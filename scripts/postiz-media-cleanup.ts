import { config as loadDotenv } from 'dotenv';
import {
  checkDiskUsage,
  parseCleanupConfig,
  runMediaCleanup,
} from '../src/server/content/mediaCleanup.js';
import { loadMediaReferences, recordMediaCleanup } from '../src/server/content/mediaRetentionDb.js';
import { closeEditorialPool, getEditorialPool } from '../src/server/content/postgres.js';

// Deletes expired Postiz uploads. Dry-run by default; pass --apply to delete. See README ("Limpieza de vídeos de Postiz").
loadDotenv({ path: '.env' });
loadDotenv({ path: '.env.local', override: true });

const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const config = parseCleanupConfig(process.argv.slice(2), process.env);

  if (config.checkDisk) {
    const disk = await checkDiskUsage({ dir: config.uploadDir, warnPercent: config.warnPercent, minFreeGb: config.minFreeGb });
    console.log(`Disco de ${disk.dir}: ${disk.usedPercent.toFixed(1)}% usado, ${disk.freeGb.toFixed(1)} GB libres.`);
    for (const line of disk.messages) console.error(`ALERTA: ${line}`);
    if (!disk.ok) process.exitCode = 1;
    return;
  }

  try {
    const pool = getEditorialPool();
    const report = await runMediaCleanup({
      uploadDir: config.uploadDir,
      urlPrefix: config.urlPrefix,
      retentionDays: config.retentionDays,
      apply: config.apply,
      loadReferences: () => loadMediaReferences(pool),
      recordDeletion: (entry) => recordMediaCleanup(pool, entry),
    });

    console.log(config.apply ? 'Modo APLICAR: se borran los ficheros caducados.' : 'Modo SIMULACIÓN (dry-run): no se borra nada. Usa --apply para borrar.');
    console.log(`Retención: ${report.retentionDays} días. Referencias leídas: ${report.referencesRead}.`);
    console.log(`Caducados: ${report.candidates}. ${config.apply ? 'Borrados' : 'A borrar'}: ${report.deleted.length} (${formatMb(report.bytesFreed)} ${config.apply ? 'liberados' : 'a liberar'}). Ya no existían: ${report.missing.length}.`);
    console.log(`Conservados por estar referenciados: ${report.kept.length}. URLs ajenas ignoradas: ${report.ignored}. Omitidos: ${report.skipped.length}.`);
    for (const entry of report.deleted) console.log(`  ${config.apply ? 'borrado' : 'borraría'}: ${entry.relativePath} (${formatMb(entry.bytes)})`);
    for (const entry of report.kept) console.log(`  conservado (${entry.reason}): ${entry.relativePath}`);
    for (const entry of report.skipped) console.log(`  omitido (${entry.reason}): ${entry.url}`);
    for (const entry of report.errors) console.error(`  ERROR ${entry.relativePath}: ${entry.error}`);
    if (report.errors.length) process.exitCode = 1;

    try {
      const disk = await checkDiskUsage({ dir: config.uploadDir, warnPercent: config.warnPercent, minFreeGb: config.minFreeGb });
      console.log(`Disco: ${disk.usedPercent.toFixed(1)}% usado, ${disk.freeGb.toFixed(1)} GB libres.`);
    } catch {
      // Informational only.
    }
  } finally {
    await closeEditorialPool();
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
