import assert from 'node:assert/strict';
import test from 'node:test';
import { GA4_FRESH_MS, isSnapshotFresh, planGa4Load } from '../src/lib/trafficAutoLoad.js';

const NOW = Date.parse('2026-10-02T12:00:00.000Z');
const iso = (ageMs: number) => new Date(NOW - ageMs).toISOString();
const snap = (syncedAt?: string, complete = true) => ({ complete, syncedAt, id: 'report' });

test('GA4_FRESH_MS is six hours', () => {
  assert.equal(GA4_FRESH_MS, 6 * 60 * 60 * 1000);
});

test('isSnapshotFresh: boundary exactly 6h is fresh, one millisecond more is stale', () => {
  assert.equal(isSnapshotFresh(iso(GA4_FRESH_MS), NOW), true);
  assert.equal(isSnapshotFresh(iso(GA4_FRESH_MS + 1), NOW), false);
  assert.equal(isSnapshotFresh(iso(0), NOW), true);
});

test('isSnapshotFresh: missing, invalid or future syncedAt is stale', () => {
  assert.equal(isSnapshotFresh(undefined, NOW), false);
  assert.equal(isSnapshotFresh('', NOW), false);
  assert.equal(isSnapshotFresh('not-a-date', NOW), false);
  assert.equal(isSnapshotFresh(iso(-60_000), NOW), false);
});

test('fresh complete snapshot is shown with no refresh for admin and viewer', () => {
  const saved = snap(iso(60_000));
  for (const isAdmin of [true, false]) {
    const plan = planGa4Load({ isAdmin, snapshot: saved, now: NOW });
    assert.equal(plan.show, saved);
    assert.equal(plan.refresh, 'none');
  }
});

test('stale complete snapshot is shown and refreshed in background (admin sync, viewer preview)', () => {
  const saved = snap(iso(GA4_FRESH_MS + 1));
  const admin = planGa4Load({ isAdmin: true, snapshot: saved, now: NOW });
  assert.equal(admin.show, saved);
  assert.equal(admin.refresh, 'background-sync');
  const viewer = planGa4Load({ isAdmin: false, snapshot: saved, now: NOW });
  assert.equal(viewer.show, saved);
  assert.equal(viewer.refresh, 'background-preview');
});

test('complete snapshot with invalid syncedAt is treated as stale', () => {
  const saved = snap('garbage');
  assert.equal(planGa4Load({ isAdmin: true, snapshot: saved, now: NOW }).refresh, 'background-sync');
  assert.equal(planGa4Load({ isAdmin: false, snapshot: snap(undefined), now: NOW }).refresh, 'background-preview');
});

test('no snapshot or incomplete snapshot blocks on a fetch and shows nothing', () => {
  for (const snapshot of [null, snap(undefined, false), snap(iso(1000), false)]) {
    const admin = planGa4Load({ isAdmin: true, snapshot, now: NOW });
    assert.equal(admin.show, null);
    assert.equal(admin.refresh, 'blocking-sync');
    const viewer = planGa4Load({ isAdmin: false, snapshot, now: NOW });
    assert.equal(viewer.show, null);
    assert.equal(viewer.refresh, 'blocking-preview');
  }
});

test('force never returns none and keeps old data visible when present', () => {
  const fresh = snap(iso(1000));
  assert.deepEqual(planGa4Load({ isAdmin: true, snapshot: fresh, now: NOW, force: true }), { show: fresh, refresh: 'background-sync' });
  assert.deepEqual(planGa4Load({ isAdmin: false, snapshot: fresh, now: NOW, force: true }), { show: fresh, refresh: 'background-preview' });
  assert.deepEqual(planGa4Load({ isAdmin: true, snapshot: null, now: NOW, force: true }), { show: null, refresh: 'blocking-sync' });
});
