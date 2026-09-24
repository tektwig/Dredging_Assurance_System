import type { AppRole } from '../types/profile';

export const PORTALS = {
  loading_officer: { path: '/loading', name: 'Loading Portal' },
  offloading_officer: { path: '/offloading', name: 'Offloading Portal' },
  operations_manager: { path: '/operations', name: 'Operations Portal' },
  system_administrator: { path: '/admin', name: 'Administration Portal' },
} as const;
export type PortalRole = keyof typeof PORTALS;

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