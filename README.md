# 🎵 Spotify Jam App

> An Electron desktop application (macOS & Windows) for shared, synchronized Spotify queues across local networks. One host device stays connected to the sound system; everyone else adds, votes, and reorders songs via the desktop client or any web browser on the local Wi-Fi.

---

## 📌 Overview

In group listening settings (parties, offices, hangouts), passing around a phone or giving everyone direct control over a single Bluetooth speaker often causes chaos. **Spotify Jam App** solves this by establishing a host device that manages the playback output while providing a collaborative local network portal.

> [!NOTE]
> **Important Design Note: Spotify's Queue API Limitation**  
> Spotify's Web API does **not** provide an endpoint to inspect, reorder, or delete tracks from a live device queue — only an "Add to Queue" endpoint exists.  
> To solve this, **Spotify Jam App** maintains its own queue in SQLite as the single source of truth (`backend/app/queue_engine.py`) and only pushes tracks to Spotify right as they are scheduled to play. This allows full reordering, prioritizing, and deletion of queued songs before they play!

---

## ✨ Features

- 🎧 **Host Playback Controller**: Run locally on macOS or Windows; streams audio smoothly through the host's active Spotify Connect device.
- 🌐 **Local Network Access (mDNS / LAN)**: Enable a single toggle in Settings to open the web portal on your local Wi-Fi (`http://<hostname>.local:9000` or local IP). Friends can join without installing anything!
- 🔀 **Custom Dynamic Queue**: Add songs via Spotify search, vote, reorder (move up/down), or remove unplayed tracks.
- 🔐 **Secure Role-Based Access (RBAC)**:
  - **Admin**: Control Spotify connection, toggle LAN discoverability, manage users, view system audit logs, and configure retention.
  - **Member**: Search tracks, submit songs, and interact with the shared queue.
  - Initial `admin` login enforces an immediate password change for security.
- 🎨 **Modern Aesthetics**: Sleek dark/light modes, live accent color customizer, responsive layouts, and music-themed animated loaders.
- 🛡️ **Security & Privacy**: Argon2 password hashing, secure JWT sessions, OS-keychain backed token encryption, and structured rotating audit logs.

---

## 🏗️ Project Architecture

```
spotify-jam/
├── electron/         # Electron main & preload processes (window management, backend lifecycle)
│   ├── main.js
│   └── preload.js
├── backend/          # FastAPI + SQLite backend service
│   ├── app/
│   │   ├── routers/  # Auth, Spotify, Queue, Settings, Users, Logs
│   │   ├── queue_engine.py
│   │   ├── spotify_client.py
│   │   └── schema.sql
│   ├── requirements.txt
│   └── run.py
├── frontend/         # Next.js frontend (static export)
│   ├── app/          # App router pages (dashboard, queue, settings, login)
│   ├── components/   # UI components (SpotifyPanel, ThemeToggle, etc.)
│   └── lib/          # API client & authentication guards
├── docs/             # Documentation (db-schema.md, architecture)
└── scripts/          # Cross-platform build & dev automation scripts
```

---

## 🚀 Quick Start

Automated scripts handle dependency installations, environment files, and local orchestration.

### 1. Automated Setup

```bash
# macOS / Linux
npm run setup

# Windows
scripts\setup.bat
```
*Installs frontend & root packages, creates a dedicated Python virtual environment (`backend/.venv`), and prepares `.env`.*

### 2. Configure Spotify Developer Credentials

Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard):
1. Set the **Redirect URI** to:
   ```
   http://127.0.0.1:9000/api/spotify/callback
   ```
2. Update your `.env` file with your credentials:
   ```env
   SPOTIFY_CLIENT_ID=your_client_id_here
   SPOTIFY_CLIENT_SECRET=your_client_secret_here
   ```

### 3. Run in Development

```bash
# Fast-reload dev loop (FastAPI backend + Next.js dev server in Electron)
npm run dev

# Or test the packaged Electron shell (loads static export)
npm run electron-dev
```

> **Default Admin Credentials**:
> - **Username**: `admin`
> - **Password**: `admin` *(You will be prompted to change this immediately on first login)*

---

## 🛠️ Manual Development Setup

If you prefer running components individually without the setup scripts:

### Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate    # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
python run.py                # Runs API on http://0.0.0.0:9000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                  # Runs Next.js on http://localhost:3000
```

### Electron
```bash
npm install
npm run build:frontend       # Generates static export in frontend/out
npm start
```

---

## 📦 Packaging & Distribution

Spotify Jam App can be built into standalone, self-contained desktop installers (no separate Python or Node.js runtime required for end-users):

```bash
# Build frontend static files
npm run build:frontend

# Package the Python backend with PyInstaller
npm run build:backend

# Bundle the final Electron installer (.dmg / .exe)
npm run build
```

### Cross-Platform Packaging from macOS
- **macOS DMG**: `npm run build:mac`
- **Windows Installer from Mac**: `npm run build:win`
  > *Note*: PyInstaller does not cross-compile binaries. To package a Windows installer from macOS, place the pre-compiled `spotify-jam-backend.exe` (built on Windows or CI) into `backend/dist/` and ensure `wine` is installed (`brew install --cask wine-stable`).

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
