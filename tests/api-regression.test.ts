import './helpers/isolated-harness-required.js';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { before, test } from 'node:test';

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const adminEmail = 'admin@infidash.local';
const adminPassword = 'admin1234';
const viewerEmail = 'viewer@infidash.local';
const viewerPassword = 'viewer1234';
const legacyClientSlug = 'legacy-fixture-client';

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

test('WordPress integration probes the REST API and only reports connected on success', async () => {
  let probeStatus = 200;
  let receivedAuthorization: string | undefined;
  const server = createServer((req, res) => {
    receivedAuthorization = req.headers.authorization;
    res.writeHead(probeStatus, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: 'WordPress REST API' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');

  try {
    const { response: clientResponse, body: clientBody } = await request('/api/clients', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: `WordPress QA ${Date.now()}` }),
    });
    assert.equal(clientResponse.status, 201, JSON.stringify(clientBody));

    const { response: integrationResponse, body: integrationBody } = await request('/api/integrations', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        clientId: clientBody.client.id,
        provider: 'wordpress',
        config: { siteUrl: `http://127.0.0.1:${address.port}`, restNamespace: '/wp-json/wp/v2' },
        credentials: { username: 'wp-agent', applicationPassword: 'app-password-fixture' },
      }),
    });
    assert.equal(integrationResponse.status, 201, JSON.stringify(integrationBody));
    assert.equal(integrationBody.integration.status, 'pending');

    const integrationId = integrationBody.integration.id as string;
    const { response: probeResponse, body: probeBody } = await request(`/api/integrations/${integrationId}/test`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(probeResponse.status, 200, JSON.stringify(probeBody));
    assert.equal(probeBody.ready, true);
    assert.equal(probeBody.integration.status, 'connected');
    assert.equal(receivedAuthorization, `Basic ${Buffer.from('wp-agent:app-password-fixture').toString('base64')}`);

    probeStatus = 503;
    const { response: failedProbeResponse, body: failedProbeBody } = await request(`/api/integrations/${integrationId}/test`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(failedProbeResponse.status, 200);
    assert.equal(failedProbeBody.ready, false);
    assert.equal(failedProbeBody.integration.status, 'error');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('lead pages and filtered counts exclude raw payload; disabling and rotating webhook credentials reject old URLs', async () => {
  const auth = { authorization: `Bearer ${adminToken}` };
  const { response: clientResponse, body: clientBody } = await request('/api/clients', {
    method: 'POST', headers: auth, body: JSON.stringify({ name: `Lead QA ${Date.now()}` }),
  });
  assert.equal(clientResponse.status, 201, JSON.stringify(clientBody));
  const clientId = clientBody.client.id;
  const { response: integrationResponse, body: integrationBody } = await request('/api/integrations', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ clientId, provider: 'wordpress', config: { siteUrl: 'https://example.test', leadSource: 'Form QA' } }),
  });
  assert.equal(integrationResponse.status, 201, JSON.stringify(integrationBody));
  const integrationId = integrationBody.integration.id;
  const originalToken = integrationBody.integration.webhookSecret;
  assert.ok(originalToken);
  const { response: malformedResponse } = await request(`/api/public/leads/${originalToken}`, {
    method: 'POST', body: JSON.stringify({ irrelevant: true }),
  });
  assert.equal(malformedResponse.status, 400);
  const sendLead = (token: string, name: string, provider?: string) => request(`/api/public/leads/${token}`, {
    method: 'POST', body: JSON.stringify({ name, secret_extra: 'must-not-be-listed',
      ...(provider ? { infidash_provider: provider, infidash_form_id: '12', infidash_delivery_id: name } : {}),
    }),
  });
  for (const name of ['A', 'B', 'C']) {
    const { response } = await sendLead(originalToken, name, 'fluent_forms');
    assert.equal(response.status, 201);
  }
  const { response: replayResponse, body: replayBody } = await sendLead(originalToken, 'A', 'fluent_forms');
  assert.equal(replayResponse.status, 200);
  assert.equal(replayBody.duplicate, true);
  const { response: pageResponse, body: page } = await request(`/api/leads?clientId=${clientId}&limit=2&offset=1&source=Form%20QA`, { headers: auth });
  assert.equal(pageResponse.status, 200);
  assert.equal(page.total, 3);
  assert.equal(page.openCount, 3);
  assert.equal(page.leads.length, 2);
  assert.ok(page.leads.every((lead: any) => !('rawPayload' in lead)));
  assert.equal((await sendLead(originalToken, 'A', 'contact_form_7')).response.status, 201);
  const { response: invalidResponse } = await request(`/api/leads?clientId=${clientId}&limit=1000`, { headers: auth });
  assert.equal(invalidResponse.status, 400);
  const { response: disabledResponse } = await request(`/api/integrations/${integrationId}/disable`, { method: 'POST', headers: auth });
  assert.equal(disabledResponse.status, 200);
  const { response: viewerRotateResponse } = await request(`/api/integrations/${integrationId}/rotate-webhook`, {
    method: 'POST', headers: { authorization: `Bearer ${viewerToken}` },
  });
  assert.equal(viewerRotateResponse.status, 403);
  assert.equal((await sendLead(originalToken, 'D')).response.status, 404);
  const { response: rotatedResponse, body: rotatedBody } = await request(`/api/integrations/${integrationId}/rotate-webhook`, { method: 'POST', headers: auth });
  assert.equal(rotatedResponse.status, 200);
  assert.notEqual(rotatedBody.integration.webhookSecret, originalToken);
  const { response: enabledResponse } = await request(`/api/integrations/${integrationId}/enable`, { method: 'POST', headers: auth });
  assert.equal(enabledResponse.status, 200);
  assert.equal((await sendLead(originalToken, 'E')).response.status, 404);
  assert.equal((await sendLead(rotatedBody.integration.webhookSecret, 'F')).response.status, 201);
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

  const pdfResponse = await fetch(`${baseUrl}/api/clients/${clientId}/reports/daily.pdf?from=${statDate}&to=${statDate}`, {
    headers: { authorization: `Bearer ${viewerToken}` },
  });
  assert.equal(pdfResponse.status, 200);
  assert.match(pdfResponse.headers.get('content-type') ?? '', /application\/pdf/);
  assert.equal(Buffer.from(await pdfResponse.arrayBuffer()).subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(pdfResponse.headers.get('cache-control'), 'private, no-store');

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
      notes: 'Importación de Análisis/UX para el dashboard',
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

  const { response: secondKpiResponse, body: secondKpiBody } = await request(`/api/clients/${clientId}/monthly-kpis`, {
    method: 'POST', headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ departmentKey: 'web', metricKey: 'sessions', monthKey: '2026-05', targetValue: 1000, actualValue: 900 }),
  });
  assert.equal(secondKpiResponse.status, 201);

  const { response: kpiCloseResponse, body: kpiCloseBody } = await request(`/api/monthly-kpis/${kpiCreateBody.kpi.id}/close`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(kpiCloseResponse.status, 200);
  assert.equal(kpiCloseBody.kpi.id, kpiCreateBody.kpi.id);
  assert.ok(kpiCloseBody.kpi.closedAt);
  const { response: cycleResponse, body: cycleBody } = await request(`/api/clients/${clientId}/monthly-kpi-cycles`, {
    headers: { authorization: `Bearer ${viewerToken}` },
  });
  assert.equal(cycleResponse.status, 200);
  assert.ok(cycleBody.cycles.some((cycle: any) => cycle.monthKey === '2026-05' && cycle.closedAt));
  const { body: closedRowsBody } = await request(`/api/clients/${clientId}/monthly-kpis?monthKey=2026-05`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.ok(closedRowsBody.kpis.every((kpi: any) => kpi.closedAt), 'manual close freezes every row in the cycle');
  const { body: nextRowsBody } = await request(`/api/clients/${clientId}/monthly-kpis?monthKey=2026-06`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(nextRowsBody.kpis.length, 2);
  assert.ok(nextRowsBody.kpis.every((kpi: any) => kpi.actualValue === null && kpi.status === 'unknown'));
  const { response: closedUpdateResponse } = await request(`/api/monthly-kpis/${kpiCreateBody.kpi.id}`, {
    method: 'PUT', headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ clientId, monthKey: '2026-05', actualValue: 9999 }),
  });
  assert.equal(closedUpdateResponse.status, 409);
  const { response: viewerReopenResponse } = await request(`/api/monthly-kpis/${kpiCreateBody.kpi.id}/reopen`, {
    method: 'POST', headers: { authorization: `Bearer ${viewerToken}` },
    body: JSON.stringify({ reason: 'QA' }),
  });
  assert.equal(viewerReopenResponse.status, 403);
  const { response: reopenResponse, body: reopenBody } = await request(`/api/monthly-kpis/${kpiCreateBody.kpi.id}/reopen`, {
    method: 'POST', headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reason: 'QA: correction required' }),
  });
  assert.equal(reopenResponse.status, 200, JSON.stringify(reopenBody));
  assert.equal(reopenBody.kpi.closedAt, null);
  const { body: reopenedRowsBody } = await request(`/api/clients/${clientId}/monthly-kpis?monthKey=2026-05`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(reopenedRowsBody.kpis.find((kpi: any) => kpi.id === secondKpiBody.kpi.id)?.closedAt, null);
  const { response: eventsResponse, body: eventsBody } = await request(`/api/monthly-kpis/${kpiCreateBody.kpi.id}/events`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(eventsResponse.status, 200);
  assert.equal(eventsBody.events.length, 2);
  assert.ok(eventsBody.events.some((event: any) => event.action === 'reopened' && event.reason === 'QA: correction required'));

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

test('admin can create, update, and delete a client from the management backend', async () => {
  const clientName = `Edicion ${Date.now()}`;
  const { response: createResponse, body: createBody } = await request('/api/clients', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: clientName,
      industry: 'Marketing',
      healthScore: 77,
      kpiThresholds: {
        revenue: 9000,
        roas: 3.8,
        conversions: 55,
        cpa: 21,
      },
    }),
  });

  assert.equal(createResponse.status, 201);
  const clientId = createBody.client.id as string;

  const { response: patchResponse, body: patchBody } = await request(`/api/clients/${clientId}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: `${clientName} Actualizado`,
      industry: 'Ecommerce',
      logoUrl: 'https://example.com/logo.png',
      healthScore: 91,
      kpiThresholds: {
        revenue: 12000,
      },
    }),
  });

  assert.equal(patchResponse.status, 200, JSON.stringify(patchBody));
  assert.equal(patchBody.client.name, `${clientName} Actualizado`);
  assert.equal(patchBody.client.industry, 'Ecommerce');
  assert.equal(patchBody.client.healthScore, 91);
  assert.equal(patchBody.client.kpiThresholds.revenue, 12000);
  assert.equal(patchBody.client.kpiThresholds.roas, 3.8);

  const { response: statCreateResponse, body: statCreateBody } = await request('/api/daily-stats', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      clientId,
      statDate: '2026-05-20',
      revenue: 5400,
      roas: 4.1,
      clicks: 420,
      conversions: 24,
      cpa: 18,
      leads: 19,
      traffic: 6200,
      source: 'manual',
    }),
  });

  assert.equal(statCreateResponse.status, 201);
  assert.equal(statCreateBody.stat.clientId, clientId);

  const { response: deleteResponse } = await request(`/api/clients/${clientId}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(deleteResponse.status, 204);

  const { response: listResponse, body: listBody } = await request('/api/clients', {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(listResponse.status, 200);
  assert.ok(!listBody.clients.some((entry: any) => entry.id === clientId), 'The deleted client must not be present anymore');

  const { response: statsResponse, body: statsBody } = await request(`/api/daily-stats?clientId=${clientId}`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(statsResponse.status, 200);
  assert.equal(statsBody.stats.length, 0, 'Deleting a client should cascade to its daily stats');
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

test('legacy SQLite clients survive the Postgres migration with related data intact', async () => {
  const { response, body } = await request('/api/clients', {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(response.status, 200);
  const legacyClient = body.clients.find((entry: any) => entry.slug === legacyClientSlug);
  assert.ok(legacyClient, `Expected legacy client ${legacyClientSlug} to be present after migration`);
  assert.equal(legacyClient.latestStat.revenue, 15678);

  const { response: uxResponse, body: uxBody } = await request(`/api/clients/${legacyClient.id}/ux-snapshots`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(uxResponse.status, 200);
  assert.equal(uxBody.snapshots.length, 1);
  assert.equal(uxBody.snapshots[0].sessions, 640);

  const { response: rrssResponse, body: rrssBody } = await request(`/api/clients/${legacyClient.id}/rrss-channels`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(rrssResponse.status, 200);
  assert.equal(rrssBody.channels.length, 1);
  assert.equal(rrssBody.channels[0].label, 'Instagram principal');

  const { response: kpiResponse, body: kpiBody } = await request(`/api/clients/${legacyClient.id}/monthly-kpis?monthKey=2026-05`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(kpiResponse.status, 200);
  assert.equal(kpiBody.kpis.length, 1);
  assert.equal(kpiBody.kpis[0].metricKey, 'followers');
  assert.ok(kpiBody.kpis[0].closedAt, 'Expected the migrated KPI to preserve its closedAt timestamp');
});

function createMockClarityServer() {
  let lastRequest: { url: string; authorization?: string } | null = null;
  const server = createServer((req, res) => {
    lastRequest = {
      url: req.url ?? '',
      authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    };

    const payload = [
      {
        date: '2026-05-19',
        metrics: {
          sessions: 321,
          pageViews: 654,
          rageClicks: 7,
          deadClicks: 2,
          scrollDepthAvg: 71.2,
          engagedSessions: 210,
          conversions: 18,
          conversionRate: 5.6,
        },
      },
    ];

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });

  return {
    server,
    getLastRequest: () => lastRequest,
  };
}

test('Análisis/UX integration can be created, tested, and synced against a live export endpoint', async () => {
  const { server, getLastRequest } = createMockClarityServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object' && typeof address.port === 'number');
  const exportUrl = `http://127.0.0.1:${address.port}/export/{projectId}?site={siteUrl}&segment={segmentName}`;

  try {
    const clientName = `Integración APIs ${Date.now()}`;
    const { response: createClientResponse, body: createClientBody } = await request('/api/clients', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: clientName,
        industry: 'Integrations',
        healthScore: 77,
        kpiThresholds: {
          revenue: 10000,
          roas: 3.5,
          conversions: 80,
          cpa: 18,
        },
      }),
    });

    assert.equal(createClientResponse.status, 201, JSON.stringify(createClientBody));
    const clientId = createClientBody.client.id as string;

    const { response: createIntegrationResponse, body: createIntegrationBody } = await request('/api/integrations', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        clientId,
        provider: 'clarity',
        label: 'Análisis/UX · Principal',
        config: {
          projectId: 'ux-project-1',
          siteUrl: 'https://example.com',
          segmentName: 'Principal',
          exportUrl,
        },
        credentials: {
          accessToken: 'secret-token',
        },
      }),
    });

    assert.equal(createIntegrationResponse.status, 201, JSON.stringify(createIntegrationBody));
    assert.equal(createIntegrationBody.integration.clientId, clientId);
    assert.equal(createIntegrationBody.integration.provider, 'clarity');
    assert.equal(createIntegrationBody.integration.status, 'pending');

    const integrationId = createIntegrationBody.integration.id as string;

    const { response: listResponse, body: listBody } = await request(`/api/clients/${clientId}/integrations`, {
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(listResponse.status, 200);
    assert.equal(listBody.integrations.length, 1);
    assert.equal(listBody.integrations[0].provider, 'clarity');

    const { response: testResponse, body: testBody } = await request(`/api/integrations/${integrationId}/test`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(testResponse.status, 200, JSON.stringify(testBody));
    assert.equal(testBody.ready, true);
    assert.equal(Array.isArray(testBody.missingFields), true);
    assert.equal(testBody.integration.status, 'pending');

    const { response: syncResponse, body: syncBody } = await request(`/api/integrations/${integrationId}/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(syncResponse.status, 200, JSON.stringify(syncBody));
    assert.equal(syncBody.skipped, false);
    assert.equal(syncBody.snapshots.length, 1);
    assert.equal(syncBody.integration.status, 'connected');
    assert.equal(syncBody.snapshots[0].sessions, 321);

    const lastRequest = getLastRequest();
    assert.ok(lastRequest, 'Expected the mock Análisis/UX endpoint to be called');
    assert.match(lastRequest!.url, /\/export\/ux-project-1\?site=https%3A%2F%2Fexample\.com&segment=Principal/);
    assert.equal(lastRequest!.authorization, 'Bearer secret-token');

    const { response: uxResponse, body: uxBody } = await request(`/api/clients/${clientId}/ux-snapshots`, {
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(uxResponse.status, 200);
    assert.equal(uxBody.snapshots.length, 1);
    assert.equal(uxBody.snapshots[0].pageViews, 654);
    assert.equal(uxBody.snapshots[0].rageClicks, 7);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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
