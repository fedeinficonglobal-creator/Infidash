import type { ContentStatus, PlanItemStatus, PublicationStatus, SocialPostStatus } from './types.js';
import { ContentApiError } from './contracts.js';

const planTransitions: Record<PlanItemStatus, readonly PlanItemStatus[]> = {
  proposed: ['approved', 'archived'], approved: ['generating', 'archived'], generating: ['review', 'generation_failed'],
  review: ['ready', 'generating', 'archived'], ready: ['generating', 'archived'], generation_failed: ['generating', 'archived'], archived: [],
};
const contentTransitions: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ['review', 'archived'], review: ['approved', 'draft', 'archived'], approved: ['review', 'archived'], archived: [],
};
// Postiz can report a post cancelled (or found after a failure) outside Infidash; reconcile must be able to record that.
const publicationTransitions: Record<PublicationStatus, readonly PublicationStatus[]> = {
  pending: ['sending', 'cancel_requested', 'cancelled'], sending: ['scheduled', 'published', 'draft', 'failed', 'unknown', 'cancelled'],
  scheduled: ['sending', 'published', 'failed', 'unknown', 'cancel_requested', 'cancelled'], published: [], failed: ['sending', 'scheduled', 'published', 'cancel_requested', 'cancelled'],
  unknown: ['sending', 'scheduled', 'published', 'failed', 'cancel_requested', 'cancelled'], cancel_requested: ['cancelled', 'failed', 'unknown'],
  cancelled: [], draft: ['sending', 'published', 'failed', 'cancel_requested'],
};
// Scheduled and discarded drafts are final: a scheduled post is managed through its publication.
const socialPostTransitions: Record<SocialPostStatus, readonly SocialPostStatus[]> = {
  review: ['approved', 'discarded'], approved: ['review', 'scheduled', 'discarded'], scheduled: [], discarded: [],
};

export function assertTransition<T extends string>(entity: string, from: T, to: T, map: Record<T, readonly T[]>) {
  if (from === to) return;
  if (!map[from]?.includes(to)) throw new ContentApiError(409, 'INVALID_TRANSITION', `Transición incompatible para ${entity}: ${from} → ${to}`);
}

/**
 * A manual RRSS draft gives a proposed/approved idea something to review, so it moves to review.
 * Kept apart from planTransitions on purpose: widening that shared map would also let a blog item
 * be PATCHed from proposed/approved straight to review. Returns null when the status stays.
 */
export function planStatusAfterManualDraft(status: PlanItemStatus): PlanItemStatus | null {
  return status === 'proposed' || status === 'approved' ? 'review' : null;
}

export const assertPlanTransition =(from: PlanItemStatus, to: PlanItemStatus) => assertTransition('plan_item', from, to, planTransitions);
export const assertContentTransition = (from: ContentStatus, to: ContentStatus) => assertTransition('content', from, to, contentTransitions);
export const assertPublicationTransition = (from: PublicationStatus, to: PublicationStatus) => assertTransition('publication', from, to, publicationTransitions);
export const assertSocialPostTransition = (from: SocialPostStatus, to: SocialPostStatus) => assertTransition('social_post', from, to, socialPostTransitions);
