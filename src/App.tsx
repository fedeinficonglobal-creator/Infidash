import { Suspense, lazy, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { LoginScreen } from './components/LoginScreen';
import { TabSkeleton } from './components/TabSkeleton.js';
import { LazyBoundary } from './components/LazyBoundary.js';
import { useClientStore } from './store/useClientStore';
import type { SessionUser } from './services/infidashApi.js';
import { getAvatarInitials } from './lib/avatarInitials.js';
import { DASHBOARD_PATH, clientPath } from './lib/routes.js';
import { useRouteSync } from './hooks/useRouteSync.js';
import { useAppNavigation } from './hooks/useAppNavigation.js';
import { ConfirmProvider } from './hooks/useConfirm.js';
import { signInToDashboard } from './lib/authNavigation.js';
import { Link, Navigate, useNavigate } from 'react-router';
import { ChevronDown, LoaderCircle, Settings2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { selectAppShell } from './store/selectors.js';

// Tabs are loaded on demand so the initial bundle only carries the shell and login.
const OverviewTab = lazy(() => import('./components/OverviewTab.js').then((m) => ({ default: m.OverviewTab })));
const SalesTab = lazy(() => import('./components/SalesTab.js').then((m) => ({ default: m.SalesTab })));
const TrafficTab = lazy(() => import('./components/TrafficTab.js').then((m) => ({ default: m.TrafficTab })));
const WebTab = lazy(() => import('./components/WebTab.js').then((m) => ({ default: m.WebTab })));
const SeoTab = lazy(() => import('./components/SeoTab.js').then((m) => ({ default: m.SeoTab })));
const LeadsTab = lazy(() => import('./components/LeadsTab.js').then((m) => ({ default: m.LeadsTab })));
const RrssTab = lazy(() => import('./components/RrssTab.js').then((m) => ({ default: m.RrssTab })));
const AiInsightsTab = lazy(() => import('./components/AiInsightsTab.js').then((m) => ({ default: m.AiInsightsTab })));
const ReportsTab = lazy(() => import('./components/ReportsTab.js').then((m) => ({ default: m.ReportsTab })));
const IntegrationsTab = lazy(() => import('./components/IntegrationsTab.js').then((m) => ({ default: m.IntegrationsTab })));
const UserProfile = lazy(() => import('./components/UserProfile.js').then((m) => ({ default: m.UserProfile })));
const AgencyDashboard = lazy(() => import('./components/AgencyDashboard.js').then((m) => ({ default: m.AgencyDashboard })));
const UsersAdminTab = lazy(() => import('./components/UsersAdminTab.js').then((m) => ({ default: m.UsersAdminTab })));
const ContentTab = lazy(() => import('./components/content/ContentTab.js').then((m) => ({ default: m.ContentTab })));

export default function App() {
  const {
    bootstrapSession,
    isBootstrapping,
    sessionToken,
    currentUser,
    signIn,
    authError,
    sessionExpiredMessage,
    isAuthenticating,
  } = useClientStore(useShallow(selectAppShell));
  const navigate = useNavigate();

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  if (isBootstrapping) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl bg-white px-6 py-4 shadow-lg border border-slate-100">
          <LoaderCircle className="size-5 animate-spin text-brand-primary" />
          <span className="text-sm font-medium text-slate-600">Cargando Infidash...</span>
        </div>
      </div>
    );
  }

  if (!sessionToken || !currentUser) {
    return <LoginScreen isLoading={isAuthenticating} error={authError} notice={sessionExpiredMessage} onLogin={(email, password) => signInToDashboard(signIn, navigate, email, password)} />;
  }

  return (
    <ConfirmProvider>
      <AuthenticatedApp currentUser={currentUser} />
    </ConfirmProvider>
  );
}

function AuthenticatedApp({ currentUser }: { currentUser: SessionUser }) {
  const clients = useClientStore((state) => state.clients);
  const route = useRouteSync();
  const { goToUsersAdmin, goToProfile } = useAppNavigation();

  if (route.type === 'redirect') {
    return <Navigate to={route.to} replace />;
  }

  const activeClientId = route.type === 'view' ? route.clientId : null;
  const activeTabId = route.type === 'view' ? route.tabId : 'overview';
  const activeClient = clients.find((c) => c.id === activeClientId) || null;

  const renderTab = () => {
    if (route.type === 'pending') {
      return (
        <div className="flex items-center justify-center py-24">
          <LoaderCircle className="size-6 animate-spin text-brand-primary" />
        </div>
      );
    }

    if (activeTabId === 'users-admin') {
      return <UsersAdminTab />;
    }

    if (activeTabId === 'profile') {
      return <UserProfile />;
    }

    if (activeTabId === 'content') {
      return <ContentTab clientId={activeClient?.id ?? null} />;
    }

    if (!activeClient) {
      return <AgencyDashboard />;
    }

    switch (activeTabId) {
      case 'overview': return <OverviewTab client={activeClient} />;
      case 'sales': return <SalesTab client={activeClient} />;
      case 'traffic': return <TrafficTab client={activeClient} />;
      case 'web': return <WebTab client={activeClient} />;
      case 'seo': return <SeoTab client={activeClient} />;
      case 'leads': return <LeadsTab client={activeClient} />;
      case 'rrss': return <RrssTab client={activeClient} />;
      case 'integrations': return <IntegrationsTab client={activeClient} />;
      case 'ai': return <AiInsightsTab client={activeClient} />;
      case 'reports': return <ReportsTab client={activeClient} />;
      default: return <OverviewTab client={activeClient} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />

      <main className="flex-1 flex flex-col">
        {/* Navbar */}
        <header className="h-20 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 text-slate-500">
                <Link
                  to={DASHBOARD_PATH}
                  className="text-sm font-medium hover:text-slate-900 transition-colors"
                >
                  Dashboard
                </Link>
                {activeClient && (
                  <>
                    <span className="text-slate-500">/</span>
                    <Link
                      to={clientPath(activeClient.slug)}
                      className={activeTabId === 'content' ? 'text-sm font-medium hover:text-slate-900 transition-colors' : 'text-sm font-bold text-slate-900'}
                    >
                      {activeClient.name}
                    </Link>
                  </>
                )}
                {activeTabId === 'content' && (
                  <>
                    <span className="text-slate-500">/</span>
                    <span className="text-sm font-bold text-slate-900">Contenidos</span>
                  </>
                )}
             </div>
          </div>

             <div className="flex items-center gap-6">
             <div className="flex items-center gap-3 border-l border-slate-200 pl-6">
                {currentUser.role === 'admin' && (
                  <button
                    type="button"
                    onClick={goToUsersAdmin}
                    className="p-2 text-slate-500 hover:text-slate-700 transition-colors relative group rounded-xl hover:bg-slate-50"
                    aria-label="Administración de usuarios"
                    title="Administración de usuarios"
                  >
                    <Settings2 className="size-5 group-hover:rotate-45 transition-transform" />
                  </button>
                )}
                <button
                   type="button"
                   onClick={goToProfile}
                   className="flex items-center gap-3 pl-3 active:scale-95 transition-transform cursor-pointer group"
                >
                   <div className="size-10 bg-slate-100 rounded-full flex items-center justify-center border-2 border-white overflow-hidden shadow-sm">
                      <span aria-label={`Iniciales de ${currentUser.name}`} className="text-sm font-bold text-slate-700">{getAvatarInitials(currentUser.name)}</span>
                   </div>
                   <div className="hidden md:block">
                      <p className="text-sm font-bold text-slate-900 leading-none mb-1">{currentUser.name}</p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">{currentUser.role === 'admin' ? 'Administrador' : 'Visualizador'}</p>
                   </div>
                   <ChevronDown className="size-4 text-slate-500 group-hover:translate-y-0.5 transition-transform" />
                </button>
             </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto w-full">
           <LazyBoundary>
             <Suspense fallback={<TabSkeleton />}>
               {renderTab()}
             </Suspense>
           </LazyBoundary>
        </div>
      </main>

    </div>
  );
}
