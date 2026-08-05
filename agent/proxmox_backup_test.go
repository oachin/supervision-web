package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMapVzdumpStatus(t *testing.T) {
	cases := []struct {
		exit, status string
		hasEnd       bool
		want         string
	}{
		{"OK", "stopped", true, "ok"},
		{"", "OK", true, "ok"},
		{"", "OK", false, "ok"},
		{"", "stopped", true, "ok"},
		{"", "running", false, "running"},
		{"", "", false, "running"},
		{"command failed", "stopped", true, "failed"},
		{"", "WARN: something", true, "warning"},
	}
	for _, tc := range cases {
		got := mapVzdumpStatus(tc.exit, tc.status, tc.hasEnd)
		if got != tc.want {
			t.Fatalf("mapVzdumpStatus(%q,%q,%v)=%q want %q", tc.exit, tc.status, tc.hasEnd, got, tc.want)
		}
	}
}

func TestParseVmidFromVolid(t *testing.T) {
	volid := "BACKUP_NAS_SUISSE:backup/vzdump-qemu-104-2026_07_23-23_50_56.vma.zst"
	vmid := parseVmidFromVolid(volid)
	if vmid == nil || *vmid != 104 {
		t.Fatalf("parseVmidFromVolid(%q)=%v want 104", volid, vmid)
	}
}

func TestIsExcludedProxmoxVmName(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"MYPLACE-AFFILIATION-105 [18]", true},
		{"MYPLACE-AFFILIATION-105[18]", true},
		{"foo [18] ", true},
		{"MYPLACE-AFFILIATION-105", false},
		{"[18]prefix", false},
		{"foo [180]", false},
		{"", false},
	}
	for _, tc := range cases {
		got := isExcludedProxmoxVmName(tc.name)
		if got != tc.want {
			t.Fatalf("isExcludedProxmoxVmName(%q)=%v want %v", tc.name, got, tc.want)
		}
	}
}

func TestExtractVMIDFromUPID(t *testing.T) {
	upid := "UPID:hyper01:000A1B2C:01D2E3F4:669A1B2C:vzdump:104:root@pam:"
	vmid := extractVMIDFromUPID(upid)
	if vmid == nil || *vmid != 104 {
		t.Fatalf("extractVMIDFromUPID=%v want 104", vmid)
	}
}

func TestProxmoxVMsEmptySliceMarshals(t *testing.T) {
	empty := []ProxmoxVmPayload{}
	m := MetricsPayload{ProxmoxVMs: &empty}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"proxmoxVms":[]`) {
		t.Fatalf("expected proxmoxVms:[], got %s", b)
	}
	m2 := MetricsPayload{}
	b2, _ := json.Marshal(m2)
	if strings.Contains(string(b2), "proxmoxVms") {
		t.Fatalf("expected omitted proxmoxVms, got %s", b2)
	}
}
