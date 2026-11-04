"""
Multicast DNS (mDNS) advertisement service.
Publishes http://<hostname>.local:<LAN_PORT> to devices on the local Wi-Fi network
(iOS, macOS, Windows, Linux).

On macOS:
  Uses Apple's native `dns-sd` CLI to register directly with `/usr/sbin/mDNSResponder`.
  This guarantees full compatibility with iOS Safari, macOS, and Windows mDNS resolvers
  without socket conflicts on UDP port 5353.

Cross-platform / Windows / Linux:
  Uses `AsyncZeroconf` bound explicitly to the machine's active LAN IP interface
  (avoiding loopback [Errno 65] on macOS and unintended virtual NICs on Windows).
"""
import asyncio
import logging
import shutil
import socket
import subprocess
import sys
from urllib.parse import urlparse
from zeroconf import IPVersion, ServiceInfo
from zeroconf.asyncio import AsyncZeroconf

from .config import LAN_PORT
from .database import get_db
from .spotify_helpers import get_lan_ip

logger = logging.getLogger("spotify-jam-app.mdns")

_aiozc: AsyncZeroconf | None = None
_service_infos: list[ServiceInfo] = []
_dns_sd_procs: list[subprocess.Popen] = []


def is_discoverable_enabled() -> bool:
    """Check if the admin has enabled network discoverability."""
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT value FROM app_settings WHERE key = 'discoverable_on_network'"
            ).fetchone()
            if row and row["value"] == "false":
                return False
    except Exception:
        pass
    return True


def get_mdns_hostname() -> str:
    """
    Get the configured .local hostname from app_settings,
    or default to 'spotifyjam.local'.
    """
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT value FROM app_settings WHERE key = 'shareable_url'"
            ).fetchone()
            if row and row["value"]:
                normalized = row["value"] if "://" in row["value"] else f"http://{row['value']}"
                parsed = urlparse(normalized)
                host = (parsed.hostname or "").strip().lower()
                if host.endswith(".local") and len(host) > 6:
                    return host
    except Exception:
        pass
    return "spotifyjam.local"


def get_bonjour_hostname() -> str:
    """Return the machine's native Bonjour hostname (e.g. 'Rithanesh-3.local')."""
    raw = socket.gethostname()
    return raw if raw.endswith(".local") else f"{raw}.local"


async def start_mdns():
    """Start broadcasting the local mDNS service and hostnames."""
    global _aiozc, _service_infos, _dns_sd_procs
    await stop_mdns()

    if not is_discoverable_enabled():
        logger.info("mDNS skipped: discoverable_on_network is disabled")
        return

    try:
        lan_ip = get_lan_ip()
        if lan_ip in ("127.0.0.1", "localhost"):
            logger.info("mDNS skipped: No active LAN interface found")
            return

        ip_bytes = socket.inet_aton(lan_ip)
        custom_hostname = get_mdns_hostname()
        bonjour_hostname = get_bonjour_hostname()

        # -----------------------------------------------------------------
        # 1. macOS native mDNSResponder registration via `dns-sd`
        # -----------------------------------------------------------------
        if sys.platform == "darwin" and shutil.which("dns-sd"):
            try:
                # Proxy registration for the custom .local hostname (e.g. spotifyjam.local)
                p_proxy = subprocess.Popen(
                    [
                        "dns-sd",
                        "-P",
                        "SpotifyJam",
                        "_http._tcp",
                        "local",
                        str(LAN_PORT),
                        custom_hostname,
                        lan_ip,
                        "path=/",
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                _dns_sd_procs.append(p_proxy)

                # Also register under native Bonjour hostname if different
                if bonjour_hostname.lower() != custom_hostname.lower():
                    p_native = subprocess.Popen(
                        [
                            "dns-sd",
                            "-R",
                            "Spotify Jam App",
                            "_http._tcp",
                            "local",
                            str(LAN_PORT),
                            "path=/",
                        ],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    _dns_sd_procs.append(p_native)

                logger.info(
                    "macOS native mDNS (dns-sd) registered: %s and %s -> %s:%d",
                    custom_hostname,
                    bonjour_hostname,
                    lan_ip,
                    LAN_PORT,
                )
            except Exception as e:
                logger.warning("Failed to start macOS dns-sd helper: %r", e)

        # -----------------------------------------------------------------
        # 2. AsyncZeroconf (Cross-platform and direct responder)
        # -----------------------------------------------------------------
        try:
            # Bind specifically to the active LAN IP interface.
            # Avoids loopback [Errno 65] on macOS and unintended virtual adapters on Windows.
            _aiozc = AsyncZeroconf(interfaces=[lan_ip], ip_version=IPVersion.V4Only)

            service_type = "_http._tcp.local."
            clean_name = custom_hostname.replace(".local", "").capitalize()
            service_name = f"{clean_name}App.{service_type}"
            server_name = f"{custom_hostname.rstrip('.')}."

            sinfo = ServiceInfo(
                service_type,
                service_name,
                addresses=[ip_bytes],
                port=LAN_PORT,
                properties={"path": "/"},
                server=server_name,
            )
            await _aiozc.async_register_service(
                sinfo,
                cooperating_responders=True,
                allow_name_change=True,
            )
            _service_infos.append(sinfo)

            # If native Bonjour hostname is different, register service record for it too
            if bonjour_hostname.lower() != custom_hostname.lower():
                bonjour_clean = bonjour_hostname.replace(".local", "").capitalize()
                bonjour_sinfo = ServiceInfo(
                    service_type,
                    f"{bonjour_clean}App.{service_type}",
                    addresses=[ip_bytes],
                    port=LAN_PORT,
                    properties={"path": "/"},
                    server=f"{bonjour_hostname.rstrip('.')}."
                )
                await _aiozc.async_register_service(
                    bonjour_sinfo,
                    cooperating_responders=True,
                    allow_name_change=True,
                )
                _service_infos.append(bonjour_sinfo)

            logger.info(
                "AsyncZeroconf active: Broadcasted http://%s:%d (IP: %s) to local network",
                custom_hostname,
                LAN_PORT,
                lan_ip,
            )
        except Exception as e:
            logger.warning("AsyncZeroconf registration warning: %r", e)

    except Exception as e:
        logger.warning("Failed to start mDNS broadcaster: %r", e)
        await stop_mdns()


async def stop_mdns():
    """Unregister and stop all mDNS services and processes asynchronously."""
    global _aiozc, _service_infos, _dns_sd_procs

    # 1. Terminate native dns-sd subprocesses
    if _dns_sd_procs:
        for p in _dns_sd_procs:
            try:
                p.terminate()
                p.wait(timeout=1.0)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
        _dns_sd_procs = []

    # 2. Unregister and close AsyncZeroconf
    if _aiozc:
        try:
            for sinfo in _service_infos:
                try:
                    await _aiozc.async_unregister_service(sinfo)
                except Exception:
                    pass
            await _aiozc.async_close()
        except Exception:
            pass
        finally:
            _aiozc = None
            _service_infos = []

    logger.info("mDNS services stopped")
