import { cn } from '../../lib/utils.js';

/** Shared action button of the Contenidos and Redes Sociales screens. */
export function Button({ children, className, ...props }: { children?: unknown; className?: string; [key: string]: unknown }) {
  return <button {...props} className={cn('inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-primary/40', className)}>{children}</button>;
}

/** Labelled text input or textarea. */
export function Field({ label, value, onChange, disabled, multiline, rows = 4, type = 'text', required, maxLength }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; multiline?: boolean; rows?: number; type?: string; required?: boolean; maxLength?: number }) {
  const className = 'mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 disabled:bg-slate-100 disabled:text-slate-500';
  return <label className="block text-xs font-bold text-slate-500">{label}{multiline ? <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required} maxLength={maxLength} className={className} /> : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required} maxLength={maxLength} className={className} />}</label>;
}
