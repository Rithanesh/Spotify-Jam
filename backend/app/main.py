import logging
import logging.handlers
import sys

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_VERSION, FRONTEND_DIR, LOG_DIR
from .database import get_db, init_db, now
from .mdns import start_mdns, stop_mdns
from .routers import auth, logs, queue, settings, spotify, users
from .scheduler import start_scheduler
from .security import hash_password

# ---- logging: rotating file + stdout, capturable by "export logs" ----
handler = logging.handlers.RotatingFileHandler(
    LOG_DIR / "app.log", maxBytes=5_000_000, backupCount=5
)
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
logging.basicConfig(level=logging.INFO, handlers=[handler, logging.StreamHandler(sys.stdout)])
logger = logging.getLogger("spotify-jam-app")

app = FastAPI(title="Spotify Jam App", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tightened by the discoverable-gate in deps.py, not CORS
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(queue.router)
app.include_router(settings.router)
app.include_router(spotify.router)
app.include_router(logs.router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error processing {request.method} {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        },
    )


@app.get("/version")
def version():
    return {"version": APP_VERSION}


# Serves the same Next.js static build to LAN browser clients
# Mounted last / at "/" so it only catches requests the API routers above didn't already match.
FRONTEND_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


@app.on_event("startup")
def on_startup():
    init_db()
    _bootstrap_admin_if_needed()
    start_scheduler()
    start_mdns()
    logger.info("app started, version=%s", APP_VERSION)


@app.on_event("shutdown")
def on_shutdown():
    stop_mdns()


def _bootstrap_admin_if_needed():
    """First run only: create the admin account with a known default
    password (admin/admin) and force a change on first login — simpler
    than a generated password buried in a log file, same security outcome
    since the account is unusable until it's changed."""
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE role = 'admin'").fetchone()
        if existing:
            return
        conn.execute(
            """INSERT INTO users (username, password_hash, role, display_name, must_change_password, created_at)
               VALUES ('admin', ?, 'admin', 'Admin', 1, ?)""",
            (hash_password("admin"), now()),
        )
        conn.commit()
    logger.warning("FIRST RUN: created admin account. username=admin password=admin — MUST be changed on first login.")
    print("\n>>> First-run login: admin / admin — you'll be forced to set a new password.\n")
