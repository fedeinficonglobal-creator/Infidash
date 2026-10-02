import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { FOCUSABLE_SELECTOR, createScrollLock, nextFocusIndex } from '../lib/focusTrap.js';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Visible heading; also names the dialog through aria-labelledby. */
  title?: ReactNode;
  /** Small text above the title. */
  eyebrow?: ReactNode;
  /** Accessible name when the content renders its own visible heading instead of `title`. */
  ariaLabel?: string;
  /** Id of an element that describes the dialog (aria-describedby). */
  describedBy?: string;
  variant?: 'dialog' | 'drawer';
  size?: ModalSize;
  /** Close when the backdrop is pressed. Default true. */
  dismissOnBackdrop?: boolean;
  /** Close on Escape. Default true. */
  dismissOnEscape?: boolean;
  /** Element focused when the modal opens. Defaults to the first focusable control in the body. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Skip the built-in header (and its close button) when the content provides its own. */
  hideHeader?: boolean;
  /** Extra classes for the panel. */
  panelClassName?: string;
  children?: ReactNode;
}

const WIDTH: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-5xl',
};

let previousOverflow = '';
const scrollLock = createScrollLock((locked) => {
  if (typeof document === 'undefined') return;
  if (locked) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = previousOverflow;
  }
});

// Open dialogs, topmost last. Only the topmost one traps focus.
const dialogStack: HTMLElement[] = [];

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}

/** Accessible modal: portal, focus trap, Escape/backdrop dismissal, focus return and scroll lock. */
export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  ariaLabel,
  describedBy,
  variant = 'dialog',
  size = 'md',
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  initialFocusRef,
  hideHeader = false,
  panelClassName = '',
  children,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRefLatest = useRef(initialFocusRef);
  initialFocusRefLatest.current = initialFocusRef;

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScroll = scrollLock.acquire();
    dialogStack.push(dialog);

    const target = initialFocusRefLatest.current?.current
      ?? (bodyRef.current ? focusableIn(bodyRef.current)[0] : undefined)
      ?? focusableIn(dialog)[0]
      ?? dialog;
    target.focus();

    // Keeps focus off the page behind when it escapes (e.g. a pointer click on inert content).
    const keepFocusInside = (event: FocusEvent) => {
      const top = dialogStack[dialogStack.length - 1];
      if (top !== dialog || !(event.target instanceof Node) || dialog.contains(event.target)) return;
      (focusableIn(dialog)[0] ?? dialog).focus();
    };
    document.addEventListener('focusin', keepFocusInside);

    return () => {
      document.removeEventListener('focusin', keepFocusInside);
      const index = dialogStack.lastIndexOf(dialog);
      if (index >= 0) dialogStack.splice(index, 1);
      releaseScroll();
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // React bubbles events from nested portals (stacked modals) to this handler: only the owning dialog reacts.
    if (!(event.target instanceof Node) || !dialogRef.current?.contains(event.target)) return;
    if (event.key === 'Escape') {
      if (!dismissOnEscape) return;
      event.stopPropagation();
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = focusableIn(dialog);
    const next = nextFocusIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey);
    event.preventDefault();
    (next === null ? dialog : items[next]).focus();
  };

  const isDrawer = variant === 'drawer';
  const backdropClass = isDrawer
    ? 'fixed inset-0 z-50 flex justify-end bg-slate-950/40'
    : 'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm';
  const panelBase = isDrawer
    ? `h-full w-full ${WIDTH[size]} overflow-y-auto bg-white shadow-2xl`
    : `max-h-[calc(100vh-2rem)] w-full ${WIDTH[size]} overflow-y-auto rounded-2xl bg-white shadow-xl`;
  const hasTitle = !hideHeader && title !== undefined;

  const surface = (
    <div
      className={backdropClass}
      onMouseDown={(event) => { if (dismissOnBackdrop && event.target === event.currentTarget) onCloseRef.current(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasTitle ? titleId : undefined}
        aria-label={hasTitle ? undefined : ariaLabel}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`${panelBase} outline-none ${panelClassName}`.trim()}
      >
        {!hideHeader && (
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
            <div>
              {eyebrow && <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.3em] text-slate-600">{eyebrow}</p>}
              {title !== undefined && <h2 id={titleId} className="text-xl font-bold text-slate-900">{title}</h2>}
            </div>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => onCloseRef.current()}
              className="rounded-lg p-1 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        )}
        <div ref={bodyRef}>{children}</div>
      </div>
    </div>
  );

  // Server rendering has no document: render in place so static markup still contains the dialog.
  return typeof document === 'undefined' ? surface : createPortal(surface, document.body);
}
