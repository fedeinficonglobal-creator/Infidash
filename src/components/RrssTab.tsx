import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Hash, TrendingUp, Users, Heart, Eye, MessageSquare, Plus, PencilLine, Trash2, Link2, Target, Sparkles, X } from 'lucide-react';
import { ChartFrame } from './ChartFrame';
import { type Client } from '../store/useClientStore';
import { buildClientSignals, formatPlain } from '../lib/clientSignals.js';
import { cn } from '../lib/utils';
import {
  getRrssMonthLabel,
  loadRrssPlanRows,
  removeRrssPlanRow,
  saveRrssPlanRows,
  upsertRrssPlanRow,
  type RrssPlanRow,
} from '../lib/rrssPlan.js';

const baseEngagementData = [
  { name: 'Lun', views: 4200 },
  { name: 'Mar', views: 3800 },
  { name: 'Mie', views: 8100 },
  { name: 'Jue', views: 5600 },
  { name: 'Vie', views: 6200 },
  { name: 'Sab', views: 12500 },
  { name: 'Dom', views: 10800 },
];

const EMPTY_FORM = {
  web: '',
  rrss: '',
  objetivo: '',
  inspoIdea: '',
  competidores: '',
};

export function RrssTab({ client }: { client: Client }) {
  const [activePlatform, setActivePlatform] = useState<string>('all');
  const [planRows, setPlanRows] = useState<RrssPlanRow[]>([]);
  const [isPlanReady, setIsPlanReady] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<RrssPlanRow | null>(null);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const monthLabel = useMemo(() => getRrssMonthLabel(), []);

  const signals = buildClientSignals(client);
  const hasData = signals.hasData;
  const followers = hasData ? Math.max(9200, Math.round(signals.conversions * 72 + client.health * 180)) : 0;
  const engagementRate = hasData ? (signals.healthBand === 'excellent' ? 6.1 : signals.healthBand === 'stable' ? 4.8 : signals.healthBand === 'risk' ? 3.4 : 2.2) : 0;
  const impressions = hasData ? Math.round(followers * (signals.healthBand === 'excellent' ? 12.4 : signals.healthBand === 'stable' ? 10.1 : 8.3)) : 0;
  const interactions = hasData ? Math.round(impressions * (engagementRate / 100)) : 0;
  const scale = hasData ? Math.max(impressions / 512000, 0.25) : 0;
  const engagementData = baseEngagementData.map((item) => ({
    ...item,
    views: hasData ? Math.round(item.views * scale * (signals.healthBand === 'critical' ? 0.82 : 1)) : 0,
  }));

  const platforms = [
    { id: 'all', label: 'Todos', icon: Hash },
    { id: 'instagram', label: 'Instagram', color: 'bg-rose-500' },
    { id: 'facebook', label: 'Facebook', color: 'bg-blue-600' },
    { id: 'tiktok', label: 'TikTok', color: 'bg-black' },
    { id: 'linkedin', label: 'LinkedIn', color: 'bg-blue-700' },
    { id: 'twitter', label: 'X (Twitter)', color: 'bg-slate-900' },
    { id: 'youtube', label: 'YouTube', color: 'bg-rose-600' },
  ];

  const contentIdeas = !hasData
    ? ['Sin datos sincronizados', 'Sin datos sincronizados', 'Sin datos sincronizados']
    : client.industry.toLowerCase().includes('moda')
    ? [
        'Reel: "3 combinaciones que convierten mejor este mes"',
        'Carousel: "Cómo elegir tu siguiente compra según el estilo"',
        'Story: "Colección destacada con CTA a producto estrella"',
      ]
    : client.industry.toLowerCase().includes('b2b')
      ? [
          'Post: "Caso de uso con resultados y KPIs visibles"',
          'Carousel: "Checklist para acelerar el pipeline"',
          'Video corto: "Cómo reducir fricción en el proceso comercial"',
        ]
      : [
          'Reel: "Presentación del producto más vendido"',
          'Carousel: "Beneficios clave para retener clientes"',
          'Story: "Oferta limitada con CTA a conversión"',
        ];

  const posts = [
    { id: 1, type: 'Reel', title: contentIdeas[0], views: formatPlain(hasData ? Math.round(impressions * 0.24) : 0), likes: formatPlain(hasData ? Math.round(interactions * 0.34) : 0), comments: hasData ? Math.round(interactions * 0.012) : 0, platform: 'Instagram' },
    { id: 2, type: 'Carousel', title: contentIdeas[1], views: formatPlain(hasData ? Math.round(impressions * 0.13) : 0), likes: formatPlain(hasData ? Math.round(interactions * 0.19) : 0), comments: hasData ? Math.round(interactions * 0.006) : 0, platform: 'LinkedIn' },
    { id: 3, type: 'Post', title: contentIdeas[2], views: formatPlain(hasData ? Math.round(impressions * 0.09) : 0), likes: formatPlain(hasData ? Math.round(interactions * 0.27) : 0), comments: hasData ? Math.round(interactions * 0.042) : 0, platform: 'Instagram' },
    { id: 4, type: 'Video', title: hasData ? 'Actualización de producto / servicio' : 'Sin datos sincronizados', views: formatPlain(hasData ? Math.round(impressions * 0.08) : 0), likes: formatPlain(hasData ? Math.round(interactions * 0.11) : 0), comments: hasData ? Math.round(interactions * 0.004) : 0, platform: 'TikTok' },
  ];

  const isFiltered = activePlatform !== 'all';

  useEffect(() => {
    setPlanRows(loadRrssPlanRows(client.id));
    setIsPlanReady(true);
    setPlanError(null);
    setIsModalOpen(false);
    setEditingRow(null);
    setForm(EMPTY_FORM);
  }, [client.id]);

  useEffect(() => {
    if (!isPlanReady) {
      return;
    }

    saveRrssPlanRows(client.id, planRows);
  }, [client.id, isPlanReady, planRows]);

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
    const confirmed = window.confirm(`¿Eliminar esta fila RRSS${current?.web ? ` de ${current.web}` : ''}?`);
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
          <p className="text-slate-500 font-medium">
            {hasData
              ? `${client.name} mantiene un engagement de ${engagementRate.toFixed(1)}% con ${formatPlain(interactions)} interacciones registradas.`
              : `${client.name} aún no tiene datos sincronizados. Las métricas se muestran en 0.`}
          </p>
        </div>
        <div className="flex bg-white border border-slate-100 p-1 rounded-xl shadow-sm overflow-x-auto no-scrollbar max-w-full">
          {platforms.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePlatform(p.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2',
                activePlatform === p.id ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
              )}
            >
              {p.icon ? <p.icon className="size-3" /> : <div className={cn('size-2 rounded-full', p.color)} />}
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex justify-between mb-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Seguidores</p>
            <Users className="size-4 text-slate-400" />
          </div>
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold">{formatPlain(followers)}</h3>
            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">{hasData ? `+${formatPlain(Math.round(followers * 0.03))}` : '0'}</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex justify-between mb-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Impresiones (7d)</p>
            <Eye className="size-4 text-slate-400" />
          </div>
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold">{formatPlain(impressions)}</h3>
            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">{hasData ? (signals.healthBand === 'critical' ? '2%' : '11%') : '0%'}</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex justify-between mb-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Interacciones</p>
            <Heart className="size-4 text-rose-400" />
          </div>
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold">{formatPlain(interactions)}</h3>
            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">{hasData ? (signals.healthBand === 'critical' ? '0.8%' : '6.4%') : '0%'}</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex justify-between mb-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Engagement Rate</p>
            <TrendingUp className="size-4 text-slate-400" />
          </div>
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold">{engagementRate.toFixed(1)}%</h3>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasData && signals.healthBand === 'critical' ? 'text-rose-600 bg-rose-50' : 'text-emerald-600 bg-emerald-50'}`}>
              {hasData ? (signals.healthBand === 'critical' ? '-0.4%' : '+0.7%') : '0%'}
            </span>
          </div>
        </div>
      </div>

      <section className="mb-8 rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-6 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 mb-2">{monthLabel}</p>
            <h3 className="text-xl font-bold text-slate-900">Plan RRSS editable</h3>
            <p className="text-sm text-slate-500 mt-1">Añade y edita filas con WEB, RRSS, objetivo, inspiración/idea y competidores.</p>
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
                    No hay filas creadas todavía. Usa <strong>Añadir fila</strong> para empezar con el plan de RRSS.
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
                        <span className="text-sm text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 border-b border-slate-100 align-top text-sm text-slate-700 whitespace-pre-wrap break-words">{row.rrss || '—'}</td>
                    <td className="px-5 py-4 border-b border-slate-100 align-top text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[280px]">{row.objetivo || '—'}</td>
                    <td className="px-5 py-4 border-b border-slate-100 align-top text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[280px]">{row.inspoIdea || '—'}</td>
                    <td className="px-5 py-4 border-b border-slate-100 align-top text-sm text-slate-700 whitespace-pre-wrap break-words max-w-[260px]">{row.competidores || '—'}</td>
                    <td className="px-5 py-4 border-b border-slate-100 align-top text-right">
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
                          onClick={() => handleDeleteRow(row.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors"
                        >
                          <Trash2 className="size-3.5" /> Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 p-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 mb-1">{monthLabel}</p>
                <h3 className="text-xl font-bold text-slate-900">{editingRow ? 'Editar fila RRSS' : 'Añadir fila RRSS'}</h3>
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
                    placeholder="Describe el objetivo de la comunicación..."
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
                  {isSavingPlan ? 'Guardando...' : editingRow ? 'Guardar cambios' : 'Añadir fila'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Alcance e Impresiones</h3>
          <ChartFrame height={300} className="w-full min-w-0" fallback={<div className="h-full flex items-center justify-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-sm font-medium text-slate-500">Calculando dimensiones del gráfico...</div>}>
            {() => (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={engagementData}>
                  <defs>
                    <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
                  <Area type="monotone" dataKey="views" name="Impresiones" stroke="#8b5cf6" strokeWidth={3} fill="url(#colorViews)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Rendimiento de Posts{isFiltered ? ` · ${activePlatform}` : ''}</h3>
          <div className="space-y-4">
            {posts.map((post) => (
              <div key={post.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'size-10 rounded-lg flex items-center justify-center font-bold text-xs uppercase text-white shadow-sm',
                      post.platform === 'Instagram' ? 'bg-gradient-to-tr from-yellow-400 via-rose-500 to-purple-500' : post.platform === 'TikTok' ? 'bg-black' : 'bg-blue-600'
                    )}
                  >
                    {post.platform.substring(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 truncate max-w-[150px] sm:max-w-xs">{post.title}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{post.type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <div className="flex items-center gap-1 text-slate-500 justify-end">
                      <Eye className="size-3" />
                      <span className="text-xs font-bold">{post.views}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-rose-500 justify-end">
                      <Heart className="size-3" />
                      <span className="text-xs font-bold">{post.likes}</span>
                    </div>
                    <div className="flex items-center gap-1 text-blue-500 justify-end">
                      <MessageSquare className="size-3" />
                      <span className="text-xs font-bold">{post.comments}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
