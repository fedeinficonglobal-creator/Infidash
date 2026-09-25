import { useEffect, useState } from 'react';
import { createSavedReportRun, fetchSavedReportPdf, listSavedReportRuns, sendSavedReportRun, type SavedReportRun } from '../services/infidashApi.js';

export function SavedReportsPanel({ token, clientId, from, to, canManage }: { token: string | null; clientId: string; from: string; to: string; canManage: boolean }) {
  const [runs, setRuns] = useState<SavedReportRun[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRuns([]); setCursor(null); setError(null); setNotice(null);
    if (token) void listSavedReportRuns(token, clientId).then((page) => {
      if (active) { setRuns(page.runs); setCursor(page.nextCursor); setSmtpConfigured(page.smtpConfigured); }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los informes'); });
    return () => { active = false; };
  }, [token, clientId]);

  const save = async () => {
    if (!token) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const { run } = await createSavedReportRun(token, clientId, from, to);
      setRuns((current) => [run, ...current]);
      setNotice('Informe guardado. El PDF conserva los datos de este momento.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el informe'); }
    finally { setBusy(false); }
  };

  const download = async (run: SavedReportRun) => {
    if (!token) return;
    setError(null);
    try {
      const blob = await fetchSavedReportPdf(token, clientId, run.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `infidash-${run.from}-${run.to}.pdf`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo descargar el informe'); }
  };

  const send = async (run: SavedReportRun) => {
    if (!token || !recipient) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await sendSavedReportRun(token, clientId, run.id, recipient.trim());
      setRuns((current) => current.map((item) => item.id === run.id ? updated.run : item));
      setNotice(`Enviado a ${recipient.trim()}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el envío'); }
    finally { setBusy(false); }
  };

  const more = async () => {
    if (!token || !cursor) return;
    setBusy(true); setError(null);
    try {
      const page = await listSavedReportRuns(token, clientId, cursor);
      setRuns((current) => [...current, ...page.runs.filter((run) => !current.some((item) => item.id === run.id))]);
      setCursor(page.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el historial'); }
    finally { setBusy(false); }
  };

  return <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm" aria-label="Informes guardados">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold text-slate-900">Informes guardados</h3><p className="text-xs text-slate-500">Los PDF guardados conservan los datos del día de generación y pueden descargarse después.</p></div>{canManage && <button type="button" onClick={() => void save()} disabled={!token || busy || !from || !to || from > to} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar informe del periodo</button>}</div>
    {canManage && <label className="mt-4 block text-xs font-semibold text-slate-600">Destinatario del envío<input type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="cliente@ejemplo.com" className="mt-1 block w-full max-w-sm rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>}
    {canManage && !smtpConfigured && <p className="mt-2 text-xs text-amber-700">Configura SMTP en el servidor para habilitar el envío.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
    <div className="mt-4 divide-y divide-slate-100">{runs.map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="text-sm"><p className="font-semibold text-slate-800">{run.from} — {run.to}</p><p className="text-xs text-slate-500">Guardado {new Date(run.generatedAt).toLocaleString('es-ES')}{run.lastSentAt ? ` · Último intento de envío: ${run.lastSentTo} (${run.lastSendError ?? 'confirmado'})` : ''}</p></div><div className="flex gap-2"><button type="button" onClick={() => void download(run)} className="rounded-lg border px-3 py-2 text-xs font-bold">Descargar</button>{canManage && <button type="button" onClick={() => void send(run)} disabled={busy || !smtpConfigured || !recipient.trim()} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">Enviar por email</button>}</div></div>)}{runs.length === 0 && <p className="py-4 text-sm text-slate-500">Aún no hay informes guardados.</p>}</div>
    {cursor && <button type="button" onClick={() => void more()} disabled={busy} className="mt-3 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">Cargar más</button>}
  </section>;
}
