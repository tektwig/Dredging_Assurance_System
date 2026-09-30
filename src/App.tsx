import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { StatusPage } from './components/StatusPage';
import { LoadingPortal } from './features/loading/LoadingPortal';
import { OffloadingPortal } from './features/offloading/OffloadingPortal';
import { OperationsDashboard } from './features/operations/dashboard/OperationsDashboard';
import { ManageCredentialsPage } from './features/operations/credentials/ManageCredentialsPage';
import { OperationsExceptionDetail } from './features/operations/exceptions/OperationsExceptionDetail';
import { OperationsExceptionsRegister } from './features/operations/exceptions/OperationsExceptionsRegister';
import { OperationsReports } from './features/operations/reports/OperationsReports';
import { OperationsTripDetail } from './features/operations/trips/OperationsTripDetail';
import { OperationsTripsRegister } from './features/operations/trips/OperationsTripsRegister';
import { OperationsDriverDetail, OperationsTruckDetail } from './features/operations/trucksDrivers/OperationsAssetDetail';
import { OperationsDriversList, OperationsTrucksList } from './features/operations/trucksDrivers/OperationsAssetsList';
import { OperationsWaybillDetail } from './features/operations/waybillsPayouts/OperationsWaybillDetail';
import { OperationsWaybillsRegister } from './features/operations/waybillsPayouts/OperationsWaybillsRegister';
import { AuthenticatedLayout } from './layouts/AuthenticatedLayout';
import { configurationError } from './lib/supabase';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import { LoginPage } from './pages/LoginPage';
import { PortalPage } from './pages/PortalPage';
import { AccountGate, HomeRedirect, LoginOnly, RequireRole, RequireSession } from './routing/RouteGuards';
import { ADMIN_NAVIGATION, OPERATIONS_NAVIGATION, PORTALS, type PortalRole } from './routing/roleRoutes';

const FIELD_PORTALS = ['loading_officer', 'offloading_officer'] as const satisfies readonly PortalRole[];

export default function App() {
  if (configurationError) {
    return (
      <StatusPage title="Application configuration required">
        <p role="alert">{configurationError}</p>
      </StatusPage>
    );
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<AccountGate />}>
            <Route element={<LoginOnly />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>

            <Route element={<RequireSession />}>
              <Route path="/access-denied" element={<AccessDeniedPage />} />
            </Route>

            {FIELD_PORTALS.map((role) => (
              <Route key={role} element={<RequireRole role={role} />}>
                <Route element={<AuthenticatedLayout />}>
                  <Route
                    path={PORTALS[role].path}
                    element={role === 'loading_officer' ? <LoadingPortal /> : <OffloadingPortal />}
                  />
                </Route>
              </Route>
            ))}

            <Route element={<RequireRole role="operations_manager" />}>
              <Route
                path={PORTALS.operations_manager.path}
                element={
                  <AuthenticatedLayout
                    accountAction={{
                      label: 'Manage Credentials',
                      to: '/operations/manage-credentials',
                    }}
                    navigation={{
                      basePath: PORTALS.operations_manager.path,
                      label: 'Operations',
                      items: OPERATIONS_NAVIGATION,
                    }}
                  />
                }
              >
                <Route index element={<OperationsDashboard />} />
                <Route path="manage-credentials" element={<ManageCredentialsPage />} />
                <Route path="create-credentials" element={<Navigate to="/operations/manage-credentials" replace />} />
                <Route path="trips" element={<OperationsTripsRegister />} />
                <Route path="trips/:tripId" element={<OperationsTripDetail />} />
                <Route path="trucks-drivers" element={<Navigate to="trucks" replace />} />
                <Route path="trucks-drivers/trucks" element={<OperationsTrucksList />} />
                <Route path="trucks-drivers/trucks/:truckId" element={<OperationsTruckDetail />} />
                <Route path="trucks-drivers/drivers" element={<OperationsDriversList />} />
                <Route path="trucks-drivers/drivers/:driverId" element={<OperationsDriverDetail />} />
                <Route path="waybills-payouts" element={<OperationsWaybillsRegister />} />
                <Route path="waybills-payouts/:invoiceId" element={<OperationsWaybillDetail />} />
                <Route path="exceptions" element={<OperationsExceptionsRegister />} />
                <Route path="exceptions/:exceptionId" element={<OperationsExceptionDetail />} />
                <Route path="reports" element={<OperationsReports />} />
                {OPERATIONS_NAVIGATION.slice(6).map((item) => (
                  <Route
                    key={item.route}
                    path={item.route}
                    element={<PortalPage role="operations_manager" title={item.title} />}
                  />
                ))}
                <Route path="*" element={<Navigate to={PORTALS.operations_manager.path} replace />} />
              </Route>
            </Route>

            <Route element={<RequireRole role="system_administrator" />}>
              <Route
                path={PORTALS.system_administrator.path}
                element={
                  <AuthenticatedLayout
                    navigation={{
                      basePath: PORTALS.system_administrator.path,
                      label: 'Administration',
                      items: ADMIN_NAVIGATION,
                    }}
                  />
                }
              >
                <Route index element={<PortalPage role="system_administrator" title={ADMIN_NAVIGATION[0].title} />} />
                {ADMIN_NAVIGATION.slice(1).map((item) => (
                  <Route
                    key={item.route}
                    path={item.route}
                    element={<PortalPage role="system_administrator" title={item.title} />}
                  />
                ))}
                <Route path="*" element={<Navigate to={PORTALS.system_administrator.path} replace />} />
              </Route>
            </Route>

            <Route path="*" element={<HomeRedirect />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
