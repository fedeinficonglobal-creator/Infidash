import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { getEditorialPool, withEditorialTransaction } from './postgres.js';
import { ContentApiError, encodeCursor, redactSecrets, requestHash, sanitizeError } from './contracts.js';
import { assertContentTransition, assertPlanTransition, assertPublicationTransition } from './transitions.js';
import type { ContentStatus, PlanItemStatus, PublicationStatus } from './types.js';

type Filters = { clientId?: string; from?: string; to?: string; status?: string; format?: string; search?: string; includeUndated?: boolean; cursor?: { at: string; id: string } | null; limit: number };

function page<T extends Record<string, any>>(rows: T[], limit: number, atField = 'created_at') {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeCursor({ at: new Date(last[atField]).toISOString(), id: last.id }) : null };
}

function json(value: unknown) { return JSON.stringify(value ?? {}); }

export class EditorialApiRepository {
  constructor(private readonly pool: Pool = getEditorialPool()) {}

  async summary(filters: { clientId?: string; from?: string; to?: string }) {
    const scoped = (clientColumn: string, dateColumn: string) => {
      const values: unknown[] = [];
      const where: string[] = [];
      if (filters.clientId) { values.push(filters.clientId); where.push(`${clientColumn} = $${values.length}`); }
      if (filters.from) { values.push(filters.from); where.push(`${dateColumn} >= $${values.length}`); }
      if (filters.to) { values.push(filters.to); where.push(`${dateColumn} < $${values.length}`); }
      return { values, sql: where.length ? ` WHERE ${where.join(' AND ')}` : '' };
    };
    const plansFilter = scoped('p.client_id', 'p.planned_at');
    const contentsFilter = scoped('ci.client_id', 'p.planned_at');
    const publicationsFilter = scoped('pub.client_id', 'pub.desired_scheduled_at');
    const incidentsFilter = scoped('j.client_id', 'j.created_at');
    const [plans, contents, publications, incidents] = await Promise.all([
      this.pool.query(`SELECT p.status, count(*)::int count FROM editorial.plan_items p${plansFilter.sql} GROUP BY p.status`, plansFilter.values),
      this.pool.query(`SELECT ci.status, count(*)::int count FROM editorial.contents ci LEFT JOIN editorial.plan_items p ON p.client_id=ci.client_id AND p.id=ci.plan_item_id${contentsFilter.sql} GROUP BY ci.status`, contentsFilter.values),
      this.pool.query(`SELECT pub.status, count(*)::int count FROM editorial.publications pub${publicationsFilter.sql} GROUP BY pub.status`, publicationsFilter.values),
      this.pool.query(`SELECT count(*)::int count FROM editorial.jobs j${incidentsFilter.sql}${incidentsFilter.sql ? ' AND' : ' WHERE'} j.status IN ('failed','unknown')`, incidentsFilter.values),
    ]);
    const counts = (rows: any[]) => Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    return { planItems: counts(plans.rows), contents: counts(contents.rows), publications: counts(publications.rows), incidents: Number(incidents.rows[0]?.count ?? 0) };
  }

  async calendar(filters: Filters) {
    const values: unknown[] = [];
    const where: string[] = [];
    if (filters.clientId) { values.push(filters.clientId); where.push(`p.client_id = $${values.length}`); }
    if (filters.from) { values.push(filters.from); where.push(`${filters.includeUndated ? '(p.planned_at IS NULL OR ' : ''}p.planned_at >= $${values.length}${filters.includeUndated ? ')' : ''}`); }
    if (filters.to) { values.push(filters.to); where.push(`${filters.includeUndated ? '(p.planned_at IS NULL OR ' : ''}p.planned_at < $${values.length}${filters.includeUndated ? ')' : ''}`); }
    if (filters.status) { values.push(filters.status); where.push(`p.status = $${values.length}`); }
    if (filters.format) { values.push(filters.format); where.push(`p.format = $${values.length}`); }
    if (filters.search) { values.push(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(p.title ILIKE $${values.length} ESCAPE '\\' OR COALESCE(p.theme,'') ILIKE $${values.length} ESCAPE '\\' OR COALESCE(p.keyword_primary,'') ILIKE $${values.length} ESCAPE '\\')`); }
    if (filters.cursor) { values.push(filters.cursor.at, filters.cursor.id); where.push(`(p.created_at, p.id) > ($${values.length - 1}, $${values.length}::uuid)`); }
    values.push(filters.limit + 1);
    const result = await this.pool.query(
      `SELECT p.*, c.title calendar_title,
        ci.id content_id, ci.status content_status, ci.title content_title, ci.version content_version,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pub.id, 'status', pub.status, 'desiredScheduledAt', pub.desired_scheduled_at, 'confirmedScheduledAt', pub.confirmed_scheduled_at))
          FROM editorial.contents content_for_publication JOIN editorial.publications pub ON pub.client_id = content_for_publication.client_id AND pub.content_id = content_for_publication.id
          WHERE content_for_publication.client_id = p.client_id AND content_for_publication.plan_item_id = p.id), '[]'::jsonb) publications
       FROM editorial.plan_items p JOIN editorial.calendars c ON c.client_id = p.client_id AND c.id = p.calendar_id
       LEFT JOIN LATERAL (SELECT id, status, title, version FROM editorial.contents WHERE client_id = p.client_id AND plan_item_id = p.id ORDER BY updated_at DESC LIMIT 1) ci ON true
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.created_at, p.id LIMIT $${values.length}`,
      values,
    );
    return page(result.rows as any[], filters.limit);
  }

  async listCalendars(clientId: string, limit: number, cursor?: { at: string; id: string } | null) {
    const values: unknown[] = [clientId];
    const cursorSql = cursor ? (values.push(cursor.at, cursor.id), `AND (created_at, id) > ($2, $3::uuid)`) : '';
    values.push(limit + 1);
    const result = await this.pool.query(`SELECT * FROM editorial.calendars WHERE client_id = $1 ${cursorSql} ORDER BY created_at, id LIMIT $${values.length}`, values);
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

  async createPlanItem(input: any, actorId: string | null) {
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
          planned_at=CASE WHEN $11::boolean THEN $12::timestamptz ELSE planned_at END, status=COALESCE($13,status), version=version+1, updated_at=now() WHERE id=$1 RETURNING *`,
        [id,input.title??null,input.theme??null,input.rationale??null,input.format??null,input.keywordPrimary??null,input.keywords===undefined?null:json(input.keywords),input.entities===undefined?null:json(input.entities),input.cta??null,input.priority??null,Object.hasOwn(input,'plannedAt'),input.plannedAt??null,input.status??null],
      );
      await this.auditWith(client,row.client_id,'plan_item',id,'plan_item.updated',actorId,input);
      return result.rows[0];
    }, this.pool);
  }

  async getContent(id: string) {
    const [content, revisions] = await Promise.all([
      this.pool.query('SELECT * FROM editorial.contents WHERE id=$1', [id]),
      this.pool.query('SELECT * FROM editorial.content_revisions WHERE content_id=$1 ORDER BY revision_number DESC LIMIT 50', [id]),
    ]);
    return content.rows[0] ? { ...content.rows[0], revisions: revisions.rows } : null;
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
      return { ...result.rows[0], revisionId };
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
      return result.rows[0];
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
       FROM editorial.publishing_accounts WHERE client_id=$1 AND active=TRUE ORDER BY label,id`, [clientId],
    );
    return result.rows;
  }

  async schedulePublication(input: any, actorId: string) {
    const occurrenceKey=input.occurrenceKey??'primary';
    const hash=requestHash({kind:'publish',contentId:input.contentId,accountId:input.accountId,desiredScheduledAt:input.desiredScheduledAt,occurrenceKey,copy:input.copy??null,media:input.media??[],expectedVersion:input.expectedVersion});
    return withEditorialTransaction(async(client)=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`job:${input.clientId}:${input.idempotencyKey}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`publication:${input.contentId}:${input.accountId}:${occurrenceKey}`]);
      await this.requireEnabledClient(client,input.clientId);
      const contentResult=await client.query('SELECT * FROM editorial.contents WHERE client_id=$1 AND id=$2 FOR UPDATE',[input.clientId,input.contentId]);
      const content=contentResult.rows[0] as any;
      if(!content) throw new ContentApiError(404,'NOT_FOUND','Contenido no encontrado');
      if(content.version!==input.expectedVersion) throw new ContentApiError(409,'STALE_VERSION','El contenido fue modificado antes de programarse');
      if(content.status!=='approved' || !content.approved_revision_id) throw new ContentApiError(409,'REVISION_NOT_APPROVED','El contenido debe tener una revisión aprobada');
      const accountResult=await client.query('SELECT * FROM editorial.publishing_accounts WHERE client_id=$1 AND id=$2 AND active=TRUE FOR SHARE',[input.clientId,input.accountId]);
      if(!accountResult.rows[0]) throw new ContentApiError(409,'ACCOUNT_NOT_AVAILABLE','La cuenta no pertenece al cliente o está desactivada');
      const existingJob=await client.query('SELECT * FROM editorial.jobs WHERE client_id=$1 AND idempotency_key=$2 FOR UPDATE',[input.clientId,input.idempotencyKey]);
      if(existingJob.rows[0]){
        const job=existingJob.rows[0] as any;
        if(job.request_hash!==hash) throw new ContentApiError(409,'IDEMPOTENCY_CONFLICT','La clave de idempotencia ya se usó con otra programación');
        const publication=await client.query(`SELECT p.*,a.provider,a.platform,a.label account_label FROM editorial.publications p JOIN editorial.publishing_accounts a ON a.client_id=p.client_id AND a.id=p.account_id WHERE p.client_id=$1 AND p.id=$2`,[input.clientId,job.target_id]);
        return {publication:publication.rows[0],job,replayed:true};
      }
      const duplicate=await client.query('SELECT id FROM editorial.publications WHERE content_id=$1 AND account_id=$2 AND occurrence_key=$3 FOR UPDATE',[input.contentId,input.accountId,occurrenceKey]);
      if(duplicate.rows[0]) throw new ContentApiError(409,'PUBLICATION_EXISTS','Ya existe una publicación para esa cuenta y ocurrencia');
      const publicationId=randomUUID();
      const publicationResult=await client.query(
        `INSERT INTO editorial.publications(id,client_id,content_id,account_id,occurrence_key,content_revision_id,copy,media,status,desired_scheduled_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'pending',$9) RETURNING *`,
        [publicationId,input.clientId,input.contentId,input.accountId,occurrenceKey,content.approved_revision_id,input.copy??null,json(input.media??[]),input.desiredScheduledAt],
      );
      const jobId=randomUUID();
      const jobResult=await client.query(
        `INSERT INTO editorial.jobs(id,client_id,kind,target_id,idempotency_key,request_hash,payload)
         VALUES($1,$2,'publish',$3,$4,$5,$6::jsonb) RETURNING *`,
        [jobId,input.clientId,publicationId,input.idempotencyKey,hash,json(this.publicationPayload(publicationResult.rows[0],accountResult.rows[0]))],
      );
      await this.auditWith(client,input.clientId,'publication',publicationId,'publication.queued',actorId,{accountId:input.accountId,desiredScheduledAt:input.desiredScheduledAt,jobId});
      const account=accountResult.rows[0] as any;
      return {publication:{...publicationResult.rows[0],provider:account.provider,platform:account.platform,account_label:account.label},job:jobResult.rows[0],replayed:false};
    },this.pool);
  }

  async createJob(input: any, actorId: string | null) {
    const hash = requestHash({ kind: input.kind, targetId: input.targetId ?? null, expectedVersion: input.expectedVersion ?? null, payload: input.payload ?? {} });
    return withEditorialTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`job:${input.clientId}:${input.idempotencyKey}`]);
      await this.requireEnabledClient(client,input.clientId);
      const existing = await client.query('SELECT * FROM editorial.jobs WHERE client_id=$1 AND idempotency_key=$2 FOR UPDATE',[input.clientId,input.idempotencyKey]);
      if (existing.rows[0]) {
        if ((existing.rows[0] as any).request_hash !== hash) throw new ContentApiError(409,'IDEMPOTENCY_CONFLICT','La clave de idempotencia ya se usó con otro payload');
        return { job: existing.rows[0], replayed: true };
      }
      await this.prepareJobTarget(client, input, actorId);
      await this.validateJobTarget(client, input);
      if (this.isPublicationJob(input.kind)) input.payload = await this.publicationPayloadForJob(client, input.clientId, input.targetId);
      const id=randomUUID();
      const result=await client.query(`INSERT INTO editorial.jobs (id,client_id,kind,target_id,idempotency_key,request_hash,payload) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,[id,input.clientId,input.kind,input.targetId??null,input.idempotencyKey,hash,json(redactSecrets(input.payload))]);
      await this.auditWith(client,input.clientId,'job',id,'job.created',actorId,{kind:input.kind,targetId:input.targetId??null});
      return { job: result.rows[0], replayed: false };
    },this.pool);
  }

  private async requireEnabledClient(client: PoolClient, clientId: string) {
    const result=await client.query('SELECT enabled FROM editorial.client_settings WHERE client_id=$1 FOR SHARE',[clientId]);
    if(!result.rows[0] || !(result.rows[0] as any).enabled) throw new ContentApiError(409,'EDITORIAL_DISABLED','La automatización editorial del cliente está desactivada');
  }

  private isPublicationJob(kind: string) { return ['publish', 'reschedule', 'cancel', 'reconcile'].includes(kind); }

  /**
   * A plan always has a durable calendar before it leaves the API.  This also
   * keeps older callers (which only sent clientId) compatible with the v1
   * workflow contract.
   */
  private async prepareJobTarget(client: PoolClient, input: any, actorId: string | null) {
    if (input.kind !== 'generate_plan') return;
    const supplied = input.payload?.calendar ?? input.payload?.editorialCalendar ?? {};
    if (input.targetId) {
      const calendar = await client.query('SELECT id FROM editorial.calendars WHERE client_id=$1 AND id=$2 FOR SHARE', [input.clientId, input.targetId]);
      if (!calendar.rows[0]) throw new ContentApiError(404, 'NOT_FOUND', 'Calendario editorial no encontrado');
    } else {
      input.targetId = randomUUID();
      await client.query(
        `INSERT INTO editorial.calendars (id,client_id,title,start_date,end_date,status,summary,insights,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [input.targetId, input.clientId, supplied.title ?? `Calendario editorial ${new Date().toISOString().slice(0, 10)}`,
          supplied.startDate ?? supplied.start_date ?? null, supplied.endDate ?? supplied.end_date ?? null,
          supplied.status ?? 'draft', supplied.summary ?? null, json(supplied.insights ?? {}), actorId],
      );
      await this.auditWith(client, input.clientId, 'calendar', input.targetId, 'calendar.created_for_generation', actorId, { jobKind: input.kind });
    }
    input.payload = {
      ...(input.payload ?? {}), schemaVersion: 1, calendarId: input.targetId, calendar_id: input.targetId,
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

  private async validateJobTarget(client: PoolClient, input: any) {
    if (input.kind === 'generate_content') {
      if (!input.targetId || !input.expectedVersion) throw new ContentApiError(400, 'TARGET_VERSION_REQUIRED', 'generate_content requiere targetId y expectedVersion');
      const result = await client.query('SELECT * FROM editorial.plan_items WHERE client_id=$1 AND id=$2 FOR UPDATE', [input.clientId, input.targetId]);
      const item = result.rows[0] as any;
      if (!item) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
      if (item.version !== input.expectedVersion) throw new ContentApiError(409, 'STALE_VERSION', 'La propuesta fue modificada antes de solicitar la generación');
      if (item.status === 'generating') throw new ContentApiError(409, 'RECONCILIATION_REQUIRED', 'La generación anterior sigue sin confirmar; reconcilia WordPress antes de crear otro borrador');
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

  async getJob(id:string){ const result=await this.pool.query('SELECT * FROM editorial.jobs WHERE id=$1',[id]); return result.rows[0]??null; }

  async claimJob(input:{kinds?:string[];clientId?:string;leaseSeconds:number;executionId:string},allowedClientIds:string[]){
    return withEditorialTransaction(async(client)=>{
      const values:unknown[]=[input.kinds?.length?input.kinds:null,allowedClientIds.includes('*')?null:allowedClientIds,input.clientId??null];
      const selected=await client.query(`SELECT j.* FROM editorial.jobs j JOIN editorial.client_settings settings ON settings.client_id=j.client_id AND settings.enabled=TRUE WHERE ((j.status IN ('pending','failed') AND j.next_attempt_at<=now()) OR (j.status='running' AND j.locked_until<=now())) AND j.attempt_count < 8
        AND ($1::text[] IS NULL OR j.kind=ANY($1)) AND ($2::text[] IS NULL OR j.client_id=ANY($2)) AND ($3::text IS NULL OR j.client_id=$3)
        ORDER BY j.next_attempt_at,j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`,values);
      if(!selected.rows[0]) return null;
      const selectedJob=selected.rows[0] as any;
      if(selectedJob.kind==='generate_content' && selectedJob.target_id){
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
      if(input.status==='succeeded' && job.kind==='generate_plan' && !Array.isArray(input.planItems)) throw new ContentApiError(400,'INVALID_RESULT','generate_plan requiere planItems');
      if(input.status==='succeeded' && job.kind==='generate_content' && !input.content) throw new ContentApiError(400,'INVALID_RESULT','generate_content requiere content');
      if(input.status==='succeeded' && ['publish','reschedule','cancel','reconcile'].includes(job.kind) && !input.publication) throw new ContentApiError(400,'INVALID_RESULT',`${job.kind} requiere publication`);
      if(input.planItems) await this.applyPlanResult(client,job,input.planItems);
      if(input.content) await this.applyContentResult(client,job,input.content,serviceId);
      if(input.publication) await this.applyPublicationResult(client,job,input.publication);
      const status=input.status==='succeeded'?'succeeded':input.status==='unknown'?'unknown':'failed';
      if(status==='failed' && job.kind==='generate_content') {
        const plan=await client.query('SELECT status FROM editorial.plan_items WHERE client_id=$1 AND id=$2 FOR UPDATE',[job.client_id,job.target_id]);
        if((plan.rows[0] as any)?.status==='generating') await client.query(`UPDATE editorial.plan_items SET status='generation_failed',version=version+1,updated_at=now() WHERE id=$1`,[job.target_id]);
      }
      if(!input.publication && ['publish','reschedule','cancel','reconcile'].includes(job.kind) && job.target_id) {
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
      const safeResult=redactSecrets(input.result??{});
      const safeError=sanitizeError(input.error);
      const result=await client.query(`UPDATE editorial.jobs SET status=$2,result=$3::jsonb,result_hash=$4,last_error=$5,lease_token=NULL,locked_until=NULL,
        next_attempt_at=CASE WHEN $2='failed' THEN now()+make_interval(secs=>LEAST(3600,(30*power(2,LEAST(attempt_count,7)))::int)) ELSE next_attempt_at END,
        completed_at=CASE WHEN $2 IN ('succeeded','unknown') THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 RETURNING *`,[id,status,json(safeResult),completionHash,safeError]);
      await this.auditWith(client,job.client_id,'job',id,`job.${status}`,null,{serviceId,result:safeResult,error:safeError});
      return {job:result.rows[0],replayed:false};
    },this.pool);
  }

  private async applyPlanResult(client:PoolClient,job:any,items:any[]){
    if(job.kind!=='generate_plan') throw new ContentApiError(409,'RESULT_KIND_MISMATCH','El resultado de plan no corresponde al trabajo');
    for(const item of items){
      if (!job.target_id) throw new ContentApiError(409, 'TARGET_MISSING', 'El trabajo de plan no tiene calendario');
      if (item.calendarId && item.calendarId !== job.target_id) throw new ContentApiError(409, 'CALENDAR_MISMATCH', 'El resultado no pertenece al calendario reservado');
      await client.query(`INSERT INTO editorial.plan_items (id,client_id,calendar_id,title,theme,rationale,format,keyword_primary,keywords,entities,cta,priority,planned_at,status,source_context,source_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,'proposed',$14::jsonb,$15)
       ON CONFLICT (client_id,calendar_id,source_key) DO UPDATE SET title=EXCLUDED.title,theme=EXCLUDED.theme,rationale=EXCLUDED.rationale,format=EXCLUDED.format,keyword_primary=EXCLUDED.keyword_primary,keywords=EXCLUDED.keywords,entities=EXCLUDED.entities,cta=EXCLUDED.cta,priority=EXCLUDED.priority,planned_at=EXCLUDED.planned_at,source_context=EXCLUDED.source_context,version=editorial.plan_items.version+1,updated_at=now()`,[item.id??randomUUID(),job.client_id,job.target_id,item.title,item.theme??null,item.rationale??null,item.format??null,item.keywordPrimary??null,json(item.keywords??[]),json(item.entities??[]),item.cta??null,item.priority??null,item.plannedAt??null,json(item.sourceContext),item.sourceKey]);
    }
  }

  private async applyContentResult(client:PoolClient,job:any,item:any,serviceId:string){
    if(job.kind!=='generate_content') throw new ContentApiError(409,'RESULT_KIND_MISMATCH','El resultado de contenido no corresponde al trabajo');
    const plan=await client.query('SELECT * FROM editorial.plan_items WHERE client_id=$1 AND id=$2 FOR UPDATE',[job.client_id,job.target_id]);
    if(!plan.rows[0]) throw new ContentApiError(409,'TARGET_MISSING','La propuesta ya no existe');
    const contentId=item.contentId??randomUUID();
    const current=await client.query('SELECT * FROM editorial.contents WHERE client_id=$1 AND id=$2 FOR UPDATE',[job.client_id,contentId]);
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

  private async applyPublicationResult(client:PoolClient,job:any,item:any){
    if(!['publish','reschedule','cancel','reconcile'].includes(job.kind)) throw new ContentApiError(409,'RESULT_KIND_MISMATCH','El resultado de publicación no corresponde al trabajo');
    const current=await client.query('SELECT * FROM editorial.publications WHERE client_id=$1 AND id=$2 FOR UPDATE',[job.client_id,job.target_id]);
    const row=current.rows[0] as any;
    if(!row) throw new ContentApiError(409,'TARGET_MISSING','La publicación ya no existe');
    assertPublicationTransition(row.status,item.status);
    await client.query(`UPDATE editorial.publications SET status=$3,confirmed_scheduled_at=COALESCE($4,confirmed_scheduled_at),postiz_post_id=COALESCE($5,postiz_post_id),provider_post_id=COALESCE($6,provider_post_id),external_url=COALESCE($7,external_url),published_at=COALESCE($8,published_at),last_synced_at=now(),error_code=$9,error_message=$10,version=version+1,updated_at=now() WHERE client_id=$1 AND id=$2`,[job.client_id,job.target_id,item.status,item.confirmedScheduledAt??null,item.postizPostId??null,item.providerPostId??null,item.externalUrl??null,item.publishedAt??null,item.errorCode??null,item.errorMessage??null]);
  }

  async context(clientId:string){
    const [settings,accounts,recent,plans]=await Promise.all([
      this.pool.query(`SELECT client_id,timezone,language,editorial_config,workflow_bindings,enabled FROM editorial.client_settings WHERE client_id=$1`,[clientId]),
      this.pool.query(`SELECT id,provider,instance_key,external_account_id,platform,label,timezone,active FROM editorial.publishing_accounts WHERE client_id=$1 AND active=TRUE`,[clientId]),
      this.pool.query(`SELECT id,title,status,updated_at FROM editorial.contents WHERE client_id=$1 ORDER BY updated_at DESC LIMIT 100`,[clientId]),
      this.pool.query(`SELECT id,title,status,planned_at FROM editorial.plan_items WHERE client_id=$1 ORDER BY planned_at DESC NULLS LAST LIMIT 200`,[clientId]),
    ]);
    return {settings:settings.rows[0]??null,accounts:accounts.rows,recentContents:recent.rows,planItems:plans.rows};
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
