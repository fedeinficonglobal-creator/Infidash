/** Promise-based confirmation queue (no DOM). Requests are shown one at a time, in call order. */

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Names the action, e.g. "Eliminar cliente". */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
}

export interface ConfirmRequest {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

export interface ConfirmQueue {
  request(options: ConfirmOptions): Promise<boolean>;
  current(): ConfirmRequest | null;
  settle(confirmed: boolean): void;
  cancelAll(): void;
  subscribe(listener: () => void): () => void;
}

export function createConfirmQueue(): ConfirmQueue {
  const pending: ConfirmRequest[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    request(options) {
      return new Promise<boolean>((resolve) => {
        pending.push({ options, resolve });
        notify();
      });
    },
    current: () => pending[0] ?? null,
    settle(confirmed) {
      const head = pending.shift();
      if (!head) return;
      head.resolve(confirmed);
      notify();
    },
    cancelAll() {
      const all = pending.splice(0);
      all.forEach((entry) => entry.resolve(false));
      if (all.length) notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
