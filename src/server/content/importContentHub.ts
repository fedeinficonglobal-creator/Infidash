import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withEditorialTransaction } from './postgres.js';

type LegacyRow = Record<string, unknown>;

export interface ContentHubTables {
  clients: LegacyRow[];
  content_plan: LegacyRow[];
  articles: LegacyRow[];
  article_publications: LegacyRow[];
  publication_channels: LegacyRow[];
}

export interface ContentHubImportMappings {
  clients: Record<string, string>;
  accounts?: Record<string, string>;
}

export interface ImportConflict {
  entity: string;
  sourceId: string;
  reason: string;
}

export interface ContentHubImportReport {
  dryRun: boolean;
  schemaOnly: boolean;
  sourceCounts: Record<keyof ContentHubTables, number>;
  planned: { calendars: number; planItems: number; contents: number; publications: number };
  applied: number;
  skipped: number;
  conflicts: ImportConflict[];
  warnings: string[];
}

interface ImportOperation {
  entity: 'calendar' | 'plan_item' | 'content' | 'publication';
  sourceId: string;
  clientId: string;
  targetId: string;
  sourceHash: string;
  values: Record<string, unknown>;
}

const EMPTY_TABLES: ContentHubTables = {
  clients: [],
  content_plan: [],
  articles: [],
  article_publications: [],
  publication_channels: [],
};

function asRows(value: unknown) {
  return Array.isArray(value) ? value.filter((row): row is LegacyRow => Boolean(row) && typeof row === 'object') : [];
}

export function parseContentHubExport(input: unknown): { tables: ContentHubTables; schemaOnly: boolean } {
  if (Array.isArray(input) && input.length === 1 && typeof input[0]?.estructura === 'string') {
    JSON.parse(input[0].estructura);
    return { tables: { ...EMPTY_TABLES }, schemaOnly: true };
  }

  const root = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const source = root.tables && typeof root.tables === 'object' ? root.tables as Record<string, unknown> : root;
  const tables = Object.fromEntries(
    Object.keys(EMPTY_TABLES).map((name) => [name, asRows(source[name])]),
  ) as unknown as ContentHubTables;
  return { tables, schemaOnly: false };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function sourceHash(value: unknown) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function stableImportUuid(entity: string, sourceId: string, clientId: string) {
  const hex = createHash('sha256').update(`content-hub:${entity}:${clientId}:${sourceId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function text(value: unknown) {
  const normalized = value === null || value === undefined ? '' : String(value).trim();
  return normalized || null;
}

function list(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  const raw = text(value);
  return raw ? raw.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean) : [];
}

function legacyId(row: LegacyRow) {
  return text(row.id);
}

function planStatus(value: unknown) {
  switch ((text(value) ?? '').toLowerCase()) {
    case 'preparado':
    case 'approved': return 'approved';
    case 'generando':
    case 'generating': return 'generating';
    case 'listo':
    case 'ready': return 'ready';
    case 'archivado':
    case 'archived': return 'archived';
    case 'error': return 'generation_failed';
    case 'publicado': return 'review';
    default: return 'proposed';
  }
}

function contentStatus(value: unknown) {
  switch ((text(value) ?? '').toLowerCase()) {
    case 'approved':
    case 'aprobado': return 'approved';
    case 'review':
    case 'revision': return 'review';
    case 'archived':
    case 'archivado': return 'archived';
    default: return 'draft';
  }
}

function publicationStatus(value: unknown) {
  switch ((text(value) ?? '').toLowerCase()) {
    case 'pending':
    case 'pendiente': return 'pending';
    case 'failed':
    case 'error': return 'failed';
    case 'draft':
    case 'borrador': return 'draft';
    case 'cancelled':
    case 'cancelado': return 'cancelled';
    case 'published':
    case 'publicado': return 'unknown';
    default: return 'unknown';
  }
}

export function buildContentHubImportPlan(
  tables: ContentHubTables,
  mappings: ContentHubImportMappings,
): { operations: ImportOperation[]; conflicts: ImportConflict[]; warnings: string[] } {
  const operations: ImportOperation[] = [];
  const conflicts: ImportConflict[] = [];
  const warnings: string[] = [];
  const clientMap = mappings.clients ?? {};
  const calendarByLegacyClient = new Map<string, string>();
  const planTargetByLegacyId = new Map<string, string>();
  const contentTargetByLegacyId = new Map<string, string>();
  const articleById = new Map(tables.articles.map((row) => [legacyId(row), row]));

  const usedLegacyClients = new Set(
    [...tables.content_plan, ...tables.articles]
      .map((row) => text(row.client_id))
      .filter((id): id is string => Boolean(id)),
  );

  for (const sourceClientId of [...usedLegacyClients].sort()) {
    const clientId = clientMap[sourceClientId];
    if (!clientId) {
      conflicts.push({ entity: 'client', sourceId: sourceClientId, reason: 'Missing explicit Infidash client mapping' });
      continue;
    }
    const sourceId = `legacy-client:${sourceClientId}`;
    const targetId = stableImportUuid('calendar', sourceId, clientId);
    calendarByLegacyClient.set(sourceClientId, targetId);
    const source = { sourceClientId, title: `Importación Content Hub ${sourceClientId}` };
    operations.push({
      entity: 'calendar', sourceId, clientId, targetId, sourceHash: sourceHash(source),
      values: { title: source.title },
    });
  }

  for (const row of tables.content_plan) {
    const sourceId = legacyId(row);
    const sourceClientId = text(row.client_id);
    if (!sourceId || !sourceClientId) {
      conflicts.push({ entity: 'plan_item', sourceId: sourceId ?? '(missing)', reason: 'Missing id or client_id' });
      continue;
    }
    const clientId = clientMap[sourceClientId];
    const calendarId = calendarByLegacyClient.get(sourceClientId);
    if (!clientId || !calendarId) continue;
    const targetId = stableImportUuid('plan_item', sourceId, clientId);
    planTargetByLegacyId.set(sourceId, targetId);
    operations.push({
      entity: 'plan_item', sourceId, clientId, targetId, sourceHash: sourceHash(row),
      values: {
        calendarId,
        title: text(row.title) ?? `Contenido ${sourceId}`,
        theme: text(row.theme), rationale: text(row.rationale), format: text(row.format),
        keywords: list(row.keywords), entities: list(row.entities), cta: text(row.cta), priority: text(row.priority),
        status: planStatus(row.status), sourceContext: { legacy: row }, sourceKey: `content-hub:${sourceId}`,
      },
    });
  }

  for (const row of tables.articles) {
    const sourceId = legacyId(row);
    const sourceClientId = text(row.client_id);
    if (!sourceId || !sourceClientId) {
      conflicts.push({ entity: 'content', sourceId: sourceId ?? '(missing)', reason: 'Missing id or client_id' });
      continue;
    }
    const clientId = clientMap[sourceClientId];
    if (!clientId) continue;
    const targetId = stableImportUuid('content', sourceId, clientId);
    contentTargetByLegacyId.set(sourceId, targetId);
    const legacyPlanId = text(row.content_plan_id);
    operations.push({
      entity: 'content', sourceId, clientId, targetId, sourceHash: sourceHash(row),
      values: {
        planItemId: legacyPlanId ? planTargetByLegacyId.get(legacyPlanId) ?? null : null,
        title: text(row.title) ?? `Artículo ${sourceId}`,
        bodyHtml: text(row.content), excerpt: text(row.excerpt),
        seo: { keywordPrimary: text(row.keyword_principal), headingStructure: text(row.heading_structure), entitiesUsed: list(row.entities_used) },
        status: contentStatus(row.status),
      },
    });

    const wordpressPostId = text(row.wordpress_post_id);
    if (wordpressPostId) {
      const accountId = mappings.accounts?.[`${sourceClientId}:wordpress`];
      const publicationSourceId = `article:${sourceId}:wordpress`;
      if (!accountId) {
        conflicts.push({ entity: 'publication', sourceId: publicationSourceId, reason: `Missing account mapping ${sourceClientId}:wordpress` });
      } else {
        const wordpressSource = {
          wordpressPostId,
          wordpressUrl: text(row.wordpress_url),
          status: row.status,
          publishedAt: text(row.published_at),
        };
        operations.push({
          entity: 'publication', sourceId: publicationSourceId, clientId,
          targetId: stableImportUuid('publication', publicationSourceId, clientId), sourceHash: sourceHash(wordpressSource),
          values: {
            contentId: targetId, accountId, status: publicationStatus(row.status), externalUrl: wordpressSource.wordpressUrl,
            providerPostId: wordpressPostId, publishedAt: wordpressSource.publishedAt, errorMessage: null,
          },
        });
      }
    }
  }

  for (const row of tables.article_publications) {
    const sourceId = legacyId(row);
    const legacyArticleId = text(row.article_id);
    const channelId = text(row.channel_id);
    const article = legacyArticleId ? articleById.get(legacyArticleId) : null;
    const sourceClientId = article ? text(article.client_id) : null;
    if (!sourceId || !legacyArticleId || !channelId || !sourceClientId) {
      conflicts.push({ entity: 'publication', sourceId: sourceId ?? '(missing)', reason: 'Missing publication, article, channel or client relation' });
      continue;
    }
    const clientId = clientMap[sourceClientId];
    const contentId = contentTargetByLegacyId.get(legacyArticleId);
    const accountId = mappings.accounts?.[`${sourceClientId}:${channelId}`];
    if (!clientId || !contentId) continue;
    if (!accountId) {
      conflicts.push({ entity: 'publication', sourceId, reason: `Missing account mapping ${sourceClientId}:${channelId}` });
      continue;
    }
    operations.push({
      entity: 'publication', sourceId, clientId, targetId: stableImportUuid('publication', sourceId, clientId), sourceHash: sourceHash(row),
      values: {
        contentId, accountId, status: publicationStatus(row.status), externalUrl: text(row.external_url),
        providerPostId: text(row.external_id), publishedAt: text(row.published_at), errorMessage: text(row.error_message),
      },
    });
  }

  if (tables.clients.length && !Object.keys(clientMap).length) {
    warnings.push('Source clients were found, but no explicit client mapping was provided. Names are never matched automatically.');
  }
  return { operations, conflicts, warnings };
}

async function applyOperation(client: PoolClient, operation: ImportOperation) {
  const mapping = await client.query<{ target_id: string; source_hash: string }>(
    `SELECT target_id, source_hash FROM editorial.legacy_mappings
     WHERE source_system = 'content-hub' AND source_entity = $1 AND source_id = $2 AND client_id = $3`,
    [operation.entity, operation.sourceId, operation.clientId],
  );
  if (mapping.rowCount) {
    return mapping.rows[0].source_hash === operation.sourceHash ? 'skipped' as const : 'conflict' as const;
  }

  const value = operation.values;
  if (operation.entity === 'calendar') {
    await client.query(
      `INSERT INTO editorial.calendars (id, client_id, title, status, insights)
       VALUES ($1, $2, $3, 'archived', $4::jsonb) ON CONFLICT (id) DO NOTHING`,
      [operation.targetId, operation.clientId, value.title, JSON.stringify({ importedFrom: 'content-hub' })],
    );
  } else if (operation.entity === 'plan_item') {
    await client.query(
      `INSERT INTO editorial.plan_items
        (id, client_id, calendar_id, title, theme, rationale, format, keywords, entities, cta, priority, status, source_context, source_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb,$14)
       ON CONFLICT (id) DO NOTHING`,
      [operation.targetId, operation.clientId, value.calendarId, value.title, value.theme, value.rationale, value.format,
        JSON.stringify(value.keywords), JSON.stringify(value.entities), value.cta, value.priority, value.status,
        JSON.stringify(value.sourceContext), value.sourceKey],
    );
  } else if (operation.entity === 'content') {
    await client.query(
      `INSERT INTO editorial.contents (id, client_id, plan_item_id, title, body_html, excerpt, seo, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (id) DO NOTHING`,
      [operation.targetId, operation.clientId, value.planItemId, value.title, value.bodyHtml, value.excerpt,
        JSON.stringify(value.seo), value.status],
    );
  } else {
    await client.query(
      `INSERT INTO editorial.publications
        (id, client_id, content_id, account_id, status, external_url, provider_post_id, published_at, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [operation.targetId, operation.clientId, value.contentId, value.accountId, value.status, value.externalUrl,
        value.providerPostId, value.publishedAt, value.errorMessage],
    );
  }

  await client.query(
    `INSERT INTO editorial.legacy_mappings
      (source_system, source_entity, source_id, target_id, client_id, source_hash)
     VALUES ('content-hub', $1, $2, $3, $4, $5)`,
    [operation.entity, operation.sourceId, operation.targetId, operation.clientId, operation.sourceHash],
  );
  return 'applied' as const;
}

export async function importContentHub(input: {
  exportData: unknown;
  mappings: ContentHubImportMappings;
  dryRun?: boolean;
  pool?: Pool;
}): Promise<ContentHubImportReport> {
  const parsed = parseContentHubExport(input.exportData);
  const plan = buildContentHubImportPlan(parsed.tables, input.mappings);
  const report: ContentHubImportReport = {
    dryRun: input.dryRun !== false,
    schemaOnly: parsed.schemaOnly,
    sourceCounts: Object.fromEntries(Object.entries(parsed.tables).map(([name, rows]) => [name, rows.length])) as ContentHubImportReport['sourceCounts'],
    planned: {
      calendars: plan.operations.filter((item) => item.entity === 'calendar').length,
      planItems: plan.operations.filter((item) => item.entity === 'plan_item').length,
      contents: plan.operations.filter((item) => item.entity === 'content').length,
      publications: plan.operations.filter((item) => item.entity === 'publication').length,
    },
    applied: 0,
    skipped: 0,
    conflicts: [...plan.conflicts],
    warnings: [...plan.warnings],
  };

  if (parsed.schemaOnly) report.warnings.push('The supplied JSON contains only schema metadata; there are no rows to import.');
  if (report.dryRun || !plan.operations.length) return report;
  if (!input.pool) throw new Error('A PostgreSQL pool is required when dryRun is false');

  await withEditorialTransaction(async (client) => {
    for (const operation of plan.operations) {
      const outcome = await applyOperation(client, operation);
      if (outcome === 'applied') report.applied += 1;
      else if (outcome === 'skipped') report.skipped += 1;
      else report.conflicts.push({ entity: operation.entity, sourceId: operation.sourceId, reason: 'Source row changed after a previous import' });
    }
  }, input.pool);
  return report;
}
