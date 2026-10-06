import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import type { PortalRole } from '../../routing/roleRoutes';

export type FieldWorkflowScope = {
  actorId: string;
  role: Extract<PortalRole, 'loading_officer' | 'offloading_officer'>;
  operationalDate: string;
};

export type LoadingWorkflowDraft = {
  assignmentId: string;
  plate: string;
  estimatedTonnage: string;
  truckId: string | null;
  driverId: string | null;
  makeRegular: boolean;
};

export type OffloadingWorkflowDraft = {
  assignmentId: string;
  tripId: string;
  quantity: string;
};

function scopeKey(scope: FieldWorkflowScope | null) {
  return scope ? `${scope.actorId}:${scope.role}:${scope.operationalDate}` : null;
}

export class FieldWorkflowStore {
  private currentScope: string | null = null;
  private loading: LoadingWorkflowDraft | null = null;
  private offloading: OffloadingWorkflowDraft | null = null;

  setScope(scope: FieldWorkflowScope | null) {
    const next = scopeKey(scope);
    if (next === this.currentScope) return;
    this.currentScope = next;
    this.clearAll();
  }

  getLoading(scope: FieldWorkflowScope): LoadingWorkflowDraft | null {
    if (scopeKey(scope) !== this.currentScope || !this.loading) return null;
    return { ...this.loading };
  }

  saveLoading(scope: FieldWorkflowScope, value: LoadingWorkflowDraft) {
    if (scopeKey(scope) !== this.currentScope) return;
    // Explicit field copying is the persistence allow-list. Never add form or OCR objects here.
    this.loading = {
      assignmentId: value.assignmentId,
      plate: value.plate,
      estimatedTonnage: value.estimatedTonnage,
      truckId: value.truckId,
      driverId: value.driverId,
      makeRegular: value.makeRegular,
    };
  }

  getOffloading(scope: FieldWorkflowScope): OffloadingWorkflowDraft | null {
    if (scopeKey(scope) !== this.currentScope || !this.offloading) return null;
    return { ...this.offloading };
  }

  saveOffloading(scope: FieldWorkflowScope, value: OffloadingWorkflowDraft) {
    if (scopeKey(scope) !== this.currentScope) return;
    this.offloading = {
      assignmentId: value.assignmentId,
      tripId: value.tripId,
      quantity: value.quantity,
    };
  }

  clearLoading(scope?: FieldWorkflowScope) {
    if (!scope || scopeKey(scope) === this.currentScope) this.loading = null;
  }

  clearOffloading(scope?: FieldWorkflowScope) {
    if (!scope || scopeKey(scope) === this.currentScope) this.offloading = null;
  }

  clearAll() {
    this.loading = null;
    this.offloading = null;
  }
}

const FieldWorkflowContext = createContext<FieldWorkflowStore | null>(null);

export function FieldWorkflowProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth();
  const [store] = useState(() => new FieldWorkflowStore());
  const activeScope = useRef<FieldWorkflowScope | null>(null);
  const scope = account.status === 'active' && account.fieldOperationalDate
    && (account.profile.role === 'loading_officer' || account.profile.role === 'offloading_officer')
    ? { actorId: account.profile.id, role: account.profile.role, operationalDate: account.fieldOperationalDate }
    : null;
  if (scope) {
    activeScope.current = scope;
    store.setScope(scope);
  } else if (account.status === 'loading-profile' && activeScope.current?.actorId === account.session.user.id) {
    // TOKEN_REFRESHED briefly reloads the profile. Keep the in-memory draft for
    // the same actor while that read runs; a user/role/day change resets it.
  } else {
    activeScope.current = null;
    store.setScope(null);
  }
  return <FieldWorkflowContext.Provider value={store}>{children}</FieldWorkflowContext.Provider>;
}

export function useFieldWorkflowStore() {
  const store = useContext(FieldWorkflowContext);
  if (!store) throw new Error('useFieldWorkflowStore requires FieldWorkflowProvider.');
  return store;
}
