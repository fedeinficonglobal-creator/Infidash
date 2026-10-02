import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { createConfirmQueue, type ConfirmOptions, type ConfirmQueue } from '../lib/confirmQueue.js';

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Mounts the single confirmation dialog. Calls made while one is open are queued
 * and shown one at a time, in call order; unmounting resolves every pending call as false.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const queue: ConfirmQueue = useMemo(() => createConfirmQueue(), []);
  const current = useSyncExternalStore(queue.subscribe, queue.current, queue.current);
  useEffect(() => () => queue.cancelAll(), [queue]);
  const confirm = useMemo<ConfirmFn>(() => (options) => queue.request(options), [queue]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={current !== null}
        title={current?.options.title ?? ''}
        description={current?.options.description}
        confirmLabel={current?.options.confirmLabel}
        cancelLabel={current?.options.cancelLabel}
        tone={current?.options.tone}
        onConfirm={() => queue.settle(true)}
        onCancel={() => queue.settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

/** `if (!(await confirm({ title, description, confirmLabel, tone: 'danger' }))) return;` */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm debe usarse dentro de ConfirmProvider');
  return confirm;
}
