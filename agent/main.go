package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	APIURL   string
	AgentKey string
	Profile  string
	Interval int
}

type PleskWebsitePayload struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type ProxmoxVmPayload struct {
	VMID       int      `json:"vmid"`
	Name       string   `json:"name"`
	Status     string   `json:"status"`
	Cpus       int      `json:"cpus"`
	MaxmemMb   float64  `json:"maxmemMb"`
	MaxdiskGb  float64  `json:"maxdiskGb"`
	CPUPercent *float64 `json:"cpuPercent,omitempty"`
	MemUsedMb  *float64 `json:"memUsedMb,omitempty"`
}

type ProxmoxBackupPayload struct {
	UPID        string `json:"upid"`
	VMID        *int   `json:"vmid,omitempty"`
	VMName      string `json:"vmName,omitempty"`
	Status      string `json:"status"`
	StartedAt   string `json:"startedAt"`
	FinishedAt  string `json:"finishedAt,omitempty"`
	DurationSec *int   `json:"durationSec,omitempty"`
	Error       string `json:"error,omitempty"`
	SizeBytes   *int64 `json:"sizeBytes,omitempty"`
}

type MetricsPayload struct {
	OSVersion      string                 `json:"osVersion,omitempty"`
	Hostname       string                 `json:"hostname,omitempty"`
	Profile        string                 `json:"profile,omitempty"`
	CPUPercent     float64                `json:"cpuPercent"`
	MemoryPercent  float64                `json:"memoryPercent"`
	MemoryUsedMb   float64                `json:"memoryUsedMb"`
	MemoryTotalMb  float64                `json:"memoryTotalMb"`
	DiskPercent    float64                `json:"diskPercent"`
	DiskUsedGb     float64                `json:"diskUsedGb"`
	DiskTotalGb    float64                `json:"diskTotalGb"`
	LoadAvg1       float64                `json:"loadAvg1"`
	LoadAvg5       float64                `json:"loadAvg5"`
	LoadAvg15      float64                `json:"loadAvg15"`
	UptimeSeconds  int                    `json:"uptimeSeconds"`
	PleskDomains   *int                   `json:"pleskDomains,omitempty"`
	PleskServices  map[string]string      `json:"pleskServices,omitempty"`
	PleskWebsites  []PleskWebsitePayload  `json:"pleskWebsites,omitempty"`
	ProxmoxVMs     *[]ProxmoxVmPayload    `json:"proxmoxVms,omitempty"`
	ProxmoxBackups []ProxmoxBackupPayload `json:"proxmoxBackups,omitempty"`
}

// agentBuildMarker is embedded so install scripts can verify the downloaded binary.
const agentBuildMarker = "havet-agent-build:2026-08-05-name18"

func main() {
	cfg := loadConfig()
	log.Printf("Havet Supervision Agent démarré (profil: %s, intervalle: %ds, %s)", cfg.Profile, cfg.Interval, agentBuildMarker)

	client := &http.Client{Timeout: 30 * time.Second}

	for {
		metrics, err := collectMetrics(cfg)
		if err != nil {
			log.Printf("Erreur collecte: %v", err)
		} else {
			if err := pushMetrics(client, cfg, metrics); err != nil {
				log.Printf("Erreur envoi: %v", err)
			} else {
				log.Printf("Métriques envoyées (CPU: %.1f%%, RAM: %.1f%%, Disk: %.1f%%)",
					metrics.CPUPercent, metrics.MemoryPercent, metrics.DiskPercent)
				if len(metrics.PleskWebsites) > 0 {
					log.Printf("Sites Plesk synchronisés: %d", len(metrics.PleskWebsites))
				}
			}
		}
		time.Sleep(time.Duration(cfg.Interval) * time.Second)
	}
}

func loadConfig() Config {
	apiURL := os.Getenv("SUPERVISION_API_URL")
	if apiURL == "" {
		apiURL = "http://localhost:4000/api"
	}
	agentKey := os.Getenv("SUPERVISION_AGENT_KEY")
	if agentKey == "" {
		log.Fatal("SUPERVISION_AGENT_KEY est requis")
	}
	profile := strings.ToLower(os.Getenv("SUPERVISION_PROFILE"))
	if profile == "" {
		profile = "linux"
	}
	interval := 60
	if v := os.Getenv("SUPERVISION_INTERVAL"); v != "" {
		if i, err := strconv.Atoi(v); err == nil && i >= 15 {
			interval = i
		}
	}
	return Config{
		APIURL:   strings.TrimRight(apiURL, "/"),
		AgentKey: agentKey,
		Profile:  profile,
		Interval: interval,
	}
}

func collectMetrics(cfg Config) (*MetricsPayload, error) {
	m := &MetricsPayload{Profile: cfg.Profile}

	if hostname, err := os.Hostname(); err == nil {
		m.Hostname = hostname
	}

	if data, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				m.OSVersion = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
				break
			}
		}
	}

	m.CPUPercent = readCPUPercent()

	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		var total, available float64
		for _, line := range strings.Split(string(data), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			val, _ := strconv.ParseFloat(fields[1], 64)
			switch fields[0] {
			case "MemTotal:":
				total = val / 1024
			case "MemAvailable:":
				available = val / 1024
			}
		}
		m.MemoryTotalMb = total
		m.MemoryUsedMb = total - available
		if total > 0 {
			m.MemoryPercent = (m.MemoryUsedMb / total) * 100
		}
	}

	if out, err := exec.Command("df", "-BG", "/").Output(); err == nil {
		lines := strings.Split(string(out), "\n")
		if len(lines) >= 2 {
			fields := strings.Fields(lines[1])
			if len(fields) >= 5 {
				totalStr := strings.TrimSuffix(fields[1], "G")
				usedStr := strings.TrimSuffix(fields[2], "G")
				m.DiskTotalGb, _ = strconv.ParseFloat(totalStr, 64)
				m.DiskUsedGb, _ = strconv.ParseFloat(usedStr, 64)
				if m.DiskTotalGb > 0 {
					m.DiskPercent = (m.DiskUsedGb / m.DiskTotalGb) * 100
				}
			}
		}
	}

	if data, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) >= 3 {
			m.LoadAvg1, _ = strconv.ParseFloat(fields[0], 64)
			m.LoadAvg5, _ = strconv.ParseFloat(fields[1], 64)
			m.LoadAvg15, _ = strconv.ParseFloat(fields[2], 64)
		}
	}

	if data, err := os.ReadFile("/proc/uptime"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) >= 1 {
			uptime, _ := strconv.ParseFloat(fields[0], 64)
			m.UptimeSeconds = int(uptime)
		}
	}

	isPlesk := cfg.Profile == "plesk" || fileExists("/usr/local/psa")
	if isPlesk {
		m.PleskServices = collectPleskServices()
		m.PleskDomains = countPleskDomains()
		if cfg.Profile == "plesk" {
			m.PleskWebsites = collectPleskWebsites()
		}
	}

	if cfg.Profile == "proxmox" {
		if node, err := localPveNode(); err == nil {
			if used, total, ok := collectProxmoxDisk(node); ok {
				m.DiskUsedGb = used
				m.DiskTotalGb = total
				if total > 0 {
					m.DiskPercent = (used / total) * 100
				}
			}
			vms := collectProxmoxVms(node)
			// Pointer so an empty inventory still serializes as [] (not omitted),
			// allowing the backend to prune VMs excluded by tag.
			if vms != nil {
				m.ProxmoxVMs = &vms
			}
			m.ProxmoxBackups = collectProxmoxBackups(node)
		} else {
			log.Printf("Proxmox: impossible de déterminer le nœud: %v", err)
		}
	}

	return m, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func readCPUPercent() float64 {
	idle1, total1 := readCPUStat()
	time.Sleep(time.Second)
	idle2, total2 := readCPUStat()

	idleDelta := idle2 - idle1
	totalDelta := total2 - total1
	if totalDelta == 0 {
		return 0
	}
	return (1.0 - float64(idleDelta)/float64(totalDelta)) * 100
}

func readCPUStat() (idle, total uint64) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0
	}
	lines := strings.Split(string(data), "\n")
	if len(lines) == 0 {
		return 0, 0
	}
	fields := strings.Fields(lines[0])
	if fields[0] != "cpu" || len(fields) < 5 {
		return 0, 0
	}
	for i := 1; i < len(fields); i++ {
		val, _ := strconv.ParseUint(fields[i], 10, 64)
		total += val
		if i == 4 {
			idle = val
		}
		if i == 5 {
			idle += val // iowait
		}
	}
	return idle, total
}

func systemdProperty(unit, property string) string {
	out, err := exec.Command("systemctl", "show", "-p", property, "--value", unit).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func findLoadedSystemdUnit(candidates ...string) string {
	for _, name := range candidates {
		unit := name
		if !strings.HasSuffix(unit, ".service") {
			unit = name + ".service"
		}
		switch systemdProperty(unit, "LoadState") {
		case "loaded", "embedded", "merged":
			return name
		}
	}
	return ""
}

func mapSystemdActiveState(active string) string {
	if active == "active" {
		return "running"
	}
	return active
}

func collectPleskServices() map[string]string {
	services := map[string]string{}
	groups := []struct {
		units    []string
		optional bool
	}{
		{[]string{"sw-engine"}, false},
		{[]string{"sw-cp-server"}, false},
		{[]string{"nginx"}, false},
		// httpd (RHEL) et apache2 (Debian) = même rôle Apache sur Plesk
		{[]string{"apache2", "httpd"}, false},
		// mariadb et mysql = même moteur selon la distro
		{[]string{"mariadb", "mysql"}, false},
		// Postfix optionnel — absent ou désactivé sans mail = pas de faux positif
		{[]string{"postfix"}, true},
	}

	for _, group := range groups {
		unit := findLoadedSystemdUnit(group.units...)
		if unit == "" {
			continue
		}

		active := systemdProperty(unit, "ActiveState")
		if group.optional {
			fileState := systemdProperty(unit, "UnitFileState")
			if fileState == "disabled" && active != "active" {
				continue
			}
		}

		services[unit] = mapSystemdActiveState(active)
	}
	return services
}

func countPleskDomains() *int {
	out, err := exec.Command("plesk", "bin", "domain", "--list").Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	count := 0
	for _, l := range lines {
		if strings.TrimSpace(l) != "" {
			count++
		}
	}
	return &count
}

func collectPleskWebsites() []PleskWebsitePayload {
	out, err := exec.Command("plesk", "bin", "domain", "--list").Output()
	if err != nil {
		log.Printf("Plesk domain list: %v", err)
		return nil
	}

	var sites []PleskWebsitePayload
	seen := map[string]bool{}

	for _, line := range strings.Split(string(out), "\n") {
		domain := strings.TrimSpace(line)
		if domain == "" || seen[domain] {
			continue
		}
		seen[domain] = true
		sites = append(sites, PleskWebsitePayload{
			Name: domain,
			URL:  "https://" + domain + "/",
		})
	}

	return sites
}

func pveshJSON(args ...string) ([]byte, error) {
	cmdArgs := append([]string{"get"}, args...)
	cmdArgs = append(cmdArgs, "--output-format", "json")
	return exec.Command("pvesh", cmdArgs...).Output()
}

func localPveNode() (string, error) {
	if node, err := localPveNodeFromCluster(); err == nil && node != "" {
		return node, nil
	}
	out, err := exec.Command("hostname", "-s").Output()
	if err != nil {
		return "", err
	}
	node := strings.TrimSpace(string(out))
	if node == "" {
		return "", fmt.Errorf("hostname -s returned empty")
	}
	return node, nil
}

func localPveNodeFromCluster() (string, error) {
	raw, err := pveshJSON("/cluster/status")
	if err != nil {
		return "", err
	}
	var items []map[string]interface{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return "", err
	}

	hostnameOut, _ := exec.Command("hostname", "-s").Output()
	hostname := strings.TrimSpace(string(hostnameOut))

	var byName string
	for _, item := range items {
		if jsonString(item, "type") != "node" {
			continue
		}
		name := jsonString(item, "name")
		if name == "" {
			continue
		}
		if local, ok := jsonNumber(item, "local"); ok && local == 1 {
			return name, nil
		}
		if hostname != "" && name == hostname {
			byName = name
		}
	}
	if byName != "" {
		return byName, nil
	}
	return "", fmt.Errorf("no local node in /cluster/status")
}

func jsonNumber(m map[string]interface{}, key string) (float64, bool) {
	v, ok := m[key]
	if !ok || v == nil {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	default:
		return 0, false
	}
}

func jsonInt(m map[string]interface{}, key string) (int, bool) {
	f, ok := jsonNumber(m, key)
	if !ok {
		return 0, false
	}
	return int(f), true
}

func jsonString(m map[string]interface{}, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch s := v.(type) {
	case string:
		return s
	default:
		return fmt.Sprint(s)
	}
}

func jsonActive(m map[string]interface{}) bool {
	v, ok := m["active"]
	if !ok || v == nil {
		return false
	}
	switch a := v.(type) {
	case float64:
		return a == 1
	case bool:
		return a
	case json.Number:
		f, err := a.Float64()
		return err == nil && f == 1
	case string:
		return a == "1" || strings.EqualFold(a, "true")
	default:
		return false
	}
}

func collectProxmoxDisk(node string) (usedGb, totalGb float64, ok bool) {
	raw, err := pveshJSON("/nodes/" + node + "/storage")
	if err != nil {
		log.Printf("Proxmox storage: %v", err)
		return 0, 0, false
	}
	var storages []map[string]interface{}
	if err := json.Unmarshal(raw, &storages); err != nil {
		log.Printf("Proxmox storage JSON: %v", err)
		return 0, 0, false
	}

	localTypes := map[string]bool{
		"dir": true, "lvm": true, "lvmthin": true, "zfspool": true,
	}
	var usedBytes, totalBytes float64
	found := false
	for _, s := range storages {
		if !jsonActive(s) || !localTypes[jsonString(s, "type")] {
			continue
		}
		used, hasUsed := jsonNumber(s, "used")
		total, hasTotal := jsonNumber(s, "total")
		if !hasTotal {
			if avail, hasAvail := jsonNumber(s, "avail"); hasAvail && hasUsed {
				total = used + avail
				hasTotal = true
			}
		}
		if !hasUsed || !hasTotal || total <= 0 {
			continue
		}
		usedBytes += used
		totalBytes += total
		found = true
	}
	if !found || totalBytes <= 0 {
		return 0, 0, false
	}
	return usedBytes / (1024 * 1024 * 1024), totalBytes / (1024 * 1024 * 1024), true
}

// excludedProxmoxVmNameSuffix marks VMs to skip from inventory (name ends with this).
const excludedProxmoxVmNameSuffix = "[18]"

func isExcludedProxmoxVmName(name string) bool {
	return strings.HasSuffix(strings.TrimSpace(name), excludedProxmoxVmNameSuffix)
}

func collectProxmoxVms(node string) []ProxmoxVmPayload {
	raw, err := pveshJSON("/nodes/" + node + "/qemu")
	if err != nil {
		log.Printf("Proxmox qemu list: %v", err)
		return nil
	}
	var items []map[string]interface{}
	if err := json.Unmarshal(raw, &items); err != nil {
		log.Printf("Proxmox qemu JSON: %v", err)
		return nil
	}

	vms := make([]ProxmoxVmPayload, 0, len(items))
	for _, item := range items {
		vmid, ok := jsonInt(item, "vmid")
		if !ok {
			continue
		}
		name := jsonString(item, "name")
		if isExcludedProxmoxVmName(name) {
			log.Printf("Proxmox: exclusion VM %d (%s) suffix %s", vmid, name, excludedProxmoxVmNameSuffix)
			continue
		}
		maxmem, _ := jsonNumber(item, "maxmem")
		maxdisk, _ := jsonNumber(item, "maxdisk")
		cpus, _ := jsonInt(item, "cpus")
		vm := ProxmoxVmPayload{
			VMID:      vmid,
			Name:      name,
			Status:    jsonString(item, "status"),
			Cpus:      cpus,
			MaxmemMb:  maxmem / (1024 * 1024),
			MaxdiskGb: maxdisk / (1024 * 1024 * 1024),
		}
		if vm.Status == "running" {
			statusRaw, err := pveshJSON(fmt.Sprintf("/nodes/%s/qemu/%d/status/current", node, vmid))
			if err != nil {
				log.Printf("Proxmox qemu %d status: %v", vmid, err)
			} else {
				var st map[string]interface{}
				if err := json.Unmarshal(statusRaw, &st); err != nil {
					log.Printf("Proxmox qemu %d status JSON: %v", vmid, err)
				} else {
					if cpu, ok := jsonNumber(st, "cpu"); ok {
						pct := cpu * 100
						vm.CPUPercent = &pct
					}
					if mem, ok := jsonNumber(st, "mem"); ok {
						mb := mem / (1024 * 1024)
						vm.MemUsedMb = &mb
					}
					if maxmemLive, ok := jsonNumber(st, "maxmem"); ok && maxmemLive > 0 {
						vm.MaxmemMb = maxmemLive / (1024 * 1024)
					}
					if cpusLive, ok := jsonInt(st, "cpus"); ok && cpusLive > 0 {
						vm.Cpus = cpusLive
					}
				}
			}
		}
		vms = append(vms, vm)
	}
	return vms
}

func collectProxmoxBackups(node string) []ProxmoxBackupPayload {
	byUPID := make(map[string]ProxmoxBackupPayload)

	for _, b := range collectProxmoxBackupTasks(node) {
		byUPID[b.UPID] = b
	}
	// Storage content is the source of truth for successful archives
	// (same list as the Proxmox "Backup" tab). Tasks alone are pruned
	// quickly and can miss overnight vzdump jobs.
	for _, b := range collectProxmoxBackupContent(node) {
		if _, exists := byUPID[b.UPID]; exists {
			continue
		}
		byUPID[b.UPID] = b
	}

	backups := make([]ProxmoxBackupPayload, 0, len(byUPID))
	for _, b := range byUPID {
		backups = append(backups, b)
	}
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].StartedAt > backups[j].StartedAt
	})
	return backups
}

func collectProxmoxBackupTasks(node string) []ProxmoxBackupPayload {
	raw, err := pveshJSON("/nodes/"+node+"/tasks", "--typefilter", "vzdump", "--limit", "100")
	var items []map[string]interface{}
	if err != nil {
		raw, err = pveshJSON("/nodes/"+node+"/tasks", "--limit", "500")
		if err != nil {
			log.Printf("Proxmox tasks: %v", err)
			return nil
		}
		if err := json.Unmarshal(raw, &items); err != nil {
			log.Printf("Proxmox tasks JSON: %v", err)
			return nil
		}
		filtered := items[:0]
		for _, item := range items {
			if jsonString(item, "type") == "vzdump" {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	} else if err := json.Unmarshal(raw, &items); err != nil {
		log.Printf("Proxmox vzdump tasks JSON: %v", err)
		return nil
	}

	sort.Slice(items, func(i, j int) bool {
		si, _ := jsonNumber(items[i], "starttime")
		sj, _ := jsonNumber(items[j], "starttime")
		return si > sj
	})
	if len(items) > 100 {
		items = items[:100]
	}

	backups := make([]ProxmoxBackupPayload, 0, len(items))
	for _, item := range items {
		upid := jsonString(item, "upid")
		if upid == "" {
			continue
		}
		startUnix, hasStart := jsonNumber(item, "starttime")
		if !hasStart {
			continue
		}
		endUnix, hasEnd := jsonNumber(item, "endtime")
		taskStatus := jsonString(item, "status")
		exitstatus := jsonString(item, "exitstatus")

		vmid := parseVzdumpVMID(jsonString(item, "id"), exitstatus, upid)
		status := mapVzdumpStatus(exitstatus, taskStatus, hasEnd)

		b := ProxmoxBackupPayload{
			UPID:      upid,
			VMID:      vmid,
			VMName:    jsonString(item, "vmname"),
			Status:    status,
			StartedAt: time.Unix(int64(startUnix), 0).UTC().Format(time.RFC3339),
		}

		if hasEnd {
			b.FinishedAt = time.Unix(int64(endUnix), 0).UTC().Format(time.RFC3339)
			dur := int(endUnix - startUnix)
			if dur < 0 {
				dur = 0
			}
			b.DurationSec = &dur
		}
		if b.Status == "failed" {
			if exitstatus != "" {
				b.Error = exitstatus
			} else if taskStatus != "" && !isTaskRunState(taskStatus) {
				b.Error = taskStatus
			}
		}
		if size, ok := jsonNumber(item, "size"); ok {
			sb := int64(size)
			b.SizeBytes = &sb
		}
		backups = append(backups, b)
	}
	return backups
}

func collectProxmoxBackupContent(node string) []ProxmoxBackupPayload {
	raw, err := pveshJSON("/nodes/" + node + "/storage")
	if err != nil {
		log.Printf("Proxmox storage (backups): %v", err)
		return nil
	}
	var storages []map[string]interface{}
	if err := json.Unmarshal(raw, &storages); err != nil {
		log.Printf("Proxmox storage JSON (backups): %v", err)
		return nil
	}

	cutoff := time.Now().UTC().Add(-14 * 24 * time.Hour)
	backups := make([]ProxmoxBackupPayload, 0, 64)

	for _, s := range storages {
		if !jsonActive(s) {
			continue
		}
		storage := jsonString(s, "storage")
		if storage == "" {
			continue
		}
		contentField := jsonString(s, "content")
		if contentField != "" && !strings.Contains(contentField, "backup") {
			continue
		}

		craw, err := pveshJSON(
			"/nodes/"+node+"/storage/"+storage+"/content",
			"--content", "backup",
		)
		if err != nil {
			continue
		}
		var items []map[string]interface{}
		if err := json.Unmarshal(craw, &items); err != nil {
			log.Printf("Proxmox storage %s content JSON: %v", storage, err)
			continue
		}

		for _, item := range items {
			volid := jsonString(item, "volid")
			ctime, hasCtime := jsonNumber(item, "ctime")
			if volid == "" || !hasCtime {
				continue
			}
			finished := time.Unix(int64(ctime), 0).UTC()
			if finished.Before(cutoff) {
				continue
			}

			var vmid *int
			if id, ok := jsonInt(item, "vmid"); ok {
				vmid = &id
			} else {
				vmid = parseVmidFromVolid(volid)
			}

			b := ProxmoxBackupPayload{
				UPID:       "content:" + volid,
				VMID:       vmid,
				VMName:     jsonString(item, "notes"),
				Status:     "ok",
				StartedAt:  finished.Format(time.RFC3339),
				FinishedAt: finished.Format(time.RFC3339),
			}
			if size, ok := jsonNumber(item, "size"); ok {
				sb := int64(size)
				b.SizeBytes = &sb
			}
			backups = append(backups, b)
		}
	}

	// Keep at most 5 newest archives per VM to bound payload size
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].StartedAt > backups[j].StartedAt
	})
	perVM := make(map[int]int)
	trimmed := backups[:0]
	for _, b := range backups {
		if b.VMID == nil {
			trimmed = append(trimmed, b)
			continue
		}
		n := perVM[*b.VMID]
		if n >= 5 {
			continue
		}
		perVM[*b.VMID] = n + 1
		trimmed = append(trimmed, b)
	}
	return trimmed
}

func parseVmidFromVolid(volid string) *int {
	// BACKUP:backup/vzdump-qemu-104-2026_07_23-23_50_56.vma.zst
	base := volid
	if i := strings.LastIndex(volid, "/"); i >= 0 {
		base = volid[i+1:]
	}
	for _, prefix := range []string{"vzdump-qemu-", "vzdump-lxc-"} {
		if strings.HasPrefix(base, prefix) {
			rest := base[len(prefix):]
			num := ""
			for _, r := range rest {
				if r >= '0' && r <= '9' {
					num += string(r)
				} else {
					break
				}
			}
			if n, err := strconv.Atoi(num); err == nil {
				return &n
			}
		}
	}
	return nil
}

func parseVzdumpVMID(id, statusText, upid string) *int {
	if vmid := extractVMID(id); vmid != nil {
		return vmid
	}
	if vmid := extractVMIDFromUPID(upid); vmid != nil {
		return vmid
	}
	return extractVMID(statusText)
}

func extractVMIDFromUPID(upid string) *int {
	// UPID:node:pid:pstart:starttime:type:id:user@realm:
	parts := strings.Split(upid, ":")
	if len(parts) < 7 {
		return nil
	}
	id := parts[6]
	if id == "" {
		return nil
	}
	return extractVMID(id)
}

func isTaskRunState(s string) bool {
	s = strings.TrimSpace(s)
	return strings.EqualFold(s, "running") || strings.EqualFold(s, "stopped")
}

func extractVMID(s string) *int {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	// vzdump:100 or qemu:100 style
	if idx := strings.LastIndex(s, ":"); idx >= 0 && idx+1 < len(s) {
		tail := s[idx+1:]
		if n, err := strconv.Atoi(tail); err == nil {
			return &n
		}
	}
	// bare number
	if n, err := strconv.Atoi(s); err == nil {
		return &n
	}
	// scan for digits after common prefixes
	for _, prefix := range []string{"VMID ", "vmid ", "VM "} {
		if i := strings.Index(strings.ToLower(s), strings.ToLower(prefix)); i >= 0 {
			rest := strings.TrimSpace(s[i+len(prefix):])
			num := ""
			for _, r := range rest {
				if r >= '0' && r <= '9' {
					num += string(r)
				} else {
					break
				}
			}
			if n, err := strconv.Atoi(num); err == nil {
				return &n
			}
		}
	}
	return nil
}

func mapVzdumpStatus(exitstatus, taskStatus string, hasEndtime bool) string {
	ts := strings.TrimSpace(taskStatus)
	es := strings.TrimSpace(exitstatus)

	if strings.EqualFold(ts, "running") {
		return "running"
	}

	// Prefer exitstatus from /tasks/{upid}/status. On the task index,
	// Proxmox often stores the exit result in "status" ("OK" / error text),
	// while "stopped"/"running" are run-states and must not mean failure.
	result := es
	if result == "" && !isTaskRunState(ts) {
		result = ts
	}
	if result == "" && !hasEndtime {
		return "running"
	}
	if result == "" || strings.EqualFold(result, "OK") {
		return "ok"
	}
	if strings.Contains(strings.ToLower(result), "warn") {
		return "warning"
	}
	return "failed"
}

func pushMetrics(client *http.Client, cfg Config, metrics *MetricsPayload) error {
	body, err := json.Marshal(metrics)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", cfg.APIURL+"/agent/metrics", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Key", cfg.AgentKey)
	req.Header.Set("User-Agent", fmt.Sprintf("HavetSupervision-Agent/%s-%s", cfg.Profile, runtime.GOOS))

	if u, err := user.Current(); err == nil {
		req.Header.Set("X-Agent-User", u.Username)
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= 400 {
		return fmt.Errorf("API returned %d", resp.StatusCode)
	}
	return nil
}
