export interface BootstrapEnvironment {
  NODE_ENV?: string;
  INFIDASH_ADMIN_EMAIL?: string;
  INFIDASH_ADMIN_NAME?: string;
  INFIDASH_ADMIN_PASSWORD?: string;
  INFIDASH_VIEWER_EMAIL?: string;
  INFIDASH_VIEWER_NAME?: string;
  INFIDASH_VIEWER_PASSWORD?: string;
}

export interface BootstrapUser {
  email: string;
  name: string;
  role: 'admin' | 'viewer';
  password: string;
}

export function getBootstrapUsers(env: BootstrapEnvironment, activeAdminExists: boolean): BootstrapUser[] {
  const production = env.NODE_ENV === 'production';
  if (production && !activeAdminExists
    && (!env.INFIDASH_ADMIN_PASSWORD || env.INFIDASH_ADMIN_PASSWORD.length < 12 || env.INFIDASH_ADMIN_PASSWORD === 'admin1234')) {
    throw new Error('Production requires an INFIDASH_ADMIN_PASSWORD of at least 12 characters before the first admin can be created.');
  }

  const users: BootstrapUser[] = [];
  if (!activeAdminExists) {
    users.push({
      email: (env.INFIDASH_ADMIN_EMAIL ?? 'admin@infidash.local').trim().toLowerCase(),
      name: env.INFIDASH_ADMIN_NAME ?? 'Administrador',
      role: 'admin',
      password: env.INFIDASH_ADMIN_PASSWORD ?? 'admin1234',
    });
  }

  if (!production || env.INFIDASH_VIEWER_PASSWORD) {
    const viewerPassword = env.INFIDASH_VIEWER_PASSWORD ?? 'viewer1234';
    if (production && viewerPassword.length < 12) {
      throw new Error('Production requires an INFIDASH_VIEWER_PASSWORD of at least 12 characters when bootstrapping a viewer.');
    }
    if (!production || viewerPassword !== 'viewer1234') {
      users.push({
        email: (env.INFIDASH_VIEWER_EMAIL ?? 'viewer@infidash.local').trim().toLowerCase(),
        name: env.INFIDASH_VIEWER_NAME ?? 'Visualizador',
        role: 'viewer',
        password: viewerPassword,
      });
    }
  }

  return users;
}
