"""
Runs one uvicorn instance bound to 0.0.0.0 on the LAN port. Loopback vs.
LAN access is NOT separated at the socket level — it's gated per-request
in app/deps.py::require_discoverable_for_lan, which checks the caller's
IP against the "discoverable_on_network" setting. This keeps the toggle
instant (no socket rebind / restart needed) at the small cost of always
technically listening on 0.0.0.0. If you want true socket-level isolation
instead, run two uvicorn processes (127.0.0.1:8000 for Electron,
0.0.0.0:9000 for LAN, started/stopped together) — the routers don't change.
"""
import uvicorn

from app.config import LAN_PORT
from app.main import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=LAN_PORT, log_level="info")

