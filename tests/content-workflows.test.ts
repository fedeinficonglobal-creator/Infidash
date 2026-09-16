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
  assert.equal(workflowFiles.length, 5);
  for (const path of workflowFiles) {
    const source = readFileSync(path, 'utf8');
    const workflow = JSON.parse(source);
    const label = relative(repoRoot, path);
    assert.equal(workflow.active, false, `${label} must be imported disabled`);
    assert.equal('pinData' in workflow, false, `${label} contains execution pinData`);
    assert.equal('credentials' in workflow, false, `${label} contains top-level credentials`);
    assert.doesNotMatch(source, /n8n-nodes-base\.googleSheets/i, `${label} still uses Google Sheets`);
    assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{16,}|Bearer\s+(?!['" +]*\$env)[A-Za-z0-9._-]{16,}/, `${label} appears to contain a secret`);

    const names = new Set<string>(workflow.nodes.map((node: any) => node.name));
    assert.equal(names.size, workflow.nodes.length, `${label} has duplicate node names`);
    for (const node of workflow.nodes) assert.equal('credentials' in node, false, `${label}/${node.name} contains credential ids`);
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
  assert.match(generate, /generate_content/);
  assert.match(generate, /wordpress\.draft_created/);
  assert.match(generate, /status: 'draft'/);
  assert.match(publish, /kind !== 'publish'/);
  assert.match(publish, /status: 'scheduled'/);
  assert.doesNotMatch(publish, /status: 'published'/);
});

test('dispatcher and reconciliation use claims, bindings, events and result callbacks', () => {
  const dispatcher = readFileSync(join(workflowRoot, 'dispatcher.v1.json'), 'utf8');
  const reconcile = readFileSync(join(workflowRoot, 'reconcile.v1.json'), 'utf8');
  assert.match(dispatcher, /\/api\/internal\/content\/jobs\/claim/);
  assert.match(dispatcher, /workflow_bindings/);
  assert.match(dispatcher, /n8n-nodes-base\.executeWorkflow/);
  assert.match(reconcile, /kind !== 'reconcile'/);
  assert.match(reconcile, /\/api\/internal\/content\/events/);
  assert.match(reconcile, /publicationStatus/);
  assert.match(reconcile, /publishedAt verificable/);
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
