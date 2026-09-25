import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Trip,
  Site,
  Truck,
  Driver,
  PayoutBatch,
  AuditLogEntry,
  ComplianceDocument,
  UserRole,
  QuantityUnit,
  ExceptionType,
  Invoice,
  InvoiceItem,
  DraftTrip,
} from '../types';
import { INITIAL_INVOICES, INITIAL_PAYOUT_BATCHES } from '../services/mockData';
import { isSupabaseLive, supabase } from '../services/supabase';
import {
  closeLiveTrip,
  createLiveLoadingTrip,
  fetchLiveSnapshot,
  LiveTruckLookup,
  lookupLiveTruck,
  registerLiveParticipant,
  raiseLiveTripException,
  resolveLiveTripException,
  subscribeToLiveTrips,
} from '../services/liveOperations';

interface AppStateContextType {
  // Authentication & Role
  isAuthenticated: boolean;
  authenticatedRole: UserRole | null;
  signIn: (role: UserRole) => void;
  signOut: () => void;

  // Navigation & Role
  activeRole: UserRole;
  setActiveRole: (role: UserRole) => void;
  activeSiteId: string;
  setActiveSiteId: (siteId: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;

  // Master Data
  sites: Site[];
  trucks: Truck[];
  drivers: Driver[];
  trips: Trip[];
  payoutBatches: PayoutBatch[];
  complianceDocs: ComplianceDocument[];
  auditLogs: AuditLogEntry[];
  invoices: Invoice[];

  // Offline / PWA
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
  draftTrips: DraftTrip[];
  syncOfflineDrafts: () => void;
  isLiveMode: boolean;
  liveSyncError: string | null;

  // Helper Lookups
  activeSite?: Site;
  openTrips: Trip[];
  closedTrips: Trip[];
  exceptionTrips: Trip[];

  // Operational Actions
  createLoadingTrip: (params: {
    plate: string;
    truckId: string;
    driverId: string;
    offloadingSiteId: string;
    estimatedTonnes: number;
    plateImageUrl: string;
    confidenceScore: number;
    notes?: string;
  }) => Promise<Trip>;

  closeOffloadingTrip: (
    tripId: string,
    params: {
      quantity: number;
      unit: QuantityUnit;
      scaleTicketUrl?: string;
      scaleTicketNumber?: string;
      deliveryPlateImageUrl?: string;
      deliveryConfirmedPlate?: string;
      deliveryPlateConfidence?: number;
      deliveryPlateCapturedAt?: string;
      notes?: string;
    }
  ) => Promise<{ success: boolean; varianceAlert?: boolean; message?: string }>;
  lookupTruckByPlate: (plate: string) => Promise<LiveTruckLookup>;

  raiseTripException: (
    tripId: string,
    params: {
      type: ExceptionType;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
    }
  ) => Promise<void>;

  resolveTripException: (
    tripId: string,
    params: {
      resolutionNotes: string;
      reasonCode: string;
      adjustedQuantity?: number;
    }
  ) => Promise<void>;

  createPayoutBatch: (tripIds: string[]) => PayoutBatch;
  approvePayoutBatch: (batchId: string) => void;

  // Invoice Actions (Commercial Revenue Assurance)
  createInvoice: (params: {
    customer_name: string;
    customer_email?: string;
    customer_phone?: string;
    customer_address?: string;
    customer_tin?: string;
    project_site_name?: string;
    items: InvoiceItem[];
    tax_rate?: number;
    discount_amount?: number;
    payment_terms?: string;
    notes?: string;
    due_date?: string;
  }) => { success: boolean; invoice?: Invoice; error?: string };
  markInvoiceAsPaid: (invoiceId: string, paymentReference: string) => void;
  cancelInvoice: (invoiceId: string, reason: string) => void;

  // Master Data Registration
  addTruck: (truck: {
    registration_number: string;
    capacity: number;
    capacity_unit?: 'm3' | 'tonnes' | 'truckloads';
    truck_type: string;
    owner_name: string;
    owner_phone?: string;
  }) => { success: boolean; error?: string; truck?: Truck };
  addDriver: (driver: {
    full_name: string;
    phone: string;
    license_number: string;
    bank_name?: string;
    account_number?: string;
    account_number_last4?: string;
    assigned_truck_id?: string;
  }) => { success: boolean; error?: string; driver?: Driver };
  registerLoadingParticipant: (participant: {
    plate: string;
    expectedTruckId?: string;
    capacity: number;
    truckType: string;
    ownerName: string;
    ownerPhone?: string;
    driverName: string;
    driverPhone: string;
    driverLicense: string;
    bankName: string;
    accountNumber: string;
  }) => Promise<{ success: boolean; error?: string; truck?: Truck; driver?: Driver }>;
}

const AppStateContext = createContext<AppStateContextType | undefined>(undefined);



export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('dredgeops_authenticated') === 'true';
    } catch {
      return false;
    }
  });

  const [authenticatedRole, setAuthenticatedRole] = useState<UserRole | null>(() => {
    try {
      return (sessionStorage.getItem('dredgeops_auth_role') as UserRole) || null;
    } catch {
      return null;
    }
  });

  const [activeRole, setActiveRoleState] = useState<UserRole>(() => {
    try {
      return (sessionStorage.getItem('dredgeops_auth_role') as UserRole) || 'loading_officer';
    } catch {
      return 'loading_officer';
    }
  });

  const [activeSiteId, setActiveSiteId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('loading');

  const signIn = (role: UserRole) => {
    setAuthenticatedRole(role);
    setActiveRoleState(role);
    setIsAuthenticated(true);
    try {
      sessionStorage.setItem('dredgeops_auth_role', role);
      sessionStorage.setItem('dredgeops_authenticated', 'true');
    } catch {
      // ignore
    }
  };

  const signOut = () => {
    if (isSupabaseLive && supabase) void supabase.auth.signOut();
    setAuthenticatedRole(null);
    setIsAuthenticated(false);
    try {
      sessionStorage.removeItem('dredgeops_auth_role');
      sessionStorage.removeItem('dredgeops_authenticated');
      sessionStorage.removeItem('dredgeops_siteagent_mode');
      sessionStorage.removeItem('dredgeops_siteagent_mode_selected');
    } catch {
      // ignore
    }
  };

  const setActiveRole = (role: UserRole) => {
    if (!authenticatedRole) return;
    const isSiteAgent =
      (authenticatedRole === 'loading_officer' || authenticatedRole === 'offloading_officer') &&
      (role === 'loading_officer' || role === 'offloading_officer');

    if (role === authenticatedRole || isSiteAgent) {
      setActiveRoleState(role);
    } else {
      console.warn(
        `RBAC Violation: Cannot switch to unauthorized terminal "${role}". Current session is locked to "${authenticatedRole}".`
      );
    }
  };

  const [sites, setSites] = useState<Site[]>([]);
  // Never hydrate operational records from browser seed/cache data. Supabase is
  // authoritative; local state starts empty and is populated by a live fetch.
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [payoutBatches, setPayoutBatches] = useState<PayoutBatch[]>(INITIAL_PAYOUT_BATCHES);
  const [complianceDocs] = useState<ComplianceDocument[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Offline / PWA queue state
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [draftTrips, setDraftTrips] = useState<DraftTrip[]>([]);
  const [liveSyncError, setLiveSyncError] = useState<string | null>(null);

  const refreshLiveData = async () => {
    if (!isSupabaseLive || !supabase || !isAuthenticated) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setLiveSyncError('Live session expired. Sign out and sign in again.');
      signOut();
      return;
    }

    try {
      const snapshot = await fetchLiveSnapshot(authenticatedRole);
      setLiveSyncError(null);
      setSites(snapshot.sites);
      setTrucks(snapshot.trucks);
      setDrivers(snapshot.drivers);
      setTrips(snapshot.trips);
      setActiveSiteId((current) => {
        if (snapshot.assignedSiteId) return snapshot.assignedSiteId;
        if (snapshot.sites.some((site) => site.id === current)) return current;
        const preferredType = authenticatedRole === 'offloading_officer' ? 'offloading' : 'loading';
        return snapshot.sites.find((site) => site.site_type === preferredType)?.id || snapshot.sites[0]?.id || current;
      });
    } catch (error: unknown) {
      setLiveSyncError(error instanceof Error ? error.message : 'Live trip synchronization failed.');
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !isSupabaseLive || !supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        signOut();
        return;
      }
      void refreshLiveData();
    });
    return subscribeToLiveTrips(() => void refreshLiveData());
    // Authentication changes establish a new RLS scope and realtime channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, authenticatedRole]);

  // Listen to network status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem('dredgeops_trucks', JSON.stringify(trucks));
  }, [trucks]);

  useEffect(() => {
    localStorage.setItem('dredgeops_drivers', JSON.stringify(drivers));
  }, [drivers]);

  useEffect(() => {
    localStorage.setItem('dredgeops_trips', JSON.stringify(trips));
  }, [trips]);

  useEffect(() => {
    localStorage.setItem('dredgeops_invoices', JSON.stringify(invoices));
  }, [invoices]);

  useEffect(() => {
    localStorage.setItem('dredgeops_payout_batches', JSON.stringify(payoutBatches));
  }, [payoutBatches]);

  useEffect(() => {
    localStorage.setItem('dredgeops_draft_trips', JSON.stringify(draftTrips));
  }, [draftTrips]);

  // Sync activeTab when role changes to give an immediate relevant view
  useEffect(() => {
    switch (activeRole) {
      case 'loading_officer':
        setActiveTab('loading');
        break;
      case 'offloading_officer':
        setActiveTab('offloading');
        break;
      case 'operations_manager':
        setActiveTab('operations');
        break;
      case 'finance_officer':
        setActiveTab('finance');
        break;
      case 'admin':
        setActiveTab('admin');
        break;
    }
  }, [activeRole]);

  // Derived lookups
  const activeSite = sites.find((s) => s.id === activeSiteId) || sites[0];
  // Enrich trips with relations
  const enrichedTrips = trips.map((trip) => ({
    ...trip,
    truck: trip.truck || trucks.find((tr) => tr.id === trip.truck_id),
    driver: trip.driver || drivers.find((dr) => dr.id === trip.driver_id),
    loading_site: trip.loading_site || sites.find((s) => s.id === trip.loading_site_id),
    offloading_site: trip.offloading_site || sites.find((s) => s.id === trip.offloading_site_id),
  }));
  const openTrips = enrichedTrips.filter((t) => t.status === 'open');
  const closedTrips = enrichedTrips.filter((t) => t.status === 'closed');
  const exceptionTrips = enrichedTrips.filter((t) => t.status === 'exception');

  // Local fallback used only when the terminal is offline or Supabase is unavailable.
  const createLocalLoadingTrip = ({
    plate,
    truckId,
    driverId,
    offloadingSiteId,
    estimatedTonnes,
    plateImageUrl,
    confidenceScore,
    notes,
  }: Parameters<AppStateContextType['createLoadingTrip']>[0]): Trip => {
    const tripSeq = Math.floor(10000 + Math.random() * 90000);
    const tripNumber = `TRP-2026-${tripSeq}`;
    const tripId = `trip-${Date.now()}`;
    const now = new Date().toISOString();

    const newTrip: Trip = {
      id: tripId,
      trip_number: tripNumber,
      truck_id: truckId,
      driver_id: driverId,
      loading_site_id: activeSiteId,
      offloading_site_id: offloadingSiteId,
      status: 'open',
      loaded_at: now,
      idempotency_key: `idem-${tripSeq}-${Date.now()}`,
      loading_event: {
        id: `load-${Date.now()}`,
        trip_id: tripId,
        plate_image_url: plateImageUrl,
        extracted_plate: plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
        confirmed_plate: plate.toUpperCase(),
        confidence_score: confidenceScore,
        captured_by_name: 'Loading Officer',
        captured_by_id: 'offline-loading-officer',
        captured_at: now,
        estimated_tonnes: estimatedTonnes,
        notes,
      },
    };

    setTrips((prev) => [newTrip, ...prev]);

    // Audit log
    const auditEntry: AuditLogEntry = {
      id: `aud-${Date.now()}`,
      entity_name: 'trips',
      entity_id: tripId,
      action: 'CREATE',
      new_value: {
        trip_number: tripNumber,
        truck_plate: plate,
        site: activeSite?.name || 'Offline site',
        estimated_tonnes: estimatedTonnes,
      },
      reason: 'Gate 1 plate captured & confirmed; trip dispatched into open transit ledger.',
      actor_id: 'offline-loading-officer',
      actor_name: 'Loading Officer',
      actor_role: 'loading_officer',
      timestamp: now,
    };
    setAuditLogs((prev) => [auditEntry, ...prev]);

    return newTrip;
  };

  const createLoadingTrip: AppStateContextType['createLoadingTrip'] = async (params) => {
    if (!isSupabaseLive || !supabase) {
      return createLocalLoadingTrip(params);
    }
    if (!navigator.onLine) {
      throw new Error('This terminal is offline. Reconnect before issuing a live waybill.');
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error('Your live session has expired. Please sign in again.');
    const row = await createLiveLoadingTrip({
      plate: params.plate,
      driverId: params.driverId,
      plateImageUrl: params.plateImageUrl,
      confidenceScore: params.confidenceScore,
    });
    await refreshLiveData();

    const truck = trucks.find((item) => item.id === row.truck_id);
    const driver = drivers.find((item) => item.id === row.driver_id);
    return {
      id: row.id,
      trip_number: row.trip_number,
      truck_id: row.truck_id,
      driver_id: row.driver_id,
      loading_site_id: row.loading_site_id,
      status: 'open',
      loaded_at: row.opened_at,
      truck,
      driver,
      loading_site: sites.find((site) => site.id === row.loading_site_id),
    };
  };

  // Local close fallback when the live service is unavailable.
  const closeLocalOffloadingTrip = (
    tripId: string,
    {
      quantity,
      unit,
      scaleTicketUrl,
      scaleTicketNumber,
      deliveryPlateImageUrl,
      deliveryConfirmedPlate,
      deliveryPlateConfidence,
      deliveryPlateCapturedAt,
      notes,
    }: Parameters<AppStateContextType['closeOffloadingTrip']>[1]
  ): { success: boolean; varianceAlert?: boolean; message?: string } => {
    const targetTrip = trips.find((t) => t.id === tripId);
    if (!targetTrip) return { success: false, message: 'Trip not found' };

    const truck = trucks.find((t) => t.id === targetTrip.truck_id);
    const capacity = truck?.capacity_tonnes || 30;
    const variancePercent = ((quantity - capacity) / capacity) * 100;
    const now = new Date().toISOString();

    // Check for severe variance (e.g. delivered quantity is over 15% lower than capacity)
    const isVarianceAlert = Math.abs(variancePercent) > 15;

    const offloadingEvent = {
      id: `offload-${Date.now()}`,
      trip_id: tripId,
      quantity,
      unit,
      scale_ticket_number: scaleTicketNumber || `WB-${Math.floor(1000 + Math.random() * 9000)}`,
      scale_ticket_url: scaleTicketUrl,
      delivery_plate_image_url: deliveryPlateImageUrl,
      delivery_extracted_plate: deliveryConfirmedPlate,
      delivery_confirmed_plate: deliveryConfirmedPlate,
      delivery_plate_confidence: deliveryPlateConfidence,
      delivery_plate_captured_at: deliveryPlateCapturedAt,
      weighed_at: now,
      closed_by_name: 'Offloading Officer',
      closed_by_id: 'offline-offloading-officer',
      variance_from_estimate: Number((quantity - (targetTrip.loading_event?.estimated_tonnes || capacity)).toFixed(1)),
      notes,
    };

    setTrips((prev) =>
      prev.map((t) =>
        t.id === tripId
          ? {
              ...t,
              status: 'closed',
              closed_at: now,
              offloading_event: offloadingEvent,
            }
          : t
      )
    );

    // Audit log
    const auditEntry: AuditLogEntry = {
      id: `aud-${Date.now()}`,
      entity_name: 'trips',
      entity_id: tripId,
      action: 'CLOSE',
      old_value: { status: 'open' },
      new_value: {
        status: 'closed',
        quantity,
        unit,
        ticket: offloadingEvent.scale_ticket_number,
        delivery_plate: deliveryConfirmedPlate,
        delivery_plate_confidence: deliveryPlateConfidence,
      },
      reason: `Weighment verified at offloading gate: ${quantity} ${unit} delivered.`,
      actor_id: 'offline-offloading-officer',
      actor_name: 'Offloading Officer',
      actor_role: 'offloading_officer',
      timestamp: now,
    };
    setAuditLogs((prev) => [auditEntry, ...prev]);

    return {
      success: true,
      varianceAlert: isVarianceAlert,
      message: isVarianceAlert
        ? `Delivered ${quantity} ${unit} differs from rated capacity (${capacity}T) by ${variancePercent.toFixed(1)}%.`
        : undefined,
    };
  };

  const closeOffloadingTrip: AppStateContextType['closeOffloadingTrip'] = async (tripId, params) => {
    if (!isSupabaseLive || !supabase) {
      return closeLocalOffloadingTrip(tripId, params);
    }
    if (!navigator.onLine) {
      return { success: false, message: 'This terminal is offline. Reconnect before closing the live trip.' };
    }

    const offloadingSite = sites.find(
      (site) => site.id === activeSiteId && site.site_type === 'offloading' && site.status === 'active'
    );
    if (!offloadingSite) return { success: false, message: 'Select your assigned offloading site before closing the trip.' };

    try {
      await closeLiveTrip({
        tripId,
        offloadingSiteId: offloadingSite.id,
        quantityTonnes: params.quantity,
      });
      await refreshLiveData();
      const targetTrip = trips.find((trip) => trip.id === tripId);
      const capacity = targetTrip?.truck?.capacity_tonnes || 30;
      const variancePercent = ((params.quantity - capacity) / capacity) * 100;
      return { success: true, varianceAlert: Math.abs(variancePercent) > 15 };
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'The live trip could not be closed.' };
    }
  };

  const lookupTruckByPlate: AppStateContextType['lookupTruckByPlate'] = async (plate) => {
    if (isSupabaseLive && supabase && navigator.onLine && authenticatedRole === 'loading_officer') {
      const result = await lookupLiveTruck(plate);
      if (result.truck) setTrucks((current) => [result.truck!, ...current.filter((item) => item.id !== result.truck!.id)]);
      if (result.driver) setDrivers((current) => [result.driver!, ...current.filter((item) => item.id !== result.driver!.id)]);
      return result;
    }

    const normalized = plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const truck = trucks.find((item) => item.normalized_registration === normalized);
    const driver = truck ? drivers.find((item) => item.assigned_truck_id === truck.id) : undefined;
    return { found: !!truck, truck, driver };
  };

  // Raise Exception
  const raiseTripException: AppStateContextType['raiseTripException'] = async (
    tripId,
    { type, description, severity }
  ) => {
    const targetTrip = trips.find((t) => t.id === tripId);
    if (!targetTrip) return;

    if (isSupabaseLive && supabase && navigator.onLine) {
      try {
        await raiseLiveTripException({
          tripId,
          truckId: targetTrip.truck_id,
          type,
          description,
        });
        await refreshLiveData();
      } catch (error: unknown) {
        setLiveSyncError(error instanceof Error ? error.message : 'The exception could not be saved to the live ledger.');
        throw error;
      }
      return;
    }

    const now = new Date().toISOString();
    const newException = {
      id: `exc-${Date.now()}`,
      trip_id: tripId,
      trip_number: targetTrip.trip_number,
      exception_type: type,
      description,
      severity,
      status: 'open' as const,
      flagged_by: 'Field Officer',
      flagged_at: now,
    };

    setTrips((prev) =>
      prev.map((t) =>
        t.id === tripId
          ? {
              ...t,
              status: 'exception',
              exceptions: [...(t.exceptions || []), newException],
            }
          : t
      )
    );

    // Audit log
    setAuditLogs((prev) => [
      {
        id: `aud-${Date.now()}`,
        entity_name: 'exceptions',
        entity_id: newException.id,
        action: 'EXCEPTION_RAISE',
        new_value: { trip_id: tripId, type, severity, description },
        reason: `Operational exception flagged: ${description}`,
        actor_id: 'offline-field-officer',
        actor_name: 'Field Officer',
        actor_role: activeRole,
        timestamp: now,
      },
      ...prev,
    ]);
  };

  // Resolve Exception (Operations Manager)
  const resolveTripException: AppStateContextType['resolveTripException'] = async (
    tripId,
    { resolutionNotes, reasonCode, adjustedQuantity }
  ) => {
    const targetTrip = trips.find((trip) => trip.id === tripId);
    const liveException = targetTrip?.exceptions?.find((exception) => exception.status === 'open');
    if (isSupabaseLive && supabase && navigator.onLine && liveException) {
      try {
        await resolveLiveTripException({
          exceptionId: liveException.id,
          reason: `${reasonCode}: ${resolutionNotes}${adjustedQuantity === undefined ? '' : ` (Adjusted quantity: ${adjustedQuantity})`}`,
        });
        await refreshLiveData();
      } catch (error: unknown) {
        setLiveSyncError(error instanceof Error ? error.message : 'The exception resolution could not be saved to the live ledger.');
        throw error;
      }
      return;
    }

    const now = new Date().toISOString();

    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;

        const updatedExceptions = (t.exceptions || []).map((exc) => ({
          ...exc,
          status: 'resolved' as const,
          resolution_notes: resolutionNotes,
          reason_code: reasonCode,
          resolved_by: 'Operations Manager',
          resolved_at: now,
          adjusted_quantity: adjustedQuantity,
        }));

        return {
          ...t,
          status: 'closed', // Transition to closed upon managerial resolution
          closed_at: now,
          exceptions: updatedExceptions,
        };
      })
    );

    // Audit log
    setAuditLogs((prev) => [
      {
        id: `aud-${Date.now()}`,
        entity_name: 'exceptions',
        entity_id: tripId,
        action: 'EXCEPTION_RESOLVE',
        new_value: { status: 'resolved', reasonCode, resolutionNotes, adjustedQuantity },
        reason: `Manager approved exception resolution: ${reasonCode} — ${resolutionNotes}`,
        actor_id: 'usr-mgr-01',
        actor_name: 'Operations Manager',
        actor_role: 'operations_manager',
        timestamp: now,
      },
      ...prev,
    ]);
  };

  // Create Payout Batch (Finance)
  const createPayoutBatch: AppStateContextType['createPayoutBatch'] = (tripIds) => {
    const batchTrips = trips.filter((t) => tripIds.includes(t.id) && t.status === 'closed');
    const totalTonnes = batchTrips.reduce((acc, t) => acc + (t.offloading_event?.quantity || 30), 0);
    const ratePerTonne = 1850; // NGN 1,850 per tonne haulage rate
    const grossAmount = Math.round(totalTonnes * ratePerTonne);

    const now = new Date().toISOString();
    const batchSeq = Math.floor(100 + Math.random() * 900);
    const newBatch: PayoutBatch = {
      id: `batch-${Date.now()}`,
      batch_reference: `PAY-2026-WK${batchSeq}`,
      period_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      period_end: new Date().toISOString().split('T')[0],
      status: 'pending_approval',
      total_trips: batchTrips.length,
      total_tonnes: Number(totalTonnes.toFixed(1)),
      gross_amount_ngn: grossAmount,
      created_at: now,
      items: batchTrips.map((bt) => {
        const drv = drivers.find((d) => d.id === bt.driver_id);
        const qty = bt.offloading_event?.quantity || 30;
        return {
          id: `item-${bt.id}`,
          payout_batch_id: `batch-${Date.now()}`,
          driver_id: bt.driver_id,
          driver_name: drv?.full_name || 'Assigned Driver',
          bank_name: drv?.bank_name || 'Zenith Bank PLC',
          account_last4: drv?.account_number_last4 || '0000',
          trip_count: 1,
          quantity_total_tonnes: qty,
          rate_per_tonne_ngn: ratePerTonne,
          amount_ngn: Math.round(qty * ratePerTonne),
          status: 'pending',
          paystack_transfer_code: `TRF_${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
        };
      }),
    };

    setPayoutBatches((prev) => [newBatch, ...prev]);

    // Audit log
    setAuditLogs((prev) => [
      {
        id: `aud-${Date.now()}`,
        entity_name: 'payout_batches',
        entity_id: newBatch.id,
        action: 'PAYOUT_APPROVE',
        new_value: {
          batch: newBatch.batch_reference,
          trips: newBatch.total_trips,
          gross: newBatch.gross_amount_ngn,
        },
        reason: 'Finance Officer generated payout batch from verified closed trips.',
        actor_id: 'usr-fin-01',
        actor_name: 'Finance Officer',
        actor_role: 'finance_officer',
        timestamp: now,
      },
      ...prev,
    ]);

    return newBatch;
  };

  // Approve Payout Batch
  const approvePayoutBatch = (batchId: string) => {
    const now = new Date().toISOString();
    setPayoutBatches((prev) =>
      prev.map((b) =>
        b.id === batchId
          ? {
              ...b,
              status: 'disbursed',
              approved_by: 'Head of Finance',
              approved_at: now,
              paystack_transfer_reference: `PST_TRF_${Math.random().toString(36).substring(2, 12).toUpperCase()}`,
              items: (b.items || []).map((i) => ({ ...i, status: 'success' as const })),
            }
          : b
      )
    );
  };

  // Commercial Invoicing Actions
  const createInvoice: AppStateContextType['createInvoice'] = (params) => {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const count = invoices.length + 1;
      const invoiceNumber = `INV-${year}-${count.toString().padStart(4, '0')}`;

      const subtotal = params.items.reduce((sum, item) => sum + (item.amount || item.quantity * item.unit_price), 0);
      const taxRate = params.tax_rate !== undefined ? params.tax_rate : 7.5;
      const taxAmount = (subtotal * taxRate) / 100;
      const discount = params.discount_amount || 0;
      const totalAmount = subtotal + taxAmount - discount;

      const issueDate = now.toISOString().split('T')[0];
      const dueDate = params.due_date || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const newInvoice: Invoice = {
        id: `inv-${Date.now()}`,
        invoice_number: invoiceNumber,
        issue_date: issueDate,
        due_date: dueDate,
        customer_name: params.customer_name,
        customer_email: params.customer_email,
        customer_phone: params.customer_phone,
        customer_address: params.customer_address,
        customer_tin: params.customer_tin,
        project_site_name: params.project_site_name,
        status: 'issued',
        items: params.items,
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        discount_amount: discount,
        total_amount: totalAmount,
        currency: 'NGN',
        payment_terms: params.payment_terms || 'Net 14 Days',
        bank_name: 'Zenith Bank PLC',
        bank_account_name: 'Tektwig Dredging Solutions Ltd - Ops Escrow',
        bank_account_number: '1019283741',
        paystack_payment_link: `https://paystack.com/pay/dredgeops-${invoiceNumber.toLowerCase()}`,
        notes: params.notes,
        created_at: now.toISOString(),
      };

      setInvoices((prev) => [newInvoice, ...prev]);

      // Audit Log
      setAuditLogs((prev) => [
        {
          id: `aud-${Date.now()}`,
          entity_name: 'invoices',
          entity_id: newInvoice.id,
          action: 'INVOICE_CREATE',
          new_value: {
            invoice_number: invoiceNumber,
            customer: params.customer_name,
            total: totalAmount,
            items_count: params.items.length,
          },
          reason: `Commercial invoice ${invoiceNumber} issued for ${params.customer_name}. Total: ₦${totalAmount.toLocaleString()}`,
          actor_id: 'usr-fin-01',
          actor_name: 'Finance Officer',
          actor_role: 'finance_officer',
          timestamp: now.toISOString(),
        },
        ...prev,
      ]);

      return { success: true, invoice: newInvoice };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to generate commercial invoice.' };
    }
  };

  const markInvoiceAsPaid = (invoiceId: string, paymentReference: string) => {
    const now = new Date().toISOString();
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === invoiceId
          ? {
              ...inv,
              status: 'paid',
              paid_at: now,
              paid_reference: paymentReference,
            }
          : inv
      )
    );

    const inv = invoices.find((i) => i.id === invoiceId);
    setAuditLogs((prev) => [
      {
        id: `aud-${Date.now()}`,
        entity_name: 'invoices',
        entity_id: invoiceId,
        action: 'INVOICE_SETTLE',
        new_value: { status: 'paid', reference: paymentReference },
        reason: `Payment confirmed for ${inv?.invoice_number || invoiceId}. Remittance Ref: ${paymentReference}`,
        actor_id: 'usr-fin-01',
        actor_name: 'Finance Officer',
        actor_role: 'finance_officer',
        timestamp: now,
      },
      ...prev,
    ]);
  };

  const cancelInvoice = (invoiceId: string, reason: string) => {
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === invoiceId ? { ...inv, status: 'cancelled' } : inv))
    );

    const inv = invoices.find((i) => i.id === invoiceId);
    setAuditLogs((prev) => [
      {
        id: `aud-${Date.now()}`,
        entity_name: 'invoices',
        entity_id: invoiceId,
        action: 'INVOICE_CANCEL',
        new_value: { status: 'cancelled' },
        reason: `Commercial invoice ${inv?.invoice_number || invoiceId} voided: ${reason}`,
        actor_id: 'usr-fin-01',
        actor_name: 'Finance Officer',
        actor_role: 'finance_officer',
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  // Master Data Registration Actions
  const addTruck: AppStateContextType['addTruck'] = (truckData) => {
    const cleanPlate = truckData.registration_number.toUpperCase().trim();
    const normalized = cleanPlate.replace(/[^A-Z0-9]/g, '');

    if (!normalized || normalized.length < 5) {
      return { success: false, error: 'Registration number must be at least 5 alphanumeric characters.' };
    }

    if (trucks.some((t) => t.normalized_registration === normalized)) {
      return { success: false, error: `Truck with plate number ${cleanPlate} is already registered in master fleet.` };
    }

    const now = new Date().toISOString();
    const newTruck: Truck = {
      id: `trk-${Date.now()}`,
      registration_number: cleanPlate,
      normalized_registration: normalized,
      capacity: truckData.capacity,
      capacity_tonnes: truckData.capacity,
      capacity_unit: truckData.capacity_unit || 'tonnes',
      truck_type: truckData.truck_type || 'Tipper Truck',
      owner_name: truckData.owner_name,
      owner_phone: truckData.owner_phone || '+234 800 000 0000',
      status: 'active',
      created_at: now,
    };

    setTrucks((prev) => [newTruck, ...prev]);

    setAuditLogs((prev) => [
      {
        id: `aud-${Date.now()}`,
        entity_name: 'trucks',
        entity_id: newTruck.id,
        action: 'TRUCK_REGISTER',
        new_value: { plate: cleanPlate, normalized, capacity: truckData.capacity, owner: truckData.owner_name },
        reason: `New vehicle [${cleanPlate}] enrolled in fleet master database.`,
        actor_id: 'usr-adm-01',
        actor_name: 'System Admin',
        actor_role: 'admin',
        timestamp: now,
      },
      ...prev,
    ]);

    return { success: true, truck: newTruck };
  };

  const addDriver: AppStateContextType['addDriver'] = (driverData) => {
    if (!driverData.full_name.trim() || !driverData.phone.trim()) {
      return { success: false, error: 'Driver full name and phone number are required.' };
    }

    const now = new Date().toISOString();
    const newDriver: Driver = {
      id: `drv-${Date.now()}`,
      full_name: driverData.full_name.trim(),
      phone: driverData.phone.trim(),
      license_number: driverData.license_number.trim() || 'FRSC-PENDING',
      status: 'active',
      bank_name: driverData.bank_name || 'Zenith Bank PLC',
      account_number: driverData.account_number,
      account_number_last4: driverData.account_number_last4 || (driverData.account_number ? driverData.account_number.slice(-4) : '1234'),
      assigned_truck_id: driverData.assigned_truck_id,
    };

    setDrivers((prev) => [newDriver, ...prev]);

    setAuditLogs((prev) => [
      {
        id: `aud-${Date.now()}`,
        entity_name: 'drivers',
        entity_id: newDriver.id,
        action: 'DRIVER_REGISTER',
        new_value: { name: driverData.full_name, phone: driverData.phone, license: driverData.license_number },
        reason: `New hauler driver [${driverData.full_name}] enrolled in verified driver registry.`,
        actor_id: 'usr-adm-01',
        actor_name: 'System Admin',
        actor_role: 'admin',
        timestamp: now,
      },
      ...prev,
    ]);

    return { success: true, driver: newDriver };
  };

  const registerLoadingParticipant: AppStateContextType['registerLoadingParticipant'] = async (participant) => {
    if (!isSupabaseLive || !supabase) {
      let truck = participant.expectedTruckId
        ? trucks.find((item) => item.id === participant.expectedTruckId)
        : undefined;
      if (!truck) {
        const truckResult = addTruck({
          registration_number: participant.plate,
          capacity: participant.capacity,
          capacity_unit: 'tonnes',
          truck_type: participant.truckType,
          owner_name: participant.ownerName,
          owner_phone: participant.ownerPhone,
        });
        if (!truckResult.success || !truckResult.truck) return truckResult;
        truck = truckResult.truck;
      }

      const driverResult = addDriver({
        full_name: participant.driverName,
        phone: participant.driverPhone,
        license_number: participant.driverLicense,
        bank_name: participant.bankName,
        account_number: participant.accountNumber,
        account_number_last4: participant.accountNumber.slice(-4),
        assigned_truck_id: truck.id,
      });
      return { ...driverResult, truck };
    }

    if (!navigator.onLine) {
      return { success: false, error: 'This terminal is offline. Reconnect before registering a truck or driver.' };
    }

    try {
      const result = await registerLiveParticipant({
        plate: participant.plate,
        expectedTruckId: participant.expectedTruckId,
        fullName: participant.driverName,
        phoneNumber: participant.driverPhone,
        bankName: participant.bankName,
        accountNumber: participant.accountNumber,
        accountName: participant.driverName,
        capacityTonnes: participant.capacity,
        truckType: participant.truckType,
        ownerName: participant.ownerName,
        ownerPhone: participant.ownerPhone,
      });
      setTrucks((current) => [result.truck, ...current.filter((item) => item.id !== result.truck.id)]);
      setDrivers((current) => [result.driver, ...current.filter((item) => item.id !== result.driver.id)]);
      return { success: true, truck: result.truck, driver: result.driver };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'The live truck and driver registration failed.',
      };
    }
  };

  // Offline Sync Actions
  const syncOfflineDrafts = () => {
    if (draftTrips.length === 0) return;
    const now = new Date().toISOString();

    draftTrips.forEach((draft) => {
      void createLoadingTrip({
        plate: draft.truck_plate,
        truckId: trucks.find((t) => t.registration_number === draft.truck_plate)?.id || trucks[0]?.id || 'trk-1',
        driverId: draft.driver_id || drivers[0]?.id || 'drv-1',
        offloadingSiteId: sites.find((s) => s.site_type === 'offloading')?.id || 'site-lkk-01',
        estimatedTonnes: draft.capacity || 30,
        plateImageUrl: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=600&auto=format&fit=crop&q=80',
        confidenceScore: 95.0,
        notes: `[OFFLINE SYNCED] ${draft.notes || ''}`,
      }).catch((error) => {
        console.warn('Offline draft sync failed:', error);
      });
    });

    setDraftTrips([]);
    setAuditLogs((prev) => [
      {
        id: `aud-${Date.now()}`,
        entity_name: 'offline_queue',
        entity_id: 'sync-batch',
        action: 'OFFLINE_SYNC_PWA',
        new_value: { count: draftTrips.length },
        reason: `PWA offline storage synced ${draftTrips.length} queued waybills to cloud ledger.`,
        actor_id: 'usr-load-pwa',
        actor_name: 'Site Agent Terminal (PWA)',
        actor_role: 'loading_officer',
        timestamp: now,
      },
      ...prev,
    ]);
  };

  return (
    <AppStateContext.Provider
      value={{
        isAuthenticated,
        authenticatedRole,
        signIn,
        signOut,
        activeRole,
        setActiveRole,
        activeSiteId,
        setActiveSiteId,
        activeTab,
        setActiveTab,
        sites,
        trucks,
        drivers,
        trips: enrichedTrips,
        payoutBatches,
        complianceDocs,
        auditLogs,
        invoices,
        isOnline,
        setIsOnline,
        draftTrips,
        syncOfflineDrafts,
        isLiveMode: isSupabaseLive,
        liveSyncError,
        activeSite,
        openTrips,
        closedTrips,
        exceptionTrips,
        createLoadingTrip,
        closeOffloadingTrip,
        lookupTruckByPlate,
        raiseTripException,
        resolveTripException,
        createPayoutBatch,
        approvePayoutBatch,
        createInvoice,
        markInvoiceAsPaid,
        cancelInvoice,
        addTruck,
        addDriver,
        registerLoadingParticipant,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
};

export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return context;
};
