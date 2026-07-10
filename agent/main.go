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
	"runtime"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	APIURL   string
	AgentKey string
	Interval int
}

type MetricsPayload struct {
	OSVersion       string            `json:"osVersion,omitempty"`
	CPUPercent      float64           `json:"cpuPercent"`
	MemoryPercent   float64           `json:"memoryPercent"`
	MemoryUsedMb    float64           `json:"memoryUsedMb"`
	MemoryTotalMb   float64           `json:"memoryTotalMb"`
	DiskPercent     float64           `json:"diskPercent"`
	DiskUsedGb      float64           `json:"diskUsedGb"`
	DiskTotalGb     float64           `json:"diskTotalGb"`
	LoadAvg1        float64           `json:"loadAvg1"`
	LoadAvg5        float64           `json:"loadAvg5"`
	LoadAvg15       float64           `json:"loadAvg15"`
	UptimeSeconds   int               `json:"uptimeSeconds"`
	PleskDomains    *int              `json:"pleskDomains,omitempty"`
	PleskServices   map[string]string `json:"pleskServices,omitempty"`
}

func main() {
	cfg := loadConfig()
	log.Printf("Havet Supervision Agent démarré (intervalle: %ds)", cfg.Interval)

	client := &http.Client{Timeout: 30 * time.Second}

	for {
		metrics, err := collectMetrics()
		if err != nil {
			log.Printf("Erreur collecte: %v", err)
		} else {
			if err := pushMetrics(client, cfg, metrics); err != nil {
				log.Printf("Erreur envoi: %v", err)
			} else {
				log.Printf("Métriques envoyées (CPU: %.1f%%, RAM: %.1f%%, Disk: %.1f%%)",
					metrics.CPUPercent, metrics.MemoryPercent, metrics.DiskPercent)
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
	interval := 60
	if v := os.Getenv("SUPERVISION_INTERVAL"); v != "" {
		if i, err := strconv.Atoi(v); err == nil && i >= 15 {
			interval = i
		}
	}
	return Config{APIURL: strings.TrimRight(apiURL, "/"), AgentKey: agentKey, Interval: interval}
}

func collectMetrics() (*MetricsPayload, error) {
	m := &MetricsPayload{}

	// OS version
	if data, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				m.OSVersion = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
				break
			}
		}
	}

	// CPU
	m.CPUPercent = readCPUPercent()

	// Memory
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

	// Disk (root partition)
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

	// Load average
	if data, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) >= 3 {
			m.LoadAvg1, _ = strconv.ParseFloat(fields[0], 64)
			m.LoadAvg5, _ = strconv.ParseFloat(fields[1], 64)
			m.LoadAvg15, _ = strconv.ParseFloat(fields[2], 64)
		}
	}

	// Uptime
	if data, err := os.ReadFile("/proc/uptime"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) >= 1 {
			uptime, _ := strconv.ParseFloat(fields[0], 64)
			m.UptimeSeconds = int(uptime)
		}
	}

	// Plesk detection
	if _, err := os.Stat("/usr/local/psa"); err == nil {
		m.PleskServices = collectPleskServices()
		m.PleskDomains = countPleskDomains()
	}

	return m, nil
}

func readCPUPercent() float64 {
	idle1, total1 := readCPUStat()
	time.Sleep(500 * time.Millisecond)
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
	}
	return idle, total
}

func collectPleskServices() map[string]string {
	services := map[string]string{}
	names := []string{"sw-engine", "sw-cp-server", "nginx", "apache2", "httpd", "mariadb", "mysql", "postfix"}
	for _, name := range names {
		status := "stopped"
		if out, err := exec.Command("systemctl", "is-active", name).Output(); err == nil {
			s := strings.TrimSpace(string(out))
			if s == "active" {
				status = "running"
			} else {
				status = s
			}
		}
		services[name] = status
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
	req.Header.Set("User-Agent", fmt.Sprintf("HavetSupervision-Agent/%s", runtime.GOOS))

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
