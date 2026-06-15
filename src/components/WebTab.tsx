import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link2, PencilLine, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { type Client } from '../store/useClientStore';
import { buildClientSignals } from '../lib/clientSignals.js';
import {
  getWebMonthLabel,
  loadWebPlanRows,
  removeWebPlanRow,
  saveWebPlanRows,
  upsertWebPlanRow,
  type WebPlanRow,
} from '../lib/webPlan.js';

const EMPTY_FORM = {
  cliente: '',
  web: '',
  kpi: '',
  umbralLeads: '',
  leadsAbril: '',
  accionMayo: '',
  leadsMayo: '',
  wpoMayo: '',
};

export function WebTab({ client }: { client: Client }) {
  const signals = buildClientSignals(client);
  const [rows, setRows] = useState<WebPlanRow[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<WebPlanRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const monthLabel = useMemo(() => getWebMonthLabel(), []);

  useEffect(() => {
    const loaded = loadWebPlanRows(client.id);
    if (loaded.length > 0) {
      setRows(loaded);
    } else {
      setRows([
        {
          id: crypto.randomUUID(),
          cliente: client.name,
          web: client.slug ? `https://${client.slug}.com/` : 'https://example.com/',
          kpi: 'Formularios web - Citas',
          umbralLeads: '5 FORMS',
          leadsAbril: '2 FORMS',
          accionMayo: 'Markdown Elementor para IA',
          leadsMayo: '3 FORMS',
          wpoMayo: '87',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
    }
    setIsReady(true);
    setIsModalOpen(false);
    setEditingRow(null);
    setForm(EMPTY_FORM);
    setError(null);
  }, [client.id, client.name, client.slug]);

  useEffect(() => {
    if (!isReady) return;
    saveWebPlanRows(client.id, rows);
  }, [client.id, isReady, rows]);

  const openCreateModal = () => {
    setEditingRow(null);
    setError(null);
    setForm({
      cliente: client.name,
      web: client.slug ? `https://${client.slug}.com/` : '',
      kpi: '',
      umbralLeads: '',
      leadsAbril: '',
      accionMayo: '',
      leadsMayo: '',
      wpoMayo: '',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (row: WebPlanRow) => {
    setEditingRow(row);
    setError(null);
    setForm({
      cliente: row.cliente,
      web: row.web,
      kpi: row.kpi,
      umbralLeads: row.umbralLeads,
      leadsAbril: row.leadsAbril,
      accionMayo: row.accionMayo,
      leadsMayo: row.leadsMayo,
      wpoMayo: row.wpoMayo,
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingRow(null);
    setError(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const payload = {
        id: editingRow?.id,
        ...form,
      };
      setRows((current) => upsertWebPlanRow(current, payload));
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la fila web');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (rowId: string) => {
    const target = rows.find((row) => row.id === rowId);
    if (!window.confirm(`¿Eliminar la fila web de ${target?.cliente ?? 'este cliente'}?`)) return;
    setRows((current) => removeWebPlanRow(current, rowId));
    if (editingRow?.id === rowId) closeModal();
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1">Web · {client.name}</h2>
          <p className="text-slate-500 font-medium">Planifica WEB, KPI, umbral de leads y el seguimiento mensual de abril/mayo.</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Salud del cliente</p>
          <p className="mt-1 text-sm font-semibold text-slate-700">{signals.primaryMessage}</p>
        </div>
      </header>

      <section className="mb-8 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-amber-50 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 mb-2">{monthLabel}</p>
            <h3 className="text-xl font-bold text-slate-900">Seguimiento Web editable</h3>
            <p className="text-sm text-slate-500 mt-1">Campos como en la hoja: cliente, web, KPI, umbral, abril, acción mayo, mayo y WPO.</p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-white shadow-lg shadow-brand-primary/20 transition-colors hover:bg-brand-primary/90"
          >
            <Plus className="size-4" /> Añadir fila
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1500px] w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="bg-slate-50 px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-200" colSpan={5}>INFORMACIÓN BASE</th>
                <th className="bg-pink-50 px-5 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-200">ABRIL</th>
                <th className="bg-amber-50 px-5 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-200" colSpan={3}>MAYO</th>
              </tr>
              <tr className="bg-white text-slate-700">
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200 bg-blue-50">Cliente</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200">Web</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200 bg-yellow-50">KPI</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200 bg-emerald-50">Umbral leads</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200 bg-pink-50">Leads - Abril</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200 bg-amber-50">Acción mayo "Markdown Elementor para IA"</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200 bg-amber-50">Leads - Mayo</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200 bg-amber-50">WPO - Mayo</th>
                <th className="px-5 py-4 text-right text-xs font-extrabold uppercase tracking-widest border-b border-slate-200">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="group align-top even:bg-slate-50/40 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4 border-b border-slate-100 text-sm font-bold text-slate-900">{row.cliente}</td>
                  <td className="px-5 py-4 border-b border-slate-100 text-sm text-slate-700 whitespace-pre-wrap break-all">
                    {row.web ? (
                      <a href={row.web} target="_blank" rel="noreferrer" className="text-brand-primary hover:underline">
                        {row.web}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-5 py-4 border-b border-slate-100 text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[240px]">{row.kpi || '—'}</td>
                  <td className="px-5 py-4 border-b border-slate-100 text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[180px]">{row.umbralLeads || '—'}</td>
                  <td className="px-5 py-4 border-b border-slate-100 text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[180px]">{row.leadsAbril || '—'}</td>
                  <td className="px-5 py-4 border-b border-slate-100 text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[320px]">{row.accionMayo || '—'}</td>
                  <td className="px-5 py-4 border-b border-slate-100 text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[180px]">{row.leadsMayo || '—'}</td>
                  <td className="px-5 py-4 border-b border-slate-100 text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[120px]">{row.wpoMayo || '—'}</td>
                  <td className="px-5 py-4 border-b border-slate-100 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => openEditModal(row)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:border-brand-primary hover:text-brand-primary transition-colors"
                      >
                        <PencilLine className="size-3.5" /> Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors"
                      >
                        <Trash2 className="size-3.5" /> Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 mb-1">{monthLabel}</p>
                <h3 className="text-xl font-bold text-slate-900">{editingRow ? 'Editar fila web' : 'Añadir fila web'}</h3>
              </div>
              <button type="button" onClick={closeModal} className="text-slate-400 transition-colors hover:text-slate-600"><X className="size-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              {error && (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm font-bold text-slate-700 md:col-span-2">
                  <span>Cliente</span>
                  <input
                    type="text"
                    required
                    value={form.cliente}
                    onChange={(e) => setForm((prev) => ({ ...prev, cliente: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>

                <label className="space-y-2 text-sm font-bold text-slate-700 md:col-span-2">
                  <span className="flex items-center gap-2"><Link2 className="size-4 text-slate-400" /> Web</span>
                  <input
                    type="url"
                    required
                    value={form.web}
                    onChange={(e) => setForm((prev) => ({ ...prev, web: e.target.value }))}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>

                <label className="space-y-2 text-sm font-bold text-slate-700">
                  <span>KPI</span>
                  <input
                    type="text"
                    required
                    value={form.kpi}
                    onChange={(e) => setForm((prev) => ({ ...prev, kpi: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>

                <label className="space-y-2 text-sm font-bold text-slate-700">
                  <span>Umbral leads</span>
                  <input
                    type="text"
                    required
                    value={form.umbralLeads}
                    onChange={(e) => setForm((prev) => ({ ...prev, umbralLeads: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>

                <label className="space-y-2 text-sm font-bold text-slate-700">
                  <span>Leads - Abril</span>
                  <input
                    type="text"
                    required
                    value={form.leadsAbril}
                    onChange={(e) => setForm((prev) => ({ ...prev, leadsAbril: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>

                <label className="space-y-2 text-sm font-bold text-slate-700 md:col-span-2">
                  <span className="flex items-center gap-2"><Sparkles className="size-4 text-slate-400" /> Acción mayo "Markdown Elementor para IA"</span>
                  <textarea
                    required
                    rows={4}
                    value={form.accionMayo}
                    onChange={(e) => setForm((prev) => ({ ...prev, accionMayo: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>

                <label className="space-y-2 text-sm font-bold text-slate-700">
                  <span>Leads - Mayo</span>
                  <input
                    type="text"
                    required
                    value={form.leadsMayo}
                    onChange={(e) => setForm((prev) => ({ ...prev, leadsMayo: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>

                <label className="space-y-2 text-sm font-bold text-slate-700">
                  <span>WPO - Mayo</span>
                  <input
                    type="text"
                    required
                    value={form.wpoMayo}
                    onChange={(e) => setForm((prev) => ({ ...prev, wpoMayo: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button type="button" onClick={closeModal} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={isSaving} className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
                  {isSaving ? 'Guardando...' : editingRow ? 'Guardar cambios' : 'Añadir fila'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
