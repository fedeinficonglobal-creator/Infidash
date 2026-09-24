export interface ServerRuntimeEnvironment {
  NODE_ENV?: string;
  INFIDASH_TEST_RUNNER_MANAGED_API?: string;
}

export function shouldServeHttp(env: ServerRuntimeEnvironment) {
  return env.NODE_ENV !== 'test' || env.INFIDASH_TEST_RUNNER_MANAGED_API === '1';
}
