import { create } from 'zustand';
import {
  ContentApiRequestError,
  createContentJob,
  getContentJob,
  getContentJobs,
  getEditorialReadiness,
  getPublishingAccounts,
  releasePlanGeneration,
  updatePlanItem,
  type ContentJob,
  type EditorialReadiness,
  type PublishingAccount,
} from '../services/contentApi.js';
import {
  approveSocialPost,
  createRrssIdea,
  discardSocialPost,
  getRrssItems,
  getRrssPlanInputs,
  getSocialPosts,
  saveRrssPlanInputs,
  scheduleSocialPost,
  updateSocialPost,
  uploadSocialPostMedia,
  type RrssIdea,
  type RrssIdeaInput,
  type RrssPlanInputs,
  type SocialMedia,
  type SocialPost,
} from '../services/rrssApi.js';
import { RRSS_PAGE_SIZE, moveMediaItem, removeMediaItem, socialScheduleKey, validateCreativeFile } from '../lib/rrss.js';

export interface RrssFilters { status: string; format: string; search: string; }
/** One file of a «Subir creatividad» batch; finished uploads leave the list, failures stay until dismissed. */
export interface CreativeUpload { key: string; name: string; status: 'uploading' | 'error'; error?: string; }

interface RrssState {
  clientId: string;
  filters: RrssFilters;
  items: RrssIdea[];
  nextCursor: string | null;
  /** The start cursor of every page visited so far; the last one is the current page. */
  pageCursors: (string | null)[];
  page: number;
  jobs: ContentJob[];
  /** Workflow readiness of the client; null means unknown, and job-creating actions stay disabled. */
  readiness: EditorialReadiness | null;
  publishingAccounts: PublishingAccount[];
  selectedId: string | null;
  socialPosts: SocialPost[];
  uploads: Record<string, CreativeUpload[]>;
  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingDetail: boolean;
  isSaving: boolean;
  error: string | null;
  detailError: string | null;
  conflict: string | null;
  lastUpdatedAt: string | null;
  reset: (clientId: string) => void;
  setFilters: (filters: Partial<RrssFilters>) => void;
  load: (token: string) => Promise<void>;
  refresh: (token: string) => Promise<void>;
  nextPage: (token: string) => Promise<void>;
  previousPage: (token: string) => Promise<void>;
  loadReadiness: (token: string) => Promise<void>;
  loadAccounts: (token: string) => Promise<void>;
  select: (token: string, id: string | null) => Promise<void>;
  loadSocialPosts: (token: string, ideaId: string) => Promise<void>;
  createIdea: (token: string, input: RrssIdeaInput) => Promise<RrssIdea>;
  /** PATCH of the idea with its current version as optimistic lock. */
  saveIdea: (token: string, id: string, input: Record<string, unknown>) => Promise<void>;
  releaseGeneration: (token: string, id: string) => Promise<void>;
  loadPlanInputs: (token: string) => Promise<RrssPlanInputs>;
  /** Saves the RRSS plan inputs, then queues generate_rrss_plan; no job is created if saving fails. */
  generatePlan: (token: string, inputs: RrssPlanInputs) => Promise<void>;
  generatePosts: (token: string, ideaId: string, input: { accountIds: string[]; generateImage: boolean }) => Promise<void>;
  saveCopy: (token: string, postId: string, copy: string) => Promise<void>;
  setMedia: (token: string, postId: string, media: SocialMedia[]) => Promise<void>;
  removeMedia: (token: string, postId: string, index: number) => Promise<void>;
  moveMedia: (token: string, postId: string, index: number, delta: number) => Promise<void>;
  /** Validates then uploads each file one by one, tracking a per-file spinner or error. */
  uploadFiles: (token: string, postId: string, files: File[]) => Promise<void>;
  dismissUpload: (postId: string, key: string) => void;
  approvePost: (token: string, postId: string) => Promise<void>;
  discardPost: (token: string, postId: string) => Promise<void>;
  schedulePost: (token: string, postId: string, input: { desiredScheduledAt: string; externalUrl?: string }) => Promise<void>;
  /** Polls in-flight jobs; returns true when it already reloaded the ideas list. */
  pollJobs: (token: string) => Promise<boolean>;
  clearConflict: () => void;
}

const EMPTY_FILTERS: RrssFilters = { status: '', format: '', search: '' };
const FIRST_PAGE = { pageCursors: [null] as (string | null)[], page: 1 };
const IN_FLIGHT = ['pending', 'running', 'unknown'];

let listController: AbortController | null = null;
let detailController: AbortController | null = null;
let requestSerial = 0;
let uploadSerial = 0;

function message(error: unknown) { return error instanceof Error ? error.message : 'No se pudo completar la operación'; }
function isConflict(error: unknown) { return error instanceof ContentApiRequestError && error.status === 409; }

function listQuery(state: Pick<RrssState, 'filters' | 'pageCursors'>) {
  const cursor = state.pageCursors[state.pageCursors.length - 1];
  return { status: state.filters.status || undefined, format: state.filters.format || undefined, search: state.filters.search.trim() || undefined, ...(cursor ? { cursor } : {}), limit: RRSS_PAGE_SIZE };
}

export const useRrssStore = create<RrssState>((set, get) => {
  const replacePost = (post: SocialPost) => set((state) => ({ socialPosts: state.socialPosts.map((current) => current.id === post.id ? { ...current, ...post } : current) }));
  const findPost = (postId: string) => {
    const post = get().socialPosts.find((candidate) => candidate.id === postId);
    if (!post) throw new Error('El borrador ya no está cargado; recarga la idea');
    return post;
  };
  /** Runs a draft mutation, surfacing 409s as a reload prompt and anything else as a detail error. */
  const mutatePost = async (operation: () => Promise<{ socialPost: SocialPost }>, conflictMessage: string) => {
    set({ isSaving: true, conflict: null, detailError: null });
    try { const { socialPost } = await operation(); replacePost(socialPost); }
    catch (error) { if (isConflict(error)) set({ conflict: `${conflictMessage} ${message(error)}` }); else set({ detailError: message(error) }); throw error; }
    finally { set({ isSaving: false }); }
  };
  const setUploads = (postId: string, update: (entries: CreativeUpload[]) => CreativeUpload[]) => set((state) => ({ uploads: { ...state.uploads, [postId]: update(state.uploads[postId] ?? []) } }));

  return {
    clientId: '',
    filters: EMPTY_FILTERS,
    items: [],
    nextCursor: null,
    ...FIRST_PAGE,
    jobs: [],
    readiness: null,
    publishingAccounts: [],
    selectedId: null,
    socialPosts: [],
    uploads: {},
    isLoading: false,
    isRefreshing: false,
    isLoadingDetail: false,
    isSaving: false,
    error: null,
    detailError: null,
    conflict: null,
    lastUpdatedAt: null,
    reset: (clientId) => {
      listController?.abort(); detailController?.abort();
      requestSerial += 1;
      set({ clientId, filters: EMPTY_FILTERS, items: [], nextCursor: null, ...FIRST_PAGE, jobs: [], readiness: null, publishingAccounts: [], selectedId: null, socialPosts: [], uploads: {}, isLoading: false, isRefreshing: false, isLoadingDetail: false, isSaving: false, error: null, detailError: null, conflict: null, lastUpdatedAt: null });
    },
    setFilters: (partial) => set((state) => ({ filters: { ...state.filters, ...partial }, ...FIRST_PAGE })),
    load: async (token) => {
      const { clientId } = get();
      if (!clientId) return;
      listController?.abort();
      listController = new AbortController();
      const serial = ++requestSerial;
      set({ isLoading: true, error: null });
      try {
        const [page, jobs] = await Promise.all([getRrssItems(token, clientId, listQuery(get()), listController.signal), getContentJobs(token, { clientId, limit: 100 }, listController.signal)]);
        if (serial === requestSerial) set({ items: page.items, nextCursor: page.nextCursor, jobs: jobs.items, lastUpdatedAt: new Date().toISOString() });
      } catch (error) {
        if ((error as Error).name !== 'AbortError' && serial === requestSerial) set({ error: message(error) });
      } finally {
        if (serial === requestSerial) set({ isLoading: false });
      }
    },
    refresh: async (token) => {
      const { clientId, isLoading, isRefreshing } = get();
      if (!clientId || isLoading || isRefreshing) return;
      const serial = ++requestSerial;
      listController?.abort();
      set({ isRefreshing: true });
      try {
        const [page, jobs] = await Promise.all([getRrssItems(token, clientId, listQuery(get())), getContentJobs(token, { clientId, limit: 100 })]);
        if (serial === requestSerial) set({ items: page.items, nextCursor: page.nextCursor, jobs: jobs.items, lastUpdatedAt: new Date().toISOString(), error: null });
      } catch (error) { if (serial === requestSerial) set({ error: message(error) }); }
      finally { if (serial === requestSerial) set({ isRefreshing: false }); }
    },
    nextPage: async (token) => {
      const { nextCursor, pageCursors } = get();
      if (!nextCursor) return;
      const next = [...pageCursors, nextCursor];
      set({ pageCursors: next, page: next.length });
      await get().load(token);
    },
    previousPage: async (token) => {
      const { pageCursors } = get();
      if (pageCursors.length <= 1) return;
      const previous = pageCursors.slice(0, -1);
      set({ pageCursors: previous, page: previous.length });
      await get().load(token);
    },
    loadReadiness: async (token) => {
      const { clientId } = get();
      if (!clientId) return;
      try { const readiness = await getEditorialReadiness(token, clientId); if (get().clientId === clientId) set({ readiness }); }
      catch { /* Unknown readiness keeps job actions disabled. */ }
    },
    loadAccounts: async (token) => {
      const { clientId } = get();
      if (!clientId) return;
      try { const { accounts } = await getPublishingAccounts(token, clientId); if (get().clientId === clientId) set({ publishingAccounts: accounts }); }
      catch (error) { set({ detailError: message(error) }); }
    },
    select: async (token, id) => {
      detailController?.abort();
      set({ selectedId: id, socialPosts: [], uploads: {}, detailError: null, conflict: null, isLoadingDetail: false });
      if (!id) return;
      await get().loadSocialPosts(token, id);
    },
    loadSocialPosts: async (token, ideaId) => {
      detailController?.abort();
      detailController = new AbortController();
      set({ isLoadingDetail: true });
      try {
        const { socialPosts } = await getSocialPosts(token, ideaId, detailController.signal);
        if (get().selectedId === ideaId) set({ socialPosts });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') set({ detailError: message(error) });
      } finally { if (get().selectedId === ideaId) set({ isLoadingDetail: false }); }
    },
    createIdea: async (token, input) => {
      const { clientId } = get();
      set({ isSaving: true });
      try {
        const { planItem } = await createRrssIdea(token, clientId, input);
        const idea = { socialPosts: [], ...planItem };
        set((state) => ({ items: [idea, ...state.items.filter((item) => item.id !== idea.id)] }));
        return idea;
      } finally { set({ isSaving: false }); }
    },
    saveIdea: async (token, id, input) => {
      const item = get().items.find((candidate) => candidate.id === id);
      if (!item) throw new Error('La idea ya no está cargada; recarga la lista');
      set({ isSaving: true, conflict: null, detailError: null });
      try {
        const { planItem } = await updatePlanItem(token, id, { ...input, version: item.version });
        set((state) => ({ items: state.items.map((current) => current.id === id ? { ...current, ...(planItem as unknown as Partial<RrssIdea>) } : current) }));
      } catch (error) {
        if (isConflict(error)) set({ conflict: 'Otra persona o automatización modificó esta idea. Recarga los datos antes de guardar de nuevo.' }); else set({ detailError: message(error) });
        throw error;
      } finally { set({ isSaving: false }); }
    },
    releaseGeneration: async (token, id) => {
      const item = get().items.find((candidate) => candidate.id === id);
      if (!item) return;
      set({ isSaving: true, conflict: null, detailError: null });
      try {
        const { planItem } = await releasePlanGeneration(token, id, item.version);
        set((state) => ({ items: state.items.map((current) => current.id === id ? { ...current, ...(planItem as unknown as Partial<RrssIdea>) } : current) }));
      } catch (error) {
        if (isConflict(error)) set({ conflict: message(error) }); else set({ detailError: message(error) });
        throw error;
      } finally { set({ isSaving: false }); }
    },
    loadPlanInputs: (token) => getRrssPlanInputs(token, get().clientId),
    generatePlan: async (token, inputs) => {
      const { clientId } = get();
      set({ isSaving: true });
      try {
        await saveRrssPlanInputs(token, clientId, inputs);
        const { job } = await createContentJob(token, { clientId, kind: 'generate_rrss_plan', idempotencyKey: `generate_rrss_plan:${clientId}:new:${Date.now()}` });
        set((state) => ({ jobs: [job, ...state.jobs.filter((current) => current.id !== job.id)] }));
      } finally { set({ isSaving: false }); }
    },
    generatePosts: async (token, ideaId, input) => {
      const { clientId } = get();
      const item = get().items.find((candidate) => candidate.id === ideaId);
      if (!item) throw new Error('La idea ya no está cargada; recarga la lista');
      set({ isSaving: true, conflict: null, detailError: null });
      try {
        const { job } = await createContentJob(token, { clientId, kind: 'generate_rrss', targetId: ideaId, expectedVersion: item.version, payload: { accountIds: input.accountIds, generateImage: input.generateImage }, idempotencyKey: `generate_rrss:${ideaId}:${item.version}:${Date.now()}` });
        // Mirror the server: creating the job moves the idea to generating and bumps its version.
        set((state) => ({
          jobs: [job, ...state.jobs.filter((current) => current.id !== job.id)],
          items: state.items.map((current) => current.id === ideaId ? { ...current, status: 'generating', version: current.version + 1 } : current),
        }));
      } finally { set({ isSaving: false }); }
    },
    saveCopy: async (token, postId, copy) => {
      const post = findPost(postId);
      await mutatePost(() => updateSocialPost(token, postId, { copy, expectedVersion: post.version }), 'El borrador cambió mientras lo editabas.');
    },
    setMedia: async (token, postId, media) => {
      const post = findPost(postId);
      await mutatePost(() => updateSocialPost(token, postId, { media, expectedVersion: post.version }), 'El borrador cambió mientras lo editabas.');
    },
    removeMedia: (token, postId, index) => get().setMedia(token, postId, removeMediaItem(findPost(postId).media, index)),
    moveMedia: (token, postId, index, delta) => get().setMedia(token, postId, moveMediaItem(findPost(postId).media, index, delta)),
    uploadFiles: async (token, postId, files) => {
      for (const file of files) {
        const key = `upload-${++uploadSerial}`;
        const invalid = validateCreativeFile(file);
        if (invalid) { setUploads(postId, (entries) => [...entries, { key, name: file.name, status: 'error', error: invalid }]); continue; }
        setUploads(postId, (entries) => [...entries, { key, name: file.name, status: 'uploading' }]);
        try {
          const { socialPost } = await uploadSocialPostMedia(token, postId, file);
          replacePost(socialPost);
          setUploads(postId, (entries) => entries.filter((entry) => entry.key !== key));
        } catch (error) {
          setUploads(postId, (entries) => entries.map((entry) => entry.key === key ? { ...entry, status: 'error', error: message(error) } : entry));
        }
      }
    },
    dismissUpload: (postId, key) => setUploads(postId, (entries) => entries.filter((entry) => entry.key !== key)),
    approvePost: async (token, postId) => {
      const post = findPost(postId);
      await mutatePost(() => approveSocialPost(token, postId, post.version), 'El borrador cambió antes de aprobarse.');
    },
    discardPost: async (token, postId) => {
      const post = findPost(postId);
      await mutatePost(() => discardSocialPost(token, postId, post.version), 'El borrador cambió antes de descartarse.');
    },
    schedulePost: async (token, postId, input) => {
      const post = findPost(postId);
      const externalUrl = input.externalUrl?.trim() || undefined;
      set({ isSaving: true, conflict: null, detailError: null });
      try {
        const response = await scheduleSocialPost(token, postId, { desiredScheduledAt: input.desiredScheduledAt, ...(externalUrl ? { externalUrl } : {}), expectedVersion: post.version, idempotencyKey: socialScheduleKey(post, input.desiredScheduledAt, externalUrl) });
        if (response.socialPost) replacePost({ ...response.socialPost, publicationStatus: response.publication?.status ?? 'pending', publicationScheduledAt: response.publication?.confirmedScheduledAt ?? null });
        if (response.job) set((state) => ({ jobs: [response.job, ...state.jobs.filter((job) => job.id !== response.job.id)] }));
      } catch (error) {
        if (isConflict(error)) set({ conflict: message(error) }); else set({ detailError: message(error) });
        throw error;
      } finally { set({ isSaving: false }); }
    },
    pollJobs: async (token) => {
      const pending = get().jobs.filter((job) => IN_FLIGHT.includes(job.status));
      if (!pending.length) return false;
      const settled = await Promise.allSettled(pending.map((job) => getContentJob(token, job.id)));
      const updates = new Map<string, ContentJob>();
      settled.forEach((result, index) => { if (result.status === 'fulfilled') updates.set(pending[index].id, result.value.job); });
      set((state) => ({ jobs: state.jobs.map((job) => updates.get(job.id) ?? job) }));
      const changed = pending.filter((job) => { const next = updates.get(job.id); return next && next.status !== job.status && !['pending', 'running'].includes(next.status); });
      // Drafts only change once n8n reports back: reload the open idea's drafts when its generate_rrss job settles.
      const { selectedId } = get();
      if (selectedId && changed.some((job) => job.kind === 'generate_rrss' && job.targetId === selectedId)) await get().loadSocialPosts(token, selectedId);
      // Scheduled drafts of the open idea show their publication outcome.
      const shownPublications = new Set(get().socialPosts.map((post) => post.publicationId).filter(Boolean));
      if (selectedId && changed.some((job) => job.targetId && shownPublications.has(job.targetId))) await get().loadSocialPosts(token, selectedId);
      // A settled plan adds new ideas: reload the list right away (other changes wait for the regular refresh).
      if (changed.some((job) => job.kind === 'generate_rrss_plan')) { await get().refresh(token); return true; }
      return false;
    },
    clearConflict: () => set({ conflict: null }),
  };
});
