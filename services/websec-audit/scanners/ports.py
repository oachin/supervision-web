"""
scanners/ports.py
Port scanning via python-nmap (wraps the system `nmap` binary).

*** AUTHORIZATION REQUIRED ***
    Port scanning company infrastructure without WRITTEN authorization is, at
    best, a policy violation and, at worst, illegal. This module therefore
    refuses to run unless it is explicitly told authorization has been granted
    (pass authorized=True, which main.py only sets behind an --authorized flag).
    Keep the authorization email/ticket reference in your records.

Scope kept intentionally narrow for a stage project: top-100 TCP ports only.
"""

# Ports that are commonly a concern if reachable from outside. This is used to
# tag findings with a severity, not to decide what to scan.
NOTABLE_PORTS = {
    21: ("high", "FTP — often plaintext, frequently misconfigured"),
    23: ("high", "Telnet — plaintext remote administration"),
    22: ("medium", "SSH — verify it should be publicly reachable"),
    3389: ("high", "RDP — remote desktop exposed to the internet"),
    3306: ("high", "MySQL — database port should not be public"),
    5432: ("high", "PostgreSQL — database port should not be public"),
    27017: ("high", "MongoDB — database port should not be public"),
    6379: ("high", "Redis — usually unauthenticated, must not be public"),
    9200: ("high", "Elasticsearch — must not be public"),
    25: ("low", "SMTP — expected on mail servers, otherwise review"),
}


class AuthorizationError(RuntimeError):
    """Raised when a port scan is attempted without explicit authorization."""


def check_ports(host: str, authorized: bool = False, top_ports: int = 100) -> dict:
    """
    Scans the top `top_ports` TCP ports on `host` using nmap.

    Args:
        host: hostname or IP to scan.
        authorized: MUST be True or the scan is refused (see module docstring).
        top_ports: how many of nmap's most-common ports to scan (default 100).

    Returns a dict:
        - host
        - authorized: bool
        - scanned: bool
        - open_ports: list of {port, protocol, service, state, severity, note}
        - issues: list[str]  (human-readable, for scoring/report)
        - error: str | None
    """
    result = {
        "host": host,
        "authorized": authorized,
        "scanned": False,
        "open_ports": [],
        "issues": [],
        "error": None,
    }

    if not authorized:
        result["error"] = (
            "Port scan skipped: not authorized. Obtain written authorization and "
            "run with --authorized. (Descope and note in the report if unavailable.)"
        )
        return result

    try:
        import nmap
    except ImportError:
        result["error"] = "python-nmap not installed (pip install python-nmap)"
        return result

    try:
        scanner = nmap.PortScanner()
    except nmap.PortScannerError as e:
        result["error"] = f"nmap binary not found or not runnable: {e}"
        return result

    try:
        # -T4 reasonable speed; --top-ports limits scope; -Pn skips host-discovery
        # ping (many hardened hosts drop ICMP but still serve web traffic).
        scanner.scan(hosts=host, arguments=f"-Pn -T4 --top-ports {top_ports}")
    except Exception as e:
        result["error"] = f"nmap scan failed: {e}"
        return result

    result["scanned"] = True

    for scanned_host in scanner.all_hosts():
        for proto in scanner[scanned_host].all_protocols():
            for port in sorted(scanner[scanned_host][proto].keys()):
                port_info = scanner[scanned_host][proto][port]
                if port_info.get("state") != "open":
                    continue
                severity, note = NOTABLE_PORTS.get(port, ("info", ""))
                entry = {
                    "port": port,
                    "protocol": proto,
                    "service": port_info.get("name", ""),
                    "state": port_info.get("state", ""),
                    "severity": severity,
                    "note": note,
                }
                result["open_ports"].append(entry)
                label = f"Open port {port}/{proto} ({entry['service'] or 'unknown'})"
                if note:
                    label += f" — {note}"
                result["issues"].append(label)

    if not result["open_ports"]:
        result["issues"].append(f"No open ports found in top {top_ports}")

    return result
