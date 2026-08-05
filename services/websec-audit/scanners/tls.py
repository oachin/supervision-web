"""
tls.py
Checks TLS/SSL configuration and certificate health using sslyze.
"""

from urllib.parse import urlparse
from datetime import datetime, timezone

from sslyze import (
    Scanner,
    ServerScanRequest,
    ServerNetworkLocation,
    ScanCommand,
)

# Protocols we consider weak/deprecated
WEAK_PROTOCOLS = {
    "ssl_2_0_cipher_suites",
    "ssl_3_0_cipher_suites",
    "tls_1_0_cipher_suites",
    "tls_1_1_cipher_suites",
}


def _hostname_from_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname or url


def check_tls(url: str) -> dict:
    """
    Runs an sslyze scan against a hostname and returns a summary dict:
        - hostname
        - cert_expiry_date: str | None
        - days_until_expiry: int | None
        - weak_protocols_supported: list[str]
        - issues: list[str]
        - error: str | None
    """
    hostname = _hostname_from_url(url)
    result = {
        "hostname": hostname,
        "cert_expiry_date": None,
        "days_until_expiry": None,
        "weak_protocols_supported": [],
        "issues": [],
        "error": None,
    }

    try:
        server_location = ServerNetworkLocation(hostname=hostname, port=443)
        scan_request = ServerScanRequest(
            server_location=server_location,
            scan_commands={
                ScanCommand.CERTIFICATE_INFO,
                ScanCommand.SSL_2_0_CIPHER_SUITES,
                ScanCommand.SSL_3_0_CIPHER_SUITES,
                ScanCommand.TLS_1_0_CIPHER_SUITES,
                ScanCommand.TLS_1_1_CIPHER_SUITES,
            },
        )

        scanner = Scanner()
        scanner.queue_scans([scan_request])

        for server_scan_result in scanner.get_results():
            if server_scan_result.scan_result is None:
                result["error"] = f"sslyze scan failed: {server_scan_result.scan_error}"
                continue
            # --- Weak protocol detection ---
            for cmd_name in [
                "ssl_2_0_cipher_suites",
                "ssl_3_0_cipher_suites",
                "tls_1_0_cipher_suites",
                "tls_1_1_cipher_suites",
            ]:
                attr = getattr(server_scan_result.scan_result, cmd_name, None)
                if attr and attr.result and attr.result.accepted_cipher_suites:
                    result["weak_protocols_supported"].append(cmd_name)
                    result["issues"].append(f"Weak protocol supported: {cmd_name}")

            # --- Certificate info ---
            cert_info = server_scan_result.scan_result.certificate_info
            if cert_info and cert_info.result:
                cert_deployments = cert_info.result.certificate_deployments
                if cert_deployments:
                    leaf_cert = cert_deployments[0].received_certificate_chain[0]
                    # Prefer the tz-aware property; fall back for older cryptography versions
                    not_after = getattr(leaf_cert, "not_valid_after_utc", None)
                    if not_after is None:
                        not_after = leaf_cert.not_valid_after
                        if not_after.tzinfo is None:
                            not_after = not_after.replace(tzinfo=timezone.utc)
                    now = datetime.now(timezone.utc)
                    days_left = (not_after - now).days

                    result["cert_expiry_date"] = not_after.strftime("%Y-%m-%d")
                    result["days_until_expiry"] = days_left

                    if days_left < 0:
                        result["issues"].append("Certificate has EXPIRED")
                    elif days_left < 14:
                        result["issues"].append(
                            f"Certificate expires soon ({days_left} days)"
                        )

                    # Hostname / trust validation issues
                    validation = cert_deployments[0].path_validation_results
                    for v in validation:
                        if not v.was_validation_successful:
                            result["issues"].append(
                                f"Certificate chain validation failed against {v.trust_store.name}"
                            )

    except Exception as e:
        result["error"] = str(e)

    return result


#if __name__ == "__main__":
#    print(check_tls("https://badssl.com"))
