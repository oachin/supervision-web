const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /** Epoch ms when access token should be considered expired */
  expiresAt?: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  totpEnabled: boolean;
}

class ApiClient {
  private refreshInFlight: Promise<boolean> | null = null;

  private getTokens(): AuthTokens | null {
    if (typeof window === 'undefined') return null;
    const data = localStorage.getItem('auth');
    return data ? JSON.parse(data) : null;
  }

  private setTokens(tokens: AuthTokens | null) {
    if (tokens) {
      const expiresAt =
        tokens.expiresAt ?? Date.now() + Math.max(tokens.expiresIn, 60) * 1000;
      localStorage.setItem('auth', JSON.stringify({ ...tokens, expiresAt }));
    } else {
      localStorage.removeItem('auth');
    }
  }

  getAccessToken(): string | null {
    return this.getTokens()?.accessToken ?? null;
  }

  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  }

  logout() {
    this.setTokens(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  /** True if access token is missing or expires within `skewMs`. */
  needsRefresh(skewMs = 120_000): boolean {
    const tokens = this.getTokens();
    if (!tokens?.refreshToken) return false;
    if (!tokens.accessToken) return true;
    if (!tokens.expiresAt) return true;
    return Date.now() >= tokens.expiresAt - skewMs;
  }

  /**
   * Proactively refresh the session (NOC / wall displays).
   * Safe to call often — shares one in-flight refresh.
   */
  async keepAlive(): Promise<boolean> {
    if (!this.getTokens()?.refreshToken) return false;
    return this.refreshToken();
  }

  private async refreshToken(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      const tokens = this.getTokens();
      if (!tokens?.refreshToken) return false;

      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        this.setTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresIn: data.expiresIn,
          expiresAt: Date.now() + Math.max(data.expiresIn ?? 900, 60) * 1000,
        });
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      this.refreshInFlight = null;
    });

    return this.refreshInFlight;
  }

  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (this.needsRefresh()) {
      await this.refreshToken();
    }

    const token = this.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res = await fetch(`${API_URL}/api${path}`, { ...options, headers });

    if (res.status === 401 && token) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.getAccessToken()}`;
        res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
      } else {
        this.logout();
        throw new Error('Session expirée');
      }
    }

    if (res.status === 429) {
      throw new Error('Trop de requêtes, réessayez dans quelques secondes.');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Erreur serveur' }));
      const message = typeof err.message === 'string'
        ? err.message.replace(/^ThrottlerException:\s*/i, '')
        : `HTTP ${res.status}`;
      throw new Error(message || `HTTP ${res.status}`);
    }

    return res.json();
  }

  async login(email: string, password: string) {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Identifiants invalides');
    return data as { requiresTotp?: boolean; tempToken?: string } & Partial<AuthTokens & { user: User }>;
  }

  async verifyTotp(tempToken: string, code: string) {
    const res = await fetch(`${API_URL}/api/auth/verify-totp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Code invalide');
    this.setTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
    });
    return data;
  }

  saveTokens(tokens: AuthTokens) {
    this.setTokens(tokens);
  }

  // Dashboard
  getDashboard() { return this.fetch<DashboardData>('/dashboard'); }
  getNocState() { return this.fetch<NocState>('/noc/state'); }
  getSystemHealth() { return this.fetch<SystemHealth>('/system/health'); }

  // Servers
  getServers() { return this.fetch<ServerWithHistory[]>('/servers'); }
  getServer(id: string) { return this.fetch<ServerDetail>(`/servers/${id}`); }
  getServerMetrics(id: string, hours = 24) { return this.fetch<ServerMetric[]>(`/servers/${id}/metrics?hours=${hours}`); }
  createServer(data: CreateServerData) { return this.fetch<ServerCreateResult>('/servers', { method: 'POST', body: JSON.stringify(data) }); }
  updateServer(id: string, data: Partial<CreateServerData>) { return this.fetch<Server>(`/servers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  deleteServer(id: string) { return this.fetch(`/servers/${id}`, { method: 'DELETE' }); }
  regenerateServerKey(id: string) { return this.fetch<{ agentKeyPlain: string; installUrl: string; installCommand: string }>(`/servers/${id}/regenerate-key`, { method: 'POST' }); }

  getProxmoxVms(serverId: string) {
    return this.fetch<ProxmoxVm[]>(`/servers/${serverId}/proxmox/vms`);
  }
  getAllProxmoxVms() {
    return this.fetch<ProxmoxVmWithServer[]>('/servers/proxmox/vms');
  }
  getProxmoxVm(vmId: string) {
    return this.fetch<ProxmoxVmWithServer>(`/servers/proxmox/vms/${vmId}`);
  }
  getProxmoxVmMetrics(serverId: string, vmid: number, from?: string, to?: string) {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return this.fetch<ProxmoxVmMetric[]>(
      `/servers/${serverId}/proxmox/vms/${vmid}/metrics${qs ? `?${qs}` : ''}`,
    );
  }
  getProxmoxBackups(serverId: string, limit = 50) {
    return this.fetch<ProxmoxBackup[]>(`/servers/${serverId}/proxmox/backups?limit=${limit}`);
  }

  // Websites
  getWebsites() { return this.fetch<WebsiteWithHistory[]>('/websites'); }
  getWebsite(id: string) { return this.fetch<WebsiteDetail>(`/websites/${id}`); }
  createWebsite(data: CreateWebsiteData) { return this.fetch<Website>('/websites', { method: 'POST', body: JSON.stringify(data) }); }
  updateWebsite(id: string, data: Partial<CreateWebsiteData>) { return this.fetch<Website>(`/websites/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  deleteWebsite(id: string) { return this.fetch(`/websites/${id}`, { method: 'DELETE' }); }

  // Users
  getUsers() { return this.fetch<ManagedUser[]>('/users'); }
  createUser(data: { email: string; name: string; password: string; role?: string }) {
    return this.fetch('/users', { method: 'POST', body: JSON.stringify(data) });
  }
  updateUser(id: string, data: { name?: string; role?: string; isActive?: boolean }) {
    return this.fetch(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  deleteUser(id: string) { return this.fetch(`/users/${id}`, { method: 'DELETE' }); }

  // Notifications
  getSmtpSettings() { return this.fetch<SmtpSettings>('/notifications/smtp'); }
  saveSmtpSettings(data: UpsertSmtpSettingsData) {
    return this.fetch<SmtpSettings>('/notifications/smtp', { method: 'PUT', body: JSON.stringify(data) });
  }
  testSmtp(to: string) {
    return this.fetch<{ success: boolean }>('/notifications/smtp/test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    });
  }
  getNotificationRules() { return this.fetch<NotificationRule[]>('/notifications/rules'); }
  createNotificationRule(data: NotificationRuleInput) {
    return this.fetch<NotificationRule>('/notifications/rules', { method: 'POST', body: JSON.stringify(data) });
  }
  updateNotificationRule(id: string, data: Partial<NotificationRuleInput>) {
    return this.fetch<NotificationRule>(`/notifications/rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  deleteNotificationRule(id: string) {
    return this.fetch(`/notifications/rules/${id}`, { method: 'DELETE' });
  }

  // Alerts
  getAlertsPopup() { return this.fetch<Alert[]>('/alerts/popup'); }
  getAlertsSummary() { return this.fetch<AlertSummary>('/alerts/summary'); }
  getAlertEvents(limit = 200) { return this.fetch<AlertEvent[]>(`/alerts/events?limit=${limit}`); }
  getAlerts(status?: string) { return this.fetch<Alert[]>(status ? `/alerts?status=${status}` : '/alerts'); }
  getAlert(id: string) { return this.fetch<AlertDetail>(`/alerts/${id}`); }
  acknowledgeAlert(id: string) { return this.fetch<Alert>(`/alerts/${id}/acknowledge`, { method: 'PATCH' }); }
  addAlertNote(id: string, message: string) {
    return this.fetch<AlertDetail>(`/alerts/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }
  closeAlert(id: string, origin: string, resolutionMethod: string) {
    return this.fetch<Alert>(`/alerts/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ origin, resolutionMethod }),
    });
  }

  // Auth profile
  getProfile() { return this.fetch<User>('/auth/me'); }
  setupTotp() { return this.fetch<{ secret: string; qrCode: string }>('/auth/totp/setup', { method: 'POST' }); }
  enableTotp(code: string) { return this.fetch<{ backupCodes: string[] }>('/auth/totp/enable', { method: 'POST', body: JSON.stringify({ code }) }); }
  disableTotp(password: string) { return this.fetch('/auth/totp/disable', { method: 'POST', body: JSON.stringify({ password }) }); }
  changePassword(currentPassword: string, newPassword: string) {
    return this.fetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
  }
}

export const api = new ApiClient();

export interface DashboardData {
  summary: {
    servers: { total: number; online: number; offline: number; degraded: number };
    websites: { total: number; up: number; down: number; degraded: number; maintenance: number; disabled: number };
    activeAlerts: number;
  };
  recentAlerts: Alert[];
  servers: ServerSummary[];
  websites: WebsiteSummary[];
  disabledWebsites: { id: string; name: string; url: string; lastCheckAt?: string }[];
}

export interface SystemHealth {
  status: 'operational' | 'degraded';
  label: string;
  checkedAt: string;
  components: {
    id: string;
    name: string;
    container: string;
    status: 'up' | 'down';
    message: string;
    latencyMs?: number;
  }[];
  faults: string[];
}

export interface Server {
  id: string;
  name: string;
  hostname: string;
  ipAddress?: string;
  osType: string;
  osVersion?: string;
  profile: 'LINUX' | 'PLESK' | 'PROXMOX';
  hasPlesk: boolean;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'UNKNOWN';
  lastSeenAt?: string;
  tags: string[];
  notes?: string;
  _count?: { websites: number; metrics: number };
}

export interface ServerMetricPoint {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  collectedAt: string;
}

export interface ServerWithHistory extends Server {
  metrics: ServerMetricPoint[];
}

export interface ServerCreateResult extends Server {
  agentKeyPlain: string;
  installUrl: string;
  installCommand: string;
}

export interface ServerSummary extends Server {
  metrics: { cpuPercent: number; memoryPercent: number; diskPercent: number; collectedAt: string }[];
}

export interface ServerDetail extends Server {
  websites: {
    id: string;
    name: string;
    url: string;
    status: string;
    lastStatusCode?: number | null;
    monitoringEnabled: boolean;
  }[];
  metrics: ServerMetric[];
}

export interface ServerMetric {
  id: string;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  diskPercent: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
  loadAvg1: number;
  pleskServices?: Record<string, string>;
  collectedAt: string;
}

export interface Website {
  id: string;
  name: string;
  url: string;
  status: 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  monitoringEnabled: boolean;
  checkInterval: number;
  sslAlertDays?: number;
  lastCheckAt?: string;
  lastResponseMs?: number;
  lastStatusCode?: number;
  sslExpiresAt?: string;
  sslDaysRemaining?: number;
  sslIssuer?: string;
  sslSubject?: string;
  lastDnsOk?: boolean;
  lastPort443Open?: boolean;
  lastTlsVersion?: string;
  server?: { id: string; name: string; hostname: string };
}

export interface WebsiteCheckPoint {
  status: string;
  responseMs?: number;
  checkedAt: string;
}

export interface WebsiteWithHistory extends Website {
  checks: WebsiteCheckPoint[];
}

export interface WebsiteCheck {
  id: string;
  status: string;
  statusCode?: number;
  responseMs?: number;
  sslValid?: boolean;
  sslChainValid?: boolean;
  sslDaysRemaining?: number;
  sslIssuer?: string;
  tlsVersion?: string;
  dnsOk?: boolean;
  port443Open?: boolean;
  errorMessage?: string;
  checkedAt: string;
}

export interface WebsiteSummary extends Website {}
export interface WebsiteDetail extends Website {
  checks: WebsiteCheck[];
}

export interface Alert {
  id: string;
  title: string;
  message: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'PENDING_CLOSE' | 'CLOSED';
  occurrenceCount: number;
  acknowledged: boolean;
  resolved: boolean;
  acknowledgedAt?: string;
  snoozedUntil?: string;
  issueResolvedAt?: string;
  origin?: string;
  resolutionMethod?: string;
  closedAt?: string;
  createdAt: string;
  server?: { id?: string; name: string; hostname?: string };
  website?: {
    id?: string;
    name: string;
    url: string;
    serverId?: string;
    server?: { id: string; name: string; hostname?: string };
  };
  serverId?: string;
  websiteId?: string;
  acknowledgedBy?: { id: string; name: string; email: string };
  closedBy?: { id: string; name: string; email: string };
}

export interface AlertDetail extends Alert {
  events: AlertEvent[];
}

export interface AlertSummary {
  counts: {
    active: number;
    acknowledged: number;
    pendingClose: number;
    closed: number;
  };
  active: Alert[];
  acknowledged: Alert[];
  pendingClose: Alert[];
  closed: Alert[];
}

export interface AlertEvent {
  id: string;
  action: string;
  message?: string;
  details?: Record<string, unknown>;
  createdAt: string;
  alertTitle?: string;
  alertSeverity?: string;
  resourceName?: string;
  resourceType?: string;
  user?: { id: string; name: string; email: string };
  alert?: {
    id: string;
    title: string;
    severity: string;
    status: string;
    occurrenceCount: number;
    server?: { name: string };
    website?: { name: string };
  };
}

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt?: string;
}

export interface NocHostSites {
  total: number;
  ok: number;
  maintenance: number;
  degraded: number;
  down: number;
  off: number;
}

export interface NocHostVms {
  total: number;
  ok: number;
  stopped: number;
}

export interface NocHost {
  id: string;
  name: string;
  hostname: string;
  tags: string[];
  type: 'web' | 'hyperviseur';
  status: 'ok' | 'degraded' | 'critical';
  sites: NocHostSites | null;
  vms: NocHostVms | null;
  downSites: string[];
  metrics: {
    cpu: number | null;
    ram: number | null;
    latency_ms: number | null;
    uptimeSeconds: number | null;
    series: { cpu: number[]; ram: number[] };
  };
  incidentSince: string | null;
}

export interface NocAlertFeedItem {
  time: string;
  severity: 'crit' | 'warn' | 'info' | 'ok';
  host: string;
  message: string;
}

export interface NocState {
  generatedAt: string;
  global: {
    status: 'incident' | 'ok';
    alerts: number;
    criticalHosts: number;
    criticalAlerts: number;
    warningAlerts: number;
  };
  kpis: {
    servers: { ok: number; total: number };
    sites: { ok: number; total: number; down: number; degraded: number };
    alerts: { active: number; critical: number; warning: number };
    vms: { ok: number; total: number };
    availability30d: number | null;
  };
  hosts: NocHost[];
  alerts: NocAlertFeedItem[];
  history24h: { hour: number; crit: number; warn: number }[];
}

export interface ProxmoxVm {
  id: string;
  serverId: string;
  vmid: number;
  name: string;
  status: string;
  cpus: number;
  maxmemMb: number;
  maxdiskGb: number;
  lastSeenAt: string;
}

export interface ProxmoxVmWithServer extends ProxmoxVm {
  server: {
    id: string;
    name: string;
    hostname: string;
    status: string;
    profile: string;
  };
}

export interface ProxmoxVmMetric {
  id: string;
  cpuPercent: number;
  memUsedMb: number;
  memTotalMb: number;
  collectedAt: string;
}

export interface ProxmoxBackup {
  id: string;
  upid: string;
  vmid: number | null;
  vmName: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationSec: number | null;
  error: string | null;
  sizeBytes: string | null;
}

export interface CreateServerData {
  name?: string;
  hostname?: string;
  profile?: 'LINUX' | 'PLESK' | 'PROXMOX';
  ipAddress?: string;
  hasPlesk?: boolean;
  pleskUrl?: string;
  tags?: string[];
  notes?: string;
}

export interface CreateWebsiteData {
  name: string;
  url: string;
  serverId?: string;
  checkInterval?: number;
  expectedStatus?: number;
  expectedKeyword?: string;
  monitoringEnabled?: boolean;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  hasPassword: boolean;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
  updatedAt: string | null;
}

export interface UpsertSmtpSettingsData {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
}

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  recipients: string[];
  serverIds: string[];
  severities: ('INFO' | 'WARNING' | 'CRITICAL')[];
  notifyOnCreate: boolean;
  notifyOnOccurrence: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRuleInput {
  name: string;
  enabled?: boolean;
  recipients: string[];
  serverIds?: string[];
  severities?: ('INFO' | 'WARNING' | 'CRITICAL')[];
  notifyOnCreate?: boolean;
  notifyOnOccurrence?: boolean;
}
