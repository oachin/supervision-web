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

type MetricsPayload struct {
	OSVersion     string                `json:"osVersion,omitempty"`
	Hostname      string                `json:"hostname,omitempty"`
	Profile       string                `json:"profile,omitempty"`
	CPUPercent    float64               `json:"cpuPercent"`
	MemoryPercent float64               `json:"memoryPercent"`
	MemoryUsedMb  float64               `json:"memoryUsedMb"`
	MemoryTotalMb float64               `json:"memoryTotalMb"`
	DiskPercent   float64               `json:"diskPercent"`
	DiskUsedGb    float64               `json:"diskUsedGb"`
	DiskTotalGb   float64               `json:"diskTotalGb"`
	LoadAvg1      float64               `json:"loadAvg1"`
	LoadAvg5      float64               `json:"loadAvg5"`
	LoadAvg15     float64               `json:"loadAvg15"`
	UptimeSeconds int                   `json:"uptimeSeconds"`
	PleskDomains  *int                  `json:"pleskDomains,omitempty"`
	PleskServices map[string]string     `json:"pleskServices,omitempty"`
	PleskWebsites []PleskWebsitePayload `json:"pleskWebsites,omitempty"`
}

func main() {
	cfg := loadConfig()
	log.Printf("Havet Supervision Agent démarré (profil: %s, intervalle: %ds)", cfg.Profile, cfg.Interval)

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
