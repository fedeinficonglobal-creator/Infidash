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

async function requestText(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.text();
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

test('the root path serves the Infidash frontend shell instead of a JSON 404', async () => {
  const { response, body } = await requestText('/');

  assert.equal(response.status, 200, body);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(body, /<title>Infidash<\/title>/);
  assert.match(body, /<div id="root"><\/div>/);
  assert.doesNotMatch(body, /Ruta no encontrada/);
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

test('admin can list and update users from the management backend', async () => {
  const { response: listResponse, body: listBody } = await request('/api/users', {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(listResponse.status, 200);
  assert.ok(Array.isArray(listBody.users));
  const viewer = listBody.users.find((user: any) => user.email === viewerEmail);
  assert.ok(viewer, 'Expected the seeded viewer account to exist');

  const toggleTo = !viewer.active;
  const { response: updateResponse, body: updateBody } = await request(`/api/users/${viewer.id}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ active: toggleTo }),
  });

  assert.equal(updateResponse.status, 200, JSON.stringify(updateBody));
  assert.equal(updateBody.user.active, toggleTo);

  const { response: restoreResponse, body: restoreBody } = await request(`/api/users/${viewer.id}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ active: viewer.active }),
  });

  assert.equal(restoreResponse.status, 200, JSON.stringify(restoreBody));
  assert.equal(restoreBody.user.active, viewer.active);
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

  const { response: uxCreateResponse, body: uxCreateBody } = await request(`/api/clients/${clientId}/ux-snapshots`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      snapshotDate: statDate,
      sessions: 640,
      pageViews: 1280,
      rageClicks: 12,
      deadClicks: 4,
      scrollDepthAvg: 68.5,
      engagedSessions: 390,
      conversions: 27,
      conversionRate: 4.2,
      notes: 'Importación de Clarity para el dashboard',
      source: 'clarity',
      payloadJson: JSON.stringify({ source: 'clarity', sessions: 640 }),
    }),
  });

  assert.equal(uxCreateResponse.status, 201, JSON.stringify(uxCreateBody));
  assert.equal(uxCreateBody.snapshot.clientId, clientId);
  assert.equal(uxCreateBody.snapshot.sessions, 640);

  const { response: uxListResponse, body: uxListBody } = await request(`/api/clients/${clientId}/ux-snapshots`, {
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
  });

  assert.equal(uxListResponse.status, 200);
  assert.equal(uxListBody.snapshots.length, 1);
  assert.equal(uxListBody.snapshots[0].rageClicks, 12);

  const { response: dashboardUxResponse, body: dashboardUxBody } = await request(`/api/clients/${clientId}/dashboard`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(dashboardUxResponse.status, 200);
  assert.equal(dashboardUxBody.latestUxSnapshot.sessions, 640);
  assert.equal(dashboardUxBody.latestUxSnapshot.pageViews, 1280);

  const { response: channelCreateResponse, body: channelCreateBody } = await request(`/api/clients/${clientId}/rrss-channels`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      platformKey: 'instagram',
      label: 'Instagram principal',
      isActive: true,
      sortOrder: 1,
    }),
  });

  assert.equal(channelCreateResponse.status, 201);
  assert.equal(channelCreateBody.channel.clientId, clientId);
  assert.equal(channelCreateBody.channel.platformKey, 'instagram');

  const { response: channelListResponse, body: channelListBody } = await request(`/api/clients/${clientId}/rrss-channels`, {
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
  });

  assert.equal(channelListResponse.status, 200);
  assert.equal(channelListBody.channels.length, 1);
  assert.equal(channelListBody.channels[0].label, 'Instagram principal');

  const { response: kpiCreateResponse, body: kpiCreateBody } = await request(`/api/clients/${clientId}/monthly-kpis`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      departmentKey: 'rrss',
      metricKey: 'followers',
      monthKey: '2026-05',
      targetValue: 5000,
      actualValue: 5200,
      targetText: '5.000 seguidores',
      actualText: '5.200 seguidores',
      status: 'success',
      notes: 'Carga inicial del KPI mensual de RRSS',
    }),
  });

  assert.equal(kpiCreateResponse.status, 201);
  assert.equal(kpiCreateBody.kpi.clientId, clientId);
  assert.equal(kpiCreateBody.kpi.departmentKey, 'rrss');
  assert.equal(kpiCreateBody.kpi.monthKey, '2026-05');

  const { response: kpiListResponse, body: kpiListBody } = await request(`/api/clients/${clientId}/monthly-kpis?monthKey=2026-05`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(kpiListResponse.status, 200);
  assert.equal(kpiListBody.kpis.length, 1);
  assert.equal(kpiListBody.kpis[0].metricKey, 'followers');

  const { response: kpiCloseResponse, body: kpiCloseBody } = await request(`/api/monthly-kpis/${kpiCreateBody.kpi.id}/close`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(kpiCloseResponse.status, 200);
  assert.equal(kpiCloseBody.kpi.id, kpiCreateBody.kpi.id);
  assert.ok(kpiCloseBody.kpi.closedAt);

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

test('admin can create, update, and delete users from the management backend', async () => {
  const uniqueEmail = `qa-${Date.now()}@infidash.local`;
  const uniqueName = `QA User ${Date.now()}`;

  const { response: listResponse, body: listBody } = await request('/api/users', {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(listResponse.status, 200);
  assert.ok(Array.isArray(listBody.users));
  assert.ok(listBody.users.some((user: any) => user.email === viewerEmail));

  const { response: createResponse, body: createBody } = await request('/api/users', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      email: uniqueEmail,
      name: uniqueName,
      password: 'TempPass123',
      role: 'viewer',
    }),
  });

  assert.equal(createResponse.status, 201, JSON.stringify(createBody));
  assert.equal(createBody.user.email, uniqueEmail);
  assert.equal(createBody.user.name, uniqueName);
  assert.equal(createBody.user.role, 'viewer');
  assert.equal(createBody.user.active, true);

  const { response: updateResponse, body: updateBody } = await request(`/api/users/${createBody.user.id}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ role: 'admin', active: false, name: `${uniqueName} Renovado` }),
  });

  assert.equal(updateResponse.status, 200, JSON.stringify(updateBody));
  assert.equal(updateBody.user.role, 'admin');
  assert.equal(updateBody.user.active, false);
  assert.equal(updateBody.user.name, `${uniqueName} Renovado`);

  const { response: deleteResponse } = await request(`/api/users/${createBody.user.id}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(deleteResponse.status, 204);

  const { response: postDeleteListResponse, body: postDeleteListBody } = await request('/api/users', {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(postDeleteListResponse.status, 200);
  assert.ok(!postDeleteListBody.users.some((user: any) => user.email === uniqueEmail));

  const { response: forbiddenResponse, body: forbiddenBody } = await request('/api/users', {
    headers: {
      authorization: `Bearer ${viewerToken}`,
    },
  });

  assert.equal(forbiddenResponse.status, 403);
  assert.equal(forbiddenBody.code, 'FORBIDDEN');
});

test('admin can create a postgres backup and viewer cannot', async () => {
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
  assert.ok(body.backup.path.endsWith('.sql'));
  assert.equal(typeof body.backup.createdAt, 'string');
});
