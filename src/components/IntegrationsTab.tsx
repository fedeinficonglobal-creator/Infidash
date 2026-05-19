import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { type Client } from '../store/useClientStore';
import { useClientStore } from '../store/useClientStore';
import {
  deleteClientIntegration,
  getClientIntegrations,
  saveClientIntegration,
  testClientIntegration,
  type ApiIntegration,
} from '../services/infidashApi.js';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileText,
  Globe,
  KeyRound,
  LoaderCircle,
  RefreshCcw,
  Save,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react';
import {
  INTEGRATION_PROVIDERS,
  buildIntegrationCapabilitySummary,
  defaultIntegrationSection,
  getIntegrationCapabilityLabel,
  getIntegrationProviderDefinition,
  type IntegrationProvider,
} from '../lib/integrationCatalog.js';
import { cn } from '../lib/utils.js';

type IntegrationDraft = {
  label: string;
  config: Record<string, string>;
  credentials: Record<string, string>;
};

function createDraft(provider: IntegrationProvider): IntegrationDraft {
  const definition = getIntegrationProviderDefinition(provider);
  if (!definition) {
    return { label: '', config: {}, credentials: {} };
  }

  return {
    label: '',
    config: defaultIntegrationSection(definition.configFields),
    credentials: defaultIntegrationSection(definition.credentialFields),
  };
}

function statusMeta(status: ApiIntegration['status']) {
  switch (status) {
    case 'connected':
      return {
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
        label: 'Conectada',
      };
    case 'error':
      return {
        badge: 'bg-rose-50 text-rose-700 border-rose-200',
        dot: 'bg-rose-500',
        label: 'Error',
      };
    case 'disabled':
      return {
        badge: 'bg-slate-100 text-slate-600 border-slate-200',
        dot: 'bg-slate-400',
        label: 'Desactivada',
      };
    default:
      return {
        badge: 'bg-amber-50 text-amber-700 border-amber-200',
        dot: 'bg-amber-500',
        label: 'Pendiente',
      };
  }
}

function integrationCardIcon(provider: IntegrationProvider) {
  switch (provider) {
    case 'clarity':
      return Globe;
    case 'wordpress':
      return FileText;
    case 'woocommerce':
      return ShoppingCart;
    default:
      return Workflow;
  }
}

function capabilityTone(capability: string) {
  switch (capability) {
    case 'analytics':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'leads':
      return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'sales':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

export function IntegrationsTab({ client }: { client: Client }) {
  const { sessionToken, currentUser } = useClientStore();
  const isAdmin = currentUser?.role === 'admin';
  const [integrations, setIntegrations] = useState<ApiIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<IntegrationProvider>('clarity');
  const [draft, setDraft] = useState<IntegrationDraft>(() => createDraft('clarity'));

  const selectedDefinition = useMemo(() => getIntegrationProviderDefinition(selectedProvider), [selectedProvider]);
  const currentIntegration = useMemo(
    () => integrations.find((integration) => integration.id === editingId) ?? null,
    [editingId, integrations],
  );

  useEffect(() => {
    if (!currentIntegration) {
      if (!editingId) {
        const definition = getIntegrationProviderDefinition(selectedProvider);
        setDraft({
          label: '',
          config: definition ? defaultIntegrationSection(definition.configFields) : {},
          credentials: definition ? defaultIntegrationSection(definition.credentialFields) : {},
        });
      }
      return;
    }

    const definition = getIntegrationProviderDefinition(currentIntegration.provider);
    setSelectedProvider(currentIntegration.provider);
    setDraft({
      label: currentIntegration.label,
      config: definition ? currentIntegration.config : {},
      credentials: definition ? defaultIntegrationSection(definition.credentialFields) : {},
    });
  }, [currentIntegration, editingId, selectedProvider]);

  useEffect(() => {
    let cancelled = false;

    const loadIntegrations = async () => {
      if (!sessionToken) {
        setLoading(false);
        setIntegrations([]);
        return;
      }

      setLoading(true);
      try {
        const response = await getClientIntegrations(sessionToken, client.id);
        if (!cancelled) {
          setIntegrations(response.integrations);
          if (editingId && !response.integrations.some((integration) => integration.id === editingId)) {
            setEditingId(response.integrations[0]?.id ?? null);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setFormError(error instanceof Error ? error.message : 'No se pudieron cargar las integraciones');
          setIntegrations([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadIntegrations();

    return () => {
      cancelled = true;
    };
  }, [client.id, editingId, sessionToken]);

  const providerSummary = useMemo(() => {
    return INTEGRATION_PROVIDERS.map((provider) => {
      const integration = integrations.find((item) => item.provider === provider.provider) ?? null;
      return {
        ...provider,
        integration,
        summary: buildIntegrationCapabilitySummary(provider),
        capabilityLabels: provider.capabilities.map((capability) => getIntegrationCapabilityLabel(capability)),
      };
    });
  }, [integrations]);

  const connectedCount = integrations.filter((integration) => integration.status === 'connected').length;
  const readyMetrics = providerSummary.filter((item) => item.integration?.status === 'connected').flatMap((item) => item.capabilityLabels);
  const lastSyncLabel = integrations.find((integration) => integration.lastSync)?.lastSync ?? 'Sin sincronizar';

  const setField = (section: 'config' | 'credentials', key: string, value: string) => {
    setDraft((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [key]: value,
      },
    }));
  };

  const resetFormForProvider = (provider: IntegrationProvider) => {
    setSelectedProvider(provider);
    setEditingId(null);
    setFormError(null);
    setFormSuccess(null);
    setDraft(createDraft(provider));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionToken) {
      setFormError('Necesitas iniciar sesión para guardar integraciones');
      return;
    }

    if (!selectedDefinition) {
      setFormError('Proveedor de integración inválido');
      return;
    }

    setSaving(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const response = await saveClientIntegration(sessionToken, {
        id: editingId ?? undefined,
        clientId: client.id,
        provider: selectedProvider,
        label: draft.label.trim() || undefined,
        config: draft.config,
        credentials: draft.credentials,
      });

      setIntegrations((current) => {
        const remaining = current.filter((item) => item.id !== response.integration.id);
        return [response.integration, ...remaining].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
      setEditingId(response.integration.id);
      setFormSuccess(`${response.integration.label} guardada correctamente.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo guardar la integración');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (integrationId: string) => {
    if (!sessionToken) {
      return;
    }

    setTestingId(integrationId);
    setFormError(null);
    try {
      const result = await testClientIntegration(sessionToken, integrationId);
      setIntegrations((current) => current.map((integration) => integration.id === integrationId ? result.integration : integration));
      setFormSuccess(result.ready
        ? `Configuración validada: ${result.summary}`
        : `Faltan campos: ${result.missingFields.join(', ')}`);
      if (editingId === integrationId) {
        setDraft((current) => ({
          ...current,
          credentials: current.credentials,
        }));
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo validar la integración');
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (integrationId: string) => {
    if (!sessionToken) {
      return;
    }

    const target = integrations.find((item) => item.id === integrationId);
    if (!target) {
      return;
    }

    if (!window.confirm(`¿Eliminar la integración ${target.label}?`)) {
      return;
    }

    setDeletingId(integrationId);
    setFormError(null);
    try {
      await deleteClientIntegration(sessionToken, integrationId);
      setIntegrations((current) => current.filter((integration) => integration.id !== integrationId));
      if (editingId === integrationId) {
        setEditingId(null);
        resetFormForProvider(selectedProvider);
      }
      setFormSuccess('Integración eliminada correctamente.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo eliminar la integración');
    } finally {
      setDeletingId(null);
    }
  };

  const renderFields = (section: 'config' | 'credentials') => {
    if (!selectedDefinition) {
      return null;
    }

    const fields = section === 'config' ? selectedDefinition.configFields : selectedDefinition.credentialFields;
    return fields.map((field) => (
      <label key={field.key} className="space-y-2 block">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
          {section === 'credentials' && <KeyRound className="size-3 text-amber-500" />}
          {field.label}
          {field.required && <span className="text-rose-500">*</span>}
        </span>
        {field.type === 'textarea' ? (
          <textarea
            value={draft[section][field.key] ?? ''}
            onChange={(event) => setField(section, field.key, event.target.value)}
            placeholder={field.placeholder}
            className="w-full min-h-24 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10"
          />
        ) : (
          <input
            type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
            value={draft[section][field.key] ?? ''}
            onChange={(event) => setField(section, field.key, event.target.value)}
            placeholder={field.placeholder}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10"
          />
        )}
        {field.help && <p className="text-[11px] text-slate-500 leading-relaxed">{field.help}</p>}
        {section === 'credentials' && editingId && <p className="text-[11px] text-amber-600">Los secretos existentes se conservan si dejas este campo vacío.</p>}
      </label>
    ));
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1">Integraciones por cliente</h2>
          <p className="text-slate-500 font-medium">
            Conecta Clarity, WordPress y WooCommerce para ver leads, ventas y analítica real sin exponer secretos en el navegador.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm">
            <ShieldCheck className="size-3.5 text-emerald-500" /> Solo backend
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm">
            <Sparkles className="size-3.5 text-brand-primary" /> {connectedCount} conectadas
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {providerSummary.map((provider) => {
              const Icon = integrationCardIcon(provider.provider);
              const integration = provider.integration;
              const meta = statusMeta(integration?.status ?? 'pending');
              return (
                <button
                  key={provider.provider}
                  type="button"
                  onClick={() => resetFormForProvider(provider.provider)}
                  className={cn(
                    'text-left rounded-3xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
                    integration ? meta.badge : 'border-slate-100',
                    selectedProvider === provider.provider && !editingId ? 'ring-2 ring-brand-primary/20 border-brand-primary/30' : '',
                  )}
                >
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className={cn('size-11 rounded-2xl flex items-center justify-center border', integration ? meta.badge : 'bg-slate-50 border-slate-100')}>
                      <Icon className="size-5" />
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{provider.summary}</p>
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <div className={cn('size-2 rounded-full', integration ? meta.dot : 'bg-slate-300')} />
                        <span className="text-xs font-bold text-slate-700">{integration ? meta.label : 'Sin conectar'}</span>
                      </div>
                    </div>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mb-1">{provider.label}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed mb-4">{provider.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {provider.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest', capabilityTone(capability))}
                      >
                        {getIntegrationCapabilityLabel(capability)}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-slate-50/50">
              <div>
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <Workflow className="size-4 text-brand-primary" /> Integraciones activas
                </h3>
                <p className="text-xs text-slate-500 mt-1">{client.name} · última sincronización: {lastSyncLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    if (!sessionToken) {
                      return;
                    }
                    setLoading(true);
                    setFormError(null);
                    try {
                      const response = await getClientIntegrations(sessionToken, client.id);
                      setIntegrations(response.integrations);
                    } catch (error) {
                      setFormError(error instanceof Error ? error.message : 'No se pudieron cargar las integraciones');
                    } finally {
                      setLoading(false);
                    }
                  })();
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
              >
                <RefreshCcw className="size-3.5" /> Refrescar lista
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-3 p-8 text-slate-500">
                <LoaderCircle className="size-5 animate-spin" />
                Cargando integraciones...
              </div>
            ) : integrations.length === 0 ? (
              <div className="p-8 text-center">
                <div className="mx-auto mb-4 size-14 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400">
                  <Eye className="size-6" />
                </div>
                <h4 className="text-lg font-bold text-slate-900 mb-2">Todavía no hay integraciones</h4>
                <p className="text-sm text-slate-500 max-w-xl mx-auto">
                  Añade primero Clarity para analítica, WordPress para capturar leads y WooCommerce para ventas.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {integrations.map((integration) => {
                  const meta = statusMeta(integration.status);
                  const provider = getIntegrationProviderDefinition(integration.provider);
                  const Icon = integrationCardIcon(integration.provider);
                  return (
                    <div key={integration.id} className="p-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between hover:bg-slate-50/60 transition-colors">
                      <div className="flex items-start gap-4">
                        <div className={cn('size-11 rounded-2xl flex items-center justify-center border', meta.badge)}>
                          <Icon className="size-5" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <h4 className="text-sm font-bold text-slate-900">{integration.label}</h4>
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest', meta.badge)}>
                              {meta.label}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mb-2">{provider?.description ?? integration.provider}</p>
                          <div className="flex flex-wrap gap-2">
                            {integration.capabilities.map((capability) => (
                              <span key={capability} className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest', capabilityTone(capability))}>
                                {getIntegrationCapabilityLabel(capability)}
                              </span>
                            ))}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-500">
                            <span>Última sync: {integration.lastSync ?? 'Sin probar'}</span>
                            <span>Secretos: {integration.secretKeys.length > 0 ? `${integration.secretKeys.length} guardados` : 'No configurados'}</span>
                            {integration.lastError && <span className="text-rose-600">{integration.lastError}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-start lg:self-auto">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(integration.id);
                            setSelectedProvider(integration.provider);
                          }}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-white"
                        >
                          <FileText className="size-3.5" /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleTest(integration.id)}
                          disabled={testingId === integration.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-brand-primary transition hover:bg-brand-primary/5 disabled:cursor-wait"
                        >
                          {testingId === integration.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Probar
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(integration.id)}
                            disabled={deletingId === integration.id}
                            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-wait"
                          >
                            {deletingId === integration.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Eliminar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-6">
            <div>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Save className="size-4 text-brand-primary" />
                    {editingId ? 'Editar integración' : 'Nueva integración'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">Los secretos quedan en backend. La UI solo trabaja con estado y configuración.</p>
                </div>
                {isAdmin ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">Admin</span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">Solo lectura</span>
                )}
              </div>

              {formError && (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex gap-3">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {formSuccess && (
                <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 flex gap-3">
                  <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
                  <span>{formSuccess}</span>
                </div>
              )}

              <label className="space-y-2 block">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Proveedor</span>
                <select
                  value={selectedProvider}
                  onChange={(event) => resetFormForProvider(event.target.value as IntegrationProvider)}
                  disabled={Boolean(editingId)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {INTEGRATION_PROVIDERS.map((provider) => (
                    <option key={provider.provider} value={provider.provider}>{provider.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">{selectedDefinition?.description}</p>
              </label>

              <label className="space-y-2 block mt-4">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Nombre interno</span>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                  placeholder={selectedDefinition ? `${selectedDefinition.label} · Cliente` : 'Nombre de la integración'}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10"
                />
              </label>
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Configuración</h4>
                <div className="space-y-4">{renderFields('config')}</div>
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Credenciales</h4>
                <div className="space-y-4">{renderFields('credentials')}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-900">Clarity</strong> alimenta analítica de comportamiento, <strong className="text-slate-900">WordPress</strong> captura leads y <strong className="text-slate-900">WooCommerce</strong> sincroniza ventas.
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="submit"
                disabled={saving || !isAdmin}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-brand-primary/20 transition hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                {editingId ? 'Guardar cambios' : 'Guardar integración'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    resetFormForProvider(selectedProvider);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancelar edición
                </button>
              )}
            </div>
          </form>

          <div className="bg-slate-900 rounded-3xl p-6 text-white overflow-hidden relative shadow-2xl">
            <div className="relative z-10">
              <ShieldCheck className="size-8 text-emerald-400 mb-4" />
              <h3 className="text-lg font-bold mb-2">Resumen operativo</h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-6">
                {readyMetrics.length > 0
                  ? `Listo para monitorizar ${readyMetrics.join(' · ')}.`
                  : 'Configura al menos una integración para activar métricas reales.'}
              </p>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                  <span className="text-xs font-medium">Cliente</span>
                  <span className="text-xs font-bold text-white">{client.name}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                  <span className="text-xs font-medium">Integraciones conectadas</span>
                  <span className="text-xs font-bold text-emerald-400">{connectedCount}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                  <span className="text-xs font-medium">Leads / ventas / analítica</span>
                  <span className="text-xs font-bold text-amber-400">Activos cuando se valide la conexión</span>
                </div>
              </div>
            </div>
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <Sparkles className="size-40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
