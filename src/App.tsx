import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { StatusPage } from './components/StatusPage';
import { LoadingPortal } from './features/loading/LoadingPortal';
import { OffloadingPortal } from './features/offloading/OffloadingPortal';
import { AuthenticatedLayout } from './layouts/AuthenticatedLayout';
import { configurationError } from './lib/supabase';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import { LoginPage } from './pages/LoginPage';
import { PortalPage } from './pages/PortalPage';
import { AccountGate, HomeRedirect, LoginOnly, RequireRole, RequireSession } from './routing/RouteGuards';
import { PORTALS, type PortalRole } from './routing/roleRoutes';

export default function App() {
  if (configurationError) return <StatusPage title="Application configuration required">
    <p role="alert">{configurationError}</p>
  </StatusPage>;
  return <BrowserRouter><AuthProvider><Routes>
    <Route element={<AccountGate />}>
      <Route element={<LoginOnly />}><Route path="/login" element={<LoginPage />} /></Route>
      <Route element={<RequireSession />}>
        <Route path="/access-denied" element={<AccessDeniedPage />} />
      </Route>
      {(Object.keys(PORTALS) as PortalRole[]).map(role =>
        <Route key={role} element={<RequireRole role={role} />}>
          <Route element={<AuthenticatedLayout />}>
            <Route path={PORTALS[role].path} element={role === 'loading_officer'
              ? <LoadingPortal /> : role === 'offloading_officer'
                ? <OffloadingPortal /> : <PortalPage role={role} />} />
          </Route>
        </Route>
      )}
      <Route path="*" element={<HomeRedirect />} />
    </Route>
  </Routes></AuthProvider></BrowserRouter>;
}
