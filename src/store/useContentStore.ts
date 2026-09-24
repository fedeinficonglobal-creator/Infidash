import { create } from 'zustand';
import { endOfMonth, startOfMonth } from 'date-fns';
import {
  approveContentItem,
  createContentJob,
  createEditorialCalendar,
  createPlanItem,
  getContentItem,
  getContentJob,
  getContentJobs,
  getContentSummary,
  getEditorialCalendars,
  getPlanItems,
  getPublications,
  getPublishingAccounts,
  schedulePublication as schedulePublicationRequest,
  updateContentItem,
  updatePlanItem,
  type ContentItem,
  ContentApiRequestError,
  type ContentJob,
  type ContentSummary,
  type EditorialCalendar,
  type JobKind,
  type PlanItem,
  type Publication,
  type PublishingAccount,
} from '../services/contentApi.js';
import type { ContentFilters } from '../lib/content.js';

interface ContentState {
  month: Date;
  view: 'calendar' | 'list';
  filters: ContentFilters;
  items: PlanItem[];
  summary: ContentSummary | null;
  nextCursor: string | null;
  selectedId: string | null;
  content: ContentItem | null;
  publications: Publication[];
  publishingAccounts: PublishingAccount[];
  calendars: EditorialCalendar[];
  jobs: ContentJob[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  isLoadingDetail: boolean;
  isSaving: boolean;
  error: string | null;
  detailError: string | null;
  conflict: string | null;
  lastUpdatedAt: string | null;
  setMonth: (month: Date) => void;
  setView: (view: 'calendar' | 'list') => void;
  setFilters: (filters: Partial<ContentFilters>) => void;
  reset: (clientId?: string) => void;
  load: (token: string) => Promise<void>;
  refresh: (token: string) => Promise<void>;
  loadMore: (token: string) => Promise<void>;
  loadCalendars: (token: string, clientId: string) => Promise<void>;
  createCalendar: (token: string, clientId: string, input: { title: string; startDate?: string; endDate?: string }) => Promise<EditorialCalendar>;
  select: (token: string, item: PlanItem | null) => Promise<void>;
  createPlanItem: (token: string, input: Record<string, unknown>) => Promise<PlanItem>;
  savePlanItem: (token: string, id: string, input: Record<string, unknown>) => Promise<void>;
  saveContent: (token: string, id: string, input: Record<string, unknown>) => Promise<void>;
  approveContent: (token: string, id: string, revisionId: string, version: number) => Promise<void>;
  schedulePublication: (token: string, input: { contentId: string; clientId: string; expectedVersion: number; accountId: string; desiredScheduledAt: string; copy?: string }) => Promise<void>;
  createJob: (token: string, input: { clientId: string; kind: JobKind; targetId?: string; expectedVersion?: number; payload?: Record<string, unknown> }) => Promise<void>;
  pollJobs: (token: string) => Promise<void>;
  clearConflict: () => void;
}

let listController: AbortController | null = null;
let detailController: AbortController | null = null;
let requestSerial = 0;

const EMPTY_FILTERS: ContentFilters = { clientId: '', status: '', format: '', search: '' };

function range(month: Date) {
  return { from: startOfMonth(month).toISOString(), to: new Date(endOfMonth(month).getTime() + 1).toISOString() };
}

function message(error: unknown) { return error instanceof Error ? error.message : 'No se pudo completar la operación'; }
function isConflict(error: unknown) { return error instanceof ContentApiRequestError ? error.status === 409 : error instanceof Error && error.message.toLowerCase().includes('conflict'); }

export const useContentStore = create<ContentState>((set, get) => ({
  month: startOfMonth(new Date()),
  view: 'calendar',
  filters: EMPTY_FILTERS,
  items: [],
  summary: null,
  nextCursor: null,
  selectedId: null,
  content: null,
  publications: [],
  publishingAccounts: [],
  calendars: [],
  jobs: [],
  isLoading: false,
  isLoadingMore: false,
  isRefreshing: false,
  isLoadingDetail: false,
  isSaving: false,
  error: null,
  detailError: null,
  conflict: null,
  lastUpdatedAt: null,
  setMonth: (month) => set({ month: startOfMonth(month) }),
  setView: (view) => set({ view }),
  setFilters: (partial) => set((state) => ({ filters: { ...state.filters, ...partial } })),
  reset: (clientId = '') => {
    listController?.abort(); detailController?.abort();
    set({ filters: { ...EMPTY_FILTERS, clientId }, items: [], summary: null, nextCursor: null, selectedId: null, content: null, publications: [], publishingAccounts: [], calendars: [], jobs: [], error: null, detailError: null, conflict: null });
  },
  load: async (token) => {
    listController?.abort();
    listController = new AbortController();
    const serial = ++requestSerial;
    set({ isLoading: true, error: null });
    const state = get();
    const filters = { clientId: state.filters.clientId || undefined, status: state.filters.status || undefined, format: state.filters.format || undefined, search: state.filters.search.trim() || undefined, ...range(state.month) };
    try {
      const [page, summary, jobs] = await Promise.all([
        getPlanItems(token, { ...filters, includeUndated: true, limit: 100 }, listController.signal),
        getContentSummary(token, filters, listController.signal),
        getContentJobs(token, { clientId: filters.clientId, limit: 100 }, listController.signal),
      ]);
      if (serial !== requestSerial) return;
      set({ items: page.items, nextCursor: page.nextCursor, summary: summary.summary, jobs: jobs.items, lastUpdatedAt: new Date().toISOString() });
    } catch (error) {
      if ((error as Error).name !== 'AbortError' && serial === requestSerial) set({ error: message(error) });
    } finally {
      if (serial === requestSerial) set({ isLoading: false });
    }
  },
  refresh: async (token) => {
    if (get().isRefreshing || get().isLoading) return;
    set({ isRefreshing: true });
    const state = get();
    const filters = { clientId: state.filters.clientId || undefined, status: state.filters.status || undefined, format: state.filters.format || undefined, search: state.filters.search.trim() || undefined, ...range(state.month) };
    try {
      const [page, summary, jobs] = await Promise.all([getPlanItems(token, { ...filters, includeUndated: true, limit: 100 }), getContentSummary(token, filters), getContentJobs(token, { clientId: filters.clientId, limit: 100 })]);
      set({ items: page.items, nextCursor: page.nextCursor, summary: summary.summary, jobs: jobs.items, lastUpdatedAt: new Date().toISOString(), error: null });
    } catch (error) { set({ error: message(error) }); }
    finally { set({ isRefreshing: false }); }
  },
  loadMore: async (token) => {
    const state = get();
    if (!state.nextCursor || state.isLoadingMore) return;
    set({ isLoadingMore: true });
    try {
      const page = await getPlanItems(token, { clientId: state.filters.clientId || undefined, status: state.filters.status || undefined, format: state.filters.format || undefined, search: state.filters.search.trim() || undefined, ...range(state.month), includeUndated: true, cursor: state.nextCursor, limit: 100 });
      set((current) => ({ items: [...current.items, ...page.items.filter((item) => !current.items.some((existing) => existing.id === item.id))], nextCursor: page.nextCursor }));
    } catch (error) { set({ error: message(error) }); }
    finally { set({ isLoadingMore: false }); }
  },
  loadCalendars: async (token, clientId) => {
    try { const page = await getEditorialCalendars(token, clientId); set({ calendars: page.items }); }
    catch (error) { set({ error: message(error) }); }
  },
  createCalendar: async (token, clientId, input) => {
    set({ isSaving: true, error: null });
    try {
      const { calendar } = await createEditorialCalendar(token, clientId, input);
      set((state) => ({ calendars: [calendar, ...state.calendars.filter((existing) => existing.id !== calendar.id)] }));
      return calendar;
    } catch (error) { set({ error: message(error) }); throw error; }
    finally { set({ isSaving: false }); }
  },
  select: async (token, item) => {
    detailController?.abort();
    if (!item) { set({ selectedId: null, content: null, publications: [], publishingAccounts: [], detailError: null }); return; }
    set({ selectedId: item.id, content: null, publications: [], publishingAccounts: [], detailError: null });
    if (!item.contentId) return;
    detailController = new AbortController();
    set({ isLoadingDetail: true });
    try {
      const [content, publications, accounts] = await Promise.all([getContentItem(token, item.contentId, detailController.signal), getPublications(token, item.contentId, detailController.signal), getPublishingAccounts(token, item.clientId, detailController.signal)]);
      if (get().selectedId === item.id) set({ content: content.content, publications: publications.items, publishingAccounts: accounts.accounts });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') set({ detailError: message(error) });
    } finally { set({ isLoadingDetail: false }); }
  },
  createPlanItem: async (token, input) => {
    set({ isSaving: true, conflict: null });
    try {
      const response = await createPlanItem(token, input);
      set((state) => ({ items: [response.planItem, ...state.items] }));
      return response.planItem;
    } catch (error) { set({ error: message(error) }); throw error; }
    finally { set({ isSaving: false }); }
  },
  savePlanItem: async (token, id, input) => {
    set({ isSaving: true, conflict: null });
    try {
      const response = await updatePlanItem(token, id, input);
      set((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, ...response.planItem } : item), selectedId: id }));
    } catch (error) {
      if (isConflict(error)) set({ conflict: 'Otra persona o automatización modificó esta propuesta. Recarga los datos antes de guardar de nuevo.' });
      else set({ detailError: message(error) });
      throw error;
    } finally { set({ isSaving: false }); }
  },
  saveContent: async (token, id, input) => {
    set({ isSaving: true, conflict: null });
    try { const response = await updateContentItem(token, id, input); set({ content: response.content }); }
    catch (error) { if (isConflict(error)) set({ conflict: 'El contenido cambió mientras lo editabas. Recarga para conservar la última versión.' }); else set({ detailError: message(error) }); throw error; }
    finally { set({ isSaving: false }); }
  },
  approveContent: async (token, id, revisionId, version) => {
    set({ isSaving: true, conflict: null });
    try { const response = await approveContentItem(token, id, revisionId, version); set((state) => ({ content: state.content ? { ...state.content, ...response.content } : response.content })); }
    catch (error) { if (isConflict(error)) set({ conflict: 'La revisión cambió antes de aprobarse. Recarga y comprueba la versión activa.' }); else set({ detailError: message(error) }); throw error; }
    finally { set({ isSaving: false }); }
  },
  schedulePublication: async (token,input) => {
    set({isSaving:true,conflict:null,detailError:null});
    try {
      const idempotencyKey=`schedule:${input.contentId}:${input.expectedVersion}:${input.accountId}:${input.desiredScheduledAt}`;
      const response=await schedulePublicationRequest(token,input.contentId,{...input,idempotencyKey});
      set((state)=>({publications:[response.publication,...state.publications.filter((item)=>item.id!==response.publication.id)],jobs:[response.job,...state.jobs.filter((job)=>job.id!==response.job.id)]}));
    } catch(error) {
      if(isConflict(error)) set({conflict:message(error)}); else set({detailError:message(error)});
      throw error;
    } finally { set({isSaving:false}); }
  },
  createJob: async (token, input) => {
    set({ isSaving: true, conflict: null });
    try {
      const response = await createContentJob(token, { ...input, idempotencyKey: `${input.kind}:${input.targetId ?? input.clientId}:${input.expectedVersion ?? 'new'}:${Date.now()}` });
      set((state) => ({ jobs: [response.job, ...state.jobs.filter((job) => job.id !== response.job.id)] }));
    } catch (error) { if (isConflict(error)) set({ conflict: message(error) }); else set({ detailError: message(error) }); throw error; }
    finally { set({ isSaving: false }); }
  },
  pollJobs: async (token) => {
    const pending = get().jobs.filter((job) => ['pending', 'running', 'unknown'].includes(job.status));
    if (!pending.length) return;
    const settled = await Promise.allSettled(pending.map((job) => getContentJob(token, job.id)));
    const updates = new Map<string, ContentJob>();
    settled.forEach((result, index) => { if (result.status === 'fulfilled') updates.set(pending[index].id, result.value.job); });
    set((state) => ({ jobs: state.jobs.map((job) => updates.get(job.id) ?? job) }));
  },
  clearConflict: () => set({ conflict: null }),
}));
