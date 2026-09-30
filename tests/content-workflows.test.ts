import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflowRoot = join(repoRoot, 'workflows', 'content');

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith('.json') ? [path] : [];
  });
}

const workflowFiles = jsonFiles(workflowRoot).filter((path) => /\.v1\.json$/.test(path));

test('exports n8n v1 are sanitized and all connection references resolve', () => {
  assert.equal(workflowFiles.length, 7);
  for (const path of workflowFiles) {
    const source = readFileSync(path, 'utf8');
    const workflow = JSON.parse(source);
    const label = relative(repoRoot, path);
    assert.equal(workflow.active, false, `${label} must be imported disabled`);
    assert.equal('pinData' in workflow, false, `${label} contains execution pinData`);
    assert.equal('credentials' in workflow, false, `${label} contains top-level credentials`);
    assert.doesNotMatch(source, /n8n-nodes-base\.googleSheets/i, `${label} still uses Google Sheets`);
    assert.doesNotMatch(source, /65115a8785e4|jina_9bca|44e8ba9ce0|343634437|cmtk8o3zb|7aSyEMAM/i, `${label} contains a known source secret or installation id`);
    assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{16,}|Bearer\s+(?!['" +]*\$env)[A-Za-z0-9._-]{16,}/, `${label} appears to contain a secret`);

    const names = new Set<string>(workflow.nodes.map((node: any) => node.name));
    assert.equal(names.size, workflow.nodes.length, `${label} has duplicate node names`);
    for (const node of workflow.nodes) assert.equal('credentials' in node, false, `${label}/${node.name} contains credential ids`);
    for (const reference of source.matchAll(/\$\('([^']+)'\)/g)) {
      assert.ok(names.has(reference[1]), `${label} expression references missing node ${reference[1]}`);
    }
    for (const [sourceName, outputs] of Object.entries<any>(workflow.connections ?? {})) {
      assert.ok(names.has(sourceName), `${label} connection source ${sourceName} is missing`);
      for (const channel of Object.values<any>(outputs)) {
        for (const branch of channel) {
          for (const edge of branch) assert.ok(names.has(edge.node), `${label} connection target ${edge.node} is missing`);
        }
      }
    }
  }
});

test('Inficon workflows implement the versioned internal API contract', () => {
  const dir = join(workflowRoot, 'inficon-global');
  const plan = readFileSync(join(dir, 'plan.v1.json'), 'utf8');
  const generate = readFileSync(join(dir, 'generate.v1.json'), 'utf8');
  const publish = readFileSync(join(dir, 'publish.v1.json'), 'utf8');

  for (const source of [plan, generate, publish]) {
    assert.match(source, /schemaVersion/);
    assert.match(source, /\/api\/internal\/content\/clients\//);
    assert.match(source, /\/api\/internal\/content\/jobs\//);
    assert.match(source, /\/result/);
    assert.match(source, /INFIDASH_SERVICE_TOKEN/);
  }
  assert.match(plan, /generate_plan/);
  assert.match(plan, /planItems/);
  assert.match(plan, /n8n-nodes-base\.googleAnalytics/);
  assert.match(plan, /n8n-nodes-google-search-console\.googleSearchConsole/);
  assert.match(plan, /r\.jina\.ai/);
  assert.match(plan, /@n8n\/n8n-nodes-langchain/);
  assert.match(generate, /generate_content/);
  assert.match(generate, /wordpress\.draft_created/);
  assert.match(generate, /status\s*:\s*['"]draft/);
  assert.match(generate, /n8n-nodes-base\.wordpress/);
  assert.match(generate, /AI company researcher2/);
  assert.match(generate, /SEO Content Writer2/);
  assert.match(generate, /Humanizer IA2/);
  assert.match(publish, /kind\s*!==\s*['"]publish/);
  assert.match(publish, /status\s*:\s*['"]scheduled/);
  assert.match(publish, /n8n-nodes-postiz\.postiz/);
  assert.match(publish, /postiz\.ambiguous/);
  assert.match(publish, /reconcileRequired/);
  assert.doesNotMatch(publish, /status\s*:\s*['"]published/);
  for (const source of [plan, generate, publish]) {
    assert.match(source, /\/heartbeat/);
    assert.doesNotMatch(source, /payload\.(?:planItems|generatedContent|providerResult)/);
  }
});

test('dispatcher and reconciliation use claims, bindings, events and result callbacks', () => {
  const dispatcher = readFileSync(join(workflowRoot, 'dispatcher.v1.json'), 'utf8');
  const reconcile = readFileSync(join(workflowRoot, 'reconcile.v1.json'), 'utf8');
  assert.match(dispatcher, /\/api\/internal\/content\/jobs\/claim/);
  assert.match(dispatcher, /workflow_bindings/);
  assert.match(dispatcher, /n8n-nodes-base\.executeWorkflow/);
  assert.match(dispatcher, /waitForSubWorkflow[^\n]*true/);
  assert.match(dispatcher, /\/heartbeat/);
  assert.match(reconcile, /kind\s*!==\s*['"]reconcile/);
  assert.match(reconcile, /POSTIZ_INTERNAL_API_URL/);
  assert.match(reconcile, /\/public\/v1\/posts/);
  assert.match(reconcile, /\/api\/internal\/content\/events/);
  assert.match(reconcile, /publicationStatus/);
  assert.match(reconcile, /publishedAt/);
  assert.match(reconcile, /POSTIZ_RECONCILE_UNAVAILABLE/);
});

test('client manifest documents only the available pilot and uses environment references', () => {
  const manifest = JSON.parse(readFileSync(join(workflowRoot, 'clients.example.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.clients.map((client: any) => client.key), ['inficon-global']);
  assert.equal(manifest.clients[0].enabled, false);
  assert.match(manifest.clients[0].clientIdEnv, /^[A-Z][A-Z0-9_]+$/);
  assert.deepEqual(Object.keys(manifest.clients[0].workflowBindings).sort(), ['generate_content', 'generate_plan', 'publish', 'reconcile']);
  for (const binding of Object.values<any>(manifest.clients[0].workflowBindings)) assert.match(binding.workflowIdEnv, /^N8N_WORKFLOW_/);
});

// ── Execution helpers: run a Code node's jsCode against stubbed upstream node outputs ──────────────

function loadWorkflow(path: string) { return JSON.parse(readFileSync(join(workflowRoot, path), 'utf8')); }
function nodeNamed(workflow: any, name: string) {
  const found = workflow.nodes.find((node: any) => node.name === name);
  assert.ok(found, `${workflow.name} is missing node ${name}`);
  return found;
}
/** Targets of `from`'s main output `index` (0 = success, 1 = error output). */
function targets(workflow: any, from: string, index = 0) { return (workflow.connections[from]?.main?.[index] ?? []).map((edge: any) => edge.node); }
function edgesInto(workflow: any, to: string) {
  const found: Array<{ from: string; output: number; input: number }> = [];
  for (const [from, outputs] of Object.entries<any>(workflow.connections)) (outputs.main ?? []).forEach((branch: any[], output: number) => (branch ?? []).forEach((edge) => { if (edge.node === to) found.push({ from, output, input: edge.index ?? 0 }); }));
  return found;
}
type Items = Array<Record<string, unknown>>;
/** Nodes absent from `nodes` behave like n8n nodes that never executed: referencing them throws. */
function runCode(workflow: any, name: string, { nodes = {}, input = [] }: { nodes?: Record<string, Items>; input?: Items } = {}): any[] {
  const wrap = (rows: Items) => rows.map((json) => ({ json }));
  const $ = (ref: string) => {
    if (!(ref in nodes)) throw new Error(`Node '${ref}' hasn't been executed`);
    const items = wrap(nodes[ref]);
    return { first: () => items[0], all: () => items, get item() { return items[0]; } };
  };
  const inputItems = wrap(input);
  const $input = { first: () => inputItems[0], all: () => inputItems, get item() { return inputItems[0]; } };
  return new Function('$', '$input', '$json', '$execution', nodeNamed(workflow, name).parameters.jsCode)($, $input, inputItems[0]?.json, { id: 'exec-1' });
}
const JOB = { id: 'job-1', client_id: 'client-a', target_id: 'target-1', leaseToken: 'lease-1' };

const EXEMPT_TYPES = /executeWorkflowTrigger|\.merge$|\.if$|\.wait$|\.aggregate$|\.set$|stickyNote|lmChat|\.tool/;
const TERMINAL_REPORTS = new Set(['Guardar fallo Infidash', 'Guardar fallo o unknown', 'Guardar unknown Infidash', 'Guardar resultado cancelacion']);

test('every child-workflow node that can fail routes its error output somewhere instead of crashing silently', () => {
  for (const path of ['inficon-global/plan.v1.json', 'inficon-global/generate.v1.json', 'inficon-global/publish.v1.json', 'inficon-global/reschedule.v1.json', 'inficon-global/cancel.v1.json', 'reconcile.v1.json']) {
    const workflow = loadWorkflow(path);
    for (const node of workflow.nodes) {
      if (EXEMPT_TYPES.test(node.type) || TERMINAL_REPORTS.has(node.name) || /^(Preparar fallo|Sin datos:)/.test(node.name)) continue;
      assert.equal(node.onError, 'continueErrorOutput', `${path}/${node.name} must use continueErrorOutput`);
      assert.ok(targets(workflow, node.name, 1).length, `${path}/${node.name} error output is not connected`);
    }
    for (const node of workflow.nodes.filter((candidate: any) => /lmChat|\.tool/.test(candidate.type))) {
      assert.equal(node.onError, undefined, `${path}/${node.name} is a sub-node; errors surface on its parent`);
      assert.equal(workflow.connections[node.name]?.main, undefined, `${path}/${node.name} sub-node must not have main connections`);
    }
    for (const name of workflow.nodes.map((node: any) => node.name).filter((name: string) => name.startsWith('Preparar fallo'))) {
      assert.deepEqual(targets(workflow, name), ['Guardar fallo Infidash'], `${path}/${name} must report to Infidash`);
    }
  }
});

test('failure reports fall back to the trigger payload when Validar trabajo itself failed, and refuse without a lease', () => {
  const generate = loadWorkflow('inficon-global/generate.v1.json');
  const [report] = runCode(generate, 'Preparar fallo confirmado', { nodes: { 'Trabajo recibido': [{ job: { ...JOB, kind: 'generate_content' } }] }, input: [{ error: 'Contrato generate_content v1 invalido' }] });
  assert.equal(report.json.jobId, 'job-1');
  assert.equal(report.json.status, 'failed');
  assert.equal(report.json.error, 'Contrato generate_content v1 invalido');
  assert.throws(() => runCode(generate, 'Preparar fallo confirmado', { nodes: { 'Trabajo recibido': [{ job: { id: 'job-1' } }] }, input: [{ error: 'x' }] }), /leaseToken/);
});

test('generate_content failures are retryable before WordPress, ambiguous only for WordPress itself, unknown afterwards', () => {
  const generate = loadWorkflow('inficon-global/generate.v1.json');
  const base = { 'Validar trabajo': [{ job: JOB }] };
  const [before] = runCode(generate, 'Preparar fallo confirmado', { nodes: base, input: [{ error: { message: 'Service unavailable', httpCode: '503' } }] });
  assert.equal(before.json.status, 'failed', 'nothing external was written, so even 5xx/timeouts are retryable');
  const [wpAmbiguous] = runCode(generate, 'Preparar fallo WordPress', { nodes: base, input: [{ error: { message: 'socket hang up', httpCode: '0' } }] });
  assert.equal(wpAmbiguous.json.status, 'unknown');
  assert.equal(wpAmbiguous.json.result.reconcileRequired, true);
  const [wpRejected] = runCode(generate, 'Preparar fallo WordPress', { nodes: base, input: [{ error: { message: 'Forbidden', httpCode: '403' } }] });
  assert.equal(wpRejected.json.status, 'failed');
  const [after] = runCode(generate, 'Preparar fallo tras WordPress', { nodes: { ...base, 'WP INF Global': [{ id: 321, link: 'https://example.com/?p=321' }] }, input: [{ error: { message: 'La reserva caducó' } }] });
  assert.equal(after.json.status, 'unknown');
  assert.equal(after.json.result.wordpressPostId, '321');
  assert.match(after.json.error, /321/);

  for (const name of ['Validar trabajo', 'Heartbeat antes de IA', 'Cargar contexto Infidash', 'Preparar contenido aprobado', 'AI company researcher2', 'SEO Content Writer2', 'Humanizer IA2', 'Limpia HTML2', 'Heartbeat antes de WordPress', 'Preparar imagen para WordPress']) {
    assert.deepEqual(targets(generate, name, 1), ['Preparar fallo confirmado'], `${name} fails before WordPress`);
  }
  assert.deepEqual(targets(generate, 'WP INF Global', 1), ['Preparar fallo WordPress']);
  for (const name of ['Heartbeat despues de WordPress', 'Normalizar borrador y contenido', 'Registrar evento WordPress', 'Guardar resultado Infidash']) {
    assert.deepEqual(targets(generate, name, 1), ['Preparar fallo tras WordPress'], `${name} fails after the draft exists`);
  }
  assert.deepEqual(targets(generate, 'Generar imagen cabecera IA', 1), ['Preparar imagen para WordPress'], 'image failures still degrade to no featured image');
});

test('generate_content prefers the server-built plan item and records the draft event against the plan item', () => {
  const generate = loadWorkflow('inficon-global/generate.v1.json');
  const ctx = { settings: { editorial_config: { siteUrl: 'https://www.acme.example/', brandName: 'Acme Bombas', topic: 'Bombas industriales' } }, accounts: [{ provider: 'wordpress', active: true, instance_key: 'inficonglobal-blog' }], planItems: [{ id: 'target-1', title: 'Título del contexto' }] };
  const planItem = { id: 'target-1', title: 'Guía de bombas', keywords: ['bombas', 'caudal'], entities: ['ISO 9906'], rationale: 'Demanda alta', format: 'blog', keywordPrimary: 'bombas' };
  const [prepared] = runCode(generate, 'Preparar contenido aprobado', { nodes: { 'Validar trabajo': [{ job: { ...JOB, payload: { schemaVersion: 1, planItem } } }] }, input: [ctx] });
  assert.equal(prepared.json.title, 'Guía de bombas');
  assert.equal(prepared.json.keywords, 'bombas, caudal');
  assert.equal(prepared.json.Entidades, 'ISO 9906');
  assert.equal(prepared.json.Justificacion, 'Demanda alta');
  assert.equal(prepared.json.siteUrl, 'https://www.acme.example', 'the trailing slash is dropped so WordPress paths can be appended');
  assert.equal(prepared.json.brandName, 'Acme Bombas');
  assert.equal(prepared.json.sector, 'Bombas industriales');
  const withConfig = (config: Record<string, unknown>) => ({ ...ctx, settings: { editorial_config: config } });
  assert.throws(() => runCode(generate, 'Preparar contenido aprobado', { nodes: { 'Validar trabajo': [{ job: { ...JOB, payload: { planItem } } }] }, input: [withConfig({ brandName: 'Acme' })] }), /Falta editorial_config\.siteUrl/);
  assert.throws(() => runCode(generate, 'Preparar contenido aprobado', { nodes: { 'Validar trabajo': [{ job: { ...JOB, payload: { planItem } } }] }, input: [withConfig({ siteUrl: 'https://acme.example' })] }), /Falta editorial_config\.brandName/);
  const [legacy] = runCode(generate, 'Preparar contenido aprobado', { nodes: { 'Validar trabajo': [{ job: { ...JOB, payload: { planItem } } }] }, input: [withConfig({ site_url: 'https://acme.example', brandName: 'Acme' })] });
  assert.equal(legacy.json.siteUrl, 'https://acme.example', 'site_url is accepted as an alias');
  assert.equal(legacy.json.sector, '');
  const [fallback] = runCode(generate, 'Preparar contenido aprobado', { nodes: { 'Validar trabajo': [{ job: { ...JOB, payload: {} } }] }, input: [ctx] });
  assert.equal(fallback.json.title, 'Título del contexto');
  assert.throws(() => runCode(generate, 'Preparar contenido aprobado', { nodes: { 'Validar trabajo': [{ job: { ...JOB, payload: {} } }] }, input: [{ ...ctx, planItems: [] }] }), /No existe el plan item objetivo/);

  const [normalized] = runCode(generate, 'Normalizar borrador y contenido', { nodes: {
    'Validar trabajo': [{ job: JOB }], 'Preparar contenido aprobado': [prepared.json], 'Limpia HTML2': [{ message: { content: '<p>Hola mundo</p>' } }],
    'WP INF Global': [{ id: 321, link: 'https://example.com/?p=321' }], 'Preparar imagen para WordPress': [{ headerImageUrl: null }],
  } });
  assert.equal(normalized.json.event.entityType, 'plan_item');
  assert.equal(normalized.json.event.entityId, 'target-1');
  assert.equal(normalized.json.event.sourceEventId, 'wordpress:inficonglobal-blog:321:draft');
});

const POSTIZ_CTX = (account: Record<string, unknown>, settings: Record<string, unknown> = {}) => ({ accounts: [{ id: 'account-1', provider: 'postiz', active: true, platform: 'blog', external_account_id: 'channel-1', ...account }], settings: { editorial_config: settings } });
const PUBLISH_JOB = (publication: Record<string, unknown> = {}) => ({ ...JOB, kind: 'publish', payload: { publication: { accountId: 'account-1', copy: 'Texto', desiredScheduledAt: '2026-10-01T09:00:00.000Z', media: [{ url: 'https://cdn.example/a.jpg' }], ...publication } } });

test('publish validates account, copy and the GMB URL before paying for an AI image', () => {
  const publish = loadWorkflow('inficon-global/publish.v1.json');
  assert.deepEqual(targets(publish, 'Cargar contexto Infidash'), ['Validar publicacion']);
  assert.deepEqual(targets(publish, 'Validar publicacion'), ['Ya hay imagen reutilizable']);
  assert.deepEqual(targets(publish, 'Validar publicacion', 1), ['Preparar fallo confirmado']);
  const run = (job: any, ctx: any) => runCode(publish, 'Validar publicacion', { nodes: { 'Validar trabajo': [{ job }], 'Cargar contexto Infidash': [ctx] }, input: [ctx] });
  assert.throws(() => run(PUBLISH_JOB({ accountId: 'other' }), POSTIZ_CTX({ instance_key: 'inficonglobal-instagram' })), /Cuenta Postiz no autorizada para el cliente/);
  assert.throws(() => run(PUBLISH_JOB({ copy: '' }), POSTIZ_CTX({ instance_key: 'inficonglobal-instagram' })), /La publicacion requiere copy/);
  assert.throws(() => run(PUBLISH_JOB(), POSTIZ_CTX({ instance_key: 'inficonglobal-gmb' })), /GMB requiere una URL/);
  assert.doesNotThrow(() => run(PUBLISH_JOB(), POSTIZ_CTX({ instance_key: 'inficonglobal-gmb' }, { site_url: 'https://inficonglobal.es' })));
  assert.doesNotThrow(() => run(PUBLISH_JOB(), POSTIZ_CTX({ instance_key: 'inficonglobal-instagram' })), 'platform "blog" must not be mistaken for the network');
  assert.doesNotMatch(nodeNamed(publish, 'Validar publicacion').parameters.jsCode, /account\.platform/);
});

const POSTIZ_NODES = ['Postiz Facebook', 'Postiz Instagram', 'Postiz GMB', 'Postiz Generico'];

test('Postiz network is chosen from instance_key, never from platform, and each network has its own static settings node', () => {
  for (const path of ['inficon-global/publish.v1.json', 'inficon-global/reschedule.v1.json']) {
    const workflow = loadWorkflow(path);
    const prepare = path.includes('publish') ? 'Preparar publicacion' : 'Preparar reprogramacion';
    const jobKind = path.includes('publish') ? 'publish' : 'reschedule';
    const prepared = (instanceKey: string) => {
      const ctx = POSTIZ_CTX({ instance_key: instanceKey }, { site_url: 'https://inficonglobal.es' });
      return runCode(workflow, prepare, { nodes: { 'Validar trabajo': [{ job: { ...PUBLISH_JOB(), kind: jobKind } }], 'Cargar contexto Infidash': [ctx] }, input: [ctx] })[0].json;
    };
    assert.equal(prepared('inficonglobal-instagram').network, 'instagram', path);
    assert.equal(prepared('inficonglobal-facebook').network, 'facebook', path);
    assert.equal(prepared('inficonglobal-gmb').network, 'gmb', path);
    assert.equal(prepared('inficonglobal-gmb').externalUrl, 'https://inficonglobal.es', `${path}: GMB falls back to editorial_config.site_url`);
    assert.equal(prepared('inficonglobal-blog').network, 'other', `${path}: platform "blog" must not be mistaken for the network`);
    assert.doesNotMatch(nodeNamed(workflow, prepare).parameters.jsCode, /account\.platform/);
    const settings = (name: string) => nodeNamed(workflow, name).parameters.posts.post[0].settings.setting;
    assert.deepEqual(settings('Postiz Instagram'), [{ key: 'post_type', stringValue: 'post' }]);
    assert.deepEqual(settings('Postiz Facebook'), [{ key: '__type', stringValue: 'facebook' }]);
    assert.ok(Array.isArray(settings('Postiz GMB')) && settings('Postiz GMB').some((setting: any) => setting.key === 'callToActionUrl'), `${path}: GMB settings must be a literal array`);
    for (const name of POSTIZ_NODES) {
      assert.deepEqual(targets(workflow, name), ['Capturar respuesta Postiz'], `${path}/${name}`);
      assert.deepEqual(targets(workflow, name, 1), ['Capturar error Postiz'], `${path}/${name}`);
    }
  }
});

test('publish failures after Postiz accepted the post are reported as unknown so reconcile can resolve them', () => {
  const publish = loadWorkflow('inficon-global/publish.v1.json');
  for (const name of ['Validar trabajo', 'Heartbeat antes de Postiz', 'Cargar contexto Infidash', 'Validar publicacion', 'Preparar publicacion']) assert.deepEqual(targets(publish, name, 1), ['Preparar fallo confirmado'], name);
  for (const name of ['Capturar respuesta Postiz', 'Heartbeat despues de Postiz', 'Normalizar programacion', 'Registrar evento Postiz', 'Guardar resultado Infidash', 'Capturar error Postiz', 'Heartbeat despues de error Postiz', 'Clasificar error Postiz', 'Registrar evento ambiguo o fallo']) assert.deepEqual(targets(publish, name, 1), ['Preparar fallo tras Postiz'], name);
  const [before] = runCode(publish, 'Preparar fallo confirmado', { nodes: { 'Validar trabajo': [{ job: JOB }] }, input: [{ error: { message: 'timeout', httpCode: '504' } }] });
  assert.equal(before.json.status, 'failed');
  assert.equal(before.json.publication, undefined);
  const [after] = runCode(publish, 'Preparar fallo tras Postiz', { nodes: { 'Validar trabajo': [{ job: JOB }], 'Capturar respuesta Postiz': [{ postizResponse: { postId: 'post-9' } }] }, input: [{ error: { message: 'La reserva caducó' } }] });
  assert.equal(after.json.status, 'unknown');
  assert.deepEqual({ status: after.json.publication.status, postizPostId: after.json.publication.postizPostId, errorCode: after.json.publication.errorCode }, { status: 'unknown', postizPostId: 'post-9', errorCode: 'POST_WRITE_FAILURE' });
  const [fromNetworkNode] = runCode(publish, 'Preparar fallo tras Postiz', { nodes: { 'Validar trabajo': [{ job: JOB }], 'Postiz GMB': [{ id: 'post-7' }] }, input: [{ error: 'boom' }] });
  assert.equal(fromNetworkNode.json.publication.postizPostId, 'post-7', 'the id comes from whichever per-network Postiz node ran');
  const [noId] = runCode(publish, 'Preparar fallo tras Postiz', { nodes: { 'Validar trabajo': [{ job: JOB }], 'Postiz Instagram': [{ error: { message: 'Bad request' } }] }, input: [{ error: 'boom' }] });
  assert.equal(noId.json.publication.postizPostId, null);
});

test('reschedule reports failed before touching Postiz and unknown after it', () => {
  const reschedule = loadWorkflow('inficon-global/reschedule.v1.json');
  for (const name of ['Validar trabajo', 'Heartbeat antes de Postiz', 'Cargar contexto Infidash', 'Preparar reprogramacion']) assert.deepEqual(targets(reschedule, name, 1), ['Preparar fallo confirmado'], name);
  for (const name of ['Capturar respuesta Postiz', 'Heartbeat despues de Postiz', 'Normalizar reprogramacion', 'Registrar evento Postiz', 'Guardar resultado Infidash', 'Capturar error Postiz', 'Heartbeat despues de error Postiz', 'Clasificar error Postiz', 'Registrar evento ambiguo o fallo']) assert.deepEqual(targets(reschedule, name, 1), ['Preparar fallo tras Postiz'], name);
  const [before] = runCode(reschedule, 'Preparar fallo confirmado', { nodes: { 'Trabajo recibido': [{ job: { ...JOB, kind: 'reschedule' } }] }, input: [{ error: 'Contrato reschedule v1 invalido' }] });
  assert.equal(before.json.status, 'failed');
  assert.equal(before.json.jobId, 'job-1');
  assert.throws(() => runCode(reschedule, 'Preparar fallo confirmado', { nodes: { 'Trabajo recibido': [{ job: { id: 'job-1' } }] }, input: [{ error: 'x' }] }), /leaseToken/);
  const [after] = runCode(reschedule, 'Preparar fallo tras Postiz', { nodes: { 'Validar trabajo': [{ job: JOB }], 'Capturar respuesta Postiz': [{ postizResponse: { id: 'post-3' } }] }, input: [{ error: { message: 'La reserva caducó' } }] });
  assert.equal(after.json.status, 'unknown');
  assert.equal(after.json.publication.postizPostId, 'post-3');
  assert.equal(after.json.publication.errorCode, 'POST_WRITE_FAILURE');
});

test('cancel reports failed unless the Postiz DELETE actually ran, then unknown with the post id', () => {
  const cancel = loadWorkflow('inficon-global/cancel.v1.json');
  for (const name of ['Validar trabajo', 'Heartbeat antes de cancelar', 'Cargar contexto Infidash', 'Preparar cancelacion']) assert.deepEqual(targets(cancel, name, 1), ['Preparar fallo confirmado'], name);
  for (const name of ['Heartbeat despues de Postiz', 'Normalizar cancelacion', 'Registrar evento Postiz', 'Guardar resultado Infidash', 'Heartbeat despues de error Postiz', 'Clasificar error Postiz', 'Registrar evento resultado cancelacion']) assert.deepEqual(targets(cancel, name, 1), ['Preparar fallo tras Postiz'], name);
  const [before] = runCode(cancel, 'Preparar fallo confirmado', { nodes: { 'Validar trabajo': [{ job: JOB }] }, input: [{ error: 'Cuenta Postiz no autorizada' }] });
  assert.equal(before.json.status, 'failed');
  const base = { 'Validar trabajo': [{ job: JOB }], 'Preparar cancelacion': [{ postizPostId: 'post-5' }] };
  const [noDelete] = runCode(cancel, 'Preparar fallo tras Postiz', { nodes: base, input: [{ error: 'La reserva caducó' }] });
  assert.equal(noDelete.json.status, 'failed', 'nothing was deleted, so the failure is retryable');
  const [afterDelete] = runCode(cancel, 'Preparar fallo tras Postiz', { nodes: { ...base, 'Eliminar publicacion en Postiz': [{}] }, input: [{ error: 'La reserva caducó' }] });
  assert.equal(afterDelete.json.status, 'unknown');
  assert.deepEqual({ status: afterDelete.json.publication.status, postizPostId: afterDelete.json.publication.postizPostId }, { status: 'unknown', postizPostId: 'post-5' });
});

test('reconcile resolves publications without a Postiz id instead of crashing', () => {
  const reconcile = loadWorkflow('reconcile.v1.json');
  assert.deepEqual(targets(reconcile, 'Cargar contexto Infidash'), ['Tiene postizPostId']);
  assert.deepEqual(targets(reconcile, 'Tiene postizPostId', 0), ['Preparar consulta Postiz']);
  assert.deepEqual(targets(reconcile, 'Tiene postizPostId', 1), ['Marcar sin id Postiz']);
  const [missing] = runCode(reconcile, 'Marcar sin id Postiz', { nodes: { 'Validar trabajo': [{ job: { ...JOB, payload: { publication: { accountId: 'account-1' } } } }] } });
  assert.equal(missing.json.status, 'succeeded');
  assert.deepEqual(missing.json.publication, { status: 'failed', postizPostId: null, errorCode: 'POSTIZ_ID_MISSING', errorMessage: 'Postiz no devolvió un identificador. Comprueba en Postiz si la publicación existe antes de reenviarla.' });
  assert.equal(missing.json.event.eventType, 'postiz.reconcile_missing_id');
  assert.equal(missing.json.event.sourceEventId, 'postiz-reconcile-missing:job-1');
  assert.equal(missing.json.event.publicationStatus, 'failed');
  assert.equal(missing.json.event.entityType, 'publication');
  const eventNode = targets(reconcile, 'Marcar sin id Postiz')[0];
  const resultNode = targets(reconcile, eventNode)[0];
  assert.match(nodeNamed(reconcile, eventNode).parameters.url, /\/api\/internal\/content\/events/);
  assert.match(nodeNamed(reconcile, resultNode).parameters.url, /\/result/);
  assert.match(nodeNamed(reconcile, resultNode).parameters.body, /Marcar sin id Postiz/);

  assert.throws(() => runCode(reconcile, 'Preparar consulta Postiz', { nodes: { 'Validar trabajo': [{ job: { ...JOB, payload: { publication: { postizPostId: 'p-1', accountId: 'gone' } } } }] }, input: [{ accounts: [] }] }), /Cuenta Postiz no autorizada/);
  assert.deepEqual(targets(reconcile, 'Preparar consulta Postiz', 1), ['Preparar fallo confirmado']);
  const [failure] = runCode(reconcile, 'Preparar fallo confirmado', { nodes: { 'Validar trabajo': [{ job: JOB }] }, input: [{ error: { message: 'Cuenta Postiz no autorizada' } }] });
  assert.equal(failure.json.status, 'failed');
  assert.equal(failure.json.publication, undefined);
});

test('reconcile maps a Postiz cancellation made outside Infidash', () => {
  const reconcile = loadWorkflow('reconcile.v1.json');
  const [normalized] = runCode(reconcile, 'Normalizar estado Postiz', { nodes: {
    'Validar trabajo': [{ job: JOB }], 'Preparar consulta Postiz': [{ postizPostId: 'p-1', accountId: 'account-1', instanceKey: 'postiz-main' }],
    'Consultar publicaciones Postiz': [{ posts: [{ id: 'p-1', status: 'cancelled' }] }],
  } });
  assert.equal(normalized.json.publication.status, 'cancelled');
  assert.equal(normalized.json.event.publicationStatus, 'cancelled');
});

test('dispatcher fails loudly on unexpected claim responses and reports binding failures to Infidash', () => {
  const dispatcher = loadWorkflow('dispatcher.v1.json');
  const claim = nodeNamed(dispatcher, 'Reservar siguiente trabajo');
  assert.deepEqual(claim.parameters.options.response.response, { fullResponse: true, neverError: true });
  assert.deepEqual(targets(dispatcher, 'Reservar siguiente trabajo'), ['Interpretar reserva']);
  assert.deepEqual(targets(dispatcher, 'Interpretar reserva'), ['Hay trabajo']);
  assert.deepEqual(runCode(dispatcher, 'Interpretar reserva', { input: [{ statusCode: 204, body: '' }] }), []);
  assert.deepEqual(runCode(dispatcher, 'Interpretar reserva', { input: [{ statusCode: 200, body: { job: JOB } }] }), [{ json: { job: JOB } }]);
  assert.deepEqual(runCode(dispatcher, 'Interpretar reserva', { input: [{ statusCode: 200, body: JSON.stringify({ job: JOB }) }] }), [{ json: { job: JOB } }]);
  assert.throws(() => runCode(dispatcher, 'Interpretar reserva', { input: [{ statusCode: 401, body: { error: 'Token de servicio inválido o caducado' } }] }), /401.*Token de servicio/);
  assert.throws(() => runCode(dispatcher, 'Interpretar reserva', { input: [{ statusCode: 200, body: {} }] }), /200/);

  const resolved = runCode(dispatcher, 'Resolver workflow autorizado', { nodes: { 'Interpretar reserva': [{ job: { ...JOB, kind: 'publish' } }] }, input: [{ settings: { workflow_bindings: { publish: 'wf-1' } } }] });
  assert.equal(resolved[0].json.workflowId, 'wf-1');
  assert.doesNotMatch(JSON.stringify(dispatcher), /\$\('Reservar siguiente trabajo'\)\.first\(\)\.json\.job/);

  for (const name of ['Cargar binding del cliente', 'Resolver workflow autorizado', 'Renovar lease antes de ejecutar', 'Ejecutar workflow del cliente']) {
    assert.equal(nodeNamed(dispatcher, name).onError, 'continueErrorOutput', name);
    assert.deepEqual(targets(dispatcher, name, 1), ['Preparar fallo dispatcher'], name);
  }
  assert.deepEqual(targets(dispatcher, 'Preparar fallo dispatcher'), ['Guardar fallo dispatcher']);
  const [report] = runCode(dispatcher, 'Preparar fallo dispatcher', { nodes: { 'Interpretar reserva': [{ job: JOB }] }, input: [{ error: { message: 'No hay workflow binding para publish y client-a' } }] });
  assert.deepEqual(report.json, { jobId: 'job-1', body: { schemaVersion: 1, clientId: 'client-a', status: 'failed', error: 'No hay workflow binding para publish y client-a', result: { workflowVersion: 1, stage: 'dispatcher' }, leaseToken: 'lease-1' } });
  const save = nodeNamed(dispatcher, 'Guardar fallo dispatcher').parameters;
  assert.match(save.url, /\/api\/internal\/content\/jobs\/' \+ \$json\.jobId \+ '\/result/);
  assert.match(save.body, /JSON\.stringify\(\$json\.body\)/);
  assert.match(nodeNamed(dispatcher, 'Renovar lease antes de ejecutar').parameters.body, /leaseSeconds:1800/);
});

const MERGE_INPUTS: Record<number, string> = { 0: 'published_articles', 1: 'trends', 3: 'historical', 4: 'search_console', 5: 'queries_analytics', 6: 'serplab_rankings', 7: 'seasonal' };

test('plan data sources are optional: every source failure feeds a stub into the same merge input', () => {
  const plan = loadWorkflow('inficon-global/plan.v1.json');
  const merge = edgesInto(plan, '🔗 Merge 4 Análisis');
  for (let input = 0; input < 8; input += 1) assert.ok(merge.some((edge) => edge.input === input && edge.output === 0), `merge input ${input} has a success feeder`);
  for (const [input, analysisType] of Object.entries(MERGE_INPUTS)) {
    const stubs = merge.filter((edge) => edge.input === Number(input) && edge.from.startsWith('Sin datos:'));
    assert.equal(stubs.length, 1, `merge input ${input} has exactly one stub`);
    const [stub] = runCode(plan, stubs[0].from, { input: [{ error: { message: 'HTTP 500' } }] });
    assert.equal(stub.json.analysis_type, analysisType);
    assert.equal(stub.json.unavailable, true);
    assert.equal(stub.json.error, 'HTTP 500');
    assert.match(stub.json.insights, /^Sin datos disponibles de /);
  }
  for (const source of ['📈 A: Google Trends', '🌍 D: Estacionalidad — SerpAPI', '📊 C: GA4 — Top Contenidos', 'Query search console', 'Pages search console', 'Datos serprobot 7 dias', '🏢 B: Scrape JINA Reader1', '🏢 B: Scrape JINA Reader3', '🤖 Agente IA: Tendencias1', '🤖 Agente IA: Histórico1', '🤖 Agente IA: SC Páginas1', '🤖 Agente IA: Queries1', '🤖 Agente IA: Rankings1', '🤖 Agente IA: Estacionalidad1', '🏢 B: IA Analiza Competidor', '🏢 B: IA Analiza Competidor2']) {
    const [stub] = targets(plan, source, 1);
    assert.ok(stub?.startsWith('Sin datos:'), `${source} degrades to a stub, got ${stub}`);
  }
  for (const [jina, input] of [['🏢 B: Scrape JINA Reader1', 0], ['🏢 B: Scrape JINA Reader3', 1]] as const) {
    const stubName = targets(plan, jina, 1)[0];
    assert.deepEqual(edgesInto(plan, 'Merge').filter((edge) => edge.from === stubName).map((edge) => edge.input), [input]);
    const [stub] = runCode(plan, stubName, { input: [{ error: 'timeout' }] });
    assert.equal(stub.json.unavailable, true);
    assert.ok(Array.isArray(stub.json.articulos));
  }
  const reporters = new Set(edgesInto(plan, 'Preparar fallo confirmado').map((edge) => edge.from));
  const allowed = new Set(['Validar trabajo', 'Heartbeat inicial', 'Cargar contexto Infidash', '⚙️ Configuración', '🧩 Preparar Contexto IA', '🤖 IA: Plan de Contenidos', '📝 Parsear Plan JSON', 'Heartbeat tras IA', 'Normalizar resultado del plan', 'Guardar resultado Infidash']);
  for (const reporter of reporters) assert.ok(allowed.has(reporter), `${reporter} must not fail the whole plan`);
  for (const core of ['🤖 IA: Plan de Contenidos', 'Heartbeat inicial', 'Heartbeat tras IA', 'Cargar contexto Infidash', 'Normalizar resultado del plan']) assert.ok(reporters.has(core), `${core} reports failures`);
});

test('the plan synthesis context tolerates stub analyses', () => {
  const plan = loadWorkflow('inficon-global/plan.v1.json');
  const stubs = Object.values(MERGE_INPUTS).map((analysisType) => ({ analysis_type: analysisType, unavailable: true, error: 'HTTP 500', insights: `Sin datos disponibles de ${analysisType}` }));
  const [context] = runCode(plan, '🧩 Preparar Contexto IA', {
    input: [...stubs, { analysis_type: 'competitors', competitors_analysis: [] }],
    nodes: { '⚙️ Configuración': [{ topic: 'marketing', keywords: 'seo, sem', weeks_horizon: 4, country: 'ES' }], 'Cargar contexto Infidash': [{ planItems: [] }] },
  });
  assert.match(context.json.trends_data, /Fuente no disponible/);
  assert.match(context.json.trends_data, /Sin datos disponibles de trends/);
  assert.deepEqual(context.json.config.keywords_list, ['seo', 'sem']);
});

test('the plan normalizer dates proposals from a YYYY-MM-DD periodStart and reports parse errors', () => {
  const plan = loadWorkflow('inficon-global/plan.v1.json');
  const job = { ...JOB, target_id: 'calendar-1', payload: { periodStart: '2026-10-05' } };
  const parsed = { success: true, plan: { content_plan: [{ week: 2, posts: [{ title: 'Guía', day: 'miércoles', keywords: ['bombas'] }] }] } };
  const [result] = runCode(plan, 'Normalizar resultado del plan', { nodes: { 'Validar trabajo': [{ job }], '📝 Parsear Plan JSON': [parsed] } });
  assert.equal(result.json.planItems[0].plannedAt, '2026-10-14T00:00:00.000Z');
  assert.throws(() => runCode(plan, 'Normalizar resultado del plan', { nodes: { 'Validar trabajo': [{ job }], '📝 Parsear Plan JSON': [{ success: false, error: 'Unexpected token } in JSON' }] } }), /Unexpected token/);
});

test('the plan workflow has no client-specific hardcoded values or paired-item config lookups', () => {
  const raw = readFileSync(join(workflowRoot, 'inficon-global', 'plan.v1.json'), 'utf8');
  for (const hardcoded of ['soyrafaramos.com', 'moodmarketing.es', '4958413', 'GA4_PROPERTY_ID_INFICON', 'inficonglobal.es', 'marketing digital y automatización', 'inficon-plan:']) {
    assert.equal(raw.includes(hardcoded), false, `plan.v1.json must not contain ${hardcoded}`);
  }
  assert.equal(raw.includes("$('⚙️ Configuración').item"), false, 'Configuración1 is read with .first(), never .item, so merges cannot break paired-item resolution');
  const plan = loadWorkflow('inficon-global/plan.v1.json');
  assert.match(nodeNamed(plan, '🤖 IA: Plan de Contenidos').parameters.text, /\{\{ \$json\.config\.keywords \}\}/);
  assert.match(nodeNamed(plan, '🤖 Agente IA: Tendencias1').parameters.text, /negocio del sector \{\{ \$\('⚙️ Configuración'\)\.first\(\)\.json\.topic \}\}/);
});

test('plan configuration comes only from editorial_config and fails loudly without topic or site URL', () => {
  const plan = loadWorkflow('inficon-global/plan.v1.json');
  const run = (config: Record<string, unknown> | null) => runCode(plan, '⚙️ Configuración', { nodes: { 'Cargar contexto Infidash': [{ settings: { editorial_config: config }, planItems: [] }] } })[0].json;
  assert.throws(() => run({ siteUrl: 'https://example.com' }), /Falta editorial_config\.topic/);
  assert.throws(() => run({ topic: '   ', siteUrl: 'https://example.com' }), /Falta editorial_config\.topic/);
  assert.throws(() => run({ topic: 'Fontanería' }), /Falta editorial_config\.siteUrl/);
  assert.throws(() => run(null), /Falta editorial_config\.topic/);

  const minimal = run({ topic: ' Fontanería ', site_url: 'https://example.com' });
  assert.equal(minimal.topic, 'Fontanería');
  assert.equal(minimal.site_url, 'https://example.com', 'site_url is accepted as a legacy alias of siteUrl');
  assert.equal(minimal.keywords, 'Fontanería', 'keywords fall back to the topic');
  assert.deepEqual(minimal.keywords_list, ['Fontanería']);
  assert.deepEqual(minimal.competitors, []);
  assert.equal(minimal.serprobotProjectId, null);
  assert.equal(minimal.ga4PropertyId, null);
  assert.equal(minimal.country, 'ES');
  assert.equal(minimal.weeks_horizon, 4);

  const full = run({ topic: 'Fontanería', siteUrl: 'https://shop.example', site_url: 'https://ignored.example', keywords: [' desatascos ', '', 'calderas'], competitors: ['a.com', ' b.com '], serprobotProjectId: 123, ga4PropertyId: ' 456 ', country: 'MX', weeksHorizon: '6' });
  assert.equal(full.site_url, 'https://shop.example');
  assert.equal(full.keywords, 'desatascos, calderas');
  assert.deepEqual(full.keywords_list, ['desatascos', 'calderas']);
  assert.deepEqual(full.competitors, ['a.com', 'b.com']);
  assert.equal(full.serprobotProjectId, '123');
  assert.equal(full.ga4PropertyId, '456');
  assert.equal(full.country, 'MX');
  assert.equal(full.weeks_horizon, 6);
  assert.deepEqual(run({ topic: 'Fontanería', siteUrl: 'https://example.com', keywords: 'seo, , sem' }).keywords_list, ['seo', 'sem'], 'legacy comma-separated keywords are still read');
});

test('the generate workflow is a client-agnostic template driven by editorial_config', () => {
  const raw = readFileSync(join(workflowRoot, 'inficon-global', 'generate.v1.json'), 'utf8');
  for (const hardcoded of ['inficonglobal.es', 'Inficon Global', 'marketing digital', 'inficon-generate']) {
    assert.equal(raw.includes(hardcoded), false, `generate.v1.json must not contain ${hardcoded}`);
  }
  const generate = loadWorkflow('inficon-global/generate.v1.json');
  const site = "$('Preparar contenido aprobado').first().json.siteUrl";
  assert.equal(nodeNamed(generate, 'Subir imagen a WordPress').parameters.url, `={{ ${site} + '/wp-json/wp/v2/media' }}`);
  assert.ok(nodeNamed(generate, 'Asignar imagen cabecera').parameters.url.includes(`${site} + '/wp-json/wp/v2/posts/'`));
  assert.match(nodeNamed(generate, 'Generar imagen cabecera IA').parameters.body, /\.sector \? ' del sector '/);
  const writer = nodeNamed(generate, 'SEO Content Writer2').parameters.messages.values[0].content;
  assert.match(writer, /redactor SEO senior de \{\{ \$json\.brandName \}\}\*\*, empresa del sector \*\*\{\{ \$json\.sector \}\}\*\*/);
  assert.match(writer, /Puedes mencionar a \*\*\{\{ \$json\.brandName \}\}\*\*/);
});
