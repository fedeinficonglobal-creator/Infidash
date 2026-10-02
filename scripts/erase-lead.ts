import { config as loadDotenv } from 'dotenv';
import { closeCorePool, getCorePool, withCoreTransaction } from '../src/lib/corePool.js';
import { EraseArgsError, eraseLeadsByEmail, findLeadIdsByEmail, hashEmailForLog, parseEraseArgs } from '../src/lib/leadErasure.js';
import { logger } from '../src/lib/logger.js';

// Usage: tsx scripts/erase-lead.ts --email=<correo> [--client=<clientId>] [--note=<texto>] [--apply]
// Dry-run by default: counts the leads that match. With --apply they are deleted in one transaction.
// Only the count and the lead ids are printed; names, e-mails and phones are never shown or logged.

loadDotenv({ path: '.env' });
loadDotenv({ path: '.env.local', override: true });

let exitCode = 0;
try {
  const args = parseEraseArgs(process.argv.slice(2));
  const scope = args.clientId ? `cliente ${args.clientId}` : 'todos los clientes';

  if (!args.apply) {
    const ids = await findLeadIdsByEmail(getCorePool(), args.email, args.clientId);
    console.log(`Simulacion (${scope}): ${ids.length} lead(s) coinciden.`);
    if (ids.length > 0) console.log(`Ids: ${ids.join(', ')}`);
    console.log('No se ha borrado nada. Repite con --apply para borrar.');
  } else {
    const ids = await withCoreTransaction((tx) => eraseLeadsByEmail(tx, args.email, args.clientId));
    logger.info({
      event: 'lead_erasure',
      deleted: ids.length,
      emailHash: hashEmailForLog(args.email),
      clientId: args.clientId,
      note: args.note || undefined,
    }, 'borrado de leads por solicitud del interesado');
    console.log(`Borrados ${ids.length} lead(s) (${scope}).`);
    if (ids.length > 0) console.log(`Ids: ${ids.join(', ')}`);
    console.log('Recuerda: los backups existentes conservan el dato hasta que rotan (ver docs/gdpr-retention.md).');
  }
} catch (error) {
  exitCode = 1;
  if (error instanceof EraseArgsError) {
    console.error(`Error: ${error.message}`);
    console.error('Uso: npm run leads:erase -- --email=<correo> [--client=<clientId>] [--note=<texto>] [--apply]');
  } else {
    // Database errors can echo connection details; print the message only.
    console.error(`No se pudo completar: ${error instanceof Error ? error.message : String(error)}`);
  }
} finally {
  await closeCorePool().catch(() => undefined);
}
process.exit(exitCode);
