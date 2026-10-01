import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { getEditorialPool, withEditorialTransaction } from './postgres.js';
import { ContentApiError, JOB_KINDS, RRSS_FORMATS, RRSS_NETWORKS, encodeCursor, networkFromInstanceKey, normalizeRrssNetworks, MAX_SOCIAL_MEDIA_ITEMS, normalizeSocialMedia, redactSecrets, requestHash, requireSocialCopy, sanitizeError, type CalendarKind, type SocialMediaItem } from './contracts.js';
import { assertContentTransition, assertPlanTransition, assertPublicationTransition, assertSocialPostTransition } from './transitions.js';
import type { ContentStatus, PlanItemStatus, PublicationStatus, SocialPostStatus } from './types.js';

type Filters = { clientId?: string; clientIds?: string[]; from?: string; to?: string; status?: string; format?: string; search?: string; includeUndated?: boolean; cursor?: { at: string; id: string } | null; limit: number };

function page<T extends Record<string, any>>(rows: T[], limit: number, atField = 'created_at') {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeCursor({ at: new Date(last[atField]).toISOString(), id: last.id }) : null };
}

function json(value: unknown) { return JSON.stringify(value ?? {}); }

/** YYYY-MM-DD for a valid date string or a pg DATE (parsed by node-postgres as local midnight); null otherwise. */
function dateOnly(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(Date.parse(value.slice(0, 10)))) return null;
  return value.slice(0, 10);
}
function addDays(day: string, days: number) { const date = new Date(`${day}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
/** The Monday strictly after today (UTC), so a new plan never starts on a day that is already under way. */
function nextMonday() { const today = new Date().toISOString().slice(0, 10); const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay(); return addDays(today, ((8 - weekday) % 7) || 7); }

export type PlanInputs = { topic: string; keywords: string[]; competitors: string[] };

const MAX_PLAN_KEYWORDS = 20;
const MAX_PLAN_KEYWORD_LENGTH = 100;
const MAX_PLAN_COMPETITORS = 5;
const MAX_PLAN_TOPIC_LENGTH = 200;

/** Reads a stored editorial_config list, accepting the legacy comma-separated string form for keywords. */
function storedList(value: unknown): string[] {
  const raw = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  return raw.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function uniqueCaseInsensitive(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => { const key = value.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function requireTextList(value: unknown, message: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new ContentApiError(400, 'INVALID_PAYLOAD', message);
  return (value as string[]).map((item) => item.trim()).filter(Boolean);
}

/** Bare lowercase hostname for a competitor domain or URL, as the n8n plan workflow scrapes it (e.g. `https://www.Foo.com/a?b` -> `foo.com`). */
function competitorDomain(value: string) {
  const domain = value.toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/, 1)[0].replace(/^www\./, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new ContentApiError(400, 'INVALID_PAYLOAD', `"${value}" no es un dominio válido de competidor`);
  return domain;
}

export function normalizePlanInputs(input: { topic?: unknown; keywords?: unknown; competitors?: unknown }): PlanInputs {
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  if (!topic) throw new ContentApiError(400, 'INVALID_PAYLOAD', 'Indica el tema del plan');
  if (topic.length > MAX_PLAN_TOPIC_LENGTH) throw new ContentApiError(400, 'INVALID_PAYLOAD', `El tema debe tener como máximo ${MAX_PLAN_TOPIC_LENGTH} caracteres`);
  const keywords = uniqueCaseInsensitive(requireTextList(input.keywords, 'keywords debe ser una lista de texto'));
  const competitors = uniqueCaseInsensitive(requireTextList(input.competitors, 'Los competidores deben ser una lista de texto').map(competitorDomain));
  if (!keywords.length) throw new ContentApiError(400, 'INVALID_PAYLOAD', 'Añade al menos una keyword');
  if (keywords.length > MAX_PLAN_KEYWORDS) throw new ContentApiError(400, 'INVALID_PAYLOAD', `Puedes indicar como máximo ${MAX_PLAN_KEYWORDS} keywords`);
  if (keywords.some((keyword) => keyword.length > MAX_PLAN_KEYWORD_LENGTH)) throw new ContentApiError(400, 'INVALID_PAYLOAD', `Cada keyword debe tener como máximo ${MAX_PLAN_KEYWORD_LENGTH} caracteres`);
  if (!competitors.length) throw new ContentApiError(400, 'INVALID_PAYLOAD', 'Añade al menos un competidor');
  if (competitors.length > MAX_PLAN_COMPETITORS) throw new ContentApiError(400, 'INVALID_PAYLOAD', `Puedes indicar como máximo ${MAX_PLAN_COMPETITORS} competidores`);
  return { topic, keywords, competitors };
}

export type RrssPlanInputs = { topic: string; keywords: string[]; networks: string[]; postsPerWeek: number; weeksHorizon: number };
/** RRSS plan inputs as read back from editorial_config.rrss: postsPerWeek stays null until an admin saves them. */
export type StoredRrssPlanInputs = Omit<RrssPlanInputs, 'postsPerWeek'> & { postsPerWeek: number | null };

const DEFAULT_RRSS_WEEKS_HORIZON = 4;
const MAX_RRSS_WEEKS_HORIZON = 12;
const MAX_RRSS_POSTS_PER_WEEK = 14;

function boundedInteger(value: unknown, min: number, max: number) {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
}

export function normalizeRrssPlanInputs(input: { topic?: unknown; keywords?: unknown; networks?: unknown; postsPerWeek?: unknown; weeksHorizon?: unknown }): RrssPlanInputs {
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  if (!topic) throw new ContentApiError(400, 'INVALID_PAYLOAD', 'Indica el tema del plan de redes');
  if (topic.length > MAX_PLAN_TOPIC_LENGTH) throw new ContentApiError(400, 'INVALID_PAYLOAD', `El tema debe tener como máximo ${MAX_PLAN_TOPIC_LENGTH} caracteres`);
  const keywords = input.keywords === undefined || input.keywords === null ? [] : uniqueCaseInsensitive(requireTextList(input.keywords, 'keywords debe ser una lista de texto'));
  if (keywords.length > MAX_PLAN_KEYWORDS) throw new ContentApiError(400, 'INVALID_PAYLOAD', `Puedes indicar como máximo ${MAX_PLAN_KEYWORDS} keywords`);
  if (keywords.some((keyword) => keyword.length > MAX_PLAN_KEYWORD_LENGTH)) throw new ContentApiError(400, 'INVALID_PAYLOAD', `Cada keyword debe tener como máximo ${MAX_PLAN_KEYWORD_LENGTH} caracteres`);
  const networks = normalizeRrssNetworks(input.networks);
  if (!networks.length) throw new ContentApiError(400, 'INVALID_PAYLOAD', 'Elige al menos una red social');
  const postsPerWeek = boundedInteger(input.postsPerWeek, 1, MAX_RRSS_POSTS_PER_WEEK);
  if (postsPerWeek === null) throw new ContentApiError(400, 'INVALID_PAYLOAD', `postsPerWeek debe ser un entero entre 1 y ${MAX_RRSS_POSTS_PER_WEEK}`);
  const weeksHorizon = input.weeksHorizon === undefined || input.weeksHorizon === null ? DEFAULT_RRSS_WEEKS_HORIZON : boundedInteger(input.weeksHorizon, 1, MAX_RRSS_WEEKS_HORIZON);
  if (weeksHorizon === null) throw new ContentApiError(400, 'INVALID_PAYLOAD', `weeksHorizon debe ser un entero entre 1 y ${MAX_RRSS_WEEKS_HORIZON}`);
  return { topic, keywords, networks, postsPerWeek, weeksHorizon };
}

/** Lenient read of editorial_config.rrss: unknown networks and non-text keywords are dropped, never rejected. */
function storedRrssPlanInputs(value: unknown): StoredRrssPlanInputs {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    topic: typeof config.topic === 'string' ? config.topic.trim() : '',
    keywords: storedList(config.keywords),
    networks: [...new Set(storedList(config.networks).filter((network) => (RRSS_NETWORKS as readonly string[]).includes(network)))],
    postsPerWeek: boundedInteger(config.postsPerWeek, 1, MAX_RRSS_POSTS_PER_WEEK),
    weeksHorizon: boundedInteger(config.weeksHorizon, 1, MAX_RRSS_WEEKS_HORIZON) ?? DEFAULT_RRSS_WEEKS_HORIZON,
  };
}

const EDITORIAL_DISABLED_MESSAGE = 'La automatización editorial del cliente está desactivada';

/** Jobs that n8n claims again on its own after a failure; publish/reschedule/cancel only ever run once (see claimJob). */
const AUTO_RETRY_KINDS = ['generate_plan', 'generate_content', 'reconcile', 'generate_rrss_plan', 'generate_rrss'];
/** Jobs whose target is a calendar created (or reused) for the plan, and whose result is a list of plan items. */
const PLAN_JOB_KINDS = ['generate_plan', 'generate_rrss_plan'];
/** Jobs that move a plan item to `generating` and back to `review`/`generation_failed`. */
const GENERATION_JOB_KINDS = ['generate_content', 'generate_rrss'];
/** Per-client RRSS calendar that holds manual ideas created outside any AI plan. */
const RRSS_IDEAS_CALENDAR_TITLE = 'Ideas sueltas';
const MAX_RRSS_ACCOUNTS = 20;

/** The Postiz accounts a generate_rrss job was created for (older payloads only carry `accounts`). */
function storedAccountIds(payload: any): string[] {
  const ids = Array.isArray(payload?.accountIds) ? payload.accountIds : Array.isArray(payload?.accounts) ? payload.accounts.map((account: any) => account?.id) : [];
  return ids.filter((id: unknown): id is string => typeof id === 'string');
}

/** Whether a generate_rrss job asks the workflow for a new AI image per post; missing (older payloads) means yes. */
function storedGenerateImage(payload: any): boolean { return payload?.generateImage !== false; }

/** The optional client-supplied generateImage flag: a boolean, defaulting to true. */
function requireGenerateImage(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'boolean') throw new ContentApiError(400, 'INVALID_PAYLOAD', 'generateImage debe ser un booleano');
  return value;
}

function requireAccountIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.some((id) => typeof id !== 'string' || !id.trim() || id.length > 100)) {
    throw new ContentApiError(400, 'INVALID_PAYLOAD', 'accountIds debe ser una lista no vacía de cuentas de redes sociales');
  }
  const ids = [...new Set((value as string[]).map((id) => id.trim()))];
  if (ids.length > MAX_RRSS_ACCOUNTS) throw new ContentApiError(400, 'INVALID_PAYLOAD', `accountIds admite como máximo ${MAX_RRSS_ACCOUNTS} cuentas`);
  return ids;
}

function socialPostFromRow(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    planItemId: row.plan_item_id,
    accountId: row.account_id,
    ...(row.account_label !== undefined ? { accountLabel: row.account_label } : {}),
    network: row.network,
    copy: row.copy,
    media: Array.isArray(row.media) ? row.media : [],
    status: row.status,
    publicationId: row.publication_id ?? null,
    ...(row.publication_status !== undefined ? { publicationStatus: row.publication_status ?? null, publicationScheduledAt: row.publication_scheduled_at ?? null } : {}),
    generationJobId: row.generation_job_id ?? null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function revisionFromRow(row: any) {
  return {
    id: row.id,
    revisionNumber: row.revision_number,
    contentSnapshot: row.content_snapshot,
    authorType: row.author_type,
    authorId: row.author_id,
    createdAt: row.created_at,
  };
}

/** `revisions` omitted (not `[]`) when not fetched, so a caller that merges this onto existing frontend state doesn't wipe an already-loaded revisions list. */
function contentFromRow(row: any, revisions?: any[]) {
  return {
    id: row.id,
    clientId: row.client_id,
    planItemId: row.plan_item_id,
    title: row.title,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    excerpt: row.excerpt,
    seo: row.seo ?? {},
    status: row.status,
    currentRevision: row.current_revision,
    approvedRevisionId: row.approved_revision_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(revisions ? { revisions: revisions.map(revisionFromRow) } : {}),
  };
}

export class EditorialApiRepository {
  constructor(private readonly pool: Pool = getEditorialPool()) {}

  async summary(filters: { clientId?: string; clientIds?: string[]; from?: string; to?: string }) {
    // RRSS ideas, their system content and their publications belong to the Redes Sociales tab, not to the blog summary.
    const scoped = (clientColumn: string, dateColumn: string, base: string[] = []) => {
      const values: unknown[] = [];
      const where: string[] = [...base];
      if (filters.clientId) { values.push(filters.clientId); where.push(`${clientColumn} = $${values.length}`); }
      else if (Array.isArray(filters.clientIds)) { values.push(filters.clientIds); where.push(`${clientColumn} = ANY($${values.length})`); }
      if (filters.from) { values.push(filters.from); where.push(`${dateColumn} >= $${values.length}`); }
      if (filters.to) { values.push(filters.to); where.push(`${dateColumn} < $${values.length}`); }
      return { values, sql: where.length ? ` WHERE ${where.join(' AND ')}` : '' };
    };
    const plansFilter = scoped('p.client_id', 'p.planned_at', ["cal.kind='blog'"]);
    const contentsFilter = scoped('ci.client_id', 'p.planned_at', ["(cal.kind IS NULL OR cal.kind='blog')"]);
    const publicationsFilter = scoped('pub.client_id', 'pub.desired_scheduled_at', [`NOT EXISTS (SELECT 1 FROM editorial.contents rc
      JOIN editorial.plan_items rp ON rp.client_id=rc.client_id AND rp.id=rc.plan_item_id
      JOIN editorial.calendars rcal ON rcal.client_id=rp.client_id AND rcal.id=rp.calendar_id
      WHERE rc.client_id=pub.client_id AND rc.id=pub.content_id AND rcal.kind='rrss')`]);
    const incidentsFilter = scoped('j.client_id', 'j.created_at');
    const [plans, contents, publications, incidents] = await Promise.all([
      this.pool.query(`SELECT p.status, count(*)::int count FROM editorial.plan_items p JOIN editorial.calendars cal ON cal.client_id=p.client_id AND cal.id=p.calendar_id${plansFilter.sql} GROUP BY p.status`, plansFilter.values),
      this.pool.query(`SELECT ci.status, count(*)::int count FROM editorial.contents ci LEFT JOIN editorial.plan_items p ON p.client_id=ci.client_id AND p.id=ci.plan_item_id LEFT JOIN editorial.calendars cal ON cal.client_id=p.client_id AND cal.id=p.calendar_id${contentsFilter.sql} GROUP BY ci.status`, contentsFilter.values),
      this.pool.query(`SELECT pub.status, count(*)::int count FROM editorial.publications pub${publicationsFilter.sql} GROUP BY pub.status`, publicationsFilter.values),
      this.pool.query(`SELECT count(*)::int count FROM editorial.jobs j${incidentsFilter.sql}${incidentsFilter.sql ? ' AND' : ' WHERE'} j.status IN ('failed','unknown')`, incidentsFilter.values),
    ]);
    const counts = (rows: any[]) => Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    return { planItems: counts(plans.rows), contents: counts(contents.rows), publications: counts(publications.rows), incidents: Number(incidents.rows[0]?.count ?? 0) };
  }

  /** Blog plan items only: RRSS ideas are listed by listRrssItems. */
  async calendar(filters: Filters) { return this.planItemPage(filters, 'blog'); }

  /** RRSS ideas with a summary of their social post drafts. */
  async listRrssItems(filters: Filters) { return this.planItemPage(filters, 'rrss'); }

  private async planItemPage(filters: Filters, kind: CalendarKind) {
    const values: unknown[] = [];
    const where: string[] = [kind === 'rrss' ? "c.kind = 'rrss'" : "c.kind = 'blog'"];
    if (filters.clientId) { values.push(filters.clientId); where.push(`p.client_id = $${values.length}`); }
    else if (Array.isArray(filters.clientIds)) { values.push(filters.clientIds); where.push(`p.client_id = ANY($${values.length})`); }
    if (filters.from) { values.push(filters.from); where.push(`${filters.includeUndated ? '(p.planned_at IS NULL OR ' : ''}p.planned_at >= $${values.length}${filters.includeUndated ? ')' : ''}`); }
    if (filters.to) { values.push(filters.to); where.push(`${filters.includeUndated ? '(p.planned_at IS NULL OR ' : ''}p.planned_at < $${values.length}${filters.includeUndated ? ')' : ''}`); }
    if (filters.status) { values.push(filters.status); where.push(`p.status = $${values.length}`); }
    if (filters.format) { values.push(filters.format); where.push(`p.format = $${values.length}`); }
    if (filters.search) { values.push(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(p.title ILIKE $${values.length} ESCAPE '\\' OR COALESCE(p.theme,'') ILIKE $${values.length} ESCAPE '\\' OR COALESCE(p.keyword_primary,'') ILIKE $${values.length} ESCAPE '\\')`); }
    if (filters.cursor) { values.push(filters.cursor.at, filters.cursor.id); where.push(`(p.created_at, p.id) > ($${values.length - 1}, $${values.length}::uuid)`); }
    values.push(filters.limit + 1);
    const columns = kind === 'rrss'
      ? `COALESCE((SELECT jsonb_agg(jsonb_build_object('id', sp.id, 'accountId', sp.account_id, 'network', sp.network, 'status', sp.status) ORDER BY sp.created_at, sp.id)
          FROM editorial.social_posts sp WHERE sp.client_id = p.client_id AND sp.plan_item_id = p.id), '[]'::jsonb) social_posts`
      : `ci.id content_id, ci.status content_status, ci.title content_title, ci.version content_version,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pub.id, 'status', pub.status, 'desiredScheduledAt', pub.desired_scheduled_at, 'confirmedScheduledAt', pub.confirmed_scheduled_at))
          FROM editorial.contents content_for_publication JOIN editorial.publications pub ON pub.client_id = content_for_publication.client_id AND pub.content_id = content_for_publication.id
          WHERE content_for_publication.client_id = p.client_id AND content_for_publication.plan_item_id = p.id), '[]'::jsonb) publications`;
    const lateral = kind === 'rrss' ? '' : `LEFT JOIN LATERAL (SELECT id, status, title, version FROM editorial.contents WHERE client_id = p.client_id AND plan_item_id = p.id ORDER BY updated_at DESC LIMIT 1) ci ON true`;
    const result = await this.pool.query(
      `SELECT p.*, c.title calendar_title,
        ${columns}
       FROM editorial.plan_items p JOIN editorial.calendars c ON c.client_id = p.client_id AND c.id = p.calendar_id
       ${lateral}
       WHERE ${where.join(' AND ')}
       ORDER BY p.created_at, p.id LIMIT $${values.length}`,
      values,
    );
    return page(result.rows as any[], filters.limit);
  }

  async listCalendars(clientId: string, limit: number, cursor?: { at: string; id: string } | null) {
    const values: unknown[] = [clientId];
    const cursorSql = cursor ? (values.push(cursor.at, cursor.id), `AND (created_at, id) > ($2, $3::uuid)`) : '';
    values.push(limit + 1);
    const result = await this.pool.query(`SELECT * FROM editorial.calendars WHERE client_id = $1 AND kind = 'blog' ${cursorSql} ORDER BY created_at, id LIMIT $${values.length}`, values);
    return page(result.rows as any[], limit);
  }

  async createCalendar(input: any, actorId: string | null) {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO editorial.calendars (id, client_id, title, start_date, end_date, status, summary, insights, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,
      [id, input.clientId, input.title, input.startDate ?? null, input.endDate ?? null, input.status ?? 'draft', input.summary ?? null, json(input.insights), actorId],
    );
    await this.audit(input.clientId, 'calendar', id, 'calendar.created', actorId, input);
    return result.rows[0];
  }

  async listPlanItems(filters: Filters) { return this.calendar(filters); }

  async getPlanItem(id: string) {
    const result = await this.pool.query('SELECT * FROM editorial.plan_items WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  /** Blog plan items only: RRSS ideas are created with createRrssIdea or by a generate_rrss_plan result. */
  async createPlanItem(input: any, actorId: string | null) {
    const calendar = await this.pool.query('SELECT kind FROM editorial.calendars WHERE client_id=$1 AND id=$2', [input.clientId, input.calendarId]);
    if (!calendar.rows[0]) throw new ContentApiError(404, 'NOT_FOUND', 'Calendario editorial no encontrado');
    if ((calendar.rows[0] as any).kind !== 'blog') throw new ContentApiError(409, 'INVALID_TARGET', 'El calendario no pertenece al blog');
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO editorial.plan_items (id,client_id,calendar_id,title,theme,rationale,format,keyword_primary,keywords,entities,cta,priority,planned_at,status,source_context,source_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15::jsonb,$16) RETURNING *`,
      [id,input.clientId,input.calendarId,input.title,input.theme??null,input.rationale??null,input.format??null,input.keywordPrimary??null,json(input.keywords??[]),json(input.entities??[]),input.cta??null,input.priority??null,input.plannedAt??null,input.status??'proposed',json(input.sourceContext),input.sourceKey??null],
    );
    await this.audit(input.clientId, 'plan_item', id, 'plan_item.created', actorId, input);
    return result.rows[0];
  }

  async patchPlanItem(id: string, input: any, actorId: string | null) {
    return withEditorialTransaction(async (client) => {
      const current = await client.query('SELECT * FROM editorial.plan_items WHERE id=$1 FOR UPDATE', [id]);
      const row = current.rows[0] as any;
      if (!row) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
      if (row.version !== input.version) throw new ContentApiError(409, 'STALE_VERSION', 'La propuesta fue modificada por otra ejecución');
      if (input.status) assertPlanTransition(row.status, input.status);
      const result = await client.query(
        `UPDATE editorial.plan_items SET title=COALESCE($2,title), theme=COALESCE($3,theme), rationale=COALESCE($4,rationale), format=COALESCE($5,format),
          keyword_primary=COALESCE($6,keyword_primary), keywords=COALESCE($7::jsonb,keywords), entities=COALESCE($8::jsonb,entities), cta=COALESCE($9,cta), priority=COALESCE($10,priority),
          planned_at=CASE WHEN $11::boolean THEN $12::timestamptz ELSE planned_at END, status=COALESCE($13,status), networks=COALESCE($14::jsonb,networks), version=version+1, updated_at=now() WHERE id=$1 RETURNING *`,
        [id,input.title??null,input.theme??null,input.rationale??null,input.format??null,input.keywordPrimary??null,input.keywords===undefined?null:json(input.keywords),input.entities===undefined?null:json(input.entities),input.cta??null,input.priority??null,Object.hasOwn(input,'plannedAt'),input.plannedAt??null,input.status??null,input.networks===undefined?null:json(input.networks)],
      );
      await this.auditWith(client,row.client_id,'plan_item',id,'plan_item.updated',actorId,input);
      return result.rows[0];
    }, this.pool);
  }

  /**
   * Admin escape hatch for a plan item stuck in `generating` (job reported `unknown`, crashed or was
   * orphaned). Every stale generate_content/generate_rrss job for the item is frozen so a late n8n result can never
   * be claimed or applied again; a live, leased execution must finish or expire first.
   */
  async releaseGeneration(id: string, expectedVersion: number, actorId: string) {
    return withEditorialTransaction(async (client) => {
      // Lock order matches claimJob (job rows, then plan item) so a concurrent claim cannot deadlock with this release.
      const owner = await client.query('SELECT client_id FROM editorial.plan_items WHERE id=$1', [id]);
      if (!owner.rows[0]) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
      await client.query(`SELECT id FROM editorial.jobs WHERE client_id=$1 AND (kind='generate_content' OR kind='generate_rrss') AND target_id=$2 FOR UPDATE`, [(owner.rows[0] as any).client_id, id]);
      const current = await client.query('SELECT * FROM editorial.plan_items WHERE id=$1 FOR UPDATE', [id]);
      const row = current.rows[0] as any;
      if (!row) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
      if (row.version !== expectedVersion) throw new ContentApiError(409, 'STALE_VERSION', 'La propuesta fue modificada por otra ejecución');
      if (row.status !== 'generating') throw new ContentApiError(409, 'INVALID_TRANSITION', 'Solo se puede marcar como fallida una propuesta en generación');
      const live = await client.query(`SELECT id FROM editorial.jobs WHERE client_id=$1 AND (kind='generate_content' OR kind='generate_rrss') AND target_id=$2 AND status='running' AND locked_until>now() FOR UPDATE`, [row.client_id, id]);
      if (live.rows[0]) throw new ContentApiError(409, 'JOB_IN_PROGRESS', 'Hay una generación en curso; espera a que termine o caduque');
      const released = await client.query(
        `UPDATE editorial.jobs SET status='failed',attempt_count=GREATEST(attempt_count,8),lease_token=NULL,locked_until=NULL,last_error=$3,updated_at=now()
         WHERE client_id=$1 AND (kind='generate_content' OR kind='generate_rrss') AND target_id=$2 AND (status IN ('pending','failed','unknown') OR (status='running' AND (locked_until IS NULL OR locked_until<=now()))) RETURNING id`,
        [row.client_id, id, 'Liberado manualmente por un administrador'],
      );
      assertPlanTransition(row.status, 'generation_failed');
      const result = await client.query(`UPDATE editorial.plan_items SET status='generation_failed',version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [id]);
      await this.auditWith(client, row.client_id, 'plan_item', id, 'plan_item.generation_released', actorId, { previousVersion: row.version, releasedJobIds: released.rows.map((job: any) => job.id) });
      return result.rows[0];
    }, this.pool);
  }

  async getContent(id: string) {
    const [content, revisions] = await Promise.all([
      this.pool.query('SELECT * FROM editorial.contents WHERE id=$1', [id]),
      this.pool.query('SELECT * FROM editorial.content_revisions WHERE content_id=$1 ORDER BY revision_number DESC LIMIT 50', [id]),
    ]);
    return content.rows[0] ? contentFromRow(content.rows[0], revisions.rows) : null;
  }

  async patchContent(id: string, input: any, actorId: string | null) {
    return withEditorialTransaction(async (client) => {
      const locked = await client.query('SELECT * FROM editorial.contents WHERE id=$1 FOR UPDATE', [id]);
      const row = locked.rows[0] as any;
      if (!row) throw new ContentApiError(404, 'NOT_FOUND', 'Contenido no encontrado');
      if (row.version !== input.version) throw new ContentApiError(409, 'STALE_VERSION', 'El contenido fue modificado por otra ejecución');
      const nextStatus = input.status ?? (row.status === 'approved' ? 'review' : row.status);
      assertContentTransition(row.status, nextStatus);
      const revisionNumber = Number(row.current_revision) + 1;
      const revisionId = randomUUID();
      const snapshot = { title: input.title ?? row.title, bodyHtml: input.bodyHtml ?? row.body_html, bodyText: input.bodyText ?? row.body_text, excerpt: input.excerpt ?? row.excerpt, seo: input.seo ?? row.seo };
      await client.query(
        `INSERT INTO editorial.content_revisions (id,client_id,content_id,revision_number,content_snapshot,source_references,author_type,author_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,'[]'::jsonb,'user',$6)`, [revisionId,row.client_id,id,revisionNumber,json(snapshot),actorId],
      );
      const result = await client.query(
        `UPDATE editorial.contents SET title=$2,body_html=$3,body_text=$4,excerpt=$5,seo=$6::jsonb,status=$7,current_revision=$8,
         approved_revision_id=CASE WHEN $7='approved' THEN approved_revision_id ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
        [id,snapshot.title,snapshot.bodyHtml,snapshot.bodyText,snapshot.excerpt,json(snapshot.seo),nextStatus,revisionNumber],
      );
      await this.auditWith(client,row.client_id,'content',id,'content.revised',actorId,{ revisionId, revisionNumber });
      const revisions = await client.query('SELECT * FROM editorial.content_revisions WHERE content_id=$1 ORDER BY revision_number DESC LIMIT 50', [id]);
      return contentFromRow(result.rows[0], revisions.rows);
    }, this.pool);
  }

  async approveContent(id: string, revisionId: string, expectedVersion: number, actorId: string) {
    return withEditorialTransaction(async (client) => {
      const locked = await client.query('SELECT * FROM editorial.contents WHERE id=$1 FOR UPDATE', [id]);
      const row = locked.rows[0] as any;
      if (!row) throw new ContentApiError(404, 'NOT_FOUND', 'Contenido no encontrado');
      if (row.version !== expectedVersion) throw new ContentApiError(409, 'STALE_VERSION', 'El contenido fue modificado antes de aprobarse');
      const revision = await client.query('SELECT id, revision_number FROM editorial.content_revisions WHERE client_id=$1 AND content_id=$2 AND id=$3', [row.client_id,id,revisionId]);
      if (!revision.rowCount) throw new ContentApiError(409, 'REVISION_MISMATCH', 'La revisión no pertenece al contenido');
      assertContentTransition(row.status, 'approved');
      const result = await client.query(`UPDATE editorial.contents SET status='approved',approved_revision_id=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [id,revisionId]);
      await this.auditWith(client,row.client_id,'content',id,'content.approved',actorId,{ revisionId });
      // An approved article is ready to schedule; a plan item in any other state (e.g. regenerating) is left alone.
      if (row.plan_item_id) {
        const planItem = await client.query('SELECT id,status,version FROM editorial.plan_items WHERE client_id=$1 AND id=$2 FOR UPDATE', [row.client_id,row.plan_item_id]);
        const plan = planItem.rows[0] as any;
        if (plan?.status === 'review') {
          assertPlanTransition(plan.status, 'ready');
          await client.query(`UPDATE editorial.plan_items SET status='ready',version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2`, [row.client_id,plan.id]);
          await this.auditWith(client,row.client_id,'plan_item',plan.id,'plan_item.ready',actorId,{ contentId: id, revisionId, previousVersion: plan.version });
        }
      }
      return contentFromRow(result.rows[0]);
    }, this.pool);
  }

  async listPublications(contentId: string, limit: number, cursor?: { at: string; id: string } | null) {
    const values: unknown[] = [contentId];
    const cursorSql = cursor ? (values.push(cursor.at,cursor.id),`AND (p.created_at,p.id)>($2,$3::uuid)`) : '';
    values.push(limit+1);
    const result = await this.pool.query(`SELECT p.*,a.provider,a.platform,a.label account_label FROM editorial.publications p JOIN editorial.publishing_accounts a ON a.client_id=p.client_id AND a.id=p.account_id WHERE p.content_id=$1 ${cursorSql} ORDER BY p.created_at,p.id LIMIT $${values.length}`,values);
    return page(result.rows as any[],limit);
  }

  async listPublishingAccounts(clientId: string) {
    const result = await this.pool.query(
      `SELECT id,client_id,provider,instance_key,external_account_id,platform,label,timezone,active
       FROM editorial.publishing_accounts WHERE client_id=$1 AND active=TRUE AND provider='postiz' ORDER BY label,id`, [clientId],
    );
    return result.rows;
  }

  async schedulePublication(input: any, actorId: string) {
    const occurrenceKey=input.occurrenceKey??'primary';
    const hash=requestHash({kind:'publish',contentId:input.contentId,accountId:input.accountId,desiredScheduledAt:input.desiredScheduledAt,externalUrl:input.externalUrl??null,occurrenceKey,copy:input.copy??null,media:input.media??[],expectedVersion:input.expectedVersion});
    return withEditorialTransaction(async(client)=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`job:${input.clientId}:${input.idempotencyKey}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`publication:${input.contentId}:${input.accountId}:${occurrenceKey}`]);
      await this.requireEnabledClient(client,input.clientId,'publish');
      const contentResult=await client.query('SELECT * FROM editorial.contents WHERE client_id=$1 AND id=$2 FOR UPDATE',[input.clientId,input.contentId]);
      const content=contentResult.rows[0] as any;
      if(!content) throw new ContentApiError(404,'NOT_FOUND','Contenido no encontrado');
      if(content.version!==input.expectedVersion) throw new ContentApiError(409,'STALE_VERSION','El contenido fue modificado antes de programarse');
      if(content.status!=='approved' || !content.approved_revision_id) throw new ContentApiError(409,'REVISION_NOT_APPROVED','El contenido debe tener una revisión aprobada');
      const accountResult=await client.query("SELECT * FROM editorial.publishing_accounts WHERE client_id=$1 AND id=$2 AND active=TRUE AND provider='postiz' FOR SHARE",[input.clientId,input.accountId]);
      if(!accountResult.rows[0]) throw new ContentApiError(409,'ACCOUNT_NOT_AVAILABLE','La cuenta no pertenece al cliente, está desactivada o no es una cuenta de redes sociales (Postiz)');
      const replay=await this.replayPublicationJob(client,input.clientId,input.idempotencyKey,hash);
      if(replay) return {...replay,replayed:true};
      const headerImageUrl=(content.seo && typeof content.seo==='object')?(content.seo as any).headerImageUrl??null:null;
      const media=(Array.isArray(input.media)&&input.media.length)?input.media:(headerImageUrl?[{url:headerImageUrl}]:[]);
      const queued=await this.queuePublication(client,{clientId:input.clientId,contentId:input.contentId,contentRevisionId:content.approved_revision_id,account:accountResult.rows[0],occurrenceKey,desiredScheduledAt:input.desiredScheduledAt,externalUrl:input.externalUrl??null,copy:input.copy??null,media,idempotencyKey:input.idempotencyKey,hash},actorId);
      return {...queued,replayed:false};
    },this.pool);
  }

  /** The publication and job already queued under this idempotency key, or null when the key is new. */
  private async replayPublicationJob(client: PoolClient, clientId: string, idempotencyKey: string, hash: string) {
    const existingJob=await client.query('SELECT * FROM editorial.jobs WHERE client_id=$1 AND idempotency_key=$2 FOR UPDATE',[clientId,idempotencyKey]);
    const job=existingJob.rows[0] as any;
    if(!job) return null;
    if(job.request_hash!==hash) throw new ContentApiError(409,'IDEMPOTENCY_CONFLICT','La clave de idempotencia ya se usó con otra programación');
    const publication=await client.query(`SELECT p.*,a.provider,a.platform,a.label account_label FROM editorial.publications p JOIN editorial.publishing_accounts a ON a.client_id=p.client_id AND a.id=p.account_id WHERE p.client_id=$1 AND p.id=$2`,[clientId,job.target_id]);
    return {publication:publication.rows[0],job};
  }

  /**
   * Inserts a pending publication plus its publish job (payload built from the database). Shared by
   * blog and RRSS scheduling; the caller holds the idempotency and publication-slot advisory locks
   * and has already checked the approved revision and the Postiz account.
   */
  private async queuePublication(client: PoolClient, input: { clientId: string; contentId: string; contentRevisionId: string; account: any; occurrenceKey: string; desiredScheduledAt: string; externalUrl: string | null; copy: string | null; media: unknown[]; idempotencyKey: string; hash: string }, actorId: string) {
    const account=input.account;
    const occurrenceKey=input.occurrenceKey;
    // A cancelled publication keeps its row (and its UNIQUE occurrence_key) for history, so
    // rescheduling after a cancel moves to the next free "<key>-<n>" occurrence. Any other
    // status in the chain (scheduled, failed, published...) still blocks the duplicate.
    const occupied=await client.query('SELECT id,occurrence_key,status FROM editorial.publications WHERE content_id=$1 AND account_id=$2 FOR UPDATE',[input.contentId,account.id]);
    const chain=(occupied.rows as any[]).filter((row)=>row.occurrence_key===occurrenceKey||new RegExp(`^${occurrenceKey.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}-\\d+$`).test(row.occurrence_key));
    if(chain.some((row)=>row.status!=='cancelled')) throw new ContentApiError(409,'PUBLICATION_EXISTS','Ya existe una publicación para esa cuenta y ocurrencia');
    const usedKeys=new Set(chain.map((row)=>row.occurrence_key));
    let slotKey=occurrenceKey;
    for(let n=2;usedKeys.has(slotKey);n++) slotKey=`${occurrenceKey}-${n}`;
    const publicationId=randomUUID();
    const publicationResult=await client.query(
      `INSERT INTO editorial.publications(id,client_id,content_id,account_id,occurrence_key,content_revision_id,copy,media,status,desired_scheduled_at,external_url)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'pending',$9,$10) RETURNING *`,
      [publicationId,input.clientId,input.contentId,account.id,slotKey,input.contentRevisionId,input.copy,json(input.media),input.desiredScheduledAt,input.externalUrl],
    );
    const jobId=randomUUID();
    const jobResult=await client.query(
      `INSERT INTO editorial.jobs(id,client_id,kind,target_id,idempotency_key,request_hash,payload)
       VALUES($1,$2,'publish',$3,$4,$5,$6::jsonb) RETURNING *`,
      [jobId,input.clientId,publicationId,input.idempotencyKey,input.hash,json(this.publicationPayload(publicationResult.rows[0],account))],
    );
    await this.auditWith(client,input.clientId,'publication',publicationId,'publication.queued',actorId,{accountId:account.id,desiredScheduledAt:input.desiredScheduledAt,jobId});
    return {publication:{...publicationResult.rows[0],provider:account.provider,platform:account.platform,account_label:account.label},job:jobResult.rows[0]};
  }

  async createJob(input: any, actorId: string | null) {
    const hash = requestHash({ kind: input.kind, targetId: input.targetId ?? null, expectedVersion: input.expectedVersion ?? null, payload: input.payload ?? {} });
    return withEditorialTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`job:${input.clientId}:${input.idempotencyKey}`]);
      await this.requireEnabledClient(client,input.clientId,input.kind);
      const existing = await client.query('SELECT * FROM editorial.jobs WHERE client_id=$1 AND idempotency_key=$2 FOR UPDATE',[input.clientId,input.idempotencyKey]);
      if (existing.rows[0]) {
        if ((existing.rows[0] as any).request_hash !== hash) throw new ContentApiError(409,'IDEMPOTENCY_CONFLICT','La clave de idempotencia ya se usó con otro payload');
        return { job: existing.rows[0], replayed: true };
      }
      await this.refuseActiveDuplicate(client, input);
      await this.prepareJobTarget(client, input, actorId);
      await this.validateJobTarget(client, input);
      if (this.isPublicationJob(input.kind)) input.payload = await this.publicationPayloadForJob(client, input.clientId, input.targetId);
      if (input.kind === 'generate_content') input.payload = await this.planItemPayloadForJob(client, input.clientId, input.targetId);
      const id=randomUUID();
      const result=await client.query(`INSERT INTO editorial.jobs (id,client_id,kind,target_id,idempotency_key,request_hash,payload) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,[id,input.clientId,input.kind,input.targetId??null,input.idempotencyKey,hash,json(redactSecrets(input.payload))]);
      await this.auditWith(client,input.clientId,'job',id,'job.created',actorId,{kind:input.kind,targetId:input.targetId??null});
      return { job: result.rows[0], replayed: false };
    },this.pool);
  }

  private async requireEnabledClient(client: PoolClient, clientId: string, kind: string) {
    const result=await client.query('SELECT enabled FROM editorial.client_settings WHERE client_id=$1 FOR SHARE',[clientId]);
    if(!result.rows[0] || !(result.rows[0] as any).enabled) throw new ContentApiError(409,'EDITORIAL_DISABLED',EDITORIAL_DISABLED_MESSAGE);
    const bindings=await client.query('SELECT workflow_bindings FROM editorial.client_settings WHERE client_id=$1 FOR SHARE',[clientId]);
    // Real client_settings rows always return bindings here. Some repository fakes
    // only implement the enabled lookup; retain their existing contract.
    if (bindings.rows[0]) {
      const configured=(bindings.rows[0] as any).workflow_bindings;
      if(!configured || typeof configured!=='object' || typeof configured[kind]!=='string' || !configured[kind].trim()) {
        throw new ContentApiError(409,'WORKFLOW_NOT_BOUND',`Falta configurar el workflow editorial ${kind} para este cliente`);
      }
    }
  }

  async readiness(clientId: string) {
    const result = await this.pool.query('SELECT enabled,workflow_bindings FROM editorial.client_settings WHERE client_id=$1', [clientId]);
    const settings = result.rows[0] as any;
    const bindings = settings?.workflow_bindings ?? {};
    return {
      enabled: Boolean(settings?.enabled),
      jobs: Object.fromEntries(JOB_KINDS.map((kind) => [kind, Boolean(settings?.enabled && typeof bindings[kind] === 'string' && bindings[kind].trim())])),
    };
  }

  /** The plan workflow's topic, keywords and competitors, read from editorial_config (the n8n plan's only source for them). */
  async getPlanInputs(clientId: string): Promise<PlanInputs> {
    const result = await this.pool.query('SELECT editorial_config FROM editorial.client_settings WHERE client_id=$1', [clientId]);
    if (!result.rows[0]) throw new ContentApiError(409, 'EDITORIAL_DISABLED', EDITORIAL_DISABLED_MESSAGE);
    const config = (result.rows[0] as any).editorial_config ?? {};
    return { topic: typeof config.topic === 'string' ? config.topic.trim() : '', keywords: storedList(config.keywords), competitors: storedList(config.competitors) };
  }

  /** Validates, normalizes and merges topic/keywords/competitors into editorial_config, preserving every other key. */
  async savePlanInputs(clientId: string, input: { topic?: unknown; keywords?: unknown; competitors?: unknown }): Promise<PlanInputs> {
    const inputs = normalizePlanInputs(input);
    const result = await this.pool.query(
      `UPDATE editorial.client_settings SET editorial_config=COALESCE(editorial_config,'{}'::jsonb) || $2::jsonb, updated_at=now() WHERE client_id=$1 RETURNING client_id`,
      [clientId, json(inputs)],
    );
    if (!result.rows[0]) throw new ContentApiError(409, 'EDITORIAL_DISABLED', EDITORIAL_DISABLED_MESSAGE);
    return inputs;
  }

  /** The RRSS plan workflow inputs, read from editorial_config.rrss. */
  async getRrssPlanInputs(clientId: string): Promise<StoredRrssPlanInputs> {
    const result = await this.pool.query('SELECT editorial_config FROM editorial.client_settings WHERE client_id=$1', [clientId]);
    if (!result.rows[0]) throw new ContentApiError(409, 'EDITORIAL_DISABLED', EDITORIAL_DISABLED_MESSAGE);
    return storedRrssPlanInputs((result.rows[0] as any).editorial_config?.rrss);
  }

  /** Validates the RRSS plan inputs and merges them into editorial_config.rrss, preserving every other key. */
  async saveRrssPlanInputs(clientId: string, input: { topic?: unknown; keywords?: unknown; networks?: unknown; postsPerWeek?: unknown; weeksHorizon?: unknown }): Promise<RrssPlanInputs> {
    const inputs = normalizeRrssPlanInputs(input);
    const result = await this.pool.query(
      `UPDATE editorial.client_settings SET editorial_config=jsonb_set(COALESCE(editorial_config,'{}'::jsonb),'{rrss}',CASE WHEN jsonb_typeof(editorial_config->'rrss')='object' THEN editorial_config->'rrss' ELSE '{}'::jsonb END || $2::jsonb,true), updated_at=now() WHERE client_id=$1 RETURNING client_id`,
      [clientId, json(inputs)],
    );
    if (!result.rows[0]) throw new ContentApiError(409, 'EDITORIAL_DISABLED', EDITORIAL_DISABLED_MESSAGE);
    return inputs;
  }

  /** A manual RRSS idea, kept in the client's "Ideas sueltas" RRSS calendar (created on first use). */
  async createRrssIdea(input: { clientId: string; title: string; theme?: string | null; rationale?: string | null; format?: string | null; networks?: string[]; cta?: string | null; plannedAt?: string; keywords?: string[]; keywordPrimary?: string | null }, actorId: string) {
    return withEditorialTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`rrss-ideas-calendar:${input.clientId}`]);
      const existing = await client.query(`SELECT id FROM editorial.calendars WHERE client_id=$1 AND kind='rrss' AND title=$2 ORDER BY created_at,id LIMIT 1`, [input.clientId, RRSS_IDEAS_CALENDAR_TITLE]);
      let calendarId = (existing.rows[0] as any)?.id as string | undefined;
      if (!calendarId) {
        calendarId = randomUUID();
        await client.query(`INSERT INTO editorial.calendars (id,client_id,title,status,kind,created_by) VALUES ($1,$2,$3,'active','rrss',$4)`, [calendarId, input.clientId, RRSS_IDEAS_CALENDAR_TITLE, actorId]);
        await this.auditWith(client, input.clientId, 'calendar', calendarId, 'calendar.created', actorId, { kind: 'rrss', title: RRSS_IDEAS_CALENDAR_TITLE });
      }
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO editorial.plan_items (id,client_id,calendar_id,title,theme,rationale,format,keyword_primary,keywords,cta,planned_at,networks,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,'proposed') RETURNING *`,
        [id, input.clientId, calendarId, input.title, input.theme ?? null, input.rationale ?? null, input.format ?? null, input.keywordPrimary ?? null, json(input.keywords ?? []), input.cta ?? null, input.plannedAt ?? null, json(input.networks ?? [])],
      );
      await this.auditWith(client, input.clientId, 'plan_item', id, 'plan_item.created', actorId, { kind: 'rrss', calendarId, title: input.title });
      return result.rows[0];
    }, this.pool);
  }

  async getSocialPost(id: string) {
    const result = await this.pool.query('SELECT * FROM editorial.social_posts WHERE id=$1', [id]);
    return result.rows[0] ? socialPostFromRow(result.rows[0]) : null;
  }

  async listSocialPosts(planItemId: string) {
    const result = await this.pool.query(
      `SELECT sp.*,a.label account_label,pub.status publication_status,pub.confirmed_scheduled_at publication_scheduled_at
       FROM editorial.social_posts sp JOIN editorial.publishing_accounts a ON a.client_id=sp.client_id AND a.id=sp.account_id
       LEFT JOIN editorial.publications pub ON pub.client_id=sp.client_id AND pub.id=sp.publication_id
       WHERE sp.plan_item_id=$1 ORDER BY sp.created_at,sp.id`, [planItemId],
    );
    return result.rows.map(socialPostFromRow);
  }

  /** Editing a draft (copy and/or media) always leaves it in review, so an approved post must be approved again. */
  async patchSocialPost(id: string, input: { copy?: string; media?: SocialMediaItem[]; expectedVersion: number }, actorId: string) {
    if (input.copy === undefined && input.media === undefined) throw new ContentApiError(400, 'INVALID_PAYLOAD', 'Indica copy o media');
    return withEditorialTransaction(async (client) => {
      const row = await this.lockSocialPost(client, id, input.expectedVersion);
      assertSocialPostTransition(row.status as SocialPostStatus, 'review');
      const result = await client.query(
        `UPDATE editorial.social_posts SET copy=COALESCE($2,copy),media=COALESCE($3::jsonb,media),status='review',version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
        [id, input.copy ?? null, input.media === undefined ? null : json(input.media)],
      );
      await this.auditWith(client, row.client_id, 'social_post', id, 'social_post.updated', actorId, { previousStatus: row.status, previousVersion: row.version });
      return socialPostFromRow(result.rows[0]);
    }, this.pool);
  }

  /**
   * Appends one uploaded creative (already stored in Postiz) to a draft. Like any edit it leaves the
   * draft in review and bumps its version; scheduled/discarded drafts and full galleries are refused.
   */
  async appendSocialPostMedia(id: string, item: SocialMediaItem, actorId: string) {
    return withEditorialTransaction(async (client) => {
      const row = await this.lockSocialPost(client, id, undefined);
      assertSocialPostTransition(row.status as SocialPostStatus, 'review');
      const media = Array.isArray(row.media) ? row.media : [];
      if (media.length >= MAX_SOCIAL_MEDIA_ITEMS) throw new ContentApiError(409, 'MEDIA_LIMIT', `El post ya tiene el máximo de ${MAX_SOCIAL_MEDIA_ITEMS} archivos`);
      const result = await client.query(
        `UPDATE editorial.social_posts SET media=$2::jsonb,status='review',version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
        [id, json([...media, item])],
      );
      await this.auditWith(client, row.client_id, 'social_post', id, 'social_post.media_added', actorId, { previousStatus: row.status, previousVersion: row.version, url: item.url, type: item.type ?? null });
      return socialPostFromRow(result.rows[0]);
    }, this.pool);
  }

  async approveSocialPost(id: string, expectedVersion: number | undefined, actorId: string) { return this.setSocialPostStatus(id, 'approved', expectedVersion, actorId); }

  async discardSocialPost(id: string, expectedVersion: number | undefined, actorId: string) { return this.setSocialPostStatus(id, 'discarded', expectedVersion, actorId); }

  private async setSocialPostStatus(id: string, status: SocialPostStatus, expectedVersion: number | undefined, actorId: string) {
    return withEditorialTransaction(async (client) => {
      const row = await this.lockSocialPost(client, id, expectedVersion);
      if (row.status === status) throw new ContentApiError(409, 'INVALID_TRANSITION', `El post ya está en estado ${status}`);
      assertSocialPostTransition(row.status as SocialPostStatus, status);
      const result = await client.query('UPDATE editorial.social_posts SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *', [id, status]);
      await this.auditWith(client, row.client_id, 'social_post', id, `social_post.${status}`, actorId, { previousStatus: row.status, previousVersion: row.version });
      return socialPostFromRow(result.rows[0]);
    }, this.pool);
  }

  private async lockSocialPost(client: PoolClient, id: string, expectedVersion: number | undefined) {
    const locked = await client.query('SELECT * FROM editorial.social_posts WHERE id=$1 FOR UPDATE', [id]);
    const row = locked.rows[0] as any;
    if (!row) throw new ContentApiError(404, 'NOT_FOUND', 'Post no encontrado');
    if (expectedVersion !== undefined && row.version !== expectedVersion) throw new ContentApiError(409, 'STALE_VERSION', 'El post fue modificado por otra ejecución');
    return row;
  }

  /**
   * Schedules an approved draft through the normal publish pipeline: the idea gets one approved
   * system content (shared by all its posts), and this post becomes a pending publication with its
   * own copy and media plus a publish job, exactly like a blog publication.
   */
  async scheduleSocialPost(id: string, input: { clientId: string; desiredScheduledAt: string; externalUrl?: string | null; expectedVersion: number; idempotencyKey: string }, actorId: string) {
    const hash = requestHash({ kind: 'publish', socialPostId: id, desiredScheduledAt: input.desiredScheduledAt, externalUrl: input.externalUrl ?? null, expectedVersion: input.expectedVersion });
    return withEditorialTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`job:${input.clientId}:${input.idempotencyKey}`]);
      await this.requireEnabledClient(client, input.clientId, 'publish');
      const replay = await this.replayPublicationJob(client, input.clientId, input.idempotencyKey, hash);
      if (replay) {
        const post = await client.query('SELECT * FROM editorial.social_posts WHERE client_id=$1 AND publication_id=$2', [input.clientId, (replay.job as any).target_id]);
        return { socialPost: post.rows[0] ? socialPostFromRow(post.rows[0]) : null, ...replay, replayed: true };
      }
      const owner = await client.query('SELECT plan_item_id FROM editorial.social_posts WHERE client_id=$1 AND id=$2', [input.clientId, id]);
      if (!owner.rows[0]) throw new ContentApiError(404, 'NOT_FOUND', 'Post no encontrado');
      // Plan item before post: the same lock order as a generate_rrss result, so the two cannot deadlock.
      const planResult = await client.query('SELECT * FROM editorial.plan_items WHERE client_id=$1 AND id=$2 FOR SHARE', [input.clientId, (owner.rows[0] as any).plan_item_id]);
      const plan = planResult.rows[0] as any;
      if (!plan) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
      const locked = await client.query('SELECT * FROM editorial.social_posts WHERE client_id=$1 AND id=$2 FOR UPDATE', [input.clientId, id]);
      const post = locked.rows[0] as any;
      if (!post) throw new ContentApiError(404, 'NOT_FOUND', 'Post no encontrado');
      if (post.version !== input.expectedVersion) throw new ContentApiError(409, 'STALE_VERSION', 'El post fue modificado antes de programarse');
      await this.assertSchedulable(client, input.clientId, post, actorId);
      const content = await this.ensureRrssContent(client, input.clientId, plan, post, actorId);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`publication:${content.id}:${post.account_id}:primary`]);
      const accountResult = await client.query("SELECT * FROM editorial.publishing_accounts WHERE client_id=$1 AND id=$2 AND active=TRUE AND provider='postiz' FOR SHARE", [input.clientId, post.account_id]);
      if (!accountResult.rows[0]) throw new ContentApiError(409, 'ACCOUNT_NOT_AVAILABLE', 'La cuenta no pertenece al cliente, está desactivada o no es una cuenta de redes sociales (Postiz)');
      const queued = await this.queuePublication(client, { clientId: input.clientId, contentId: content.id, contentRevisionId: content.approved_revision_id, account: accountResult.rows[0], occurrenceKey: 'primary', desiredScheduledAt: input.desiredScheduledAt, externalUrl: input.externalUrl ?? null, copy: post.copy, media: Array.isArray(post.media) ? post.media : [], idempotencyKey: input.idempotencyKey, hash }, actorId);
      assertSocialPostTransition(post.status, 'scheduled');
      const publicationId = (queued.publication as any).id;
      const updated = await client.query(`UPDATE editorial.social_posts SET status='scheduled',publication_id=$3,version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2 RETURNING *`, [input.clientId, id, publicationId]);
      await this.auditWith(client, input.clientId, 'social_post', id, 'social_post.scheduled', actorId, { publicationId, jobId: (queued.job as any).id, desiredScheduledAt: input.desiredScheduledAt });
      return { socialPost: socialPostFromRow(updated.rows[0]), ...queued, replayed: false };
    }, this.pool);
  }

  /**
   * An approved draft can be scheduled; so can a scheduled one whose publication was cancelled or
   * failed (re-queued into the next occurrence slot). A failed publication is closed as cancelled
   * first, so the occurrence chain only keeps cancelled rows behind the new one.
   */
  private async assertSchedulable(client: PoolClient, clientId: string, post: any, actorId: string) {
    if (post.status === 'approved') return;
    if (post.status === 'scheduled' && post.publication_id) {
      const current = await client.query('SELECT id,status FROM editorial.publications WHERE client_id=$1 AND id=$2 FOR UPDATE', [clientId, post.publication_id]);
      const publication = current.rows[0] as any;
      if (!publication || publication.status === 'cancelled') return;
      if (publication.status === 'failed') {
        assertPublicationTransition('failed', 'cancelled');
        await client.query(`UPDATE editorial.publications SET status='cancelled',version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2`, [clientId, publication.id]);
        await this.auditWith(client, clientId, 'publication', publication.id, 'publication.superseded', actorId, { previousStatus: 'failed', socialPostId: post.id });
        return;
      }
    }
    throw new ContentApiError(409, 'INVALID_TRANSITION', 'Solo se pueden programar posts aprobados o con la publicación cancelada o fallida');
  }

  /** The approved system content every publication of an RRSS idea points at, created on the first schedule. */
  private async ensureRrssContent(client: PoolClient, clientId: string, plan: any, post: any, actorId: string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`rrss-content:${clientId}:${plan.id}`]);
    const current = await client.query('SELECT * FROM editorial.contents WHERE client_id=$1 AND plan_item_id=$2 FOR UPDATE', [clientId, plan.id]);
    const existing = current.rows[0] as any;
    if (existing) {
      if (existing.status !== 'approved' || !existing.approved_revision_id) throw new ContentApiError(409, 'REVISION_NOT_APPROVED', 'El contenido de la idea no tiene una revisión aprobada');
      return existing;
    }
    const contentId = randomUUID();
    const revisionId = randomUUID();
    const bodyText = typeof plan.rationale === 'string' && plan.rationale.trim() ? plan.rationale : post.copy;
    const seo = { source: 'rrss' };
    await client.query(
      `INSERT INTO editorial.contents (id,client_id,plan_item_id,title,body_text,seo,status,current_revision) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'approved',1)`,
      [contentId, clientId, plan.id, plan.title, bodyText, json(seo)],
    );
    await client.query(
      `INSERT INTO editorial.content_revisions (id,client_id,content_id,revision_number,content_snapshot,source_references,author_type,author_id) VALUES ($1,$2,$3,1,$4::jsonb,'[]'::jsonb,'system',NULL)`,
      [revisionId, clientId, contentId, json({ title: plan.title, bodyText, seo })],
    );
    const approved = await client.query(`UPDATE editorial.contents SET approved_revision_id=$3,version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2 RETURNING *`, [clientId, contentId, revisionId]);
    await this.auditWith(client, clientId, 'content', contentId, 'content.created_for_rrss', actorId, { planItemId: plan.id, revisionId });
    return approved.rows[0] as any;
  }

  private isPublicationJob(kind: string) { return ['publish', 'reschedule', 'cancel', 'reconcile'].includes(kind); }

  /**
   * Server-side double-submit guard: UI idempotency keys include a timestamp, so two clicks would
   * otherwise queue two jobs. Active = pending, leased, or failed/expired but still auto-retried by claimJob.
   */
  private async refuseActiveDuplicate(client: PoolClient, input: any) {
    const planKind = PLAN_JOB_KINDS.includes(input.kind);
    if (!planKind && !input.targetId) return;
    const active = await client.query(
      `SELECT id AS active_job FROM editorial.jobs WHERE client_id=$1 AND kind=$2 AND ($3::uuid IS NULL OR target_id=$3::uuid)
        AND (status='pending' OR (status='running' AND (locked_until>now() OR ($4::boolean AND attempt_count<8))) OR (status='failed' AND $4::boolean AND attempt_count<8)) LIMIT 1`,
      [input.clientId, input.kind, planKind ? null : input.targetId, AUTO_RETRY_KINDS.includes(input.kind)],
    );
    if (active.rows[0]) throw new ContentApiError(409, 'JOB_IN_PROGRESS', 'Ya hay un trabajo igual en curso');
  }

  /**
   * A plan always has a durable calendar before it leaves the API.  This also
   * keeps older callers (which only sent clientId) compatible with the v1
   * workflow contract.
   */
  private async prepareJobTarget(client: PoolClient, input: any, actorId: string | null) {
    if (!PLAN_JOB_KINDS.includes(input.kind)) return;
    const calendarKind: CalendarKind = input.kind === 'generate_rrss_plan' ? 'rrss' : 'blog';
    // An RRSS plan payload is built only from the database; the blog plan keeps its calendar hints from the UI.
    const supplied = calendarKind === 'blog' ? (input.payload?.calendar ?? input.payload?.editorialCalendar ?? {}) : {};
    const suppliedStart = dateOnly(supplied.startDate ?? supplied.start_date);
    let config: any;
    const editorialConfig = async () => {
      if (config === undefined) {
        const settings = await client.query('SELECT editorial_config FROM editorial.client_settings WHERE client_id=$1', [input.clientId]);
        config = (settings.rows[0] as any)?.editorial_config ?? {};
      }
      return config;
    };
    let periodStart: string;
    if (input.targetId) {
      const calendar = await client.query('SELECT id,start_date,kind FROM editorial.calendars WHERE client_id=$1 AND id=$2 FOR SHARE', [input.clientId, input.targetId]);
      const row = calendar.rows[0] as any;
      if (!row) throw new ContentApiError(404, 'NOT_FOUND', 'Calendario editorial no encontrado');
      if ((row.kind ?? 'blog') !== calendarKind) throw new ContentApiError(409, 'INVALID_TARGET', calendarKind === 'rrss' ? 'El calendario no es un plan de redes sociales' : 'El calendario no pertenece al blog');
      periodStart = suppliedStart ?? dateOnly(row.start_date) ?? nextMonday();
    } else {
      // The plan workflow dates each proposal from periodStart (week N, weekday), so a new calendar always has one.
      const stored = await editorialConfig();
      let weeks: number;
      if (calendarKind === 'rrss') weeks = storedRrssPlanInputs(stored.rrss).weeksHorizon;
      else {
        const horizon = Number(stored.weeksHorizon ?? stored.weeks_horizon);
        weeks = Number.isInteger(horizon) && horizon > 0 ? Math.min(horizon, 52) : 4;
      }
      periodStart = suppliedStart ?? nextMonday();
      input.targetId = randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      await client.query(
        `INSERT INTO editorial.calendars (id,client_id,title,start_date,end_date,status,summary,insights,created_by,kind)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [input.targetId, input.clientId, calendarKind === 'rrss' ? `Plan de redes ${today}` : (supplied.title ?? `Calendario editorial ${today}`),
          periodStart, dateOnly(supplied.endDate ?? supplied.end_date) ?? addDays(periodStart, weeks * 7 - 1),
          supplied.status ?? 'draft', supplied.summary ?? null, json(supplied.insights ?? {}), actorId, calendarKind],
      );
      await this.auditWith(client, input.clientId, 'calendar', input.targetId, 'calendar.created_for_generation', actorId, { jobKind: input.kind });
    }
    if (calendarKind === 'rrss') {
      input.payload = {
        schemaVersion: 1, periodStart, calendarId: input.targetId, calendar_id: input.targetId,
        calendar: { id: input.targetId, calendarId: input.targetId, calendar_id: input.targetId },
        rrss: storedRrssPlanInputs((await editorialConfig()).rrss),
      };
      return;
    }
    input.payload = {
      ...(input.payload ?? {}), schemaVersion: 1, periodStart, calendarId: input.targetId, calendar_id: input.targetId,
      calendar: { ...supplied, id: input.targetId, calendarId: input.targetId, calendar_id: input.targetId },
    };
  }

  /** The workflow receives a snapshot from the database, never untrusted UI input. */
  private publicationPayload(publication: any, account: any) {
    const media = Array.isArray(publication.media) ? publication.media : [];
    return {
      schemaVersion: 1,
      publication: {
        id: publication.id, publicationId: publication.id, publication_id: publication.id,
        contentId: publication.content_id, content_id: publication.content_id,
        contentRevisionId: publication.content_revision_id, content_revision_id: publication.content_revision_id,
        accountId: publication.account_id, account_id: publication.account_id,
        desiredScheduledAt: publication.desired_scheduled_at, desired_scheduled_at: publication.desired_scheduled_at,
        confirmedScheduledAt: publication.confirmed_scheduled_at, confirmed_scheduled_at: publication.confirmed_scheduled_at,
        copy: publication.copy ?? null, media,
        postizPostId: publication.postiz_post_id ?? null, postiz_post_id: publication.postiz_post_id ?? null,
        providerPostId: publication.provider_post_id ?? null, provider_post_id: publication.provider_post_id ?? null,
        externalUrl: publication.external_url ?? null, external_url: publication.external_url ?? null,
        provider: account.provider, platform: account.platform ?? null, instanceKey: account.instance_key ?? null,
        instance_key: account.instance_key ?? null, externalAccountId: account.external_account_id ?? null,
        external_account_id: account.external_account_id ?? null,
      },
    };
  }

  private async publicationPayloadForJob(client: PoolClient, clientId: string, publicationId: string) {
    const result = await client.query(
      `SELECT p.*,a.provider,a.platform,a.instance_key,a.external_account_id
       FROM editorial.publications p JOIN editorial.publishing_accounts a ON a.client_id=p.client_id AND a.id=p.account_id
       WHERE p.client_id=$1 AND p.id=$2 FOR SHARE`, [clientId, publicationId],
    );
    if (!result.rows[0]) throw new ContentApiError(404, 'NOT_FOUND', 'Publicación no encontrada');
    return this.publicationPayload(result.rows[0], result.rows[0]);
  }

  /** Full brief for generate.v1.json, read from the database so the writer never depends on (or trusts) the browser. */
  private planItemPayload(row: any) {
    return {
      schemaVersion: 1,
      planItem: {
        id: row.id, calendarId: row.calendar_id, title: row.title, theme: row.theme ?? null, rationale: row.rationale ?? null, format: row.format ?? null,
        keywordPrimary: row.keyword_primary ?? null, keywords: Array.isArray(row.keywords) ? row.keywords : [], entities: Array.isArray(row.entities) ? row.entities : [],
        cta: row.cta ?? null, priority: row.priority ?? null, plannedAt: row.planned_at ?? null, version: row.version,
      },
    };
  }

  private async planItemPayloadForJob(client: PoolClient, clientId: string, planItemId: string) {
    const result = await client.query('SELECT * FROM editorial.plan_items WHERE client_id=$1 AND id=$2', [clientId, planItemId]);
    if (!result.rows[0]) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
    return this.planItemPayload(result.rows[0]);
  }

  /** Active Postiz accounts of the client among `accountIds`, in the requested order; unknown or inactive ids are left out. */
  private async rrssAccounts(client: PoolClient, clientId: string, accountIds: string[]) {
    const result = await client.query(
      `SELECT id,instance_key,external_account_id,label FROM editorial.publishing_accounts WHERE client_id=$1 AND id::text=ANY($2::text[]) AND active=TRUE AND provider='postiz' FOR SHARE`,
      [clientId, accountIds],
    );
    const byId = new Map((result.rows as any[]).map((row) => [String(row.id), row]));
    return accountIds.map((id) => byId.get(id)).filter(Boolean) as any[];
  }

  /** generate_rrss brief: the idea (with its target networks) and the selected accounts, each with the network its copy must fit. */
  private rrssPayload(row: any, accounts: any[], accountIds: string[], generateImage: boolean) {
    return {
      schemaVersion: 1,
      planItem: { ...this.planItemPayload(row).planItem, networks: Array.isArray(row.networks) ? row.networks : [] },
      accountIds,
      accounts: accounts.map((account) => ({ id: account.id, instanceKey: account.instance_key, network: networkFromInstanceKey(account.instance_key), label: account.label, externalAccountId: account.external_account_id ?? null })),
      generateImage,
    };
  }

  private async rrssPayloadForJob(client: PoolClient, clientId: string, planItemId: string, accountIds: string[], generateImage: boolean) {
    const result = await client.query('SELECT * FROM editorial.plan_items WHERE client_id=$1 AND id=$2', [clientId, planItemId]);
    if (!result.rows[0]) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
    return this.rrssPayload(result.rows[0], await this.rrssAccounts(client, clientId, accountIds), accountIds, generateImage);
  }

  private async validateJobTarget(client: PoolClient, input: any) {
    if (input.kind === 'generate_rrss') {
      if (!input.targetId || !input.expectedVersion) throw new ContentApiError(400, 'TARGET_VERSION_REQUIRED', 'generate_rrss requiere targetId y expectedVersion');
      const accountIds = requireAccountIds(input.payload?.accountIds);
      // accountIds and generateImage are the only client-controlled fields of the generate_rrss payload.
      const generateImage = requireGenerateImage(input.payload?.generateImage);
      const result = await client.query(
        `SELECT p.*,c.kind calendar_kind FROM editorial.plan_items p JOIN editorial.calendars c ON c.client_id=p.client_id AND c.id=p.calendar_id
         WHERE p.client_id=$1 AND p.id=$2 FOR UPDATE OF p`, [input.clientId, input.targetId],
      );
      const item = result.rows[0] as any;
      if (!item) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
      if (item.calendar_kind !== 'rrss') throw new ContentApiError(409, 'INVALID_TARGET', 'Solo se pueden generar posts para ideas de redes sociales');
      if (item.version !== input.expectedVersion) throw new ContentApiError(409, 'STALE_VERSION', 'La idea fue modificada antes de solicitar la generación');
      if (item.status === 'generating') throw new ContentApiError(409, 'GENERATION_RELEASE_REQUIRED', 'La generación anterior sigue sin confirmar; usa «Marcar como fallida» antes de generar otros posts');
      assertPlanTransition(item.status, 'generating');
      const accounts = await this.rrssAccounts(client, input.clientId, accountIds);
      if (accounts.length !== accountIds.length) throw new ContentApiError(409, 'ACCOUNT_NOT_AVAILABLE', 'Alguna cuenta no pertenece al cliente, está desactivada o no es una cuenta de redes sociales (Postiz)');
      await client.query(`UPDATE editorial.plan_items SET status='generating',version=version+1,updated_at=now() WHERE id=$1`, [input.targetId]);
      input.payload = this.rrssPayload(item, accounts, accountIds, generateImage);
      return;
    }
    if (input.kind === 'generate_content') {
      if (!input.targetId || !input.expectedVersion) throw new ContentApiError(400, 'TARGET_VERSION_REQUIRED', 'generate_content requiere targetId y expectedVersion');
      const result = await client.query('SELECT * FROM editorial.plan_items WHERE client_id=$1 AND id=$2 FOR UPDATE', [input.clientId, input.targetId]);
      const item = result.rows[0] as any;
      if (!item) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
      const calendar = await client.query('SELECT kind FROM editorial.calendars WHERE client_id=$1 AND id=$2', [input.clientId, item.calendar_id]);
      if ((calendar.rows[0] as any)?.kind === 'rrss') throw new ContentApiError(409, 'INVALID_TARGET', 'Las ideas de redes sociales se generan como posts, no como artículos');
      if (item.version !== input.expectedVersion) throw new ContentApiError(409, 'STALE_VERSION', 'La propuesta fue modificada antes de solicitar la generación');
      if (item.status === 'generating') throw new ContentApiError(409, 'GENERATION_RELEASE_REQUIRED', 'La generación anterior sigue sin confirmar; revisa WordPress y usa «Marcar como fallida» antes de generar otro borrador');
      assertPlanTransition(item.status, 'generating');
      await client.query(`UPDATE editorial.plan_items SET status='generating',version=version+1,updated_at=now() WHERE id=$1`, [input.targetId]);
      return;
    }
    if (this.isPublicationJob(input.kind)) {
      if (!input.targetId || (input.kind !== 'reconcile' && !input.expectedVersion)) throw new ContentApiError(400, 'TARGET_VERSION_REQUIRED', `${input.kind} requiere targetId${input.kind === 'reconcile' ? '' : ' y expectedVersion'}`);
      const result = await client.query(
        `SELECT p.*,c.status content_status,c.approved_revision_id FROM editorial.publications p
         JOIN editorial.contents c ON c.client_id=p.client_id AND c.id=p.content_id
         WHERE p.client_id=$1 AND p.id=$2 FOR UPDATE OF p`, [input.clientId,input.targetId],
      );
      const publication = result.rows[0] as any;
      if (!publication) throw new ContentApiError(404,'NOT_FOUND','Publicación no encontrada');
      if (input.expectedVersion && publication.version !== input.expectedVersion) throw new ContentApiError(409,'STALE_VERSION','La publicación fue modificada antes de solicitar la operación');
      if (input.kind === 'publish' && (publication.content_status !== 'approved' || !publication.approved_revision_id || publication.content_revision_id !== publication.approved_revision_id)) {
        throw new ContentApiError(409,'REVISION_NOT_APPROVED','La publicación no referencia la revisión aprobada');
      }
      if (input.kind === 'publish' && publication.status === 'unknown') throw new ContentApiError(409,'RECONCILIATION_REQUIRED','La publicación debe reconciliarse antes de reenviarse');
      if (input.kind === 'reconcile') return;
      if (input.kind === 'reschedule') {
        const desired = input.payload?.desiredScheduledAt ?? input.payload?.desired_scheduled_at;
        if (desired) {
          if (Number.isNaN(Date.parse(desired))) throw new ContentApiError(400, 'INVALID_PAYLOAD', 'desiredScheduledAt debe ser ISO-8601');
          await client.query('UPDATE editorial.publications SET desired_scheduled_at=$3,version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2', [input.clientId, input.targetId, desired]);
        }
      }
      const reservedStatus = input.kind === 'cancel' ? 'cancel_requested' : 'sending';
      assertPublicationTransition(publication.status, reservedStatus);
      await client.query('UPDATE editorial.publications SET status=$2,version=version+1,updated_at=now() WHERE id=$1',[input.targetId,reservedStatus]);
    }
  }

  async getJob(id:string){ const result=await this.pool.query(`SELECT id,client_id,kind,target_id,status,attempt_count,next_attempt_at,locked_until,execution_id,last_error,created_at,updated_at,completed_at
    FROM editorial.jobs WHERE id=$1`,[id]); return result.rows[0]??null; }

  async listJobs(filters: { clientId?: string; clientIds?: string[]; status?: string; cursor?: { at: string; id: string } | null; limit: number }) {
    const values: unknown[] = [];
    const where: string[] = [];
    if (filters.clientId) { values.push(filters.clientId); where.push(`client_id=$${values.length}`); }
    else if (Array.isArray(filters.clientIds)) { values.push(filters.clientIds); where.push(`client_id=ANY($${values.length})`); }
    if (filters.status) { values.push(filters.status); where.push(`status=$${values.length}`); }
    if (filters.cursor) {
      values.push(filters.cursor.at, filters.cursor.id);
      where.push(`(created_at,id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    values.push(filters.limit + 1);
    const result = await this.pool.query(`SELECT id,client_id,kind,target_id,status,attempt_count,next_attempt_at,locked_until,execution_id,last_error,created_at,updated_at,completed_at
      FROM editorial.jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC,id DESC LIMIT $${values.length}`, values);
    const items = result.rows.slice(0, filters.limit);
    const last = items.at(-1) as any;
    return { items, nextCursor: result.rows.length > filters.limit && last ? encodeCursor({ at: new Date(last.created_at).toISOString(), id: last.id }) : null };
  }

  async recoverPlanJob(id: string, actorId: string) {
    return withEditorialTransaction(async (client) => {
      const result = await client.query('SELECT * FROM editorial.jobs WHERE id=$1 FOR UPDATE', [id]);
      const job = result.rows[0] as any;
      if (!job) throw new ContentApiError(404, 'NOT_FOUND', 'Trabajo no encontrado');
      if (!PLAN_JOB_KINDS.includes(job.kind)) throw new ContentApiError(409, 'RECOVERY_REQUIRES_RECONCILIATION', 'Solo se puede reintentar aquí la generación de planes');
      const exhausted = Number(job.attempt_count) >= 8 && (job.status === 'failed' || (job.status === 'running' && job.locked_until && new Date(job.locked_until).getTime() <= Date.now()));
      if (!exhausted) throw new ContentApiError(409, 'JOB_NOT_EXHAUSTED', 'El trabajo aún no ha agotado los reintentos');
      await this.requireEnabledClient(client, job.client_id, job.kind);
      const updated = await client.query(`UPDATE editorial.jobs SET status='pending',attempt_count=0,next_attempt_at=now(),lease_token=NULL,locked_until=NULL,execution_id=NULL,last_error=NULL,completed_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`, [id]);
      await this.auditWith(client, job.client_id, 'job', id, 'job.recovered', actorId, { previousStatus: job.status, previousAttempts: job.attempt_count });
      return updated.rows[0];
    }, this.pool);
  }

  async claimJob(input:{kinds?:string[];clientId?:string;leaseSeconds:number;executionId:string},allowedClientIds:string[]){
    return withEditorialTransaction(async(client)=>{
      const values:unknown[]=[input.kinds?.length?input.kinds:null,allowedClientIds.includes('*')?null:allowedClientIds,input.clientId??null];
      const selected=await client.query(`SELECT j.* FROM editorial.jobs j JOIN editorial.client_settings settings ON settings.client_id=j.client_id AND settings.enabled=TRUE WHERE ((j.status IN ('pending','failed') AND j.next_attempt_at<=now()) OR (j.status='running' AND j.locked_until<=now())) AND j.attempt_count < 8
        AND (j.kind NOT IN ('publish','reschedule','cancel') OR j.attempt_count=0)
        AND ($1::text[] IS NULL OR j.kind=ANY($1)) AND ($2::text[] IS NULL OR j.client_id=ANY($2)) AND ($3::text IS NULL OR j.client_id=$3)
        ORDER BY j.next_attempt_at,j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`,values);
      if(!selected.rows[0]) return null;
      const selectedJob=selected.rows[0] as any;
      if(GENERATION_JOB_KINDS.includes(selectedJob.kind) && selectedJob.target_id){
        const plan=await client.query('SELECT status FROM editorial.plan_items WHERE client_id=$1 AND id=$2 FOR UPDATE',[selectedJob.client_id,selectedJob.target_id]);
        const currentStatus=(plan.rows[0] as any)?.status;
        if(currentStatus && currentStatus!=='generating'){
          assertPlanTransition(currentStatus,'generating');
          await client.query(`UPDATE editorial.plan_items SET status='generating',version=version+1,updated_at=now() WHERE id=$1`,[selectedJob.target_id]);
        }
      }
      if(['publish','reschedule','cancel'].includes(selectedJob.kind) && selectedJob.target_id){
        const publication=await client.query('SELECT status FROM editorial.publications WHERE client_id=$1 AND id=$2 FOR UPDATE',[selectedJob.client_id,selectedJob.target_id]);
        const currentStatus=(publication.rows[0] as any)?.status;
        const reservedStatus=selectedJob.kind==='cancel'?'cancel_requested':'sending';
        if(currentStatus && currentStatus!==reservedStatus){
          assertPublicationTransition(currentStatus,reservedStatus);
          await client.query('UPDATE editorial.publications SET status=$2,version=version+1,updated_at=now() WHERE id=$1',[selectedJob.target_id,reservedStatus]);
        }
      }
      // Jobs created before the contract was tightened may only contain an id.
      // Rebuild the payload on every claim so retries and manual reconciliations
      // use the current persisted publication/account rather than stale UI data.
      if(this.isPublicationJob(selectedJob.kind) && selectedJob.target_id) {
        const payload = await this.publicationPayloadForJob(client, selectedJob.client_id, selectedJob.target_id);
        selectedJob.payload = payload;
        await client.query('UPDATE editorial.jobs SET payload=$2::jsonb,updated_at=now() WHERE id=$1', [selectedJob.id, json(payload)]);
      }
      if(selectedJob.kind==='generate_content' && selectedJob.target_id) {
        const payload = await this.planItemPayloadForJob(client, selectedJob.client_id, selectedJob.target_id);
        selectedJob.payload = payload;
        await client.query('UPDATE editorial.jobs SET payload=$2::jsonb,updated_at=now() WHERE id=$1', [selectedJob.id, json(payload)]);
      }
      if(selectedJob.kind==='generate_rrss' && selectedJob.target_id) {
        const payload = await this.rrssPayloadForJob(client, selectedJob.client_id, selectedJob.target_id, storedAccountIds(selectedJob.payload), storedGenerateImage(selectedJob.payload));
        selectedJob.payload = payload;
        await client.query('UPDATE editorial.jobs SET payload=$2::jsonb,updated_at=now() WHERE id=$1', [selectedJob.id, json(payload)]);
      }
      const leaseToken=randomUUID();
      const result=await client.query(`UPDATE editorial.jobs SET status='running',attempt_count=attempt_count+1,lease_token=$2,locked_until=now()+make_interval(secs=>$3),execution_id=$4,updated_at=now() WHERE id=$1 RETURNING *`,[selectedJob.id,leaseToken,input.leaseSeconds,input.executionId]);
      return {...result.rows[0],leaseToken};
    },this.pool);
  }

  async heartbeatJob(id:string,clientId:string,leaseToken:string,seconds:number){
    const result=await this.pool.query(`UPDATE editorial.jobs SET locked_until=now()+make_interval(secs=>$4),updated_at=now() WHERE id=$1 AND client_id=$2 AND lease_token=$3::uuid AND status='running' AND locked_until>now() RETURNING *`,[id,clientId,leaseToken,seconds]);
    if(!result.rows[0]) throw new ContentApiError(409,'LEASE_LOST','La reserva caducó o pertenece a otra ejecución');
    return result.rows[0];
  }

  async finishJob(id:string,leaseToken:string,input:any,serviceId:string){
    return withEditorialTransaction(async(client)=>{
      const completionHash=requestHash(input);
      const locked=await client.query('SELECT * FROM editorial.jobs WHERE id=$1 FOR UPDATE',[id]);
      const job=locked.rows[0] as any;
      if(!job) throw new ContentApiError(404,'NOT_FOUND','Trabajo no encontrado');
      if(job.client_id!==input.clientId) throw new ContentApiError(403,'SERVICE_FORBIDDEN','El trabajo no pertenece al cliente autorizado');
      if(job.status==='succeeded' || job.status==='failed' || job.status==='unknown') {
        if(job.result_hash!==completionHash) throw new ContentApiError(409,'RESULT_CONFLICT','El trabajo ya terminó con un resultado diferente');
        return {job,replayed:true};
      }
      if(job.status!=='running' || job.lease_token!==leaseToken || new Date(job.locked_until).getTime()<=Date.now()) throw new ContentApiError(409,'LEASE_LOST','La reserva caducó o pertenece a otra ejecución');
      if(input.status==='succeeded' && PLAN_JOB_KINDS.includes(job.kind) && !Array.isArray(input.planItems)) throw new ContentApiError(400,'INVALID_RESULT',`${job.kind} requiere planItems`);
      if(input.status==='succeeded' && job.kind==='generate_rrss' && (!Array.isArray(input.socialPosts) || !input.socialPosts.length)) throw new ContentApiError(400,'INVALID_RESULT','generate_rrss requiere socialPosts');
      if(input.status==='succeeded' && job.kind==='generate_content' && !input.content) throw new ContentApiError(400,'INVALID_RESULT','generate_content requiere content');
      if(input.status==='succeeded' && ['publish','reschedule','cancel','reconcile'].includes(job.kind) && !input.publication) throw new ContentApiError(400,'INVALID_RESULT',`${job.kind} requiere publication`);
      if(input.planItems) await this.applyPlanResult(client,job,input.planItems);
      if(input.content) await this.applyContentResult(client,job,input.content,serviceId);
      if(input.publication) await this.applyPublicationResult(client,job,input.publication);
      const socialPosts=input.socialPosts && input.status==='succeeded' ? await this.applySocialPostsResult(client,job,input.socialPosts,serviceId) : null;
      const status=input.status==='succeeded'?'succeeded':input.status==='unknown'?'unknown':'failed';
      if(status==='failed' && GENERATION_JOB_KINDS.includes(job.kind)) {
        const plan=await client.query('SELECT status FROM editorial.plan_items WHERE client_id=$1 AND id=$2 FOR UPDATE',[job.client_id,job.target_id]);
        if((plan.rows[0] as any)?.status==='generating') await client.query(`UPDATE editorial.plan_items SET status='generation_failed',version=version+1,updated_at=now() WHERE id=$1`,[job.target_id]);
      }
      // A failed reconcile says nothing about the post itself (it is retried), so only publishing operations fall back.
      if(!input.publication && ['publish','reschedule','cancel'].includes(job.kind) && job.target_id) {
        const fallbackStatus=status==='unknown'?'unknown':status==='failed'?'failed':null;
        if(fallbackStatus) {
          const current=await client.query('SELECT status FROM editorial.publications WHERE client_id=$1 AND id=$2 FOR UPDATE',[job.client_id,job.target_id]);
          const publicationStatus=(current.rows[0] as any)?.status;
          if(publicationStatus) {
            assertPublicationTransition(publicationStatus,fallbackStatus);
            await client.query('UPDATE editorial.publications SET status=$3,error_message=$4,last_synced_at=now(),version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2',[job.client_id,job.target_id,fallbackStatus,sanitizeError(input.error)]);
          }
        }
      }
      const reported=input.result && typeof input.result==='object' && !Array.isArray(input.result) ? input.result : {};
      const safeResult=redactSecrets(socialPosts ? {...reported,socialPosts} : (input.result??{}));
      const safeError=sanitizeError(input.error);
      const result=await client.query(`UPDATE editorial.jobs SET status=$2,result=$3::jsonb,result_hash=$4,last_error=$5,lease_token=NULL,locked_until=NULL,
        next_attempt_at=CASE WHEN $2='failed' THEN now()+make_interval(secs=>LEAST(3600,(30*power(2,LEAST(attempt_count,7)))::int)) ELSE next_attempt_at END,
        completed_at=CASE WHEN $2 IN ('succeeded','unknown') THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 RETURNING *`,[id,status,json(safeResult),completionHash,safeError]);
      await this.auditWith(client,job.client_id,'job',id,`job.${status}`,null,{serviceId,result:safeResult,error:safeError});
      return {job:result.rows[0],replayed:false};
    },this.pool);
  }

  private async applyPlanResult(client:PoolClient,job:any,items:any[]){
    if(!PLAN_JOB_KINDS.includes(job.kind)) throw new ContentApiError(409,'RESULT_KIND_MISMATCH','El resultado de plan no corresponde al trabajo');
    // RRSS ideas carry their target networks and a social format; the whole plan is validated before any write.
    const networks=items.map((item,index)=>{
      if(job.kind!=='generate_rrss_plan') return [];
      if(item?.format!=null && !(RRSS_FORMATS as readonly string[]).includes(item.format)) throw new ContentApiError(400,'INVALID_RESULT',`planItems[${index}].format debe ser uno de: ${RRSS_FORMATS.join(', ')}`);
      return item?.networks==null ? [] : normalizeRrssNetworks(item.networks,`planItems[${index}].networks`,'INVALID_RESULT');
    });
    for(const [index,item] of items.entries()){
      if (!job.target_id) throw new ContentApiError(409, 'TARGET_MISSING', 'El trabajo de plan no tiene calendario');
      if (item.calendarId && item.calendarId !== job.target_id) throw new ContentApiError(409, 'CALENDAR_MISMATCH', 'El resultado no pertenece al calendario reservado');
      await client.query(`INSERT INTO editorial.plan_items (id,client_id,calendar_id,title,theme,rationale,format,keyword_primary,keywords,entities,cta,priority,planned_at,status,source_context,source_key,networks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,'proposed',$14::jsonb,$15,$16::jsonb)
       ON CONFLICT (client_id,calendar_id,source_key) DO UPDATE SET title=EXCLUDED.title,theme=EXCLUDED.theme,rationale=EXCLUDED.rationale,format=EXCLUDED.format,keyword_primary=EXCLUDED.keyword_primary,keywords=EXCLUDED.keywords,entities=EXCLUDED.entities,cta=EXCLUDED.cta,priority=EXCLUDED.priority,planned_at=EXCLUDED.planned_at,source_context=EXCLUDED.source_context,networks=EXCLUDED.networks,version=editorial.plan_items.version+1,updated_at=now()`,[item.id??randomUUID(),job.client_id,job.target_id,item.title,item.theme??null,item.rationale??null,item.format??null,item.keywordPrimary??null,json(item.keywords??[]),json(item.entities??[]),item.cta??null,item.priority??null,item.plannedAt??null,json(item.sourceContext),item.sourceKey,json(networks[index])]);
    }
  }

  private async applyContentResult(client:PoolClient,job:any,item:any,serviceId:string){
    if(job.kind!=='generate_content') throw new ContentApiError(409,'RESULT_KIND_MISMATCH','El resultado de contenido no corresponde al trabajo');
    const plan=await client.query('SELECT * FROM editorial.plan_items WHERE client_id=$1 AND id=$2 FOR UPDATE',[job.client_id,job.target_id]);
    if(!plan.rows[0]) throw new ContentApiError(409,'TARGET_MISSING','La propuesta ya no existe');
    const current=await client.query('SELECT * FROM editorial.contents WHERE client_id=$1 AND plan_item_id=$2 FOR UPDATE',[job.client_id,job.target_id]);
    const contentId=current.rows[0]?(current.rows[0] as any).id:(item.contentId??randomUUID());
    const revisionNumber=current.rows[0]?Number((current.rows[0] as any).current_revision)+1:1;
    const revisionId=randomUUID();
    const snapshot={title:item.title,bodyHtml:item.bodyHtml??null,bodyText:item.bodyText??null,excerpt:item.excerpt??null,seo:item.seo??{}};
    if(current.rows[0]) await client.query(`UPDATE editorial.contents SET title=$3,body_html=$4,body_text=$5,excerpt=$6,seo=$7::jsonb,status='review',current_revision=$8,approved_revision_id=NULL,version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2`,[job.client_id,contentId,item.title,item.bodyHtml??null,item.bodyText??null,item.excerpt??null,json(item.seo),revisionNumber]);
    else await client.query(`INSERT INTO editorial.contents(id,client_id,plan_item_id,title,body_html,body_text,excerpt,seo,status,current_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'review',1)`,[contentId,job.client_id,job.target_id,item.title,item.bodyHtml??null,item.bodyText??null,item.excerpt??null,json(item.seo)]);
    await client.query(`INSERT INTO editorial.content_revisions(id,client_id,content_id,revision_number,content_snapshot,prompt_version,source_references,author_type,author_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,'system',NULL)`,[revisionId,job.client_id,contentId,revisionNumber,json(snapshot),item.promptVersion??null,json(item.sourceReferences??[])]);
    assertPlanTransition((plan.rows[0] as any).status,'review');
    await client.query(`UPDATE editorial.plan_items SET status='review',version=version+1,updated_at=now() WHERE id=$1`,[job.target_id]);
    await this.auditWith(client,job.client_id,'content',contentId,'content.generated',null,{serviceId,revisionId,revisionNumber});
  }

  /**
   * One draft per selected account, upserted on (client, idea, account): regenerating overwrites a
   * draft in review/approved/discarded back to review, but never a post already scheduled.
   */
  private async applySocialPostsResult(client:PoolClient,job:any,posts:unknown,serviceId:string){
    if(job.kind!=='generate_rrss') throw new ContentApiError(409,'RESULT_KIND_MISMATCH','El resultado de posts no corresponde al trabajo');
    if(!Array.isArray(posts)) throw new ContentApiError(400,'INVALID_RESULT','socialPosts debe ser una lista');
    const selected=new Set(storedAccountIds(job.payload));
    const seen=new Set<string>();
    const drafts=posts.map((post:any,index)=>{
      if(!post || typeof post!=='object' || Array.isArray(post) || typeof post.accountId!=='string') throw new ContentApiError(400,'INVALID_RESULT',`socialPosts[${index}] requiere accountId`);
      if(seen.has(post.accountId)) throw new ContentApiError(400,'INVALID_RESULT',`socialPosts[${index}] repite la cuenta ${post.accountId}`);
      seen.add(post.accountId);
      const copy=requireSocialCopy(post.copy,`socialPosts[${index}].copy`,'INVALID_RESULT');
      const media=post.media==null ? [] : normalizeSocialMedia(post.media,`socialPosts[${index}].media`,'INVALID_RESULT');
      if(!selected.has(post.accountId)) throw new ContentApiError(409,'ACCOUNT_MISMATCH','El resultado incluye una cuenta que no se seleccionó para este trabajo');
      return {accountId:post.accountId as string,copy,media};
    });
    const plan=await client.query('SELECT * FROM editorial.plan_items WHERE client_id=$1 AND id=$2 FOR UPDATE',[job.client_id,job.target_id]);
    const planRow=plan.rows[0] as any;
    if(!planRow) throw new ContentApiError(409,'TARGET_MISSING','La idea ya no existe');
    const accounts=await client.query('SELECT id,instance_key FROM editorial.publishing_accounts WHERE client_id=$1 AND id::text=ANY($2::text[])',[job.client_id,drafts.map((draft)=>draft.accountId)]);
    const accountById=new Map((accounts.rows as any[]).map((row)=>[String(row.id),row]));
    const existing=await client.query('SELECT id,account_id,status FROM editorial.social_posts WHERE client_id=$1 AND plan_item_id=$2 FOR UPDATE',[job.client_id,job.target_id]);
    const scheduled=new Set((existing.rows as any[]).filter((row)=>row.status==='scheduled').map((row)=>String(row.account_id)));
    const upsertedAccountIds:string[]=[];
    const skippedScheduledAccountIds:string[]=[];
    for(const draft of drafts){
      if(scheduled.has(draft.accountId)){ skippedScheduledAccountIds.push(draft.accountId); continue; }
      const account=accountById.get(draft.accountId);
      if(!account) throw new ContentApiError(409,'ACCOUNT_NOT_AVAILABLE','Una cuenta del resultado ya no existe');
      await client.query(`INSERT INTO editorial.social_posts (id,client_id,plan_item_id,account_id,network,copy,media,status,generation_job_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'review',$8)
       ON CONFLICT (client_id,plan_item_id,account_id) DO UPDATE SET network=EXCLUDED.network,copy=EXCLUDED.copy,media=EXCLUDED.media,status='review',generation_job_id=EXCLUDED.generation_job_id,version=editorial.social_posts.version+1,updated_at=now()
       WHERE editorial.social_posts.status<>'scheduled'`,[randomUUID(),job.client_id,job.target_id,draft.accountId,networkFromInstanceKey(account.instance_key),draft.copy,json(draft.media),job.id]);
      upsertedAccountIds.push(draft.accountId);
    }
    assertPlanTransition(planRow.status,'review');
    await client.query(`UPDATE editorial.plan_items SET status='review',version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2`,[job.client_id,job.target_id]);
    await this.auditWith(client,job.client_id,'plan_item',job.target_id,'social_posts.generated',null,{serviceId,jobId:job.id,upsertedAccountIds,skippedScheduledAccountIds});
    return {upsertedAccountIds,skippedScheduledAccountIds};
  }

  private async applyPublicationResult(client:PoolClient,job:any,item:any){
    if(!['publish','reschedule','cancel','reconcile'].includes(job.kind)) throw new ContentApiError(409,'RESULT_KIND_MISMATCH','El resultado de publicación no corresponde al trabajo');
    const current=await client.query('SELECT * FROM editorial.publications WHERE client_id=$1 AND id=$2 FOR UPDATE',[job.client_id,job.target_id]);
    const row=current.rows[0] as any;
    if(!row) throw new ContentApiError(409,'TARGET_MISSING','La publicación ya no existe');
    assertPublicationTransition(row.status,item.status);
    await client.query(`UPDATE editorial.publications SET status=$3,confirmed_scheduled_at=COALESCE($4,confirmed_scheduled_at),postiz_post_id=COALESCE($5,postiz_post_id),provider_post_id=COALESCE($6,provider_post_id),external_url=COALESCE($7,external_url),published_at=COALESCE($8,published_at),last_synced_at=now(),error_code=$9,error_message=$10,version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2`,[job.client_id,job.target_id,item.status,item.confirmedScheduledAt??null,item.postizPostId??null,item.providerPostId??null,item.externalUrl??null,item.publishedAt??null,item.errorCode??null,item.errorMessage??null]);
  }

  async context(clientId:string){
    // Blog and RRSS ideas are separate pipelines: planItems keeps blog-calendar items only, rrssPlanItems the RRSS ones.
    const [settings,accounts,recent,plans,rrssPlans]=await Promise.all([
      this.pool.query(`SELECT client_id,timezone,language,editorial_config,workflow_bindings,enabled FROM editorial.client_settings WHERE client_id=$1`,[clientId]),
      this.pool.query(`SELECT id,provider,instance_key,external_account_id,platform,label,timezone,active FROM editorial.publishing_accounts WHERE client_id=$1 AND active=TRUE`,[clientId]),
      this.pool.query(`SELECT id,title,status,updated_at FROM editorial.contents WHERE client_id=$1 ORDER BY updated_at DESC LIMIT 100`,[clientId]),
      this.pool.query(`SELECT p.id,p.title,p.status,p.planned_at FROM editorial.plan_items p JOIN editorial.calendars c ON c.client_id=p.client_id AND c.id=p.calendar_id WHERE p.client_id=$1 AND c.kind='blog' ORDER BY p.planned_at DESC NULLS LAST LIMIT 200`,[clientId]),
      this.pool.query(`SELECT p.id,p.title,p.status,p.planned_at,p.format,p.networks FROM editorial.plan_items p JOIN editorial.calendars c ON c.client_id=p.client_id AND c.id=p.calendar_id WHERE p.client_id=$1 AND c.kind='rrss' ORDER BY p.planned_at DESC NULLS LAST LIMIT 200`,[clientId]),
    ]);
    return {settings:settings.rows[0]??null,accounts:accounts.rows,recentContents:recent.rows,planItems:plans.rows,rrssPlanItems:rrssPlans.rows};
  }

  async recordEvent(input:any,serviceId:string){
    return withEditorialTransaction(async(client)=>{
      const id=randomUUID();
      const inserted=await client.query(`INSERT INTO editorial.events(id,client_id,entity_type,entity_id,event_type,source_event_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (client_id,entity_type,source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING RETURNING *`,[id,input.clientId,input.entityType,input.entityId??null,input.eventType,input.sourceEventId??null,json(redactSecrets(input.payload)),input.occurredAt]);
      if(!inserted.rows[0] && input.sourceEventId){ const existing=await client.query('SELECT * FROM editorial.events WHERE client_id=$1 AND entity_type=$2 AND source_event_id=$3',[input.clientId,input.entityType,input.sourceEventId]); return {event:existing.rows[0],replayed:true}; }
      if(input.entityType==='publication' && input.entityId && input.publicationStatus){
        const publication=await client.query('SELECT * FROM editorial.publications WHERE client_id=$1 AND id=$2 FOR UPDATE',[input.clientId,input.entityId]);
        const row=publication.rows[0] as any;
        if(row && row.status!=='published'){ assertPublicationTransition(row.status,input.publicationStatus); await client.query(`UPDATE editorial.publications SET status=$3,last_synced_at=now(),version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2`,[input.clientId,input.entityId,input.publicationStatus]); }
      }
      return {event:inserted.rows[0],replayed:false};
    },this.pool);
  }

  async saveResearch(input:any){ const id=randomUUID(); const result=await this.pool.query(`INSERT INTO editorial.research_snapshots(id,client_id,source,period_start,period_end,fetched_at,payload,status) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,[id,input.clientId,input.source,input.periodStart??null,input.periodEnd??null,input.fetchedAt,json(redactSecrets(input.payload)),input.status??'complete']); return result.rows[0]; }

  private audit(clientId:string,entityType:string,entityId:string,eventType:string,actorId:string|null,payload:unknown){ return this.pool.query(`INSERT INTO editorial.events(id,client_id,entity_type,entity_id,event_type,payload,actor_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,now())`,[randomUUID(),clientId,entityType,entityId,eventType,json(redactSecrets(payload)),actorId]); }
  private auditWith(client:PoolClient,clientId:string,entityType:string,entityId:string,eventType:string,actorId:string|null,payload:unknown){ return client.query(`INSERT INTO editorial.events(id,client_id,entity_type,entity_id,event_type,payload,actor_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,now())`,[randomUUID(),clientId,entityType,entityId,eventType,json(redactSecrets(payload)),actorId]); }
}
