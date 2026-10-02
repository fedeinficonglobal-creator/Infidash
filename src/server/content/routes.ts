import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { EditorialApiRepository } from './apiRepository.js';
import { getEditorialPool } from './postgres.js';
import { authenticateServiceToken, serviceCan, type ServicePrincipal } from './serviceAuth.js';
import { CALENDAR_STATUSES, CONTENT_STATUSES, ContentApiError, JOB_KINDS, PLAN_STATUSES, PUBLICATION_STATUSES, RRSS_FORMATS, assertEnum, decodeCursor, normalizeRrssNetworks, MAX_SOCIAL_MEDIA_ITEMS, normalizeSocialMedia, optionalString, parseLimit, redactSecrets, requireObject, requirePositiveVersion, requireSocialCopy, requireString, sanitizeError } from './contracts.js';
import { canAccessClient } from '../../lib/auth.js';
import { assertPublicHttpUrl } from '../../lib/urlSafety.js';
import { UserFacingError } from '../../lib/userFacingError.js';
import { createPostizUploader, postizConfigFromEnv } from './postizUpload.js';
import { MAX_CREATIVE_BYTES, spoolCreative } from './creativeUpload.js';
import { createUploadLimiter, maxConcurrentUploadsFromEnv } from './uploadLimiter.js';

type HumanSession = { user: { id: string; role: 'admin' | 'viewer'; clientIds: string[] | null } };
type Request = FastifyRequest<{ Body: any; Params: any; Querystring: any; Headers: any }>;

const queryOf = (request: Request) => request.query as Record<string, any>;
const paramsOf = (request: Request) => request.params as Record<string, any>;

export interface ContentRoutesOptions {
  repository?: EditorialApiRepository;
  resolveHumanSession: (token: string) => HumanSession | null | Promise<HumanSession | null>;
  authenticateService?: (token: string) => ServicePrincipal | null | Promise<ServicePrincipal | null>;
  /** Postiz upload wiring; env defaults to process.env (read per request) and fetchImpl to fetch. Injectable for tests. */
  postiz?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch };
  uploads?: { maxConcurrent?: number; tmpDir?: string };
}

function bearer(request: Request) {
  const value = request.headers.authorization;
  return typeof value === 'string' && /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, '').trim() : null;
}

function humanToken(request: Request) {
  const session = request.headers['x-session-token'];
  if (typeof session === 'string' && session.trim()) return session.trim();
  return bearer(request);
}

function optionalHttpUrl(value: unknown) {
  const raw = optionalString(value, 'externalUrl', 2048);
  if (!raw?.trim()) return raw;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
    // Syntactic SSRF check only (no DNS): the link is published, not fetched, by this server.
    assertPublicHttpUrl(url);
    return url.toString();
  } catch (error) {
    if (error instanceof UserFacingError) throw new ContentApiError(400, 'INVALID_PAYLOAD', `externalUrl no es válida: ${error.message}`);
    throw new ContentApiError(400, 'INVALID_PAYLOAD', 'externalUrl debe ser una URL HTTP o HTTPS válida');
  }
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof ContentApiError) return reply.code(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
  requestSafeLog(reply, 'content api failed', error);
  return reply.code(500).send({ error: 'No se pudo completar la operación', code: 'INTERNAL_ERROR' });
}

function requestSafeLog(reply: FastifyReply, label: string, error: unknown) {
  // reply.log carries the request id; the error is reduced to name + sanitized message (no stack, no payload).
  const payload = error instanceof Error ? { err: { type: error.name, message: sanitizeError(error.message) } } : { detail: redactSecrets(error) };
  reply.log.error(payload, label);
}

function asDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new ContentApiError(400, 'INVALID_DATE', `${field} no es una fecha válida`);
  return value;
}

function stringArray(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new ContentApiError(400, 'INVALID_PAYLOAD', `${field} debe ser una lista de texto`);
  return value;
}

function listFilters(query: Record<string, any>) {
  return { from: asDate(query.from, 'from'), to: asDate(query.to, 'to'), status: optionalString(query.status, 'status', 50) ?? undefined, format: optionalString(query.format, 'format', 100) ?? undefined, search: optionalString(query.search, 'search', 200) ?? undefined, includeUndated: query.includeUndated === 'true', cursor: decodeCursor(query.cursor), limit: parseLimit(query.limit) };
}

export async function contentRoutes(app: FastifyInstance, options: ContentRoutesOptions) {
  const repository = options.repository ?? new EditorialApiRepository();
  const serviceAuthenticator = options.authenticateService ?? ((token: string) => authenticateServiceToken(getEditorialPool(), token));
  // Scoped to this plugin: only the creative upload route consumes multipart bodies; JSON routes are unaffected.
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_CREATIVE_BYTES, files: 1, fields: 0, parts: 1 } });

  const uploadLimiter = createUploadLimiter(options.uploads?.maxConcurrent ?? maxConcurrentUploadsFromEnv());

  async function requireHuman(request: Request, role: 'viewer' | 'admin' = 'viewer') {
    const token = humanToken(request);
    if (!token) throw new ContentApiError(401, 'UNAUTHENTICATED', 'Sesión no autenticada');
    const session = await options.resolveHumanSession(token);
    if (!session) throw new ContentApiError(401, 'INVALID_SESSION', 'Sesión expirada o inválida');
    if (role === 'admin' && session.user.role !== 'admin') throw new ContentApiError(403, 'FORBIDDEN', 'No tienes permisos para realizar esta acción');
    return session;
  }

  function requireClientAccess(session: HumanSession, clientId: string) {
    if (!canAccessClient(session.user, clientId)) throw new ContentApiError(403, 'FORBIDDEN', 'No tienes acceso a este cliente');
  }

  async function requireService(request: Request, scope: string, clientId?: string | null) {
    const token = bearer(request);
    if (!token) throw new ContentApiError(401, 'SERVICE_UNAUTHENTICATED', 'Token de servicio obligatorio');
    const principal = await serviceAuthenticator(token);
    if (!principal) throw new ContentApiError(401, 'INVALID_SERVICE_TOKEN', 'Token de servicio inválido o caducado');
    if (!serviceCan(principal, scope, clientId)) throw new ContentApiError(403, 'SERVICE_FORBIDDEN', 'El token no permite esta operación o cliente');
    return principal;
  }

  const route = (handler: (request: Request, reply: FastifyReply) => Promise<unknown>) => async (request: Request, reply: FastifyReply) => {
    try { return await handler(request, reply); } catch (error) { return sendError(reply, error); }
  };

  app.get('/api/content/summary', route(async (request, reply) => {
    const session = await requireHuman(request);
    const query = queryOf(request);
    const clientId = optionalString(query.clientId, 'clientId', 200) ?? undefined;
    if (clientId) requireClientAccess(session, clientId);
    const clientIds = (clientId || session.user.role === 'admin') ? undefined : (session.user.clientIds ?? []);
    return reply.send({ summary: await repository.summary({ clientId, clientIds, from: asDate(query.from, 'from'), to: asDate(query.to, 'to') }) });
  }));

  app.get('/api/content/calendar', route(async (request, reply) => {
    const session = await requireHuman(request);
    const query = queryOf(request);
    const clientId = optionalString(query.clientId, 'clientId', 200) ?? undefined;
    if (clientId) requireClientAccess(session, clientId);
    const clientIds = (clientId || session.user.role === 'admin') ? undefined : (session.user.clientIds ?? []);
    const result = await repository.calendar({ clientId, clientIds, from: asDate(query.from, 'from'), to: asDate(query.to, 'to'), status: optionalString(query.status, 'status', 50) ?? undefined, format: optionalString(query.format, 'format', 100) ?? undefined, search: optionalString(query.search, 'search', 200) ?? undefined, includeUndated: query.includeUndated === 'true', cursor: decodeCursor(query.cursor), limit: parseLimit(query.limit) });
    return reply.send(result);
  }));

  app.get('/api/clients/:clientId/editorial-calendars', route(async (request, reply) => {
    const session = await requireHuman(request);
    const clientId = requireString(paramsOf(request).clientId, 'clientId', 200);
    requireClientAccess(session, clientId);
    return reply.send(await repository.listCalendars(clientId, parseLimit(queryOf(request).limit), decodeCursor(queryOf(request).cursor)));
  }));

  app.post('/api/clients/:clientId/editorial-calendars', route(async (request, reply) => {
    const session = await requireHuman(request, 'admin');
    const body = requireObject(request.body);
    const clientId = requireString(paramsOf(request).clientId, 'clientId', 200);
    const calendar = await repository.createCalendar({ clientId, title: requireString(body.title, 'title'), startDate: asDate(body.startDate, 'startDate'), endDate: asDate(body.endDate, 'endDate'), summary: optionalString(body.summary, 'summary'), status: body.status === undefined ? undefined : assertEnum(body.status, CALENDAR_STATUSES, 'status'), insights: body.insights }, session.user.id);
    return reply.code(201).send({ calendar });
  }));

  app.get('/api/content/plan-items', route(async (request, reply) => {
    const session=await requireHuman(request);
    const query=queryOf(request);
    const clientId=optionalString(query.clientId,'clientId',200)??undefined;
    if(clientId) requireClientAccess(session,clientId);
    const clientIds=(clientId||session.user.role==='admin')?undefined:(session.user.clientIds??[]);
    return reply.send(await repository.listPlanItems({clientId,clientIds,from:asDate(query.from,'from'),to:asDate(query.to,'to'),status:optionalString(query.status,'status',50)??undefined,format:optionalString(query.format,'format',100)??undefined,search:optionalString(query.search,'search',200)??undefined,includeUndated:query.includeUndated==='true',cursor:decodeCursor(query.cursor),limit:parseLimit(query.limit)}));
  }));

  app.get('/api/content/plan-items/:id', route(async (request, reply) => {
    const session=await requireHuman(request);
    const item=await repository.getPlanItem(requireString(paramsOf(request).id,'id',100));
    if(!item) throw new ContentApiError(404,'NOT_FOUND','Propuesta no encontrada');
    requireClientAccess(session,(item as any).client_id);
    return reply.send({planItem:item});
  }));

  app.post('/api/content/plan-items', route(async (request, reply) => {
    const session=await requireHuman(request,'admin'); const body=requireObject(request.body);
    const planItem=await repository.createPlanItem({clientId:requireString(body.clientId,'clientId',200),calendarId:requireString(body.calendarId,'calendarId',100),title:requireString(body.title,'title'),theme:optionalString(body.theme,'theme'),rationale:optionalString(body.rationale,'rationale'),format:optionalString(body.format,'format',100),keywordPrimary:optionalString(body.keywordPrimary,'keywordPrimary'),keywords:stringArray(body.keywords,'keywords'),entities:stringArray(body.entities,'entities'),cta:optionalString(body.cta,'cta'),priority:optionalString(body.priority,'priority',30),plannedAt:asDate(body.plannedAt,'plannedAt'),status:body.status===undefined?undefined:assertEnum(body.status,PLAN_STATUSES,'status'),sourceContext:body.sourceContext,sourceKey:optionalString(body.sourceKey,'sourceKey',200)},session.user.id);
    return reply.code(201).send({planItem});
  }));

  app.patch('/api/content/plan-items/:id', route(async (request, reply) => {
    const session=await requireHuman(request,'admin'); const body=requireObject(request.body);
    const planItem=await repository.patchPlanItem(requireString(paramsOf(request).id,'id',100),{...body,version:requirePositiveVersion(body.version),status:body.status===undefined?undefined:assertEnum(body.status,PLAN_STATUSES,'status'),plannedAt:asDate(body.plannedAt,'plannedAt'),keywords:stringArray(body.keywords,'keywords'),entities:stringArray(body.entities,'entities'),networks:body.networks===undefined?undefined:normalizeRrssNetworks(body.networks)},session.user.id);
    return reply.send({planItem});
  }));

  app.post('/api/content/plan-items/:id/release-generation', route(async (request, reply) => {
    const session=await requireHuman(request,'admin'); const body=requireObject(request.body??{});
    const id=requireString(paramsOf(request).id,'id',100);
    const item=await repository.getPlanItem(id);
    if(!item) throw new ContentApiError(404,'NOT_FOUND','Propuesta no encontrada');
    requireClientAccess(session,(item as any).client_id);
    return reply.send({planItem:await repository.releaseGeneration(id,requirePositiveVersion(body.version),session.user.id)});
  }));

  app.get('/api/clients/:clientId/rrss/items', route(async (request, reply) => {
    const session = await requireHuman(request);
    const clientId = requireString(paramsOf(request).clientId, 'clientId', 200);
    requireClientAccess(session, clientId);
    return reply.send(await repository.listRrssItems({ clientId, ...listFilters(queryOf(request)) }));
  }));

  app.post('/api/clients/:clientId/rrss/items', route(async (request, reply) => {
    const session = await requireHuman(request, 'admin');
    const clientId = requireString(paramsOf(request).clientId, 'clientId', 200);
    requireClientAccess(session, clientId);
    const body = requireObject(request.body);
    const planItem = await repository.createRrssIdea({
      clientId,
      title: requireString(body.title, 'title'),
      theme: optionalString(body.theme, 'theme'),
      rationale: optionalString(body.rationale, 'rationale'),
      format: body.format === undefined || body.format === null ? null : assertEnum(body.format, RRSS_FORMATS, 'format'),
      networks: body.networks === undefined ? [] : normalizeRrssNetworks(body.networks),
      cta: optionalString(body.cta, 'cta'),
      plannedAt: asDate(body.plannedAt, 'plannedAt'),
      keywords: stringArray(body.keywords, 'keywords'),
    }, session.user.id);
    return reply.code(201).send({ planItem });
  }));

  app.get('/api/content/plan-items/:id/social-posts', route(async (request, reply) => {
    const session = await requireHuman(request);
    const id = requireString(paramsOf(request).id, 'id', 100);
    const item = await repository.getPlanItem(id);
    if (!item) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
    requireClientAccess(session, (item as any).client_id);
    return reply.send({ socialPosts: await repository.listSocialPosts(id) });
  }));

  /** «Nuevo borrador»: a manual draft (no AI) for one Postiz account of the idea's client. */
  app.post('/api/content/plan-items/:id/social-posts', route(async (request, reply) => {
    const session = await requireHuman(request, 'admin');
    const id = requireString(paramsOf(request).id, 'id', 100);
    const item = await repository.getPlanItem(id);
    if (!item) throw new ContentApiError(404, 'NOT_FOUND', 'Propuesta no encontrada');
    const clientId = (item as any).client_id as string;
    requireClientAccess(session, clientId);
    const body = requireObject(request.body);
    const socialPost = await repository.createManualSocialPost({
      clientId,
      planItemId: id,
      accountId: requireString(body.accountId, 'accountId', 100),
      copy: requireSocialCopy(body.copy),
    }, session.user.id);
    return reply.code(201).send({ socialPost });
  }));

  /** Loads a social post for an admin mutation and checks the session can act on its client. */
  async function socialPostForAdmin(request: Request) {
    const session = await requireHuman(request, 'admin');
    const id = requireString(paramsOf(request).id, 'id', 100);
    const post = await repository.getSocialPost(id);
    if (!post) throw new ContentApiError(404, 'NOT_FOUND', 'Post no encontrado');
    requireClientAccess(session, post.clientId);
    return { session, id, post };
  }

  const optionalVersion = (body: Record<string, unknown>) => body.expectedVersion === undefined ? undefined : requirePositiveVersion(body.expectedVersion);

  app.patch('/api/social-posts/:id', route(async (request, reply) => {
    const { session, id } = await socialPostForAdmin(request);
    const body = requireObject(request.body);
    const expectedVersion = requirePositiveVersion(body.expectedVersion);
    if (body.copy === undefined && body.media === undefined) throw new ContentApiError(400, 'INVALID_PAYLOAD', 'Indica copy o media');
    const input = {
      ...(body.copy === undefined ? {} : { copy: requireSocialCopy(body.copy) }),
      ...(body.media === undefined ? {} : { media: normalizeSocialMedia(body.media) }),
      expectedVersion,
    };
    return reply.send({ socialPost: await repository.patchSocialPost(id, input, session.user.id) });
  }));

  app.post('/api/social-posts/:id/approve', route(async (request, reply) => {
    const { session, id } = await socialPostForAdmin(request);
    return reply.send({ socialPost: await repository.approveSocialPost(id, optionalVersion(requireObject(request.body ?? {})), session.user.id) });
  }));

  app.post('/api/social-posts/:id/discard', route(async (request, reply) => {
    const { session, id } = await socialPostForAdmin(request);
    return reply.send({ socialPost: await repository.discardSocialPost(id, optionalVersion(requireObject(request.body ?? {})), session.user.id) });
  }));

  app.post('/api/social-posts/:id/schedule', route(async (request, reply) => {
    const { session, id, post } = await socialPostForAdmin(request);
    const body = requireObject(request.body);
    const scheduled = await repository.scheduleSocialPost(id, {
      clientId: post.clientId,
      desiredScheduledAt: asDate(body.desiredScheduledAt, 'desiredScheduledAt') ?? requireString(body.desiredScheduledAt, 'desiredScheduledAt', 100),
      externalUrl: optionalHttpUrl(body.externalUrl),
      expectedVersion: requirePositiveVersion(body.expectedVersion),
      idempotencyKey: requireString(body.idempotencyKey, 'idempotencyKey', 300),
    }, session.user.id);
    return reply.code(scheduled.replayed ? 200 : 202).send(scheduled);
  }));

  app.post('/api/social-posts/:id/media', route(async (request, reply) => {
    const { session, id, post } = await socialPostForAdmin(request);
    // Cheap checks first so a refused upload never reaches Postiz; appendSocialPostMedia re-checks under lock.
    if (post.status === 'scheduled' || post.status === 'discarded') throw new ContentApiError(409, 'INVALID_TRANSITION', 'No se pueden añadir creatividades a un post programado o descartado');
    if (Array.isArray(post.media) && post.media.length >= MAX_SOCIAL_MEDIA_ITEMS) throw new ContentApiError(409, 'MEDIA_LIMIT', `El post ya tiene el máximo de ${MAX_SOCIAL_MEDIA_ITEMS} archivos`);
    const config = postizConfigFromEnv(options.postiz?.env ?? process.env);
    if (!config) throw new ContentApiError(503, 'POSTIZ_NOT_CONFIGURED', 'La subida de creatividades no está disponible: falta configurar Postiz (POSTIZ_API_URL y POSTIZ_API_KEY) en el servidor');
    if (!request.isMultipart()) throw new ContentApiError(400, 'INVALID_PAYLOAD', 'Envía el archivo como multipart/form-data en el campo file');
    // Server-wide cap on simultaneous uploads (each one spools to disk and streams to Postiz); no queueing.
    const release = uploadLimiter.acquire();
    let creative: Awaited<ReturnType<typeof spoolCreative>> | undefined;
    let socialPost: unknown;
    try {
      const part = await request.file();
      if (!part || part.fieldname !== 'file') {
        part?.file.resume();
        throw new ContentApiError(400, 'INVALID_PAYLOAD', 'Falta el archivo en el campo file');
      }
      creative = await spoolCreative(part, { tmpDir: options.uploads?.tmpDir });
      const uploaded = await createPostizUploader(config, options.postiz?.fetchImpl ?? fetch)({ path: creative.path, filename: creative.name, mimetype: creative.mimetype });
      socialPost = await repository.appendSocialPostMedia(id, { url: uploaded.url, type: creative.kind, name: creative.name }, session.user.id);
    } finally {
      await creative?.cleanup();
      release();
    }
    // Reply only after the temp file is gone and the slot is free.
    return reply.send({ socialPost });
  }));

  app.get('/api/content/items/:id', route(async (request, reply) => {
    const session=await requireHuman(request); const content=await repository.getContent(requireString(paramsOf(request).id,'id',100));
    if(!content) throw new ContentApiError(404,'NOT_FOUND','Contenido no encontrado');
    requireClientAccess(session,(content as any).clientId);
    return reply.send({content});
  }));

  app.patch('/api/content/items/:id', route(async (request, reply) => {
    const session=await requireHuman(request,'admin'); const body=requireObject(request.body);
    const content=await repository.patchContent(requireString(paramsOf(request).id,'id',100),{...body,version:requirePositiveVersion(body.version),status:body.status===undefined?undefined:assertEnum(body.status,CONTENT_STATUSES,'status')},session.user.id);
    return reply.send({content});
  }));

  app.post('/api/content/items/:id/approve', route(async (request, reply) => {
    const session=await requireHuman(request,'admin'); const body=requireObject(request.body);
    const content=await repository.approveContent(requireString(paramsOf(request).id,'id',100),requireString(body.revisionId,'revisionId',100),requirePositiveVersion(body.version),session.user.id);
    return reply.send({content});
  }));

  app.post('/api/content/jobs', route(async (request, reply) => {
    const session=await requireHuman(request,'admin'); const body=requireObject(request.body);
    const created=await repository.createJob({clientId:requireString(body.clientId,'clientId',200),kind:assertEnum(body.kind,JOB_KINDS,'kind'),targetId:optionalString(body.targetId,'targetId',100),expectedVersion:body.expectedVersion===undefined?undefined:requirePositiveVersion(body.expectedVersion),idempotencyKey:requireString(body.idempotencyKey,'idempotencyKey',300),payload:body.payload??{}},session.user.id);
    return reply.code(created.replayed ? 200 : 202).send({job:created.job,replayed:created.replayed});
  }));

  app.get('/api/content/jobs', route(async (request, reply) => {
    const session = await requireHuman(request);
    const query = queryOf(request);
    const status = optionalString(query.status, 'status', 30);
    if (status && !['pending', 'running', 'succeeded', 'failed', 'unknown', 'cancelled'].includes(status)) {
      throw new ContentApiError(400, 'INVALID_PAYLOAD', 'status no es válido');
    }
    const clientId = optionalString(query.clientId, 'clientId', 200) ?? undefined;
    if (clientId) requireClientAccess(session, clientId);
    const clientIds = (clientId || session.user.role === 'admin') ? undefined : (session.user.clientIds ?? []);
    return reply.send(await repository.listJobs({
      clientId,
      clientIds,
      status: status ?? undefined,
      cursor: decodeCursor(query.cursor),
      limit: parseLimit(query.limit),
    }));
  }));

  app.get('/api/content/jobs/:id', route(async (request, reply) => {
    const session=await requireHuman(request); const job=await repository.getJob(requireString(paramsOf(request).id,'id',100));
    if(!job) throw new ContentApiError(404,'NOT_FOUND','Trabajo no encontrado');
    requireClientAccess(session,(job as any).client_id);
    return reply.send({job});
  }));

  app.post('/api/content/jobs/:id/recover', route(async (request, reply) => {
    const session = await requireHuman(request, 'admin');
    const id = requireString(paramsOf(request).id, 'id', 100);
    const job = await repository.getJob(id);
    if (!job) throw new ContentApiError(404, 'NOT_FOUND', 'Trabajo no encontrado');
    requireClientAccess(session, (job as any).client_id);
    return reply.send({ job: await repository.recoverPlanJob(id, session.user.id) });
  }));

  app.get('/api/clients/:clientId/editorial-readiness', route(async (request, reply) => {
    const session = await requireHuman(request);
    const clientId = requireString(paramsOf(request).clientId, 'clientId', 200);
    requireClientAccess(session, clientId);
    return reply.send(await repository.readiness(clientId));
  }));

  app.get('/api/clients/:clientId/editorial-plan-inputs', route(async (request, reply) => {
    const session = await requireHuman(request, 'admin');
    const clientId = requireString(paramsOf(request).clientId, 'clientId', 200);
    requireClientAccess(session, clientId);
    return reply.send(await repository.getPlanInputs(clientId));
  }));

  app.put('/api/clients/:clientId/editorial-plan-inputs', route(async (request, reply) => {
    const session = await requireHuman(request, 'admin');
    const clientId = requireString(paramsOf(request).clientId, 'clientId', 200);
    requireClientAccess(session, clientId);
    const body = requireObject(request.body);
    return reply.send(await repository.savePlanInputs(clientId, { topic: body.topic, keywords: body.keywords, competitors: body.competitors }));
  }));

  app.get('/api/clients/:clientId/rrss-plan-inputs', route(async (request, reply) => {
    const session = await requireHuman(request, 'admin');
    const clientId = requireString(paramsOf(request).clientId, 'clientId', 200);
    requireClientAccess(session, clientId);
    return reply.send(await repository.getRrssPlanInputs(clientId));
  }));

  app.put('/api/clients/:clientId/rrss-plan-inputs', route(async (request, reply) => {
    const session = await requireHuman(request, 'admin');
    const clientId = requireString(paramsOf(request).clientId, 'clientId', 200);
    requireClientAccess(session, clientId);
    const body = requireObject(request.body);
    return reply.send(await repository.saveRrssPlanInputs(clientId, { topic: body.topic, keywords: body.keywords, networks: body.networks, postsPerWeek: body.postsPerWeek, weeksHorizon: body.weeksHorizon }));
  }));

  app.get('/api/content/items/:id/publications', route(async (request, reply) => {
    const session=await requireHuman(request);
    const contentId=requireString(paramsOf(request).id,'id',100);
    const content=await repository.getContent(contentId);
    if(!content) throw new ContentApiError(404,'NOT_FOUND','Contenido no encontrado');
    requireClientAccess(session,(content as any).clientId);
    return reply.send(await repository.listPublications(contentId,parseLimit(queryOf(request).limit),decodeCursor(queryOf(request).cursor)));
  }));

  app.get('/api/clients/:clientId/publishing-accounts', route(async (request, reply) => {
    const session=await requireHuman(request);
    const clientId=requireString(paramsOf(request).clientId,'clientId',200);
    requireClientAccess(session,clientId);
    return reply.send({accounts:await repository.listPublishingAccounts(clientId)});
  }));

  app.post('/api/content/items/:id/publications', route(async (request, reply) => {
    const session=await requireHuman(request,'admin');
    const body=requireObject(request.body);
    if(body.media!==undefined&&!Array.isArray(body.media)) throw new ContentApiError(400,'INVALID_PAYLOAD','media debe ser una lista');
    const scheduled=await repository.schedulePublication({
      clientId:requireString(body.clientId,'clientId',200),
      contentId:requireString(paramsOf(request).id,'id',100),
      expectedVersion:requirePositiveVersion(body.expectedVersion),
      accountId:requireString(body.accountId,'accountId',100),
      desiredScheduledAt:asDate(body.desiredScheduledAt,'desiredScheduledAt')??requireString(body.desiredScheduledAt,'desiredScheduledAt',100),
      externalUrl:optionalHttpUrl(body.externalUrl),
      occurrenceKey:body.occurrenceKey===undefined?undefined:requireString(body.occurrenceKey,'occurrenceKey',100),
      copy:optionalString(body.copy,'copy',20_000),
      media:Array.isArray(body.media)?body.media:[],
      idempotencyKey:requireString(body.idempotencyKey,'idempotencyKey',300),
    },session.user.id);
    return reply.code(scheduled.replayed?200:202).send(scheduled);
  }));

  app.post('/api/internal/content/jobs/claim', route(async (request, reply) => {
    const body=requireObject(request.body); const requestedClient=optionalString(body.clientId,'clientId',200)??undefined;
    const principal=await requireService(request,'jobs:claim',requestedClient);
    const kinds=body.kinds===undefined?undefined:stringArray(body.kinds,'kinds')?.map((kind)=>assertEnum(kind,JOB_KINDS,'kinds'));
    const leaseSeconds=Math.min(Math.max(Number(body.leaseSeconds??300),30),3600);
    if(!Number.isInteger(leaseSeconds)) throw new ContentApiError(400,'INVALID_PAYLOAD','leaseSeconds debe ser entero');
    const job=await repository.claimJob({kinds,clientId:requestedClient,leaseSeconds,executionId:requireString(body.executionId,'executionId',300)},principal.allowedClientIds);
    return job ? reply.send({job}) : reply.code(204).send();
  }));

  app.post('/api/internal/content/jobs/:id/heartbeat', route(async (request, reply) => {
    const body=requireObject(request.body); const clientId=requireString(body.clientId,'clientId',200); await requireService(request,'jobs:heartbeat',clientId);
    const leaseSeconds=Math.min(Math.max(Number(body.leaseSeconds??300),30),3600);
    const job=await repository.heartbeatJob(requireString(paramsOf(request).id,'id',100),clientId,requireString(body.leaseToken,'leaseToken',100),leaseSeconds); return reply.send({job});
  }));

  app.post('/api/internal/content/jobs/:id/result', route(async (request, reply) => {
    const body=requireObject(request.body); const clientId=requireString(body.clientId,'clientId',200); const principal=await requireService(request,'jobs:result',clientId);
    if(body.schemaVersion!==1) throw new ContentApiError(400,'UNSUPPORTED_SCHEMA_VERSION','schemaVersion debe ser 1');
    if(body.status!=='succeeded'&&body.status!=='failed'&&body.status!=='unknown') throw new ContentApiError(400,'INVALID_PAYLOAD','status no es válido');
    const result=await repository.finishJob(requireString(paramsOf(request).id,'id',100),requireString(body.leaseToken,'leaseToken',100),body,principal.id); return reply.send(result);
  }));

  app.get('/api/internal/content/clients/:clientId/context', route(async (request, reply) => {
    const clientId=requireString(paramsOf(request).clientId,'clientId',200); await requireService(request,'context:read',clientId); return reply.send(await repository.context(clientId));
  }));

  app.post('/api/internal/content/events', route(async (request, reply) => {
    const body=requireObject(request.body); const clientId=requireString(body.clientId,'clientId',200); const principal=await requireService(request,'events:write',clientId);
    if(body.schemaVersion!==1) throw new ContentApiError(400,'UNSUPPORTED_SCHEMA_VERSION','schemaVersion debe ser 1');
    const event=await repository.recordEvent({clientId,entityType:requireString(body.entityType,'entityType',100),entityId:optionalString(body.entityId,'entityId',100),eventType:requireString(body.eventType,'eventType',100),sourceEventId:optionalString(body.sourceEventId,'sourceEventId',300),payload:body.payload??{},occurredAt:asDate(body.occurredAt,'occurredAt')??new Date().toISOString(),publicationStatus:body.publicationStatus===undefined?undefined:assertEnum(body.publicationStatus,PUBLICATION_STATUSES,'publicationStatus')},principal.id);
    return reply.code(event.replayed?200:201).send(event);
  }));

  app.post('/api/internal/content/research', route(async (request, reply) => {
    const body=requireObject(request.body); const clientId=requireString(body.clientId,'clientId',200); await requireService(request,'research:write',clientId);
    if(body.schemaVersion!==1) throw new ContentApiError(400,'UNSUPPORTED_SCHEMA_VERSION','schemaVersion debe ser 1');
    const snapshot=await repository.saveResearch({clientId,source:requireString(body.source,'source',100),periodStart:asDate(body.periodStart,'periodStart'),periodEnd:asDate(body.periodEnd,'periodEnd'),fetchedAt:asDate(body.fetchedAt,'fetchedAt')??new Date().toISOString(),payload:body.payload??{},status:body.status}); return reply.code(201).send({snapshot});
  }));
}
