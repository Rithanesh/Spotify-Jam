const { app, BrowserWindow, Tray, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let backendProcess = null;
let mainWindow = null;
let tray = null;

// Per-OS app data dir — passed to the backend so DB/logs never sit inside
// the read-only, code-signed app bundle.
const APP_DATA_DIR = app.getPath('userData');

function resolveBackendBinary() {
  const binName = process.platform === 'win32' ? 'spotify-jam-backend.exe' : 'spotify-jam-backend';
  const packaged = path.join(process.resourcesPath, 'backend', binName);
  const devBinary = path.join(__dirname, '..', 'backend', 'dist', binName);
  if (fs.existsSync(packaged)) return { cmd: packaged, args: [] };
  if (fs.existsSync(devBinary)) return { cmd: devBinary, args: [] };

  // No PyInstaller build yet — run straight from the venv created by
  // scripts/setup.sh, so `npm run electron-dev` works with zero build step.
  const venvPython = process.platform === 'win32'
    ? path.join(__dirname, '..', 'backend', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', 'backend', '.venv', 'bin', 'python3');
  const pythonCmd = fs.existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3');
  return { cmd: pythonCmd, args: [path.join(__dirname, '..', 'backend', 'run.py')] };
}

function resolveFrontendOutDir() {
  const packaged = path.join(process.resourcesPath, 'frontend-out');
  const dev = path.join(__dirname, '..', 'frontend', 'out');
  return fs.existsSync(packaged) ? packaged : dev;
}

function startBackend() {
  const { cmd, args } = resolveBackendBinary();
  const isPackaged = app.isPackaged;
  const backendCwd = isPackaged 
    ? path.join(process.resourcesPath, 'backend') 
    : path.join(__dirname, '..', 'backend');

  backendProcess = spawn(cmd, args, {
    cwd: backendCwd,
    env: {
      ...process.env,
      APP_DATA_DIR,
      APP_VERSION: app.getVersion(),
      FRONTEND_DIR: resolveFrontendOutDir(), // lets the backend serve the app to LAN browsers too
    },
  });

  backendProcess.stdout.on('data', (d) => console.log(`[backend] ${d}`));
  backendProcess.stderr.on('data', (d) => console.error(`[backend] ${d}`));
  backendProcess.on('exit', (code) => {
    if (code !== 0 && mainWindow) {
      dialog.showErrorBox('Backend stopped unexpectedly', `Exit code: ${code}. Check the logs.`);
    }
  });
}

// Dev mode: point at the Next.js dev server (hot reload) instead of the
// static export, and skip spawning our own backend since scripts/dev.sh
// already started one — avoids two backends fighting over port 9000.
const DEV_START_URL = process.env.ELECTRON_START_URL;
const SKIP_BACKEND = process.env.ELECTRON_SKIP_BACKEND === '1';

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#14151A', // matches dark theme default — avoids a white flash on load
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (DEV_START_URL) {
    mainWindow.loadURL(DEV_START_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Packaged/production: wait until backend HTTP server is ready before loading
    const backendUrl = 'http://127.0.0.1:9000';
    const http = require('http');

    const checkAndLoad = (retries = 50) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      http.get('http://127.0.0.1:9000/api/settings', (res) => {
        // Backend is up (even 401 Unauthorized means FastAPI is alive)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(backendUrl);
        }
      }).on('error', () => {
        if (retries > 0) {
          setTimeout(() => checkAndLoad(retries - 1), 300);
        } else {
          // Fallback if backend failed completely
          const fallbackPath = path.join(resolveFrontendOutDir(), 'index.html');
          if (fs.existsSync(fallbackPath) && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadFile(fallbackPath);
          }
        }
      });
    };

    checkAndLoad();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    if (!fs.existsSync(iconPath)) return;
    tray = new Tray(iconPath);
    tray.setToolTip('Spotify Jam App');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open', click: () => mainWindow?.show() },
      { label: 'Quit', click: () => app.quit() },
    ]));
  } catch (err) {
    console.warn('[tray] Failed to initialize tray:', err.message);
  }
}

// Renderer can't call shell.openExternal directly (contextIsolation is on),
// so it asks the main process to do it — used for the Spotify OAuth flow,
// which has to happen in the OS browser, not inside the app's own window.
ipcMain.handle('open-external', async (_event, url) => {
  try {
    const parsed = new URL(url);
    const allowedHosts = ['accounts.spotify.com', 'developer.spotify.com', 'open.spotify.com', 'spotify.com'];
    const isAllowed = allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
    if (isAllowed) {
      await shell.openExternal(url);
      return { success: true };
    }
    console.warn(`[open-external] Blocked opening untrusted URL: ${url}`);
    return { success: false, error: 'URL domain not allowed' };
  } catch (err) {
    console.error(`[open-external] Failed to open external URL ${url}:`, err);
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  if (!SKIP_BACKEND) startBackend();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
});