import type { ContentStatus, PlanItemStatus, PublicationStatus } from './types.js';
import { ContentApiError } from './contracts.js';

const planTransitions: Record<PlanItemStatus, readonly PlanItemStatus[]> = {
  proposed: ['approved', 'archived'], approved: ['generating', 'archived'], generating: ['review', 'generation_failed'],
  review: ['ready', 'generating', 'archived'], ready: ['generating', 'archived'], generation_failed: ['generating', 'archived'], archived: [],
};
const contentTransitions: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ['review', 'archived'], review: ['approved', 'draft', 'archived'], approved: ['review', 'archived'], archived: [],
};
const publicationTransitions: Record<PublicationStatus, readonly PublicationStatus[]> = {
  pending: ['sending', 'cancel_requested', 'cancelled'], sending: ['scheduled', 'published', 'draft', 'failed', 'unknown'],
  scheduled: ['sending', 'published', 'failed', 'unknown', 'cancel_requested'], published: [], failed: ['sending', 'cancel_requested'],
  unknown: ['sending', 'scheduled', 'published', 'failed', 'cancel_requested'], cancel_requested: ['cancelled', 'failed', 'unknown'],
  cancelled: [], draft: ['sending', 'published', 'failed', 'cancel_requested'],
};

export function assertTransition<T extends string>(entity: string, from: T, to: T, map: Record<T, readonly T[]>) {
  if (from === to) return;
  if (!map[from]?.includes(to)) throw new ContentApiError(409, 'INVALID_TRANSITION', `Transición incompatible para ${entity}: ${from} → ${to}`);
}

export const assertPlanTransition = (from: PlanItemStatus, to: PlanItemStatus) => assertTransition('plan_item', from, to, planTransitions);
export const assertContentTransition = (from: ContentStatus, to: ContentStatus) => assertTransition('content', from, to, contentTransitions);
export const assertPublicationTransition = (from: PublicationStatus, to: PublicationStatus) => assertTransition('publication', from, to, publicationTransitions);
