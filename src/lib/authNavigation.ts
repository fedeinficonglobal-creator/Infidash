import { DASHBOARD_PATH } from './routes.js';

type NavigateTo = (to: string, options?: { replace?: boolean }) => void | Promise<void>;

/**
 * An interactive login always lands on the agency dashboard. The login screen renders on
 * whatever URL was open (e.g. /perfil after logging out there), so the URL is moved to the
 * dashboard before the session exists; otherwise the authenticated app would resume that page.
 * Session bootstrap on reload does not go through here and keeps the current URL.
 */
export async function signInToDashboard(
  signIn: (email: string, password: string) => Promise<void>,
  navigate: NavigateTo,
  email: string,
  password: string,
) {
  void navigate(DASHBOARD_PATH, { replace: true });
  await signIn(email, password);
}

/** Logging out leaves the URL at the dashboard so a later login never resumes a stale page. */
export async function signOutToDashboard(signOut: () => Promise<void>, navigate: NavigateTo) {
  await signOut();
  void navigate(DASHBOARD_PATH, { replace: true });
}
