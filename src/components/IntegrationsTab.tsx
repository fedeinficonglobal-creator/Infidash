import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { type Client } from '../store/useClientStore';
import { useClientStore } from '../store/useClientStore';
import {
  deleteClientIntegration,
  getWooCommerceSalesPreview,
  getClientIntegrations,
  getGa4ServiceAccountEmail,
  getGoogleAdsManagerAccount,
  saveClientIntegration,
  syncClientIntegration,
  testClientIntegration,
  type ApiIntegration,
  type WooCommerceSalesPreview,
} from '../services/infidashApi.js';
import { hasLiveIntegrationAdapter, hasManualIntegrationSync } from '../lib/integrationState.js';
import {
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  Eye,
  FileText,
  Globe,
  KeyRound,
  LoaderCircle,
  Megaphone,
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
        label: 'Sin verificar',
      };
  }
}

function integrationCardIcon(provider: IntegrationProvider) {
  switch (provider) {
    case 'clarity':
      return Globe;
    case 'meta_ads':
      return BarChart3;
    case 'google_ads':
      return Megaphone;
    case 'wordpress':
      return FileText;
    case 'woocommerce':
      return ShoppingCart;
    case 'ga4':
      return Compass;
    default:
      return Workflow;
  }
}

function capabilityTone(capability: string) {
  switch (capability) {
    case 'analytics':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'ads':
      return 'bg-amber-50 text-amber-700 border-amber-200';
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
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedWebhookId, setCopiedWebhookId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<IntegrationProvider>('clarity');
  const [draft, setDraft] = useState<IntegrationDraft>(() => createDraft('clarity'));
  const [previewFrom, setPreviewFrom] = useState('');
  const [previewTo, setPreviewTo] = useState('');
  const [salesPreview, setSalesPreview] = useState<WooCommerceSalesPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestId = useRef(0);
  const [ga4ServiceAccountEmail, setGa4ServiceAccountEmail] = useState<string | null>(null);
  const [ga4ServiceAccountError, setGa4ServiceAccountError] = useState<string | null>(null);
  const [ga4EmailCopied, setGa4EmailCopied] = useState(false);
  const [googleAdsLoginCustomerId, setGoogleAdsLoginCustomerId] = useState<string | null>(null);
  const [googleAdsManagerError, setGoogleAdsManagerError] = useState<string | null>(null);

  useEffect(() => {
    previewRequestId.current += 1;
    setPreviewLoading(false);
    setSalesPreview(null);
    setPreviewError(null);
  }, [editingId, client.id]);

  useEffect(() => {
    if (selectedProvider !== 'ga4' || !sessionToken) return;
    let cancelled = false;
    setGa4ServiceAccountEmail(null);
    setGa4ServiceAccountError(null);
    void getGa4ServiceAccountEmail(sessionToken)
      .then(({ email }) => { if (!cancelled) setGa4ServiceAccountEmail(email); })
      .catch((error) => { if (!cancelled) setGa4ServiceAccountError(error instanceof Error ? error.message : 'No se pudo obtener la cuenta de servicio de GA4'); });
    return () => { cancelled = true; };
  }, [selectedProvider, sessionToken]);

  useEffect(() => {
    if (selectedProvider !== 'google_ads' || !sessionToken) return;
    let cancelled = false;
    setGoogleAdsLoginCustomerId(null);
    setGoogleAdsManagerError(null);
    void getGoogleAdsManagerAccount(sessionToken)
      .then(({ loginCustomerId }) => { if (!cancelled) setGoogleAdsLoginCustomerId(loginCustomerId); })
      .catch((error) => { if (!cancelled) setGoogleAdsManagerError(error instanceof Error ? error.message : 'No se pudo obtener la cuenta de gestor de Google Ads'); });
    return () => { cancelled = true; };
  }, [selectedProvider, sessionToken]);

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
    if (section === 'config') {
      previewRequestId.current += 1;
      setPreviewLoading(false);
      setSalesPreview(null);
    }
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
      setFormSuccess(result.missingFields.length > 0
        ? `Faltan campos: ${result.missingFields.join(', ')}`
        : result.integration.status === 'connected'
          ? `Conexión comprobada: ${result.summary}`
          : result.integration.lastError ?? 'Configuración revisada; aún no hay conexión real confirmada.');
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

  const handleSync = async (integrationId: string) => {
    if (!sessionToken) {
      return;
    }

    setSyncingId(integrationId);
    setFormError(null);
    try {
      const result = await syncClientIntegration(sessionToken, integrationId);
      setIntegrations((current) => current.map((integration) => integration.id === integrationId ? result.integration : integration));
      setFormSuccess(result.skipped
        ? 'La integración no requiere sincronización automática.'
        : `Sincronización completada con ${result.snapshots.length} punto${result.snapshots.length === 1 ? '' : 's'} de Análisis/UX.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo sincronizar Análisis/UX');
    } finally {
      setSyncingId(null);
    }
  };

  const handleSalesPreview = async () => {
    if (!sessionToken || !editingId) return;
    const requestId = ++previewRequestId.current;
    setPreviewLoading(true);
    setPreviewError(null);
    setSalesPreview(null);
    try {
      const result = await getWooCommerceSalesPreview(sessionToken, editingId, previewFrom, previewTo);
      if (previewRequestId.current === requestId) setSalesPreview(result);
    } catch (error) {
      if (previewRequestId.current === requestId) setPreviewError(error instanceof Error ? error.message : 'No se pudo consultar WooCommerce');
    } finally {
      if (previewRequestId.current === requestId) setPreviewLoading(false);
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
        {field.type === 'select' ? (
          <select
            value={draft[section][field.key] ?? field.defaultValue ?? ''}
            onChange={(event) => setField(section, field.key, event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10"
          >
            {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : field.type === 'textarea' ? (
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
            Gestiona Análisis/UX y leads de WordPress. WooCommerce permite comprobar el acceso de lectura, pero todavía no aporta cifras de ventas al panel.
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
                  Añade primero Análisis/UX para analítica, WordPress para capturar leads y WooCommerce para ventas.
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
                          {integration.capabilities.includes('leads') && integration.webhookSecret && (
                            <div className="mt-3 flex items-center gap-2">
                              <code className="max-w-xs truncate rounded-lg bg-slate-50 border border-slate-200 px-2 py-1 text-[10px] text-slate-600">
                                {`${window.location.origin}/api/public/leads/${integration.webhookSecret}`}
                              </code>
                              <button
                                type="button"
                                onClick={() => {
                                  void navigator.clipboard.writeText(`${window.location.origin}/api/public/leads/${integration.webhookSecret}`).then(() => {
                                    setCopiedWebhookId(integration.id);
                                    setTimeout(() => setCopiedWebhookId((current) => (current === integration.id ? null : current)), 2000);
                                  });
                                }}
                                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-white"
                              >
                                {copiedWebhookId === integration.id ? <Check className="size-3" /> : <Copy className="size-3" />}
                                {copiedWebhookId === integration.id ? 'Copiado' : 'Copiar webhook'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-start lg:self-auto">
                        {isAdmin && <>
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
                          {testingId === integration.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} {integration.provider !== 'clarity' && (hasLiveIntegrationAdapter(integration.provider) || integration.provider === 'woocommerce') ? 'Probar conexión' : 'Validar campos'}
                        </button>
                        {hasManualIntegrationSync(integration.provider) && <button
                          type="button"
                          onClick={() => void handleSync(integration.id)}
                          disabled={syncingId === integration.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-50 disabled:cursor-wait"
                        >
                          {syncingId === integration.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />} Sincronizar
                        </button>}
                          <button
                            type="button"
                            onClick={() => void handleDelete(integration.id)}
                            disabled={deletingId === integration.id}
                            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-wait"
                          >
                            {deletingId === integration.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Eliminar
                          </button>
                        </>}
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

            {isAdmin && selectedProvider === 'woocommerce' && editingId && (
              <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 space-y-3" aria-label="Vista previa de ventas WooCommerce">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Vista previa de ventas WooCommerce</h4>
                  <p className="text-xs text-slate-600">Consulta directa de hasta 31 días y 500 pedidos. No se guarda ni sustituye las métricas del panel.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-700">Compra desde
                    <input type="date" value={previewFrom} onChange={(event) => { previewRequestId.current += 1; setPreviewLoading(false); setPreviewFrom(event.target.value); setSalesPreview(null); }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2" />
                  </label>
                  <label className="text-xs font-semibold text-slate-700">Compra hasta
                    <input type="date" value={previewTo} onChange={(event) => { previewRequestId.current += 1; setPreviewLoading(false); setPreviewTo(event.target.value); setSalesPreview(null); }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2" />
                  </label>
                </div>
                <button type="button" onClick={() => void handleSalesPreview()} disabled={!previewFrom || !previewTo || previewLoading} className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  {previewLoading ? 'Consultando…' : 'Consultar ventas'}
                </button>
                {previewError && <p role="alert" className="text-xs text-rose-700">{previewError}</p>}
                {salesPreview && (
                  <div className="space-y-2 text-xs text-slate-700" aria-live="polite">
                    <p>Fuente WooCommerce · {salesPreview.refundPolicy === 'subtract' ? 'Reembolsos restados' : 'Reembolsos no restados'} · {salesPreview.orderCount} pedidos leídos.</p>
                    {salesPreview.sales.length === 0 ? <p>No hay pedidos completados en este periodo.</p> : (
                      <div className="max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white">
                        <table className="w-full text-left"><thead><tr className="border-b border-slate-100"><th className="p-2">Compra</th><th className="p-2">Moneda</th><th className="p-2">Pedidos</th><th className="p-2">Bruto</th><th className="p-2">Reembolsos</th><th className="p-2">Venta</th></tr></thead>
                          <tbody>{salesPreview.sales.map((row) => <tr key={`${row.purchaseDate}-${row.currency}`} className="border-b border-slate-100"><td className="p-2">{row.purchaseDate}</td><td className="p-2">{row.currency}</td><td className="p-2">{row.orderCount}</td><td className="p-2">{row.grossTotal}</td><td className="p-2">{row.refundTotal}</td><td className="p-2 font-bold">{row.salesTotal}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {selectedProvider === 'ga4' && (
              <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 space-y-2" aria-label="Cuenta de servicio de GA4">
                <h4 className="text-sm font-bold text-slate-900">Autoriza la cuenta de servicio de Infidash</h4>
                <p className="text-xs text-slate-600">En GA4 → Administración → Acceso a la propiedad, añade esta cuenta con rol de Lector para esta propiedad:</p>
                {ga4ServiceAccountError ? (
                  <p role="alert" className="text-xs text-rose-700">{ga4ServiceAccountError}</p>
                ) : !ga4ServiceAccountEmail ? (
                  <p className="text-xs text-slate-500" role="status">Cargando…</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <code className="rounded-lg bg-white px-3 py-2 text-xs text-slate-800 border border-slate-200">{ga4ServiceAccountEmail}</code>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(ga4ServiceAccountEmail).then(() => {
                          setGa4EmailCopied(true);
                          setTimeout(() => setGa4EmailCopied(false), 2000);
                        });
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                    >
                      {ga4EmailCopied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                )}
              </section>
            )}

            {selectedProvider === 'google_ads' && (
              <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 space-y-2" aria-label="Cuenta de gestor de Google Ads">
                <h4 className="text-sm font-bold text-slate-900">Cuenta de gestor (MCC) compartida de Infidash</h4>
                <p className="text-xs text-slate-600">Esta integración usa la cuenta de gestor de Infidash, no credenciales propias del cliente. Confirma que el Customer ID que vas a introducir está enlazado bajo esta MCC:</p>
                {googleAdsManagerError ? (
                  <p role="alert" className="text-xs text-rose-700">{googleAdsManagerError}</p>
                ) : !googleAdsLoginCustomerId ? (
                  <p className="text-xs text-slate-500" role="status">Cargando…</p>
                ) : (
                  <code className="inline-block rounded-lg bg-white px-3 py-2 text-xs text-slate-800 border border-slate-200">{googleAdsLoginCustomerId}</code>
                )}
              </section>
            )}

            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-900">Análisis/UX</strong> alimenta analítica de comportamiento, <strong className="text-slate-900">WordPress</strong> captura leads, <strong className="text-slate-900">WooCommerce</strong> permite probar el acceso a pedidos, <strong className="text-slate-900">Google Analytics 4</strong> trae tráfico a la pestaña Tráfico y <strong className="text-slate-900">Google Ads</strong> trae inversión y campañas también a Tráfico. La sincronización completa de ventas, tráfico y campañas se ejecuta desde Ventas y Tráfico mediante una acción administrativa. Los importes, impuestos, envíos, fechas y reembolsos de pedidos se corrigen en WooCommerce; aquí solo se edita la política de cálculo por cliente.
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
