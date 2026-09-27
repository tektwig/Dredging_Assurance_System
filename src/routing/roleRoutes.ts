import type { AppRole } from '../types/profile';

export const PORTALS = {
  loading_officer: { path: '/loading', name: 'Loading Portal' },
  offloading_officer: { path: '/offloading', name: 'Offloading Portal' },
  operations_manager: { path: '/operations', name: 'Operations Portal' },
  system_administrator: { path: '/admin', name: 'Administration Portal' },
} as const;
export type PortalRole = keyof typeof PORTALS;

export type PortalNavigationItem = {
  label: string;
  route: string;
  title: string;
};

export const OPERATIONS_NAVIGATION = [
  { label: 'Dashboard', route: '', title: 'Operations Dashboard' },
  { label: 'Trips', route: 'trips', title: 'Trips' },
  { label: 'Trucks & Drivers', route: 'trucks-drivers', title: 'Trucks & Drivers' },
  { label: 'Waybills & Payouts', route: 'waybills-payouts', title: 'Waybills & Payouts' },
  { label: 'Exceptions', route: 'exceptions', title: 'Exceptions' },
  { label: 'Reports', route: 'reports', title: 'Reports' },
] as const satisfies readonly PortalNavigationItem[];

export const ADMIN_NAVIGATION = [
  { label: 'Dashboard', route: '', title: 'Administration Dashboard' },
  { label: 'Users & Access', route: 'users', title: 'Users & Access' },
  { label: 'Sites', route: 'sites', title: 'Sites' },
  { label: 'System Configuration', route: 'configuration', title: 'System Configuration' },
  { label: 'Audit Logs', route: 'audit', title: 'Audit Logs' },
] as const satisfies readonly PortalNavigationItem[];

export const ROLE_LABELS: Record<AppRole, string> = {
  loading_officer: 'Loading Officer',
  offloading_officer: 'Offloading Officer',
  operations_manager: 'Operations Manager',
  system_administrator: 'System Administrator',
  finance_officer: 'Finance Officer',
  audit_reviewer: 'Audit Reviewer',
};

export function destinationForRole(role: AppRole | null): string {
  switch (role) {
    case 'loading_officer': return '/loading';
    case 'offloading_officer': return '/offloading';
    case 'operations_manager': return '/operations';
    case 'system_administrator': return '/admin';
    default: return '/access-denied';
  }
}
