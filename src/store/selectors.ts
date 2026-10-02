import type { useClientStore } from './useClientStore.js';
import type { useContentStore } from './useContentStore.js';
import type { useRrssStore } from './useRrssStore.js';

/**
 * Named store selectors. Components subscribe through these (multi-field picks wrapped in `useShallow`)
 * so an unrelated store update, such as the Contenidos job-polling tick, does not re-render them.
 * Actions are stable references in Zustand, so including them in a pick never triggers a re-render.
 */
export type ClientStoreState = ReturnType<typeof useClientStore.getState>;
export type ContentStoreState = ReturnType<typeof useContentStore.getState>;
export type RrssStoreState = ReturnType<typeof useRrssStore.getState>;

// --- Client store ---------------------------------------------------------------------------------------

export const selectSessionToken = (s: ClientStoreState) => s.sessionToken;
export const selectCurrentUser = (s: ClientStoreState) => s.currentUser;

export const selectAppShell = (s: ClientStoreState) => ({
  bootstrapSession: s.bootstrapSession,
  isBootstrapping: s.isBootstrapping,
  sessionToken: s.sessionToken,
  currentUser: s.currentUser,
  signIn: s.signIn,
  authError: s.authError,
  sessionExpiredMessage: s.sessionExpiredMessage,
  isAuthenticating: s.isAuthenticating,
});

export const selectSession = (s: ClientStoreState) => ({ sessionToken: s.sessionToken, currentUser: s.currentUser });

export const selectAgencyDashboard = (s: ClientStoreState) => ({
  clients: s.clients,
  sessionToken: s.sessionToken,
  currentUser: s.currentUser,
  addClient: s.addClient,
  updateClient: s.updateClient,
  deleteClient: s.deleteClient,
});

export const selectReportsSession = (s: ClientStoreState) => ({
  sessionToken: s.sessionToken,
  currentUser: s.currentUser,
  refreshClients: s.refreshClients,
});

export const selectSidebar = (s: ClientStoreState) => ({
  clients: s.clients,
  activeClientId: s.activeClientId,
  activeTabId: s.activeTabId,
});

export const selectUserProfile = (s: ClientStoreState) => ({ currentUser: s.currentUser, signOut: s.signOut });

export const selectUsersAdmin = (s: ClientStoreState) => ({
  sessionToken: s.sessionToken,
  currentUser: s.currentUser,
  clients: s.clients,
});

// --- Content store --------------------------------------------------------------------------------------

export const selectContentFilterBar = (s: ContentStoreState) => ({ filters: s.filters, setFilters: s.setFilters, items: s.items });
export const selectContentMonth = (s: ContentStoreState) => s.month;

export const selectContentPagination = (s: ContentStoreState) => ({
  page: s.page,
  nextCursor: s.nextCursor,
  isLoading: s.isLoading,
  nextPage: s.nextPage,
  previousPage: s.previousPage,
});

export const selectContentDetail = (s: ContentStoreState) => ({
  items: s.items,
  selectedId: s.selectedId,
  content: s.content,
  publications: s.publications,
  publishingAccounts: s.publishingAccounts,
  jobs: s.jobs,
  readinessByClient: s.readinessByClient,
  isLoadingDetail: s.isLoadingDetail,
  isSaving: s.isSaving,
  detailError: s.detailError,
  conflict: s.conflict,
  select: s.select,
  savePlanItem: s.savePlanItem,
  releasePlanGeneration: s.releasePlanGeneration,
  loadReadiness: s.loadReadiness,
  saveContent: s.saveContent,
  approveContent: s.approveContent,
  schedulePublication: s.schedulePublication,
  createJob: s.createJob,
  refresh: s.refresh,
  clearConflict: s.clearConflict,
});

export const selectContentCreatePanel = (s: ContentStoreState) => ({
  filters: s.filters,
  calendars: s.calendars,
  loadCalendars: s.loadCalendars,
  createPlanItem: s.createPlanItem,
  isSaving: s.isSaving,
  select: s.select,
});

export const selectContentTab = (s: ContentStoreState) => ({
  month: s.month,
  view: s.view,
  filters: s.filters,
  items: s.items,
  nextCursor: s.nextCursor,
  page: s.page,
  isLoading: s.isLoading,
  isLoadingMore: s.isLoadingMore,
  isRefreshing: s.isRefreshing,
  error: s.error,
  lastUpdatedAt: s.lastUpdatedAt,
  jobs: s.jobs,
  readinessByClient: s.readinessByClient,
  setView: s.setView,
  setMonth: s.setMonth,
  reset: s.reset,
  setFilters: s.setFilters,
  load: s.load,
  loadMore: s.loadMore,
  refresh: s.refresh,
  pollJobs: s.pollJobs,
  loadReadiness: s.loadReadiness,
});

// --- RRSS store -----------------------------------------------------------------------------------------

export const selectRrssAccounts = (s: RrssStoreState) => ({ publishingAccounts: s.publishingAccounts, loadAccounts: s.loadAccounts, generatePosts: s.generatePosts });

export const selectRrssDraftDialog = (s: RrssStoreState) => ({
  publishingAccounts: s.publishingAccounts,
  socialPosts: s.socialPosts,
  loadAccounts: s.loadAccounts,
  createManualDraft: s.createManualDraft,
});

export const selectRrssIdeaDetail = (s: RrssStoreState) => ({
  items: s.items,
  selectedId: s.selectedId,
  socialPosts: s.socialPosts,
  uploads: s.uploads,
  bulkUpload: s.bulkUpload,
  readiness: s.readiness,
  isLoadingDetail: s.isLoadingDetail,
  isSaving: s.isSaving,
  detailError: s.detailError,
  conflict: s.conflict,
  select: s.select,
  saveIdea: s.saveIdea,
  releaseGeneration: s.releaseGeneration,
  saveCopy: s.saveCopy,
  removeMedia: s.removeMedia,
  moveMedia: s.moveMedia,
  uploadFiles: s.uploadFiles,
  uploadToAllDrafts: s.uploadToAllDrafts,
  dismissBulkUpload: s.dismissBulkUpload,
  dismissUpload: s.dismissUpload,
  approvePost: s.approvePost,
  discardPost: s.discardPost,
  schedulePost: s.schedulePost,
  refresh: s.refresh,
  clearConflict: s.clearConflict,
});

export const selectRrssPostsSection = (s: RrssStoreState) => ({
  clientId: s.clientId,
  filters: s.filters,
  items: s.items,
  nextCursor: s.nextCursor,
  page: s.page,
  jobs: s.jobs,
  readiness: s.readiness,
  isLoading: s.isLoading,
  isRefreshing: s.isRefreshing,
  error: s.error,
  lastUpdatedAt: s.lastUpdatedAt,
  reset: s.reset,
  setFilters: s.setFilters,
  load: s.load,
  refresh: s.refresh,
  nextPage: s.nextPage,
  previousPage: s.previousPage,
  loadReadiness: s.loadReadiness,
  pollJobs: s.pollJobs,
  select: s.select,
});
