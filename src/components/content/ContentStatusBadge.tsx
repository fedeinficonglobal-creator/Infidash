import { AlertTriangle, CheckCircle2, Clock3, FilePenLine, LoaderCircle, Send, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { statusLabel } from '../../lib/content.js';

const STYLE: Record<string, string> = {
  proposed: 'bg-slate-100 text-slate-700', draft: 'bg-slate-100 text-slate-700',
  approved: 'bg-emerald-50 text-emerald-700', published: 'bg-emerald-50 text-emerald-700', ready: 'bg-emerald-50 text-emerald-700',
  review: 'bg-amber-50 text-amber-800', pending: 'bg-amber-50 text-amber-800', unknown: 'bg-amber-50 text-amber-800',
  generating: 'bg-sky-50 text-sky-700', sending: 'bg-sky-50 text-sky-700', scheduled: 'bg-indigo-50 text-indigo-700',
  failed: 'bg-rose-50 text-rose-700', generation_failed: 'bg-rose-50 text-rose-700', cancelled: 'bg-slate-100 text-slate-500', cancel_requested: 'bg-orange-50 text-orange-700', archived: 'bg-slate-100 text-slate-500',
};

function Icon({ status }: { status: string }) {
  if (['approved', 'ready', 'published'].includes(status)) return <CheckCircle2 className="size-3.5" aria-hidden="true" />;
  if (['failed', 'generation_failed'].includes(status)) return <XCircle className="size-3.5" aria-hidden="true" />;
  if (['generating', 'sending'].includes(status)) return <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />;
  if (status === 'scheduled') return <Send className="size-3.5" aria-hidden="true" />;
  if (['review', 'unknown', 'cancel_requested'].includes(status)) return <AlertTriangle className="size-3.5" aria-hidden="true" />;
  if (status === 'draft') return <FilePenLine className="size-3.5" aria-hidden="true" />;
  return <Clock3 className="size-3.5" aria-hidden="true" />;
}

export function ContentStatusBadge({ status }: { status: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold', STYLE[status] ?? STYLE.proposed)}><Icon status={status} /><span>{statusLabel(status)}</span></span>;
}
