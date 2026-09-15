import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getEditorialPool, withEditorialTransaction } from './postgres.js';
import type { ContentItem, ContentRevision, EditorialCalendar, PlanItem, PlanItemStatus } from './types.js';

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

function iso(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function calendarFromRow(row: Record<string, any>): EditorialCalendar {
  return {
    id: row.id,
    clientId: row.client_id,
    startDate: iso(row.start_date),
    endDate: iso(row.end_date),
    title: row.title,
    version: row.version,
    status: row.status,
    summary: row.summary,
    insights: row.insights ?? {},
    createdBy: row.created_by,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function planItemFromRow(row: Record<string, any>): PlanItem {
  return {
    id: row.id,
    clientId: row.client_id,
    calendarId: row.calendar_id,
    title: row.title,
    theme: row.theme,
    rationale: row.rationale,
    format: row.format,
    keywordPrimary: row.keyword_primary,
    keywords: row.keywords ?? [],
    entities: row.entities ?? [],
    cta: row.cta,
    priority: row.priority,
    plannedAt: iso(row.planned_at),
    status: row.status,
    sourceContext: row.source_context ?? {},
    sourceKey: row.source_key,
    version: row.version,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function contentFromRow(row: Record<string, any>): ContentItem {
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
    version: row.version,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function revisionFromRow(row: Record<string, any>): ContentRevision {
  return {
    id: row.id,
    clientId: row.client_id,
    contentId: row.content_id,
    revisionNumber: row.revision_number,
    contentSnapshot: row.content_snapshot,
    promptVersion: row.prompt_version,
    sourceReferences: row.source_references ?? [],
    authorType: row.author_type,
    authorId: row.author_id,
    createdAt: iso(row.created_at)!,
  };
}

export class ContentRepository {
  private readonly queryable: Queryable;
  private readonly pool: Pool | null;

  constructor(queryable?: Queryable, pool?: Pool) {
    const defaultPool = queryable ? null : getEditorialPool();
    this.queryable = queryable ?? defaultPool!;
    this.pool = pool ?? defaultPool;
  }

  async createCalendar(input: {
    id?: string;
    clientId: string;
    title: string;
    startDate?: string | null;
    endDate?: string | null;
    summary?: string | null;
    insights?: Record<string, unknown>;
    createdBy?: string | null;
  }) {
    const result = await this.queryable.query(
      `INSERT INTO editorial.calendars
        (id, client_id, title, start_date, end_date, summary, insights, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING *`,
      [input.id ?? randomUUID(), input.clientId, input.title, input.startDate ?? null, input.endDate ?? null,
        input.summary ?? null, JSON.stringify(input.insights ?? {}), input.createdBy ?? null],
    );
    return calendarFromRow(result.rows[0]);
  }

  async createPlanItem(input: {
    id?: string;
    clientId: string;
    calendarId: string;
    title: string;
    theme?: string | null;
    rationale?: string | null;
    format?: string | null;
    keywordPrimary?: string | null;
    keywords?: string[];
    entities?: string[];
    cta?: string | null;
    priority?: string | null;
    plannedAt?: string | null;
    status?: PlanItemStatus;
    sourceContext?: Record<string, unknown>;
    sourceKey?: string | null;
  }) {
    const result = await this.queryable.query(
      `INSERT INTO editorial.plan_items
        (id, client_id, calendar_id, title, theme, rationale, format, keyword_primary, keywords, entities,
         cta, priority, planned_at, status, source_context, source_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15::jsonb, $16)
       RETURNING *`,
      [input.id ?? randomUUID(), input.clientId, input.calendarId, input.title, input.theme ?? null,
        input.rationale ?? null, input.format ?? null, input.keywordPrimary ?? null,
        JSON.stringify(input.keywords ?? []), JSON.stringify(input.entities ?? []), input.cta ?? null,
        input.priority ?? null, input.plannedAt ?? null, input.status ?? 'proposed',
        JSON.stringify(input.sourceContext ?? {}), input.sourceKey ?? null],
    );
    return planItemFromRow(result.rows[0]);
  }

  async getPlanItem(clientId: string, id: string) {
    const result = await this.queryable.query(
      'SELECT * FROM editorial.plan_items WHERE client_id = $1 AND id = $2',
      [clientId, id],
    );
    return result.rows[0] ? planItemFromRow(result.rows[0]) : null;
  }

  async listPlanItems(input: { clientId: string; from?: string; to?: string; status?: PlanItemStatus; limit?: number }) {
    const values: unknown[] = [input.clientId];
    const conditions = ['client_id = $1'];
    if (input.from) {
      values.push(input.from);
      conditions.push(`planned_at >= $${values.length}`);
    }
    if (input.to) {
      values.push(input.to);
      conditions.push(`planned_at < $${values.length}`);
    }
    if (input.status) {
      values.push(input.status);
      conditions.push(`status = $${values.length}`);
    }
    values.push(Math.min(Math.max(input.limit ?? 100, 1), 500));
    const result = await this.queryable.query(
      `SELECT * FROM editorial.plan_items WHERE ${conditions.join(' AND ')}
       ORDER BY planned_at ASC NULLS LAST, created_at ASC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(planItemFromRow);
  }

  async createContentRevision(input: {
    contentId?: string;
    revisionId?: string;
    clientId: string;
    planItemId?: string | null;
    title: string;
    bodyHtml?: string | null;
    bodyText?: string | null;
    excerpt?: string | null;
    seo?: Record<string, unknown>;
    promptVersion?: string | null;
    sourceReferences?: unknown[];
    authorType: ContentRevision['authorType'];
    authorId?: string | null;
  }): Promise<{ content: ContentItem; revision: ContentRevision }> {
    const pool = this.pool;
    if (!pool) {
      throw new Error('createContentRevision requires the repository to be constructed with a Pool');
    }

    return withEditorialTransaction(async (client: PoolClient) => {
      const contentId = input.contentId ?? randomUUID();
      const locked = await client.query('SELECT * FROM editorial.contents WHERE client_id = $1 AND id = $2 FOR UPDATE', [input.clientId, contentId]);
      const revisionNumber = locked.rows[0] ? Number(locked.rows[0].current_revision) + 1 : 1;
      let contentResult;
      if (locked.rows[0]) {
        contentResult = await client.query(
          `UPDATE editorial.contents SET title = $3, body_html = $4, body_text = $5, excerpt = $6,
             seo = $7::jsonb, current_revision = $8, version = version + 1, updated_at = now()
           WHERE client_id = $1 AND id = $2 RETURNING *`,
          [input.clientId, contentId, input.title, input.bodyHtml ?? null, input.bodyText ?? null,
            input.excerpt ?? null, JSON.stringify(input.seo ?? {}), revisionNumber],
        );
      } else {
        contentResult = await client.query(
          `INSERT INTO editorial.contents
            (id, client_id, plan_item_id, title, body_html, body_text, excerpt, seo, current_revision)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING *`,
          [contentId, input.clientId, input.planItemId ?? null, input.title, input.bodyHtml ?? null,
            input.bodyText ?? null, input.excerpt ?? null, JSON.stringify(input.seo ?? {}), revisionNumber],
        );
      }

      const snapshot = {
        title: input.title,
        bodyHtml: input.bodyHtml ?? null,
        bodyText: input.bodyText ?? null,
        excerpt: input.excerpt ?? null,
        seo: input.seo ?? {},
      };
      const revisionResult = await client.query(
        `INSERT INTO editorial.content_revisions
          (id, client_id, content_id, revision_number, content_snapshot, prompt_version, source_references, author_type, author_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9) RETURNING *`,
        [input.revisionId ?? randomUUID(), input.clientId, contentId, revisionNumber, JSON.stringify(snapshot),
          input.promptVersion ?? null, JSON.stringify(input.sourceReferences ?? []), input.authorType, input.authorId ?? null],
      );

      return { content: contentFromRow(contentResult.rows[0]), revision: revisionFromRow(revisionResult.rows[0]) };
    }, pool);
  }
}
