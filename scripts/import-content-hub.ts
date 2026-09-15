import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { importContentHub, type ContentHubImportMappings } from '../src/server/content/importContentHub.js';
import { closeEditorialPool, getEditorialPool } from '../src/server/content/postgres.js';

function readArgument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

loadDotenv({ path: '.env' });
loadDotenv({ path: '.env.local', override: true });

const exportPath = path.resolve(readArgument('input') ?? path.join('..', 'estructura-db-content-hub.json'));
const mappingPath = readArgument('mapping');
const apply = process.argv.includes('--apply');
const exportData = JSON.parse(await fs.readFile(exportPath, 'utf8'));
const mappings = mappingPath
  ? JSON.parse(await fs.readFile(path.resolve(mappingPath), 'utf8')) as ContentHubImportMappings
  : { clients: {} };

try {
  const report = await importContentHub({
    exportData,
    mappings,
    dryRun: !apply,
    pool: apply ? getEditorialPool() : undefined,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.conflicts.length) process.exitCode = 2;
} finally {
  if (apply) await closeEditorialPool();
}
