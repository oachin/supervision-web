"""Tests for OSV cross-verification of CVEs (scanners.cve_verify).

All offline: the OSV fetcher is injected, so no network is used.
"""

from requests.exceptions import RequestException

from scanners.cve_verify import (
    _cmp,
    _range_affects,
    _status_from_record,
    _version_key,
    verify_vulns,
)


def test_version_key_parses_numeric_prefix():
    assert _version_key("1.18.0") == (1, 18, 0)
    assert _version_key("2.4.49p1") == (2, 4, 49)  # stops at non-numeric
    assert _version_key("nightly") is None


def test_cmp_handles_padding_and_unparseable():
    assert _cmp("1.18", "1.18.0") == 0
    assert _cmp("1.18.1", "1.18.0") == 1
    assert _cmp("1.17.0", "1.18.0") == -1
    assert _cmp("weird", "1.0") is None


def test_range_affects_introduced_and_fixed():
    events = [{"introduced": "1.16.0"}, {"fixed": "1.18.1"}]
    assert _range_affects("1.18.0", events) is True    # in [1.16.0, 1.18.1)
    assert _range_affects("1.18.1", events) is False   # == fixed -> patched
    assert _range_affects("1.15.0", events) is False   # before introduced


def test_range_affects_introduced_zero():
    events = [{"introduced": "0"}, {"fixed": "1.18.1"}]
    assert _range_affects("1.0.0", events) is True
    assert _range_affects("2.0.0", events) is False


def _record(package_name="nginx", introduced="1.16.0", fixed="1.18.1"):
    return {
        "id": "OSV-x", "aliases": ["CVE-2021-AAA"],
        "affected": [{
            "package": {"ecosystem": "Debian", "name": package_name},
            "ranges": [{"type": "ECOSYSTEM",
                        "events": [{"introduced": introduced}, {"fixed": fixed}]}],
        }],
    }


def test_status_affected_when_version_in_range():
    assert _status_from_record("nginx", "1.17.0", _record()) == "affected"


def test_status_not_affected_when_patched():
    # Version >= fixed -> OSV positively says not affected (false positive).
    assert _status_from_record("nginx", "1.18.1", _record()) == "not_affected"


def test_status_unknown_when_product_not_tracked():
    # OSV record is about a different package -> we can't conclude anything.
    assert _status_from_record("apache", "2.4.49", _record()) == "unknown"


def test_status_affected_via_explicit_versions_list():
    record = {"affected": [{"package": {"name": "nginx"},
                            "versions": ["1.18.0", "1.19.0"]}]}
    assert _status_from_record("nginx", "1.18.0", record) == "affected"
    assert _status_from_record("nginx", "1.20.0", record) == "not_affected"


def test_verify_vulns_drops_not_affected_and_tags_rest():
    vulns = [
        {"id": "CVE-2021-AAA", "cvss": 9.8, "severity": "critical"},  # patched
        {"id": "CVE-2021-BBB", "cvss": 7.5, "severity": "high"},      # affected
    ]

    def fetcher_patched(cve_id, timeout=10):
        if cve_id == "CVE-2021-AAA":
            return _record(introduced="1.16.0", fixed="1.17.0")  # 1.18.0 patched
        return _record(introduced="1.16.0", fixed="1.20.0")      # 1.18.0 affected

    kept = verify_vulns("nginx", "1.18.0", vulns, fetcher=fetcher_patched)
    ids = [v["id"] for v in kept]
    assert ids == ["CVE-2021-BBB"]
    assert kept[0]["osv"] == "affected"


def test_verify_vulns_keeps_all_on_fetch_error():
    vulns = [{"id": "CVE-2021-AAA", "cvss": 9.8, "severity": "critical"}]

    def boom(cve_id, timeout=10):
        raise RequestException("osv down")

    kept = verify_vulns("nginx", "1.18.0", vulns, fetcher=boom)
    assert len(kept) == 1
    assert kept[0]["osv"] == "unknown"  # fail-safe: never drop on error


def test_verify_vulns_keeps_when_osv_has_no_record():
    vulns = [{"id": "CVE-2099-ZZZ", "cvss": 5.0, "severity": "medium"}]
    kept = verify_vulns("nginx", "1.18.0", vulns, fetcher=lambda i, timeout=10: None)
    assert len(kept) == 1 and kept[0]["osv"] == "unknown"


def test_verify_vulns_ignores_non_cve_ids():
    vulns = [{"id": "GHSA-xxxx", "cvss": 5.0, "severity": "medium"}]
    called = []
    kept = verify_vulns("nginx", "1.18.0", vulns,
                        fetcher=lambda i, timeout=10: called.append(i))
    assert not called  # non-CVE ids are not looked up
    assert kept[0]["osv"] == "unknown"
