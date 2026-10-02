import { applyRetention, parseRetentionSettings } from '../src/lib/backupRetention.js';
import { createDatabaseBackup, getBackupDirectory } from '../src/lib/database.js';
import { scrubBackupSecrets } from '../src/lib/databaseBackup.js';

// Usage: tsx scripts/backup.ts [--label=name] [--no-retention]
// Takes one backup now through the same code as POST /api/admin/backup and the scheduler, then applies retention.

const args = process.argv.slice(2);
const labelArg = args.find((arg) => arg.startsWith('--label='));
const label = labelArg ? labelArg.slice('--label='.length) : 'manual';
const skipRetention = args.includes('--no-retention');

try {
  const backup = await createDatabaseBackup(label);
  console.log(`Backup creado: ${backup.name} (${backup.sizeBytes} bytes)`);

  if (!skipRetention) {
    const result = await applyRetention(getBackupDirectory(), parseRetentionSettings(process.env), {
      log: (level, message, meta) => console.log(`[${level}] ${message}: ${meta.name}${meta.error ? ` (${meta.error})` : ''}`),
    });
    console.log(`Retencion: ${result.kept.length} conservados, ${result.deleted.length} eliminados, ${result.failed.length} con error`);
  }
} catch (error) {
  const connectionString = process.env.DATABASE_URL ?? process.env.INFIDASH_DATABASE_URL ?? '';
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Backup fallido: ${scrubBackupSecrets(message, connectionString)}`);
  process.exitCode = 1;
}
