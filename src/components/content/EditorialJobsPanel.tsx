import { useCallback, useEffect, useState } from 'react';
import { createContentJob, getContentJobs, getEditorialReadiness, recoverPlanJob, type ContentJob, type EditorialReadiness } from '../../services/contentApi.js';
import { useClientStore } from '../../store/useClientStore.js';

const JOB_LABELS: Record<ContentJob['kind'], string> = {
  generate_plan: 'Generar plan', generate_content: 'Generar contenido', publish: 'Publicar',
  reschedule: 'Reprogramar', cancel: 'Cancelar publicación', reconcile: 'Conciliar publicación',
};

export function EditorialJobsPanel({ clientId }: { clientId: string }) {
  const token = useClientStore((state) => state.sessionToken);
  const admin = useClientStore((state) => state.currentUser?.role === 'admin');
  const [jobs, setJobs] = useState<ContentJob[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<EditorialReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const [page, config] = await Promise.all([getContentJobs(token, { clientId, limit: 25 }), getEditorialReadiness(token, clientId)]);
      setJobs(page.items);
      setCursor(page.nextCursor);
      setReadiness(config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los trabajos');
    } finally { setBusy(false); }
  }, [token, clientId]);

  useEffect(() => { setJobs([]); setCursor(null); setReadiness(null); void refresh(); }, [refresh]);

  const loadMore = async () => {
    if (!token || !cursor) return;
    setBusy(true);
    try {
      const page = await getContentJobs(token, { clientId, cursor, limit: 25 });
      setJobs((current) => [...current, ...page.items.filter((item) => !current.some((old) => old.id === item.id))]);
      setCursor(page.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el historial'); }
    finally { setBusy(false); }
  };

  const recover = async (id: string) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try { await recoverPlanJob(token, id); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo recuperar el trabajo'); setBusy(false); }
  };

  const reconcile = async (job: ContentJob) => {
    if (!token || !job.targetId) return;
    setBusy(true); setError(null);
    try {
      await createContentJob(token, { clientId, kind: 'reconcile', targetId: job.targetId, idempotencyKey: `reconcile:${job.id}` });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo solicitar la conciliación'); setBusy(false); }
  };

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Trabajos editoriales">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-bold text-slate-900">Trabajos editoriales</h2><p className="text-xs text-slate-500">Historial del cliente y estado de automatización.</p></div><button type="button" onClick={() => void refresh()} disabled={busy} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">Actualizar</button></div>
    {readiness && <div className="mt-3 text-xs text-slate-600">{readiness.enabled ? 'Automatización activa' : 'Automatización desactivada'} · {Object.entries(readiness.jobs).filter(([, ready]) => !ready).map(([kind]) => JOB_LABELS[kind as ContentJob['kind']]).join(', ') || 'Todos los workflows configurados'}{Object.values(readiness.jobs).every(Boolean) ? '' : ' sin configurar'}</div>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    <div className="mt-4 divide-y divide-slate-100">{jobs.map((job) => {
      const exhausted = (job.attemptCount ?? 0) >= 8 && (job.status === 'failed' || (job.status === 'running' && job.lockedUntil && new Date(job.lockedUntil).getTime() <= Date.now()));
      const needsReconciliation = ['publish', 'reschedule', 'cancel'].includes(job.kind) && (job.status === 'failed' || job.status === 'unknown' || (job.status === 'running' && job.lockedUntil && new Date(job.lockedUntil).getTime() <= Date.now()));
      return <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><p className="font-semibold text-slate-800">{JOB_LABELS[job.kind]} · {job.status} · {job.attemptCount ?? 0}/8 intentos</p><p className="text-xs text-slate-500">{new Date(job.updatedAt).toLocaleString('es-ES')}{job.lastError ? ` · ${job.lastError}` : ''}</p></div>{admin && job.kind === 'generate_plan' && exhausted && <button type="button" disabled={busy} onClick={() => void recover(job.id)} className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-50">Reintentar plan</button>}{admin && needsReconciliation && job.targetId && <button type="button" disabled={busy} onClick={() => void reconcile(job)} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 disabled:opacity-50">Conciliar con proveedor</button>}</div>;
    })}{jobs.length === 0 && !busy && <p className="py-4 text-sm text-slate-500">Sin trabajos registrados.</p>}</div>
    {cursor && <button type="button" disabled={busy} onClick={() => void loadMore()} className="mt-3 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">Cargar más trabajos</button>}
  </section>;
}
