export type CalendarStatus = 'draft' | 'active' | 'archived';
export type PlanItemStatus = 'proposed' | 'approved' | 'generating' | 'review' | 'ready' | 'generation_failed' | 'archived';
export type ContentStatus = 'draft' | 'review' | 'approved' | 'archived';
export type PublicationStatus = 'pending' | 'sending' | 'scheduled' | 'published' | 'failed' | 'unknown' | 'cancel_requested' | 'cancelled' | 'draft';

export interface EditorialCalendar {
  id: string;
  clientId: string;
  startDate: string | null;
  endDate: string | null;
  title: string;
  version: number;
  status: CalendarStatus;
  summary: string | null;
  insights: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanItem {
  id: string;
  clientId: string;
  calendarId: string;
  title: string;
  theme: string | null;
  rationale: string | null;
  format: string | null;
  keywordPrimary: string | null;
  keywords: string[];
  entities: string[];
  cta: string | null;
  priority: string | null;
  plannedAt: string | null;
  status: PlanItemStatus;
  sourceContext: Record<string, unknown>;
  sourceKey: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentItem {
  id: string;
  clientId: string;
  planItemId: string | null;
  title: string;
  bodyHtml: string | null;
  bodyText: string | null;
  excerpt: string | null;
  seo: Record<string, unknown>;
  status: ContentStatus;
  currentRevision: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentRevision {
  id: string;
  clientId: string;
  contentId: string;
  revisionNumber: number;
  contentSnapshot: Record<string, unknown>;
  promptVersion: string | null;
  sourceReferences: unknown[];
  authorType: 'ai' | 'user' | 'import' | 'system';
  authorId: string | null;
  createdAt: string;
}

export interface Publication {
  id: string;
  clientId: string;
  contentId: string;
  accountId: string;
  occurrenceKey: string;
  contentRevisionId: string | null;
  copy: string | null;
  media: unknown[];
  status: PublicationStatus;
  desiredScheduledAt: string | null;
  confirmedScheduledAt: string | null;
  postizPostId: string | null;
  providerPostId: string | null;
  externalUrl: string | null;
  publishedAt: string | null;
  lastSyncedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

