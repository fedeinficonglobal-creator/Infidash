export interface ServerRuntimeEnvironment {
  NODE_ENV?: string;
  INFIDASH_TEST_RUNNER_MANAGED_API?: string;
  INFIDASH_SKIP_EDITORIAL_MIGRATIONS?: string;
}

export function shouldServeHttp(env: ServerRuntimeEnvironment) {
  return env.NODE_ENV !== 'test' || env.INFIDASH_TEST_RUNNER_MANAGED_API === '1';
}

/**
 * The HTTP server applies pending editorial migrations before it starts listening, so a deploy can
 * never serve code that expects a newer schema. INFIDASH_SKIP_EDITORIAL_MIGRATIONS=1 opts out.
 */
export function shouldRunEditorialMigrations(env: ServerRuntimeEnvironment) {
  return shouldServeHttp(env) && env.INFIDASH_SKIP_EDITORIAL_MIGRATIONS !== '1';
}
