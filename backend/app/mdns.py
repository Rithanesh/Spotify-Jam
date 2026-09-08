"""
Multicast DNS (mDNS) advertisement service.
Uses Zeroconf to announce http://spotifyjam.local:<LAN_PORT> to all devices
on the local Wi-Fi network (iOS, Android, Windows, macOS, Linux).
"""
import logging
import socket
from zeroconf import IPVersion, ServiceInfo, Zeroconf

from .config import LAN_PORT
from .spotify_helpers import get_lan_ip

logger = logging.getLogger("spotify-jam-app.mdns")

_zeroconf = None
_service_info = None


def start_mdns():
    """Start broadcasting spotifyjam.local over mDNS."""
    global _zeroconf, _service_info
    if _zeroconf is not None:
        return

    try:
        lan_ip = get_lan_ip()
        if lan_ip in ("127.0.0.1", "localhost"):
            logger.info("mDNS skipped: No active LAN interface found")
            return

        ip_bytes = socket.inet_aton(lan_ip)
        _zeroconf = Zeroconf(ip_version=IPVersion.V4Only)

        _service_info = ServiceInfo(
            "_http._tcp.local.",
            "SpotifyJamApp._http._tcp.local.",
            addresses=[ip_bytes],
            port=LAN_PORT,
            properties={"path": "/"},
            server="spotifyjam.local.",
        )

        _zeroconf.register_service(_service_info, cooperating_responders=True)
        logger.info(
            "mDNS active: Broadcasted http://spotifyjam.local:%d (IP: %s) to local network",
            LAN_PORT,
            lan_ip,
        )
    except Exception as e:
        logger.warning("Failed to start mDNS broadcaster: %s", e)


def stop_mdns():
    """Unregister and stop mDNS service on shutdown."""
    global _zeroconf, _service_info
    if _zeroconf:
        try:
            if _service_info:
                _zeroconf.unregister_service(_service_info)
            _zeroconf.close()
            logger.info("mDNS service stopped")
        except Exception:
            pass
        finally:
            _zeroconf = None
            _service_info = None
