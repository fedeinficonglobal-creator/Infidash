import { useCallback, useEffect, useRef, useState } from 'react';
import { getOperationalPlan, saveOperationalPlan, type OperationalPlan } from '../services/infidashApi.js';

type PlanRow = { id: string; createdAt: string; updatedAt: string };

export function currentPlanPeriodKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function rowFingerprint(row: PlanRow) {
  return JSON.stringify(Object.entries(row)
    .filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function useOperationalPlan<T extends PlanRow>(input: {
  token: string | null;
  clientId: string;
  domain: 'web' | 'rrss';
  periodKey: string;
  loadLocal: (clientId: string) => T[];
  saveLocal: (clientId: string, rows: T[]) => void;
}) {
  const { token, clientId, domain, periodKey, loadLocal, saveLocal } = input;
  const key = `${clientId}:${domain}:${periodKey}`;
  const activeKey = useRef(key);
  const inFlight = useRef(false);
  const [plan, setPlan] = useState<OperationalPlan<T> | null>(null);
  const [localRows, setLocalRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token) return;
    const response = await getOperationalPlan<T>(token, clientId, domain, periodKey);
    if (activeKey.current === key) {
      setPlan(response.plan);
      setError(null);
    }
  }, [token, clientId, domain, periodKey, key]);

  useEffect(() => {
    activeKey.current = key;
    setPlan(null);
    setLocalRows(loadLocal(clientId));
    setLoading(true);
    setError(null);
    if (!token) {
      setLoading(false);
      return;
    }
    void reload().catch((cause) => {
      if (activeKey.current === key) setError(cause instanceof Error ? cause.message : 'No se pudo cargar el plan');
    }).finally(() => {
      if (activeKey.current === key) setLoading(false);
    });
  }, [key, clientId, token, loadLocal, reload]);

  const saveRows = async (rows: T[]) => {
    if (!token || !plan || activeKey.current !== key || inFlight.current) throw new Error('El plan todavía no está listo para guardar');
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await saveOperationalPlan<T>(token, clientId, domain, { periodKey, version: plan.version, rows });
      if (activeKey.current === key) setPlan(response.plan);
      return response.plan;
    } catch (cause) {
      if (activeKey.current === key) setError(cause instanceof Error ? cause.message : 'No se pudo guardar el plan');
      throw cause;
    } finally {
      inFlight.current = false;
      if (activeKey.current === key) setSaving(false);
    }
  };

  const currentRows = plan?.rows ?? [];
  const currentById = new Map<string, T>(currentRows.map((row): [string, T] => [row.id, row]));
  const fingerprints = new Set(currentRows.map(rowFingerprint));
  const conflicts = localRows.filter((row) => {
    const existing = currentById.get(row.id);
    return existing && rowFingerprint(existing) !== rowFingerprint(row);
  });
  const seenFingerprints = new Set(fingerprints);
  const seenIds = new Set(currentById.keys());
  const toImport = localRows.filter((row) => {
    const fingerprint = rowFingerprint(row);
    if (seenIds.has(row.id) || seenFingerprints.has(fingerprint)) return false;
    seenIds.add(row.id);
    seenFingerprints.add(fingerprint);
    return true;
  });
  const duplicateCount = localRows.length - conflicts.length - toImport.length;

  const importLocal = async () => {
    if (!plan || activeKey.current !== key) throw new Error('Carga el plan antes de importar');
    if (toImport.length) await saveRows([...currentRows, ...toImport]);
    saveLocal(clientId, conflicts);
    setLocalRows(conflicts);
  };

  return {
    rows: currentRows,
    version: plan?.version ?? 0,
    ready: plan !== null,
    loading,
    saving,
    error,
    setError,
    reload,
    saveRows,
    localRows,
    importLocal,
    importPreview: { newCount: toImport.length, duplicateCount, conflictCount: conflicts.length },
  };
}
