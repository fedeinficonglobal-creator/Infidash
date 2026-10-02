import { useId, useRef } from 'react';
import type { ConfirmOptions } from '../lib/confirmQueue.js';
import { Modal } from './Modal.js';

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirmation. For danger tone Cancel receives the initial focus (so Enter
 * never confirms a destructive action), and the confirm button names the action.
 */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = 'Cancelar', tone = 'default', onConfirm, onCancel }: ConfirmDialogProps) {
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const danger = tone === 'danger';
  const label = confirmLabel ?? (danger ? 'Eliminar' : 'Confirmar');

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      describedBy={description ? descriptionId : undefined}
      initialFocusRef={danger ? cancelRef : confirmRef}
    >
      <div className="space-y-6 p-6">
        {description && <p id={descriptionId} className="text-sm leading-relaxed text-slate-600">{description}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 ${danger ? 'bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600' : 'bg-brand-primary hover:opacity-90 focus-visible:outline-brand-primary'}`}
          >
            {label}
          </button>
        </div>
      </div>
    </Modal>
  );
}
