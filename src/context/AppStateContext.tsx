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
} from '../types';

interface AppStateContextType {
  // Authentication & Role
  isAuthenticated: boolean;
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
  }) => Trip;

  closeOffloadingTrip: (
    tripId: string,
    params: {
      quantity: number;
      unit: QuantityUnit;
      scaleTicketUrl?: string;
      scaleTicketNumber?: string;
      notes?: string;
    }
  ) => { success: boolean; varianceAlert?: boolean; message?: string };

  raiseTripException: (
    tripId: string,
    params: {
      type: ExceptionType;
      description: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
    }
  ) => void;

  resolveTripException: (
    tripId: string,
    params: {
      resolutionNotes: string;
      reasonCode: string;
      adjustedQuantity?: number;
    }
  ) => void;

  createPayoutBatch: (tripIds: string[]) => PayoutBatch;
  approvePayoutBatch: (batchId: string) => void;
}

const AppStateContext = createContext<AppStateContextType | undefined>(undefined);

// Initial Seed Data (Nigerian Sand Dredging Haulage)
const INITIAL_SITES: Site[] = [
  {
    id: 'site-epe-01',
    name: 'Epe Dredging Pit Alpha',
    code: 'EPE-01',
    site_type: 'loading',
    status: 'active',
    location: 'Epe Lagoon Waterfront, Lagos',
    timezone: 'Africa/Lagos',
    daily_target_tonnes: 1200,
  },
  {
    id: 'site-ikd-02',
    name: 'Ikorodu Sand Jetty Delta',
    code: 'IKD-02',
    site_type: 'loading',
    status: 'active',
    location: 'Majidun Waterway, Ikorodu',
    timezone: 'Africa/Lagos',
    daily_target_tonnes: 900,
  },
  {
    id: 'site-lkk-01',
    name: 'Lekki Expressway Central Depot',
    code: 'LKK-01',
    site_type: 'offloading',
    status: 'active',
    location: 'KM 28 Lekki-Epe Expressway, Lagos',
    timezone: 'Africa/Lagos',
  },
  {
    id: 'site-bdg-03',
    name: 'Badagry Stockpile Terminal',
    code: 'BDG-03',
    site_type: 'offloading',
    status: 'active',
    location: 'Marina Road, Badagry',
    timezone: 'Africa/Lagos',
  },
];

const INITIAL_TRUCKS: Truck[] = [
  {
    id: 'trk-1',
    registration_number: 'KJA-482XY',
    normalized_registration: 'KJA482XY',
    capacity_tonnes: 30,
    truck_type: 'Mack 10-Wheeler Tipper',
    owner_name: 'Alhaji Bello Haulage Ent.',
    owner_phone: '+234 803 551 0921',
    status: 'active',
    created_at: '2026-01-10T08:00:00Z',
  },
  {
    id: 'trk-2',
    registration_number: 'APP-914AA',
    normalized_registration: 'APP914AA',
    capacity_tonnes: 35,
    truck_type: 'Sino 35T Heavy Dump',
    owner_name: 'Coastal Logistics West Africa',
    owner_phone: '+234 802 882 1109',
    status: 'active',
    created_at: '2026-02-15T09:30:00Z',
  },
  {
    id: 'trk-3',
    registration_number: 'EPE-303ZZ',
    normalized_registration: 'EPE303ZZ',
    capacity_tonnes: 28,
    truck_type: 'Mercedes Actros 28T',
    owner_name: 'Epe Sands Artisanal Co-op',
    owner_phone: '+234 814 200 4488',
    status: 'active',
    created_at: '2026-03-01T11:15:00Z',
  },
  {
    id: 'trk-4',
    registration_number: 'BDG-708BB',
    normalized_registration: 'BDG708BB',
    capacity_tonnes: 32,
    truck_type: 'HOWO Sinotruk 32T',
    owner_name: 'West Coast Freight Limited',
    owner_phone: '+234 805 771 9901',
    status: 'active',
    created_at: '2026-04-10T14:20:00Z',
  },
  {
    id: 'trk-5',
    registration_number: 'LND-551CF',
    normalized_registration: 'LND551CF',
    capacity_tonnes: 30,
    truck_type: 'DAF CF Tipper 30T',
    owner_name: 'Apex Sand Haulage Ventures',
    owner_phone: '+234 818 333 7720',
    status: 'active',
    created_at: '2026-05-18T10:00:00Z',
  },
];

const INITIAL_DRIVERS: Driver[] = [
  {
    id: 'drv-1',
    full_name: 'Musa Ibrahim',
    phone: '+234 803 445 1290',
    license_number: 'FRSC-LAG-88910',
    status: 'active',
    assigned_truck_id: 'trk-1',
    bank_name: 'Zenith Bank PLC',
    account_number_last4: '4912',
    paystack_recipient_code: 'RCP_6a7b8c9d0e1f',
  },
  {
    id: 'drv-2',
    full_name: 'Emeka Okafor',
    phone: '+234 802 331 9081',
    license_number: 'FRSC-OGN-44219',
    status: 'active',
    assigned_truck_id: 'trk-2',
    bank_name: 'Access Bank PLC',
    account_number_last4: '8820',
    paystack_recipient_code: 'RCP_1a2b3c4d5e6f',
  },
  {
    id: 'drv-3',
    full_name: 'Babatunde Adeleke',
    phone: '+234 814 772 0019',
    license_number: 'FRSC-LAG-11204',
    status: 'active',
    assigned_truck_id: 'trk-3',
    bank_name: 'Guaranty Trust Bank (GTB)',
    account_number_last4: '3310',
    paystack_recipient_code: 'RCP_9z8y7x6w5v4u',
  },
  {
    id: 'drv-4',
    full_name: 'Chinedu Eze',
    phone: '+234 805 119 4432',
    license_number: 'FRSC-EDO-99412',
    status: 'active',
    assigned_truck_id: 'trk-4',
    bank_name: 'First Bank of Nigeria',
    account_number_last4: '7741',
    paystack_recipient_code: 'RCP_5m6n7o8p9q0r',
  },
];

const INITIAL_TRIPS: Trip[] = [
  {
    id: 'trip-001',
    trip_number: 'TRP-2026-08191',
    truck_id: 'trk-1',
    driver_id: 'drv-1',
    loading_site_id: 'site-epe-01',
    offloading_site_id: 'site-lkk-01',
    status: 'open',
    loaded_at: new Date(Date.now() - 42 * 60 * 1000).toISOString(), // 42 mins ago
    idempotency_key: 'idem-08191-abc',
    loading_event: {
      id: 'load-001',
      trip_id: 'trip-001',
      plate_image_url: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=600&auto=format&fit=crop&q=80',
      extracted_plate: 'KJA482XY',
      confirmed_plate: 'KJA-482XY',
      confidence_score: 96.4,
      captured_by_name: 'Sgt. D. Danladi (Loading Officer)',
      captured_by_id: 'usr-load-01',
      captured_at: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
      estimated_tonnes: 30,
      notes: 'Clean white sharp sand. Gate queue normal.',
    },
  },
  {
    id: 'trip-002',
    trip_number: 'TRP-2026-08192',
    truck_id: 'trk-2',
    driver_id: 'drv-2',
    loading_site_id: 'site-ikd-02',
    offloading_site_id: 'site-lkk-01',
    status: 'open',
    loaded_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(), // 25 mins ago
    idempotency_key: 'idem-08192-def',
    loading_event: {
      id: 'load-002',
      trip_id: 'trip-002',
      plate_image_url: 'https://images.unsplash.com/photo-1586191582056-a602167d4f61?w=600&auto=format&fit=crop&q=80',
      extracted_plate: 'APP914AA',
      confirmed_plate: 'APP-914AA',
      confidence_score: 98.1,
      captured_by_name: 'K. Adebayo (Loading Officer)',
      captured_by_id: 'usr-load-02',
      captured_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      estimated_tonnes: 35,
      notes: 'Coarse plaster sand payload.',
    },
  },
  {
    id: 'trip-003',
    trip_number: 'TRP-2026-08189',
    truck_id: 'trk-3',
    driver_id: 'drv-3',
    loading_site_id: 'site-epe-01',
    offloading_site_id: 'site-lkk-01',
    status: 'closed',
    loaded_at: new Date(Date.now() - 140 * 60 * 1000).toISOString(),
    closed_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
    idempotency_key: 'idem-08189-xyz',
    loading_event: {
      id: 'load-003',
      trip_id: 'trip-003',
      plate_image_url: 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?w=600&auto=format&fit=crop&q=80',
      extracted_plate: 'EPE303ZZ',
      confirmed_plate: 'EPE-303ZZ',
      confidence_score: 95.0,
      captured_by_name: 'Sgt. D. Danladi (Loading Officer)',
      captured_by_id: 'usr-load-01',
      captured_at: new Date(Date.now() - 140 * 60 * 1000).toISOString(),
      estimated_tonnes: 28,
    },
    offloading_event: {
      id: 'offload-003',
      trip_id: 'trip-003',
      quantity: 28.2,
      unit: 'tonnes',
      scale_ticket_number: 'WB-LKK-9041',
      scale_ticket_url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=600&auto=format&fit=crop&q=80',
      weighed_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
      closed_by_name: 'T. Balogun (Weighbridge Officer)',
      closed_by_id: 'usr-offload-01',
      variance_from_estimate: 0.2,
      notes: 'Weighbridge Ticket WB-LKK-9041 verified. Gross: 42.6T, Tare: 14.4T, Net: 28.2T.',
    },
  },
  {
    id: 'trip-004',
    trip_number: 'TRP-2026-08185',
    truck_id: 'trk-4',
    driver_id: 'drv-4',
    loading_site_id: 'site-epe-01',
    offloading_site_id: 'site-bdg-03',
    status: 'exception',
    loaded_at: new Date(Date.now() - 190 * 60 * 1000).toISOString(),
    idempotency_key: 'idem-08185-qqq',
    loading_event: {
      id: 'load-004',
      trip_id: 'trip-004',
      plate_image_url: 'https://images.unsplash.com/photo-1586191582056-a602167d4f61?w=600&auto=format&fit=crop&q=80',
      extracted_plate: 'BDG708BB',
      confirmed_plate: 'BDG-708BB',
      confidence_score: 93.2,
      captured_by_name: 'Sgt. D. Danladi (Loading Officer)',
      captured_by_id: 'usr-load-01',
      captured_at: new Date(Date.now() - 190 * 60 * 1000).toISOString(),
      estimated_tonnes: 32,
    },
    exceptions: [
      {
        id: 'exc-001',
        trip_id: 'trip-004',
        trip_number: 'TRP-2026-08185',
        exception_type: 'quantity_mismatch',
        description: 'Delivered scale ticket showed 19.5T against 32.0T loading capacity (-39% payload deficit). Suspected unauthorized transshipment or moisture dispute.',
        severity: 'high',
        status: 'open',
        flagged_by: 'O. Nwosu (Badagry Depot Officer)',
        flagged_at: new Date(Date.now() - 55 * 60 * 1000).toISOString(),
      },
    ],
  },
];

const INITIAL_COMPLIANCE_DOCS: ComplianceDocument[] = [
  {
    id: 'doc-cac',
    document_type: 'cac_certificate',
    title: 'CAC Certificate of Incorporation (RC-1849201)',
    registration_number: 'RC-1849201',
    file_name: 'tektwig_dredging_cac_cert.pdf',
    file_size: '1.4 MB',
    status: 'verified',
    uploaded_at: '2026-01-15T10:00:00Z',
    reviewed_by: 'Paystack Compliance Team',
    reviewed_at: '2026-01-18T14:30:00Z',
  },
  {
    id: 'doc-tin',
    document_type: 'tin_certificate',
    title: 'FIRS Corporate Tax Identification (TIN)',
    registration_number: '24190812-0001',
    file_name: 'firs_tax_clearance_tin.pdf',
    file_size: '890 KB',
    status: 'verified',
    uploaded_at: '2026-01-15T10:15:00Z',
    reviewed_by: 'Head of Finance',
    reviewed_at: '2026-01-17T09:00:00Z',
  },
  {
    id: 'doc-director',
    document_type: 'director_kyc',
    title: 'Managing Director NIMC NIN & BVN Verification',
    registration_number: 'NIN-58291048190',
    file_name: 'director_nin_bvn_consent.pdf',
    file_size: '2.1 MB',
    status: 'verified',
    uploaded_at: '2026-01-16T12:00:00Z',
    reviewed_by: 'Paystack Compliance Team',
    reviewed_at: '2026-01-19T11:20:00Z',
  },
  {
    id: 'doc-scuml',
    document_type: 'scuml_certificate',
    title: 'SCUML AML/CFT Compliance Certificate',
    registration_number: 'SC-2026-88190',
    file_name: 'scuml_registration_proof.pdf',
    file_size: '1.8 MB',
    status: 'pending_review',
    uploaded_at: '2026-02-01T15:00:00Z',
  },
  {
    id: 'doc-address',
    document_type: 'proof_of_address',
    title: 'Lagos Waterfront Operating Lease & Utility Bill',
    file_name: 'epe_waterfront_lease_doc.pdf',
    file_size: '3.4 MB',
    status: 'verified',
    uploaded_at: '2026-01-15T11:00:00Z',
    reviewed_by: 'Internal Legal Counsel',
    reviewed_at: '2026-01-18T16:00:00Z',
  },
];

const INITIAL_AUDIT_LOG: AuditLogEntry[] = [
  {
    id: 'aud-001',
    entity_name: 'trips',
    entity_id: 'trip-003',
    action: 'CLOSE',
    new_value: { status: 'closed', quantity: 28.2, unit: 'tonnes', ticket: 'WB-LKK-9041' },
    old_value: { status: 'open' },
    reason: 'Verified scale ticket submitted and signed off at Lekki Depot weighbridge.',
    actor_id: 'usr-offload-01',
    actor_name: 'T. Balogun (Weighbridge Officer)',
    actor_role: 'offloading_officer',
    timestamp: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
  },
  {
    id: 'aud-002',
    entity_name: 'trips',
    entity_id: 'trip-004',
    action: 'EXCEPTION_RAISE',
    new_value: { status: 'exception', anomaly: 'quantity_mismatch', deficit: '12.5T' },
    reason: 'Discrepancy alert: Measured net tonnage is 39% below loaded truck capacity.',
    actor_id: 'usr-offload-02',
    actor_name: 'O. Nwosu (Badagry Depot Officer)',
    actor_role: 'offloading_officer',
    timestamp: new Date(Date.now() - 55 * 60 * 1000).toISOString(),
  },
  {
    id: 'aud-003',
    entity_name: 'trips',
    entity_id: 'trip-002',
    action: 'CREATE',
    new_value: { trip_number: 'TRP-2026-08192', plate: 'APP-914AA', status: 'open' },
    reason: 'Loading capture confirmed and trip dispatched from Ikorodu Jetty.',
    actor_id: 'usr-load-02',
    actor_name: 'K. Adebayo (Loading Officer)',
    actor_role: 'loading_officer',
    timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
  },
];

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [activeRole, setActiveRole] = useState<UserRole>('loading_officer');
  const [activeSiteId, setActiveSiteId] = useState<string>('site-epe-01');
  const [activeTab, setActiveTab] = useState<string>('loading');

  const signIn = (role: UserRole) => {
    setActiveRole(role);
    setIsAuthenticated(true);
  };

  const signOut = () => {
    setIsAuthenticated(false);
  };

  const [sites] = useState<Site[]>(INITIAL_SITES);
  const [trucks] = useState<Truck[]>(INITIAL_TRUCKS);
  const [drivers] = useState<Driver[]>(INITIAL_DRIVERS);
  const [trips, setTrips] = useState<Trip[]>(INITIAL_TRIPS);
  const [payoutBatches, setPayoutBatches] = useState<PayoutBatch[]>([]);
  const [complianceDocs] = useState<ComplianceDocument[]>(INITIAL_COMPLIANCE_DOCS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOG);

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
  const openTrips = trips.filter((t) => t.status === 'open');
  const closedTrips = trips.filter((t) => t.status === 'closed');
  const exceptionTrips = trips.filter((t) => t.status === 'exception');

  // Enrich trips with relations
  const enrichedTrips = trips.map((trip) => ({
    ...trip,
    truck: trucks.find((tr) => tr.id === trip.truck_id),
    driver: drivers.find((dr) => dr.id === trip.driver_id),
    loading_site: sites.find((s) => s.id === trip.loading_site_id),
    offloading_site: sites.find((s) => s.id === trip.offloading_site_id),
  }));

  // Create loading trip
  const createLoadingTrip: AppStateContextType['createLoadingTrip'] = ({
    plate,
    truckId,
    driverId,
    offloadingSiteId,
    estimatedTonnes,
    plateImageUrl,
    confidenceScore,
    notes,
  }) => {
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
        captured_by_name: 'Dredge Gate Officer (Faith)',
        captured_by_id: 'usr-faith-01',
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
        site: activeSite.name,
        estimated_tonnes: estimatedTonnes,
      },
      reason: 'Gate 1 plate captured & confirmed; trip dispatched into open transit ledger.',
      actor_id: 'usr-faith-01',
      actor_name: 'Loading Officer (Faith)',
      actor_role: 'loading_officer',
      timestamp: now,
    };
    setAuditLogs((prev) => [auditEntry, ...prev]);

    return newTrip;
  };

  // Close offloading trip
  const closeOffloadingTrip: AppStateContextType['closeOffloadingTrip'] = (
    tripId,
    { quantity, unit, scaleTicketUrl, scaleTicketNumber, notes }
  ) => {
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
      weighed_at: now,
      closed_by_name: 'Depot Scale Officer (Faith)',
      closed_by_id: 'usr-faith-02',
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
      },
      reason: `Weighment verified at offloading gate: ${quantity} ${unit} delivered.`,
      actor_id: 'usr-faith-02',
      actor_name: 'Depot Scale Officer (Faith)',
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

  // Raise Exception
  const raiseTripException: AppStateContextType['raiseTripException'] = (
    tripId,
    { type, description, severity }
  ) => {
    const targetTrip = trips.find((t) => t.id === tripId);
    if (!targetTrip) return;

    const now = new Date().toISOString();
    const newException = {
      id: `exc-${Date.now()}`,
      trip_id: tripId,
      trip_number: targetTrip.trip_number,
      exception_type: type,
      description,
      severity,
      status: 'open' as const,
      flagged_by: 'Field Officer (Faith)',
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
        actor_id: 'usr-faith-01',
        actor_name: 'Field Officer (Faith)',
        actor_role: activeRole,
        timestamp: now,
      },
      ...prev,
    ]);
  };

  // Resolve Exception (Operations Manager)
  const resolveTripException: AppStateContextType['resolveTripException'] = (
    tripId,
    { resolutionNotes, reasonCode, adjustedQuantity }
  ) => {
    const now = new Date().toISOString();

    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== tripId) return t;

        const updatedExceptions = (t.exceptions || []).map((exc) => ({
          ...exc,
          status: 'resolved' as const,
          resolution_notes: resolutionNotes,
          reason_code: reasonCode,
          resolved_by: 'Operations Manager (Faith)',
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
        actor_name: 'Operations Manager (Faith)',
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
        actor_name: 'Finance Officer (Faith)',
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
              approved_by: 'Head of Finance (Faith)',
              approved_at: now,
              paystack_transfer_reference: `PST_TRF_${Math.random().toString(36).substring(2, 12).toUpperCase()}`,
              items: b.items.map((i) => ({ ...i, status: 'success' })),
            }
          : b
      )
    );
  };

  return (
    <AppStateContext.Provider
      value={{
        isAuthenticated,
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
        activeSite,
        openTrips,
        closedTrips,
        exceptionTrips,
        createLoadingTrip,
        closeOffloadingTrip,
        raiseTripException,
        resolveTripException,
        createPayoutBatch,
        approvePayoutBatch,
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
