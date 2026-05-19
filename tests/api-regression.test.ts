import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const adminEmail = 'admin@infidash.local';
const adminPassword = 'admin1234';
const viewerEmail = 'viewer@infidash.local';
const viewerPassword = 'viewer1234';

let adminToken = '';
let viewerToken = '';

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;
  return { response, body };
}

async function login(email: string, password: string) {
  const { response, body } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  assert.equal(response.status, 200, `login failed for ${email}: ${JSON.stringify(body)}`);
  assert.equal(typeof body.token, 'string');
  return body.token as string;
}

before(async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.ok, true, `Backend no disponible en ${baseUrl}`);
  adminToken = await login(adminEmail, adminPassword);
  viewerToken = await login(viewerEmail, viewerPassword);
});

test('auth/login returns a usable token for the seeded admin account', async () => {
  const { response, body } = await request('/api/auth/me', {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(body.user.email, adminEmail);
  assert.equal(body.user.role, 'admin');
});

test('viewer cannot create daily stats', async () => {
  const { response, body } = await request('/api/daily-stats', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
    body: JSON.stringify({
      clientId: 'matundy',
      statDate: '2026-05-18',
      revenue: 1000,
    }),
  });

  assert.equal(response.status, 403);
  assert.equal(body.code, 'FORBIDDEN');
});

test('admin can create a client, save daily metrics, and see the refresh reflected in the dashboard data', async () => {
  const clientName = `Regresion ${Date.now()}`;
  const { response: createClientResponse, body: createClientBody } = await request('/api/clients', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: clientName,
      industry: 'QA / Regression',
      healthScore: 82,
      kpiThresholds: {
        revenue: 15000,
        roas: 4.2,
        conversions: 120,
        cpa: 14,
      },
    }),
  });

  assert.equal(createClientResponse.status, 201);
  assert.equal(createClientBody.client.name, clientName);
  assert.equal(createClientBody.client.kpiThresholds.revenue, 15000);
  const clientId = createClientBody.client.id as string;

  const { response: dashboardAfterCreateResponse, body: dashboardAfterCreateBody } = await request('/api/clients', {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(dashboardAfterCreateResponse.status, 200);
  const createdClient = dashboardAfterCreateBody.clients.find((entry: any) => entry.id === clientId);
  assert.ok(createdClient, 'The created client should still be present in the dashboard payload');
  assert.equal(createdClient.kpiThresholds.cpa, 14);

  const statDate = '2026-05-18';
  const firstPayload = {
    clientId,
    statDate,
    revenue: 12345,
    roas: 4.7,
    clicks: 1200,
    conversions: 138,
    cpa: 13,
    leads: 42,
    traffic: 12000,
    notes: 'Primera carga de métricas de regresión',
    source: 'manual',
  };

  const { response: firstStatResponse, body: firstStatBody } = await request('/api/daily-stats', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(firstPayload),
  });

  assert.equal(firstStatResponse.status, 201);
  assert.equal(firstStatBody.stat.clientId, clientId);
  assert.equal(firstStatBody.stat.revenue, 12345);

  const updatedPayload = {
    revenue: 15678,
    roas: 5.1,
    clicks: 1300,
    conversions: 145,
    cpa: 11,
    leads: 48,
    traffic: 12850,
    notes: 'Métrica actualizada tras refresco',
  };

  const { response: updateResponse, body: updatedBody } = await request(`/api/daily-stats/${firstStatBody.stat.id}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(updatedPayload),
  });

  assert.equal(updateResponse.status, 200);
  assert.equal(updatedBody.stat.revenue, 15678);
  assert.equal(updatedBody.stat.roas, 5.1);

  const { response: statsResponse, body: statsBody } = await request(`/api/daily-stats?clientId=${clientId}`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(statsResponse.status, 200);
  assert.equal(statsBody.stats.length, 1);
  assert.equal(statsBody.stats[0].revenue, 15678);

  const { response: dashboardResponse, body: dashboardBody } = await request('/api/clients', {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(dashboardResponse.status, 200);
  const savedClient = dashboardBody.clients.find((entry: any) => entry.id === clientId);
  assert.ok(savedClient, 'The created client should still be present in the dashboard payload');
  assert.equal(savedClient.latestStat.revenue, 15678);
});

test('admin can create a sqlite backup and viewer cannot', async () => {
  const { response: forbiddenResponse, body: forbiddenBody } = await request('/api/admin/backup', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
  });

  assert.equal(forbiddenResponse.status, 403);
  assert.equal(forbiddenBody.code, 'FORBIDDEN');

  const { response, body } = await request('/api/admin/backup', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ label: 'regression-smoke' }),
  });

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.backup.label, 'regression-smoke');
  assert.equal(typeof body.backup.path, 'string');
  assert.equal(typeof body.backup.createdAt, 'string');
});
