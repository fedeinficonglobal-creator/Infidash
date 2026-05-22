import { strict as assert } from 'node:assert';
import { beforeEach, afterEach, test } from 'node:test';
import { normalizeClaritySnapshots, resolveClarityExportUrl } from '../src/lib/claritySync.js';

const originalEnv = {
  CLARITY_EXPORT_URL: process.env.CLARITY_EXPORT_URL,
  CLARITY_EXPORT_URL_TEMPLATE: process.env.CLARITY_EXPORT_URL_TEMPLATE,
};

beforeEach(() => {
  process.env.CLARITY_EXPORT_URL = originalEnv.CLARITY_EXPORT_URL;
  process.env.CLARITY_EXPORT_URL_TEMPLATE = originalEnv.CLARITY_EXPORT_URL_TEMPLATE;
});

afterEach(() => {
  process.env.CLARITY_EXPORT_URL = originalEnv.CLARITY_EXPORT_URL;
  process.env.CLARITY_EXPORT_URL_TEMPLATE = originalEnv.CLARITY_EXPORT_URL_TEMPLATE;
});

test('normalizeClaritySnapshots turns a raw Clarity payload into dashboard-ready snapshots', () => {
  const snapshots = normalizeClaritySnapshots({
    data: [
      {
        date: '2026-05-18',
        metrics: {
          sessions: '640',
          pageViews: 1280,
          rageClicks: 12,
          deadClicks: 4,
          scrollDepthAvg: '68.5',
          engagedSessions: 390,
          conversions: 27,
          conversionRate: '4.2',
        },
      },
    ],
    source: 'clarity',
  }, 'client-123');

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].clientId, 'client-123');
  assert.equal(snapshots[0].snapshotDate, '2026-05-18');
  assert.equal(snapshots[0].sessions, 640);
  assert.equal(snapshots[0].pageViews, 1280);
  assert.equal(snapshots[0].rageClicks, 12);
  assert.equal(snapshots[0].deadClicks, 4);
  assert.equal(snapshots[0].scrollDepthAvg, 68.5);
  assert.equal(snapshots[0].notes, null);
});

test('normalizeClaritySnapshots falls back to zeros when the export is empty', () => {
  const snapshots = normalizeClaritySnapshots(null, 'client-123', '2026-05-18');

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].sessions, 0);
  assert.equal(snapshots[0].pageViews, 0);
  assert.equal(snapshots[0].notes, 'Sin datos devueltos por la exportación de Análisis/UX');
});

test('resolveClarityExportUrl supports env templates and placeholders', () => {
  process.env.CLARITY_EXPORT_URL = 'https://clarity.example/export/{projectId}?site={siteUrl}&segment={segmentName}';
  const resolved = resolveClarityExportUrl({
    clientId: 'client-123',
    integrationId: 'integration-abc',
    projectId: 'prj-123',
    siteUrl: 'https://example.com',
    segmentName: 'Main Store',
  });

  assert.match(resolved, /prj-123/);
  assert.match(resolved, /site=https%3A%2F%2Fexample.com/);
  assert.match(resolved, /segment=Main%20Store/);
});
