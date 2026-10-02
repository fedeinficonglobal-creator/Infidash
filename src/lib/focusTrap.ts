/** Pure helpers for the shared Modal: tab cycling and a reference-counted scroll lock. */

/**
 * Index of the element that should receive focus after Tab / Shift+Tab inside a dialog.
 * `current` is the index of the focused element in the focusable list, or -1 when focus is outside it.
 * Returns null when there is nothing focusable, so the caller keeps focus on the dialog container.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number | null {
  if (count <= 0) return null;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  if (backwards) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}

export interface ScrollLock {
  /** Locks scrolling and returns an idempotent release function. */
  acquire(): () => void;
  count(): number;
}

/** Counts stacked holders so scrolling is only restored when the last one releases. */
export function createScrollLock(apply: (locked: boolean) => void): ScrollLock {
  let holders = 0;
  return {
    acquire() {
      holders += 1;
      if (holders === 1) apply(true);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) apply(false);
      };
    },
    count: () => holders,
  };
}

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
