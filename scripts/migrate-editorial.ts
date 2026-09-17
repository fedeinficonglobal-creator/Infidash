import { config as loadDotenv } from 'dotenv';
import { closeEditorialPool, getEditorialPool } from '../src/server/content/postgres.js';
import { runEditorialMigrations } from '../src/server/content/migrations.js';

loadDotenv({ path: '.env' });
loadDotenv({ path: '.env.local', override: true });

try {
  const result = await runEditorialMigrations(getEditorialPool());
  console.log(JSON.stringify(result, null, 2));
} finally {
  await closeEditorialPool();
}
