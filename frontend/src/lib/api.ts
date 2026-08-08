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
  profileId?: string;
  profile?: {
    id: string;
    name: string;
    slug: string;
    baseRole: string;
    permissions?: Record<string, { view: boolean; modify: boolean; delete: boolean }>;
  };
  permissions?: Record<string, { view: boolean; modify: boolean; delete: boolean }> | null;
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
  getWebsiteAlertStability(id: string) {
    return this.fetch<WebsiteAlertStability>(`/websites/${id}/alert-stability`);
  }
  createWebsite(data: CreateWebsiteData) { return this.fetch<Website>('/websites', { method: 'POST', body: JSON.stringify(data) }); }
  updateWebsite(id: string, data: Partial<CreateWebsiteData>) { return this.fetch<Website>(`/websites/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  deleteWebsite(id: string) { return this.fetch(`/websites/${id}`, { method: 'DELETE' }); }

  // Users
  getUsers() { return this.fetch<ManagedUser[]>('/users'); }
  createUser(data: { email: string; firstName: string; lastName: string; profileId?: string; role?: string }) {
    return this.fetch<ManagedUser & { inviteUrl?: string; inviteExpiresAt?: string }>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  updateUser(id: string, data: {
    firstName?: string;
    lastName?: string;
    profileId?: string;
    role?: string;
    isActive?: boolean;
  }) {
    return this.fetch<ManagedUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  resendUserInvite(id: string) {
    return this.fetch<{ success: boolean; inviteUrl: string; inviteExpiresAt: string }>(
      `/users/${id}/resend-invite`,
      { method: 'POST' },
    );
  }
  resetUser2fa(id: string) {
    return this.fetch<{ success: boolean }>(`/users/${id}/reset-2fa`, { method: 'POST' });
  }
  deleteUser(id: string) { return this.fetch(`/users/${id}`, { method: 'DELETE' }); }

  // Invite (public)
  getInviteInfo(token: string) {
    return this.fetch<{
      email: string;
      firstName: string;
      lastName: string;
      name: string;
      hasPassword: boolean;
      totpEnabled: boolean;
      step: 'password' | 'totp' | 'done';
    }>(`/auth/invite/${token}`);
  }
  completeInvitePassword(token: string, password: string) {
    return this.fetch<{ inviteToken: string; email: string; step: string }>('/auth/invite/password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }
  resumeInvite(token: string) {
    return this.fetch<{ inviteToken: string; email: string; step: string }>('/auth/invite/resume', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }
  setupInviteTotp(inviteToken: string) {
    return this.fetch<{ secret: string; qrCode: string }>('/auth/invite/totp/setup', {
      method: 'POST',
      body: JSON.stringify({ inviteToken }),
    });
  }
  enableInviteTotp(inviteToken: string, code: string) {
    return this.fetch<{
      accessToken?: string;
      refreshToken?: string;
      expiresIn?: number;
      backupCodes: string[];
    }>('/auth/invite/totp/enable', {
      method: 'POST',
      body: JSON.stringify({ inviteToken, code }),
    }).then((result) => {
      if (result.accessToken && result.refreshToken) {
        this.saveTokens({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn ?? 900,
        });
      }
      return result;
    });
  }

  // Cybersécurité / WebSec
  getCyberOverview() { return this.fetch<CyberOverview>('/cyber/overview'); }
  getCyberTargets() { return this.fetch<CyberTargets>('/cyber/targets'); }
  setCyberWebsiteScan(websiteId: string, enabled: boolean) {
    return this.fetch(`/cyber/targets/supervision/${websiteId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }
  addCyberExternalTarget(data: { name: string; url: string; notes?: string }) {
    return this.fetch('/cyber/targets/external', { method: 'POST', body: JSON.stringify(data) });
  }
  updateCyberExternalTarget(id: string, data: { name?: string; enabled?: boolean; notes?: string | null }) {
    return this.fetch(`/cyber/targets/external/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  deleteCyberExternalTarget(id: string) {
    return this.fetch(`/cyber/targets/external/${id}`, { method: 'DELETE' });
  }
  startCyberScan(data: { deep?: boolean; authorized?: boolean } = {}) {
    return this.fetch<{ started: boolean; sites: number; deep: boolean }>('/cyber/scan', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  getCyberAutomation() {
    return this.fetch<CyberAutomation>('/cyber/automation');
  }
  getCyberRiskRules() {
    return this.fetch<CyberExtremeRiskRules>('/cyber/risk-rules');
  }
  updateCyberRiskRules(data: Partial<CyberExtremeRiskRules> & { reset?: boolean }) {
    return this.fetch<CyberExtremeRiskRules>('/cyber/risk-rules', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  updateCyberAutomation(data: {
    enabled?: boolean;
    intervalMinutes?: number;
    dailyTimes?: string[];
    autoExcludeUrls?: string[];
    deep?: boolean;
    timezone?: string;
  }) {
    return this.fetch<CyberAutomation>('/cyber/automation', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
  getCyberScanStatus() {
    return this.fetch<CyberScanStatus>('/cyber/scan/status');
  }
  getCyberSiteResult(url: string, runId?: number) {
    const params = new URLSearchParams({ url });
    if (runId != null && Number.isFinite(runId)) {
      params.set('run_id', String(runId));
    }
    return this.fetch<CyberSiteResult>(`/cyber/sites?${params.toString()}`);
  }
  getCyberTrend(limit = 30) {
    return this.fetch<{ trend: CyberTrendPoint[] }>(`/cyber/trend?limit=${limit}`);
  }
  getCyberHistory(url: string, limit = 30) {
    return this.fetch<{ url: string; history: CyberHistoryPoint[] }>(
      `/cyber/history?url=${encodeURIComponent(url)}&limit=${limit}`,
    );
  }
  async downloadCyberReport(kind: 'global' | 'site', opts: { fmt: 'html' | 'pdf'; url?: string; lang?: string }) {
    if (this.needsRefresh()) await this.refreshToken();
    const token = this.getAccessToken();
    const params = new URLSearchParams({ fmt: opts.fmt, lang: opts.lang || 'fr' });
    if (kind === 'site') {
      if (!opts.url) throw new Error('URL requise pour le rapport site');
      params.set('url', opts.url);
    }
    const path = kind === 'global' ? '/cyber/report/global' : '/cyber/report/site';
    let res = await fetch(`${API_URL}/api${path}?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401 && token) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        res = await fetch(`${API_URL}/api${path}?${params}`, {
          headers: { Authorization: `Bearer ${this.getAccessToken()}` },
        });
      } else {
        this.logout();
        throw new Error('Session expirée');
      }
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Erreur serveur' }));
      throw new Error(typeof err.message === 'string' ? err.message : `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd);
    const filename = match
      ? decodeURIComponent(match[1].replace(/"/g, ''))
      : `audit_${kind}.${opts.fmt}`;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  // Profiles
  getProfiles() { return this.fetch<AccessProfile[]>('/profiles'); }
  getProfileById(id: string) { return this.fetch<AccessProfile>(`/profiles/${id}`); }
  createProfile(data: { name: string; description?: string; permissions: AccessProfile['permissions'] }) {
    return this.fetch<AccessProfile>('/profiles', { method: 'POST', body: JSON.stringify(data) });
  }
  updateProfile(id: string, data: { name?: string; description?: string; permissions?: AccessProfile['permissions'] }) {
    return this.fetch<AccessProfile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  deleteProfile(id: string) { return this.fetch(`/profiles/${id}`, { method: 'DELETE' }); }

  // Notifications
  getSmtpSettings() { return this.fetch<SmtpSettings>('/notifications/smtp'); }
  getAppSettings() { return this.fetch<AppSettings>('/settings/app'); }
  updateAppSettings(data: { timezone: string }) {
    return this.fetch<AppSettings>('/settings/app', { method: 'PUT', body: JSON.stringify(data) });
  }
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
  acknowledgeAlert(id: string) {
    return this.fetch<Alert>(`/alerts/${id}/acknowledge`, { method: 'POST' });
  }
  closeAlert(id: string, note?: string) {
    return this.fetch<AlertDetail>(`/alerts/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ note: note || undefined }),
    });
  }
  addAlertNote(id: string, message: string) {
    return this.fetch<AlertDetail>(`/alerts/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ message }),
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

export type WebsiteAlertStabilityCounts = {
  CRITICAL: number;
  WARNING: number;
  EXPIRATION_SSL: number;
  INFO: number;
  total: number;
};

export interface WebsiteAlertStability {
  websiteId: string;
  active: Alert[];
  periods: {
    key: string;
    label: string;
    counts: WebsiteAlertStabilityCounts;
  }[];
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
  firstName?: string;
  lastName?: string;
  role: string;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt?: string;
  profileId?: string;
  profile?: { id: string; name: string; slug: string; baseRole?: string };
  hasPassword?: boolean;
  invitePending?: boolean;
  inviteSentAt?: string;
  inviteExpiresAt?: string;
}

export interface AccessProfile {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  isSystem: boolean;
  baseRole: string;
  permissions: Record<string, { view: boolean; modify: boolean; delete: boolean }>;
  usersCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CyberTargetRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  source: 'supervision' | 'external';
  status?: string;
  notes?: string | null;
  server?: { id: string; name: string; hostname?: string } | null;
}

export interface CyberTargets {
  supervision: CyberTargetRow[];
  external: CyberTargetRow[];
}

export interface CyberTrendPoint {
  run_id?: number;
  started_at?: string | null;
  avg_score?: number;
  site_count?: number;
}

export interface CyberHistoryPoint {
  run_id?: number;
  started_at?: string | null;
  score?: number;
  grade?: string;
}

export interface CyberFinding {
  code?: string;
  title?: string;
  /** Primary human-readable finding text from WebSec. */
  message?: string;
  detail?: string;
  severity?: string;
  category?: string;
  recommendation?: string;
  recommendation_fr?: string;
  recommendation_en?: string;
  penalty?: number;
  status?: string;
  references?: string[];
  reference_links?: { label?: string; url?: string }[];
}

export interface CyberSiteResult {
  name?: string;
  url?: string;
  domain?: string;
  score?: number;
  grade?: string;
  run_id?: number;
  started_at?: string | null;
  findings?: CyberFinding[];
  findingsCount?: number;
  /** Secrets-leak / takeover findings on latest audit (overview slim payload). */
  extremeRiskCount?: number;
  history?: CyberHistoryPoint[];
  /** ISO timestamp of the latest audit (overview payload). */
  startedAt?: string | null;
  previousScore?: number | null;
  previousGrade?: string | null;
}

export interface CyberAutoTarget {
  name: string;
  url: string;
  domain?: string;
  includedInAuto: boolean;
}

export interface CyberAutomation {
  id: string;
  enabled: boolean;
  intervalMinutes: number;
  dailyTimes: string[];
  autoExcludeUrls: string[];
  deep: boolean;
  timezone: string;
  lastRunAt?: string | null;
  lastTrigger?: string | null;
  lastDailySlot?: string | null;
  lastError?: string | null;
  scanRunning?: boolean;
  nextIntervalAt?: string | null;
  nextDailyAt?: string | null;
  nextRunAt?: string | null;
  autoTargets?: CyberAutoTarget[];
  autoIncludedCount?: number;
  autoEligibleCount?: number;
}

export interface CyberScanSiteProgress {
  url?: string;
  name?: string;
  status?: 'queued' | 'scanning' | 'done' | 'error' | string;
  check?: string | null;
  checks_done?: number;
  checks_total?: number;
  percent?: number;
  score?: number | null;
  grade?: string | null;
  findings?: number | null;
  error?: string | null;
}

export interface CyberScanStatus {
  running?: boolean;
  trigger?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  stats?: Record<string, unknown> | null;
  run_uuid?: string | null;
  progress?: string | null;
  total?: number;
  done?: number;
  percent?: number;
  sites?: CyberScanSiteProgress[];
}

export interface CyberExtremeRiskRules {
  label: string;
  findingMatchers: { code: string; severities?: string[] }[];
  grades: string[];
}

export interface CyberOverview {
  healthy: boolean;
  scan: CyberScanStatus;
  enabledTargets: number;
  resultsCount: number;
  grades: Record<string, number>;
  /** Sites with ≥1 matching finding / grade on latest audit */
  extremeRiskSites: number;
  /** Total matching findings (+1 per grade-only hit) across inventory */
  extremeRiskFindings: number;
  /** Configurable label from risk rules */
  extremeRiskLabel?: string;
  sites: CyberSiteResult[];
  trend: CyberTrendPoint[];
  automation?: CyberAutomation | null;
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
  severity: 'crit' | 'warn' | 'ssl' | 'info' | 'ok';
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
    sslAlerts?: number;
  };
  kpis: {
    servers: { ok: number; total: number };
    sites: { ok: number; total: number; down: number; degraded: number };
    alerts: { active: number; critical: number; warning: number; ssl?: number };
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

export interface AppSettings {
  id: string;
  timezone: string;
  updatedAt: string;
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
