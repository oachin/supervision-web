const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  totpEnabled: boolean;
}

class ApiClient {
  private getTokens(): AuthTokens | null {
    if (typeof window === 'undefined') return null;
    const data = localStorage.getItem('auth');
    return data ? JSON.parse(data) : null;
  }

  private setTokens(tokens: AuthTokens | null) {
    if (tokens) {
      localStorage.setItem('auth', JSON.stringify(tokens));
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

  private async refreshToken(): Promise<boolean> {
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
      });
      return true;
    } catch {
      return false;
    }
  }

  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
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

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Erreur serveur' }));
      throw new Error(err.message || `HTTP ${res.status}`);
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
  getSystemHealth() { return this.fetch<SystemHealth>('/system/health'); }

  // Servers
  getServers() { return this.fetch<Server[]>('/servers'); }
  getServer(id: string) { return this.fetch<ServerDetail>(`/servers/${id}`); }
  getServerMetrics(id: string, hours = 24) { return this.fetch<ServerMetric[]>(`/servers/${id}/metrics?hours=${hours}`); }
  createServer(data: CreateServerData) { return this.fetch<Server & { agentKeyPlain: string }>('/servers', { method: 'POST', body: JSON.stringify(data) }); }
  updateServer(id: string, data: Partial<CreateServerData>) { return this.fetch<Server>(`/servers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  deleteServer(id: string) { return this.fetch(`/servers/${id}`, { method: 'DELETE' }); }
  regenerateServerKey(id: string) { return this.fetch<{ agentKeyPlain: string }>(`/servers/${id}/regenerate-key`, { method: 'POST' }); }

  // Websites
  getWebsites() { return this.fetch<Website[]>('/websites'); }
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

  // Alerts
  getAlertsPopup() { return this.fetch<Alert[]>('/alerts/popup'); }
  getAlertsSummary() { return this.fetch<AlertSummary>('/alerts/summary'); }
  getAlertEvents(limit = 200) { return this.fetch<AlertEvent[]>(`/alerts/events?limit=${limit}`); }
  getAlerts(status?: string) { return this.fetch<Alert[]>(status ? `/alerts?status=${status}` : '/alerts'); }
  acknowledgeAlert(id: string) { return this.fetch<Alert>(`/alerts/${id}/acknowledge`, { method: 'PATCH' }); }
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
    websites: { total: number; up: number; down: number };
    activeAlerts: number;
  };
  recentAlerts: Alert[];
  servers: ServerSummary[];
  websites: WebsiteSummary[];
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
  hasPlesk: boolean;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'UNKNOWN';
  lastSeenAt?: string;
  tags: string[];
  notes?: string;
  _count?: { websites: number; metrics: number };
}

export interface ServerSummary extends Server {
  metrics: { cpuPercent: number; memoryPercent: number; diskPercent: number; collectedAt: string }[];
}

export interface ServerDetail extends Server {
  websites: { id: string; name: string; url: string; status: string }[];
  metrics: ServerMetric[];
}

export interface ServerMetric {
  id: string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  loadAvg1: number;
  collectedAt: string;
}

export interface Website {
  id: string;
  name: string;
  url: string;
  status: 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  checkInterval: number;
  lastCheckAt?: string;
  lastResponseMs?: number;
  lastStatusCode?: number;
  sslExpiresAt?: string;
  server?: { id: string; name: string; hostname: string };
}

export interface WebsiteSummary extends Website {}
export interface WebsiteDetail extends Website {
  checks: WebsiteCheck[];
}

export interface WebsiteCheck {
  id: string;
  status: string;
  statusCode?: number;
  responseMs?: number;
  checkedAt: string;
  errorMessage?: string;
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
  server?: { id?: string; name: string };
  website?: { id?: string; name: string; url: string };
  acknowledgedBy?: { id: string; name: string; email: string };
  closedBy?: { id: string; name: string; email: string };
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

export interface CreateServerData {
  name: string;
  hostname: string;
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
}
