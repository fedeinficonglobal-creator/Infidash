import assert from 'node:assert/strict';
import test from 'node:test';
import { createScrollLock, nextFocusIndex } from '../src/lib/focusTrap.ts';
import { createConfirmQueue } from '../src/lib/confirmQueue.ts';

test('Tab moves forward and wraps from the last element to the first', () => {
  assert.equal(nextFocusIndex(3, 0, false), 1);
  assert.equal(nextFocusIndex(3, 2, false), 0);
});

test('Shift+Tab moves backward and wraps from the first element to the last', () => {
  assert.equal(nextFocusIndex(3, 1, true), 0);
  assert.equal(nextFocusIndex(3, 0, true), 2);
});

test('focus outside the dialog (-1) enters at the first or last element', () => {
  assert.equal(nextFocusIndex(3, -1, false), 0);
  assert.equal(nextFocusIndex(3, -1, true), 2);
});

test('an empty focusable list yields null so the caller keeps focus on the container', () => {
  assert.equal(nextFocusIndex(0, -1, false), null);
  assert.equal(nextFocusIndex(0, 0, true), null);
});

test('a single focusable element always stays on itself', () => {
  assert.equal(nextFocusIndex(1, 0, false), 0);
  assert.equal(nextFocusIndex(1, 0, true), 0);
});

test('scroll lock is reference counted across stacked modals', () => {
  const calls: boolean[] = [];
  const lock = createScrollLock((locked) => calls.push(locked));
  const releaseA = lock.acquire();
  const releaseB = lock.acquire();
  assert.deepEqual(calls, [true]);
  assert.equal(lock.count(), 2);
  releaseA();
  assert.deepEqual(calls, [true]);
  releaseB();
  assert.deepEqual(calls, [true, false]);
  assert.equal(lock.count(), 0);
});

test('releasing the same scroll lock twice is idempotent', () => {
  const calls: boolean[] = [];
  const lock = createScrollLock((locked) => calls.push(locked));
  const release = lock.acquire();
  const other = lock.acquire();
  release();
  release();
  assert.equal(lock.count(), 1);
  other();
  assert.deepEqual(calls, [true, false]);
});

test('confirm queue exposes the first request and settles it with the answer', async () => {
  const queue = createConfirmQueue();
  const first = queue.request({ title: 'Uno' });
  assert.equal(queue.current()?.options.title, 'Uno');
  queue.settle(true);
  assert.equal(await first, true);
  assert.equal(queue.current(), null);
});

test('a second confirmation queues behind the open one and is shown after it settles', async () => {
  const queue = createConfirmQueue();
  const first = queue.request({ title: 'Uno' });
  const second = queue.request({ title: 'Dos' });
  assert.equal(queue.current()?.options.title, 'Uno');
  queue.settle(false);
  assert.equal(await first, false);
  assert.equal(queue.current()?.options.title, 'Dos');
  queue.settle(true);
  assert.equal(await second, true);
  assert.equal(queue.current(), null);
});

test('settling an empty queue is a no-op and subscribers are notified on changes', () => {
  const queue = createConfirmQueue();
  let notifications = 0;
  const unsubscribe = queue.subscribe(() => { notifications += 1; });
  queue.settle(true);
  assert.equal(notifications, 0);
  void queue.request({ title: 'Uno' });
  assert.equal(notifications, 1);
  queue.settle(false);
  assert.equal(notifications, 2);
  unsubscribe();
  void queue.request({ title: 'Dos' });
  assert.equal(notifications, 2);
});

test('cancelAll resolves every pending confirmation as false', async () => {
  const queue = createConfirmQueue();
  const first = queue.request({ title: 'Uno' });
  const second = queue.request({ title: 'Dos' });
  queue.cancelAll();
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(queue.current(), null);
});

test('Modal and ConfirmDialog render accessible dialog markup (static, no DOM)', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { Modal } = await import('../src/components/Modal.tsx');
  const { ConfirmDialog } = await import('../src/components/ConfirmDialog.tsx');

  const modal = renderToStaticMarkup(createElement(Modal, { open: true, onClose: () => {}, title: 'Editar cliente' }, 'contenido'));
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby="[^"]+"/);
  assert.match(modal, /aria-label="Cerrar"/);
  assert.match(modal, /tabindex="-1"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Modal, { open: false, onClose: () => {}, title: 'x' })), /dialog/);

  const drawer = renderToStaticMarkup(createElement(Modal, { open: true, onClose: () => {}, variant: 'drawer', hideHeader: true, ariaLabel: 'Detalle' }, 'x'));
  assert.match(drawer, /aria-label="Detalle"/);
  assert.doesNotMatch(drawer, /aria-labelledby/);

  const confirm = renderToStaticMarkup(createElement(ConfirmDialog, { open: true, title: '¿Eliminar a Acme?', description: 'No se puede deshacer.', confirmLabel: 'Eliminar cliente', tone: 'danger', onConfirm: () => {}, onCancel: () => {} }));
  assert.match(confirm, /aria-describedby="[^"]+"/);
  assert.match(confirm, />Eliminar cliente</);
  assert.match(confirm, />Cancelar</);
  assert.match(confirm, /bg-rose-600/);
});
