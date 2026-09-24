import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, PencilLine, Trash2, Link2, Target, Sparkles, X } from 'lucide-react';
import { type Client, useClientStore } from '../store/useClientStore';
import { canPersistPlanRows } from '../lib/planStorage.js';
import {
  getRrssMonthLabel,
  loadRrssPlanRows,
  removeRrssPlanRow,
  saveRrssPlanRows,
  upsertRrssPlanRow,
  type RrssPlanRow,
} from '../lib/rrssPlan.js';

const EMPTY_FORM = {
  web: '',
  rrss: '',
  objetivo: '',
  inspoIdea: '',
  competidores: '',
};

export function RrssTab({ client }: { client: Client }) {
  const { currentUser } = useClientStore();
  const isAdmin = currentUser?.role === 'admin';
  const [planRows, setPlanRows] = useState<RrssPlanRow[]>([]);
  const [loadedPlanClientId, setLoadedPlanClientId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<RrssPlanRow | null>(null);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const monthLabel = useMemo(() => getRrssMonthLabel(), []);


  useEffect(() => {
    setPlanRows(loadRrssPlanRows(client.id));
    setLoadedPlanClientId(client.id);
    setPlanError(null);
    setIsModalOpen(false);
    setEditingRow(null);
    setForm(EMPTY_FORM);
  }, [client.id]);

  useEffect(() => {
    if (!canPersistPlanRows(client.id, loadedPlanClientId)) return;

    saveRrssPlanRows(client.id, planRows);
  }, [client.id, loadedPlanClientId, planRows]);

  const openCreateModal = () => {
    setEditingRow(null);
    setPlanError(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (row: RrssPlanRow) => {
    setEditingRow(row);
    setPlanError(null);
    setForm({
      web: row.web,
      rrss: row.rrss,
      objetivo: row.objetivo,
      inspoIdea: row.inspoIdea,
      competidores: row.competidores,
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingRow(null);
    setPlanError(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmitPlan = async (e: FormEvent) => {
    e.preventDefault();
    setIsSavingPlan(true);
    setPlanError(null);

    try {
      const payload = {
        id: editingRow?.id,
        web: form.web,
        rrss: form.rrss,
        objetivo: form.objetivo,
        inspoIdea: form.inspoIdea,
        competidores: form.competidores,
      };

      setPlanRows((current) => upsertRrssPlanRow(current, payload));
      closeModal();
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : 'No se pudo guardar la fila RRSS');
    } finally {
      setIsSavingPlan(false);
    }
  };

  const handleDeleteRow = (rowId: string) => {
    const current = planRows.find((row) => row.id === rowId);
    const confirmed = window.confirm(`Â¿Eliminar esta fila RRSS${current?.web ? ` de ${current.web}` : ''}?`);
    if (!confirmed) {
      return;
    }

    setPlanRows((rows) => removeRrssPlanRow(rows, rowId));
    if (editingRow?.id === rowId) {
      closeModal();
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1 flex items-center gap-3">Redes Sociales</h2>
          <p className="text-slate-500 font-medium">Plan de contenidos de {client.name} Â· borrador local en este navegador.</p>
        </div>
      </header>

      <div role="note" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        No hay una fuente social conectada: aquí se mantiene el plan de contenidos, pero no se presentan cifras sintéticas de audiencia o rendimiento. El plan es un borrador local de este navegador.
      </div>
      <section className="mb-8 rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-6 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 mb-2">{monthLabel}</p>
            <h3 className="text-xl font-bold text-slate-900">Plan RRSS editable</h3>
            <p className="text-sm text-slate-500 mt-1">AÃ±ade y edita filas con WEB, RRSS, objetivo, inspiraciÃ³n/idea y competidores.</p>
          </div>
          {isAdmin && <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-white shadow-lg shadow-brand-primary/20 transition-colors hover:bg-brand-primary/90"
          >
            <Plus className="size-4" /> AÃ±adir fila
          </button>}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full border-separate border-spacing-0">
            <thead>
              <tr className="bg-blue-50 text-slate-700">
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200">WEB</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200">RRSS</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200">OBJETIVO</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200">INSPO/IDEA</th>
                <th className="px-5 py-4 text-left text-xs font-extrabold uppercase tracking-widest border-b border-slate-200">Competidores</th>
                <th className="px-5 py-4 text-right text-xs font-extrabold uppercase tracking-widest border-b border-slate-200">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {planRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">
                    No hay filas creadas todavÃ­a. Usa <strong>AÃ±adir fila</strong> para empezar con el plan de RRSS.
                  </td>
                </tr>
              ) : (
                planRows.map((row) => (
                  <tr key={row.id} className="group align-top even:bg-amber-50/30 hover:bg-slate-50/90 transition-colors">
                    <td className="px-5 py-4 border-b border-slate-100 align-top">
                      {row.web ? (
                        <a href={row.web} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-primary hover:underline break-all">
                          {row.web}
                        </a>
                      ) : (
                        <span className="text-sm text-slate-400">â€”</span>
                      )}
                    </td>
                    <td className="px-5 py-4 border-b border-slate-100 align-top text-sm text-slate-700 whitespace-pre-wrap break-words">{row.rrss || 'â€”'}</td>
                    <td className="px-5 py-4 border-b border-slate-100 align-top text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[280px]">{row.objetivo || 'â€”'}</td>
                    <td className="px-5 py-4 border-b border-slate-100 align-top text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[280px]">{row.inspoIdea || 'â€”'}</td>
                    <td className="px-5 py-4 border-b border-slate-100 align-top text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[260px]">{row.competidores || 'â€”'}</td>
                    <td className="px-5 py-4 border-b border-slate-100 align-top text-right">
                      {isAdmin && <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => openEditModal(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:border-brand-primary hover:text-brand-primary transition-colors"
                        >
                          <PencilLine className="size-3.5" /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(row.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors"
                        >
                          <Trash2 className="size-3.5" /> Eliminar
                        </button>
                      </div>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin && isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 p-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 mb-1">{monthLabel}</p>
                <h3 className="text-xl font-bold text-slate-900">{editingRow ? 'Editar fila RRSS' : 'AÃ±adir fila RRSS'}</h3>
              </div>
              <button type="button" onClick={closeModal} className="text-slate-400 transition-colors hover:text-slate-600">
                <X className="size-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitPlan} className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {planError && (
                  <div className="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {planError}
                  </div>
                )}

                <label className="space-y-2 text-sm font-bold text-slate-700 md:col-span-2">
                  <span className="flex items-center gap-2"><Link2 className="size-4 text-slate-400" /> WEB</span>
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
                  <span>RRSS</span>
                  <input
                    type="text"
                    required
                    value={form.rrss}
                    onChange={(e) => setForm((prev) => ({ ...prev, rrss: e.target.value }))}
                    placeholder="Facebook, Instagram..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>

                <label className="space-y-2 text-sm font-bold text-slate-700">
                  <span className="flex items-center gap-2"><Target className="size-4 text-slate-400" /> OBJETIVO</span>
                  <textarea
                    required
                    rows={4}
                    value={form.objetivo}
                    onChange={(e) => setForm((prev) => ({ ...prev, objetivo: e.target.value }))}
                    placeholder="Describe el objetivo de la comunicaciÃ³n..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>

                <label className="space-y-2 text-sm font-bold text-slate-700">
                  <span className="flex items-center gap-2"><Sparkles className="size-4 text-slate-400" /> INSPO/IDEA</span>
                  <textarea
                    required
                    rows={4}
                    value={form.inspoIdea}
                    onChange={(e) => setForm((prev) => ({ ...prev, inspoIdea: e.target.value }))}
                    placeholder="Ideas, referencias, enlaces o concepto creativo..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>

                <label className="space-y-2 text-sm font-bold text-slate-700 md:col-span-2">
                  <span>Competidores</span>
                  <textarea
                    required
                    rows={3}
                    value={form.competidores}
                    onChange={(e) => setForm((prev) => ({ ...prev, competidores: e.target.value }))}
                    placeholder="Competidores, ejemplos o referencias..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-normal outline-none transition-all focus:ring-2 focus:ring-brand-primary"
                  />
                </label>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingPlan}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-bold text-white shadow-lg shadow-brand-primary/20 transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingPlan ? 'Guardando...' : editingRow ? 'Guardar cambios' : 'AÃ±adir fila'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
