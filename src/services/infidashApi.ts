export type UserRole = 'admin' | 'viewer';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  token: string;
  user: SessionUser;
}

export interface DailyStat {
  id: string;
  clientId: string;
  statDate: string;
  revenue: number;
  roas: number;
  clicks: number;
  conversions: number;
  cpa: number;
  leads: number;
  traffic: number;
  notes: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiClient {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  industry: string | null;
  healthScore: number;
  createdAt: string;
  updatedAt: string;
  latestStat: DailyStat | null;
}

const SESSION_KEY = 'infidash.session';

export interface StoredSession {
  token: string;
  user: SessionUser;
}

export function loadStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.user?.id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredSession(session: StoredSession) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error?: string }).error ?? 'Request failed')
      : typeof payload === 'string' && payload
        ? payload
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
}

export async function login(email: string, password: string) {
  return apiRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function getCurrentSession(token: string) {
  return apiRequest<{ token: string; user: SessionUser; expiresAt: string }>('/api/auth/me', {}, token);
}

export async function logout(token: string) {
  return apiRequest<void>('/api/auth/logout', { method: 'POST' }, token);
}

export async function getClients(token: string) {
  return apiRequest<{ clients: ApiClient[] }>('/api/clients', {}, token);
}

export async function getDailyStats(token: string, clientId?: string) {
  const path = clientId ? `/api/daily-stats?clientId=${encodeURIComponent(clientId)}` : '/api/daily-stats';
  return apiRequest<{ stats: DailyStat[] }>(path, {}, token);
}

export async function createDailyStat(
  token: string,
  input: {
    clientId: string;
    statDate: string;
    revenue?: number;
    roas?: number;
    clicks?: number;
    conversions?: number;
    cpa?: number;
    leads?: number;
    traffic?: number;
    notes?: string;
    source?: string;
  },
) {
  return apiRequest<{ stat: DailyStat }>('/api/daily-stats', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token);
}

export interface HealthSummary {
  status: string;
  users: number;
  clients: number;
  dailyStats: number;
}

export async function getHealthSummary() {
  return apiRequest<HealthSummary>('/api/health');
}

export async function createClient(
  token: string,
  input: { name: string; industry?: string; logoUrl?: string; healthScore?: number },
) {
  return apiRequest<{ client: ApiClient }>('/api/clients', {
    method: 'POST',
    body: JSON.stringify(input),
  }, token);
}
