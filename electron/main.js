const { app, BrowserWindow, Tray, Menu, dialog, shell, ipcMain, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let backendProcess = null;
let mainWindow = null;
let tray = null;

// Per-OS app data dir — passed to the backend so DB/logs never sit inside
// the read-only, code-signed app bundle.
const APP_DATA_DIR = app.getPath('userData');

// ---------------------------------------------------------------------------
// Load .env so Spotify credentials are available to pass to the backend.
// In dev, .env sits at the repo root; in a packaged build, try the
// extraResources directory or fall back to whatever is already in process.env.
// ---------------------------------------------------------------------------
function loadDotenvIfAvailable() {
  const candidates = [
    path.join(__dirname, '..', '.env'),                           // dev: repo root
    path.join(process.resourcesPath || '', '.env'),               // packaged: resourcesPath
    path.join(APP_DATA_DIR, '.env'),                              // user data dir
  ];
  for (const envPath of candidates) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex).trim();
            const value = trimmed.slice(eqIndex + 1).trim();
            if (!process.env[key]) {       // don't override existing env
              process.env[key] = value;
            }
          }
        }
        break; // stop after first found .env
      }
    } catch (_) { /* ignore */ }
  }
}
loadDotenvIfAvailable();

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

  // Collect last N lines of stderr for the error dialog so users can report
  // actionable crash info instead of just "exit code 1".
  const stderrLines = [];
  const MAX_STDERR_LINES = 30;

  backendProcess = spawn(cmd, args, {
    cwd: backendCwd,
    env: {
      ...process.env,
      APP_DATA_DIR,
      APP_VERSION: app.getVersion(),
      FRONTEND_DIR: resolveFrontendOutDir(),
      // Pass Spotify credentials so the backend has them even without .env
      SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID || '',
      SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET || '',
      SPOTIFY_REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:9000/api/spotify/callback',
      // Disable keyring prompts — the backend has a file-based fallback
      // in APP_DATA_DIR for the master encryption key.
      ...(isPackaged || process.platform === 'darwin'
        ? { PYTHON_KEYRING_BACKEND: 'keyring.backends.null.Keyring' }
        : {}),
    },
  });

  backendProcess.stdout.on('data', (d) => console.log(`[backend] ${d}`));
  backendProcess.stderr.on('data', (d) => {
    const text = d.toString();
    console.error(`[backend] ${text}`);
    const lines = text.split('\n').filter(Boolean);
    stderrLines.push(...lines);
    while (stderrLines.length > MAX_STDERR_LINES) stderrLines.shift();
  });
  backendProcess.on('exit', (code) => {
    if (code !== 0 && mainWindow) {
      const logPath = path.join(APP_DATA_DIR, 'logs', 'app.log');
      const lastErrors = stderrLines.length > 0
        ? `\nLast stderr output:\n${stderrLines.join('\n')}\n`
        : '';
      dialog.showErrorBox(
        'Backend stopped unexpectedly',
        `Exit code: ${code}.\n` +
        `${lastErrors}\n` +
        `This can happen if port 9000 is already in use by another instance or process.\n\n` +
        `Logs are located at:\n${logPath}`
      );
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

  session.defaultSession.clearCache();

  if (DEV_START_URL) {
    mainWindow.loadURL(DEV_START_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Show the splash / loading screen immediately while the backend starts.
    // PyInstaller --onefile binaries take 60-120s on first launch to
    // extract, so the splash keeps the user informed instead of staring
    // at a blank window.
    const splashPath = path.join(__dirname, 'splash.html');
    mainWindow.loadFile(splashPath);

    const backendUrl = 'http://127.0.0.1:9000';
    const http = require('http');

    const checkAndLoad = (retries = 240) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      http.get('http://127.0.0.1:9000/api/settings', (res) => {
        // Backend is up (even 401 Unauthorized means FastAPI is alive)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(backendUrl);
        }
      }).on('error', () => {
        if (retries > 0) {
          setTimeout(() => checkAndLoad(retries - 1), 500);
        } else {
          // Fallback if backend failed completely after ~120s
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
// so it asks the main process to do it.
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

// ---------------------------------------------------------------------------
// Spotify OAuth in an in-app window.
// Safari's HTTPS-Only mode blocks redirects to http://127.0.0.1:…, so we
// run the entire OAuth flow inside a dedicated Electron BrowserWindow
// (Chromium, which allows localhost HTTP just fine).  After the /callback
// route responds with the "Spotify connected" HTML the window auto-closes.
// ---------------------------------------------------------------------------
let spotifyAuthWindow = null;

ipcMain.handle('spotify-auth', async (_event, authUrl) => {
  if (spotifyAuthWindow && !spotifyAuthWindow.isDestroyed()) {
    spotifyAuthWindow.focus();
    return { success: true };
  }

  return new Promise((resolve) => {
    spotifyAuthWindow = new BrowserWindow({
      width: 520,
      height: 750,
      title: 'Connect Spotify',
      parent: mainWindow,
      modal: false,
      show: false,
      backgroundColor: '#191414',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Use a separate session so Spotify cookies don't leak into the main app
        partition: 'spotify-auth',
      },
    });

    spotifyAuthWindow.once('ready-to-show', () => spotifyAuthWindow.show());

    // Watch for navigation to the callback URL
    spotifyAuthWindow.webContents.on('will-navigate', (_e, navUrl) => {
      checkCallback(navUrl);
    });
    spotifyAuthWindow.webContents.on('will-redirect', (_e, navUrl) => {
      checkCallback(navUrl);
    });

    function checkCallback(navUrl) {
      try {
        const parsed = new URL(navUrl);
        // When Spotify redirects to our callback, the backend handles the
        // token exchange and returns the "connected" HTML.  We let that load,
        // then auto-close the window after a short delay so the user sees the
        // success message.
        if (
          parsed.hostname === '127.0.0.1' &&
          parsed.pathname.startsWith('/api/spotify/callback')
        ) {
          // Let the callback page load, then close after 1.5s
          spotifyAuthWindow.webContents.once('did-finish-load', () => {
            setTimeout(() => {
              if (spotifyAuthWindow && !spotifyAuthWindow.isDestroyed()) {
                spotifyAuthWindow.close();
              }
            }, 1500);
          });
        }
      } catch { /* ignore parse errors */ }
    }

    spotifyAuthWindow.on('closed', () => {
      spotifyAuthWindow = null;
      resolve({ success: true });
    });

    spotifyAuthWindow.loadURL(authUrl);
  });
});

// Enforce single instance so opening the app twice doesn't crash on port 9000
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
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

  const cleanupBackend = () => {
    if (backendProcess) {
      try {
        backendProcess.kill();
      } catch (err) {
        // ignore
      }
      backendProcess = null;
    }
  };

  app.on('before-quit', cleanupBackend);
  app.on('will-quit', cleanupBackend);
}