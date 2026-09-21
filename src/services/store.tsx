import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  UserRole,
  Site,
  Truck,
  Driver,
  Trip,
  ExceptionItem,
  PayoutBatch,
  BusinessComplianceDoc,
  AuditLogEntry,
  DraftTrip,
  Invoice,
  InvoiceItem,
} from '../types';
import {
  INITIAL_SITES,
  INITIAL_TRUCKS,
  INITIAL_DRIVERS,
  INITIAL_TRIPS,
  INITIAL_EXCEPTIONS,
  INITIAL_PAYOUT_BATCHES,
  INITIAL_COMPLIANCE_DOCS,
  INITIAL_AUDIT_LOGS,
  INITIAL_INVOICES,
} from './mockData';

interface AppContextType {
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  currentSiteId: string;
  setCurrentSiteId: (siteId: string) => void;
  sites: Site[];
  trucks: Truck[];
  drivers: Driver[];
  trips: Trip[];
  exceptions: ExceptionItem[];
  payoutBatches: PayoutBatch[];
  complianceDocs: BusinessComplianceDoc[];
  auditLogs: AuditLogEntry[];
  draftTrips: DraftTrip[];
  invoices: Invoice[];
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
  activeSite: Site | undefined;

  // Actions
  createLoadingTrip: (params: {
    truck_id: string;
    driver_id: string;
    loading_site_id: string;
    confirmed_plate: string;
    confidence_score: number;
    notes?: string;
  }) => { success: boolean; trip?: Trip; error?: string };

  completeOffloadingTrip: (params: {
    trip_id: string;
    offloading_site_id: string;
    quantity: number;
    unit: 'm3' | 'tonnes' | 'truckloads';
    notes?: string;
  }) => { success: boolean; error?: string };

  flagTripException: (params: {
    trip_id: string;
    exception_type: ExceptionItem['exception_type'];
    description: string;
  }) => void;

  resolveException: (params: {
    exception_id: string;
    trip_id: string;
    action: 'resolve_discrepancy' | 'cancel_trip';
    correctedQuantity?: number;
    reason: string;
  }) => void;

  addTruck: (truck: {
    registration_number: string;
    capacity: number;
    capacity_unit: 'm3' | 'tonnes' | 'truckloads';
    truck_type: string;
    owner_name: string;
  }) => { success: boolean; error?: string };
  addDriver: (driver: {
    full_name: string;
    phone: string;
    license_number: string;
  }) => { success: boolean; error?: string };
  approvePayoutBatch: (batch_id: string) => void;
  syncOfflineDrafts: () => void;
  addAuditLog: (entry: Omit<AuditLogEntry, 'id' | 'created_at'>) => void;

  // Invoice Actions
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
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentRole, setCurrentRole] = useState<UserRole>('operations_manager');
  const [currentSiteId, setCurrentSiteId] = useState<string>('site-1');
  const [sites] = useState<Site[]>(INITIAL_SITES);
  const [trucks, setTrucks] = useState<Truck[]>(() => {
    const saved = localStorage.getItem('adams_trucks');
    return saved ? JSON.parse(saved) : INITIAL_TRUCKS;
  });
  const [drivers, setDrivers] = useState<Driver[]>(() => {
    const saved = localStorage.getItem('adams_drivers');
    return saved ? JSON.parse(saved) : INITIAL_DRIVERS;
  });

  // Trips state with localStorage caching
  const [trips, setTrips] = useState<Trip[]>(() => {
    const saved = localStorage.getItem('adams_trips');
    return saved ? JSON.parse(saved) : INITIAL_TRIPS;
  });

  const [exceptions, setExceptions] = useState<ExceptionItem[]>(() => {
    const saved = localStorage.getItem('adams_exceptions');
    return saved ? JSON.parse(saved) : INITIAL_EXCEPTIONS;
  });

  const [payoutBatches, setPayoutBatches] = useState<PayoutBatch[]>(() => {
    const saved = localStorage.getItem('adams_payout_batches');
    return saved ? JSON.parse(saved) : INITIAL_PAYOUT_BATCHES;
  });

  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    const saved = localStorage.getItem('adams_invoices');
    return saved ? JSON.parse(saved) : INITIAL_INVOICES;
  });

  const [complianceDocs] = useState<BusinessComplianceDoc[]>(INITIAL_COMPLIANCE_DOCS);

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => {
    const saved = localStorage.getItem('adams_audit_logs');
    return saved ? JSON.parse(saved) : INITIAL_AUDIT_LOGS;
  });

  const [draftTrips, setDraftTrips] = useState<DraftTrip[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('adams_invoices', JSON.stringify(invoices));
  }, [invoices]);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('adams_trips', JSON.stringify(trips));
  }, [trips]);

  useEffect(() => {
    localStorage.setItem('adams_trucks', JSON.stringify(trucks));
  }, [trucks]);

  useEffect(() => {
    localStorage.setItem('adams_drivers', JSON.stringify(drivers));
  }, [drivers]);

  useEffect(() => {
    localStorage.setItem('adams_exceptions', JSON.stringify(exceptions));
  }, [exceptions]);

  useEffect(() => {
    localStorage.setItem('adams_payout_batches', JSON.stringify(payoutBatches));
  }, [payoutBatches]);

  useEffect(() => {
    localStorage.setItem('adams_audit_logs', JSON.stringify(auditLogs));
  }, [auditLogs]);

  const activeSite = sites.find((s) => s.id === currentSiteId);

  const addAuditLog = (entry: Omit<AuditLogEntry, 'id' | 'created_at'>) => {
    const newEntry: AuditLogEntry = {
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      created_at: new Date().toISOString(),
    };
    setAuditLogs((prev) => [newEntry, ...prev]);
  };

  const addTruck: AppContextType['addTruck'] = (data) => {
    const normalized = data.registration_number.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (trucks.some((t) => t.normalized_registration === normalized)) {
      return { success: false, error: `Truck with plate ${normalized} is already registered.` };
    }

    const newTruck: Truck = {
      id: `truck-${Date.now()}`,
      registration_number: data.registration_number.toUpperCase(),
      normalized_registration: normalized,
      capacity: Number(data.capacity),
      capacity_unit: data.capacity_unit,
      truck_type: data.truck_type,
      owner_name: data.owner_name,
      status: 'active',
    };

    setTrucks((prev) => [...prev, newTruck]);

    addAuditLog({
      entity_name: 'trucks',
      entity_id: newTruck.id,
      action: 'INSERT',
      old_value: null,
      new_value: newTruck as unknown as Record<string, unknown>,
      reason: `New truck registered: ${newTruck.registration_number} (${newTruck.capacity} ${newTruck.capacity_unit})`,
      actor_role: currentRole,
    });

    return { success: true };
  };

  const addDriver: AppContextType['addDriver'] = (data) => {
    if (drivers.some((d) => d.phone === data.phone)) {
      return { success: false, error: `Driver with phone number ${data.phone} already exists.` };
    }

    const newDriver: Driver = {
      id: `driver-${Date.now()}`,
      full_name: data.full_name,
      phone: data.phone,
      license_number: data.license_number,
      status: 'active',
    };

    setDrivers((prev) => [...prev, newDriver]);

    addAuditLog({
      entity_name: 'drivers',
      entity_id: newDriver.id,
      action: 'INSERT',
      old_value: null,
      new_value: newDriver as unknown as Record<string, unknown>,
      reason: `New haulage driver registered: ${newDriver.full_name} (${newDriver.phone})`,
      actor_role: currentRole,
    });

    return { success: true };
  };

  const createLoadingTrip: AppContextType['createLoadingTrip'] = ({
    truck_id,
    driver_id,
    loading_site_id,
    confirmed_plate,
    confidence_score,
    notes,
  }) => {
    const truck = trucks.find((t) => t.id === truck_id);
    const driver = drivers.find((d) => d.id === driver_id);
    const loadingSite = sites.find((s) => s.id === loading_site_id);

    if (!truck) return { success: false, error: 'Truck not found in master records' };

    const idempotency_key = `idem-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // If offline, add to draft queue
    if (!isOnline) {
      const draft: DraftTrip = {
        idempotency_key,
        truck_plate: confirmed_plate,
        driver_id,
        loading_site_id,
        capacity: truck.capacity,
        captured_at: new Date().toISOString(),
        notes,
      };
      setDraftTrips((prev) => [draft, ...prev]);
      return { success: true };
    }

    const tripId = `trip-${Date.now()}`;
    const tripNumber = `TRIP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(
      100 + Math.random() * 900
    )}`;

    const newTrip: Trip = {
      id: tripId,
      trip_number: tripNumber,
      truck_id,
      driver_id,
      loading_site_id,
      status: 'open',
      loaded_at: new Date().toISOString(),
      idempotency_key,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      truck,
      driver,
      loading_site: loadingSite,
      loading_event: {
        id: `load-ev-${Date.now()}`,
        trip_id: tripId,
        extracted_number: confirmed_plate.replace(/[^A-Za-z0-9]/g, ''),
        confirmed_number: confirmed_plate,
        confidence_score,
        captured_by: currentRole,
        captured_at: new Date().toISOString(),
        operator_notes: notes,
      },
    };

    setTrips((prev) => [newTrip, ...prev]);

    addAuditLog({
      entity_name: 'trips',
      entity_id: tripId,
      action: 'INSERT',
      old_value: null,
      new_value: { trip_number: tripNumber, status: 'open', plate: confirmed_plate },
      reason: `Gate loading captured for truck ${confirmed_plate} at ${loadingSite?.name}`,
      actor_role: currentRole,
    });

    return { success: true, trip: newTrip };
  };

  const completeOffloadingTrip: AppContextType['completeOffloadingTrip'] = ({
    trip_id,
    offloading_site_id,
    quantity,
    unit,
    notes,
  }) => {
    const trip = trips.find((t) => t.id === trip_id);
    if (!trip) return { success: false, error: 'Trip not found' };

    const offloadingSite = sites.find((s) => s.id === offloading_site_id);
    const expectedCapacity = trip.truck?.capacity || quantity;
    const variance = Number((((quantity - expectedCapacity) / expectedCapacity) * 100).toFixed(2));

    const isAnomaly = Math.abs(variance) > 10;
    const newStatus = isAnomaly ? 'exception' : 'closed';

    const updatedTrip: Trip = {
      ...trip,
      offloading_site_id,
      offloading_site: offloadingSite,
      status: newStatus,
      closed_at: isAnomaly ? undefined : new Date().toISOString(),
      updated_at: new Date().toISOString(),
      offloading_event: {
        id: `offload-ev-${Date.now()}`,
        trip_id,
        quantity,
        unit,
        weighed_at: new Date().toISOString(),
        closed_by: currentRole,
        variance_percentage: variance,
        operator_notes: notes,
      },
    };

    setTrips((prev) => prev.map((t) => (t.id === trip_id ? updatedTrip : t)));

    if (isAnomaly) {
      const excId = `exc-${Date.now()}`;
      const newExc: ExceptionItem = {
        id: excId,
        trip_id,
        trip_number: trip.trip_number,
        truck_plate: trip.truck?.registration_number,
        exception_type: 'volume_variance',
        description: `Delivered volume (${quantity} ${unit}) diverges from loaded capacity (${expectedCapacity} ${unit}) by ${variance}%.`,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      setExceptions((prev) => [newExc, ...prev]);

      addAuditLog({
        entity_name: 'exceptions',
        entity_id: excId,
        action: 'EXCEPTION_FLAGGED',
        old_value: { status: trip.status },
        new_value: { status: 'exception', variance: `${variance}%`, quantity },
        reason: `Discrepancy alert: Quantity variance ${variance}% exceeded threshold.`,
        actor_role: currentRole,
      });
    } else {
      addAuditLog({
        entity_name: 'trips',
        entity_id: trip_id,
        action: 'STATUS_CHANGE',
        old_value: { status: trip.status },
        new_value: { status: 'closed', quantity, unit },
        reason: `Trip closed and verified at ${offloadingSite?.name}`,
        actor_role: currentRole,
      });
    }

    return { success: true };
  };

  const flagTripException: AppContextType['flagTripException'] = ({
    trip_id,
    exception_type,
    description,
  }) => {
    const trip = trips.find((t) => t.id === trip_id);
    if (!trip) return;

    const excId = `exc-${Date.now()}`;
    const newExc: ExceptionItem = {
      id: excId,
      trip_id,
      trip_number: trip.trip_number,
      truck_plate: trip.truck?.registration_number,
      exception_type,
      description,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    setExceptions((prev) => [newExc, ...prev]);
    setTrips((prev) =>
      prev.map((t) => (t.id === trip_id ? { ...t, status: 'exception', updated_at: new Date().toISOString() } : t))
    );

    addAuditLog({
      entity_name: 'exceptions',
      entity_id: excId,
      action: 'EXCEPTION_FLAGGED',
      old_value: { status: trip.status },
      new_value: { status: 'exception', type: exception_type },
      reason: description,
      actor_role: currentRole,
    });
  };

  const resolveException: AppContextType['resolveException'] = ({
    exception_id,
    trip_id,
    action,
    correctedQuantity,
    reason,
  }) => {
    const trip = trips.find((t) => t.id === trip_id);
    const exc = exceptions.find((e) => e.id === exception_id);
    if (!trip || !exc) return;

    const newStatus = action === 'cancel_trip' ? 'cancelled' : 'closed';

    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== trip_id) return t;
        return {
          ...t,
          status: newStatus,
          closed_at: action === 'cancel_trip' ? undefined : new Date().toISOString(),
          updated_at: new Date().toISOString(),
          offloading_event:
            action === 'resolve_discrepancy' && correctedQuantity && t.offloading_event
              ? {
                  ...t.offloading_event,
                  quantity: correctedQuantity,
                  operator_notes: `Correction: ${reason}`,
                }
              : t.offloading_event,
        };
      })
    );

    setExceptions((prev) =>
      prev.map((e) =>
        e.id === exception_id
          ? {
              ...e,
              status: action === 'cancel_trip' ? 'dismissed' : 'resolved',
              resolution_notes: reason,
              resolved_by: currentRole,
              resolved_at: new Date().toISOString(),
            }
          : e
      )
    );

    addAuditLog({
      entity_name: 'trips',
      entity_id: trip_id,
      action: 'CORRECTION_APPLIED',
      old_value: { status: trip.status },
      new_value: { status: newStatus, correctedQuantity, action },
      reason: `Managerial resolution: ${reason}`,
      actor_role: currentRole,
    });
  };

  const approvePayoutBatch: AppContextType['approvePayoutBatch'] = (batch_id) => {
    const batch = payoutBatches.find((b) => b.id === batch_id);
    if (!batch) return;

    const reference = `PST_TRF_${Date.now()}`;

    setPayoutBatches((prev) =>
      prev.map((b) =>
        b.id === batch_id
          ? {
              ...b,
              status: 'processing',
              approved_by: currentRole,
              approved_at: new Date().toISOString(),
              paystack_transfer_reference: reference,
              items: b.items?.map((item) => ({ ...item, status: 'success' })),
            }
          : b
      )
    );

    addAuditLog({
      entity_name: 'payout_batches',
      entity_id: batch_id,
      action: 'PAYOUT_APPROVED',
      old_value: { status: batch.status },
      new_value: { status: 'processing', reference },
      reason: `Batch ${batch.batch_number} approved and dispatched via Paystack bulk transfer.`,
      actor_role: currentRole,
    });
  };

  const syncOfflineDrafts = () => {
    if (draftTrips.length === 0) return;

    draftTrips.forEach((draft) => {
      const truck = trucks.find((t) => t.normalized_registration === draft.truck_plate.replace(/[^A-Za-z0-9]/g, '')) || trucks[0];
      const tripId = `trip-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      const tripNumber = `TRIP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(
        100 + Math.random() * 900
      )}`;

      const newTrip: Trip = {
        id: tripId,
        trip_number: tripNumber,
        truck_id: truck.id,
        driver_id: draft.driver_id,
        loading_site_id: draft.loading_site_id,
        status: 'open',
        loaded_at: draft.captured_at,
        idempotency_key: draft.idempotency_key,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        truck,
        driver: drivers.find((d) => d.id === draft.driver_id),
        loading_site: sites.find((s) => s.id === draft.loading_site_id),
        loading_event: {
          id: `load-ev-${Date.now()}`,
          trip_id: tripId,
          extracted_number: draft.truck_plate,
          confirmed_number: draft.truck_plate,
          confidence_score: 95.0,
          captured_by: currentRole,
          captured_at: draft.captured_at,
          operator_notes: draft.notes,
        },
      };

      setTrips((prev) => [newTrip, ...prev]);

      addAuditLog({
        entity_name: 'trips',
        entity_id: tripId,
        action: 'INSERT',
        old_value: null,
        new_value: { trip_number: tripNumber, status: 'open', synced_from_draft: true },
        reason: `Offline draft synced successfully with idempotency key ${draft.idempotency_key}`,
        actor_role: currentRole,
      });
    });

    setDraftTrips([]);
  };

  // Invoice Management Actions
  const createInvoice = (params: {
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
  }): { success: boolean; invoice?: Invoice; error?: string } => {
    if (!params.customer_name?.trim() || !params.items || params.items.length === 0) {
      return { success: false, error: 'Customer name and at least one line item are required.' };
    }

    const subtotal = params.items.reduce(
      (sum, it) => sum + (Number(it.amount) || Number(it.quantity) * Number(it.unit_price)),
      0
    );
    const tax_rate = params.tax_rate !== undefined ? params.tax_rate : 7.5;
    const tax_amount = Math.round((subtotal * (tax_rate / 100)) * 100) / 100;
    const discount_amount = Number(params.discount_amount) || 0;
    const total_amount = subtotal + tax_amount - discount_amount;

    const invoiceNum = `INV-${new Date().getFullYear()}-${String(invoices.length + 95).padStart(4, '0')}`;
    const issueDate = new Date().toISOString().split('T')[0];
    const dueDate =
      params.due_date ||
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const newInvoice: Invoice = {
      id: `inv-${Date.now()}`,
      invoice_number: invoiceNum,
      issue_date: issueDate,
      due_date: dueDate,
      customer_name: params.customer_name.trim(),
      customer_email: params.customer_email?.trim(),
      customer_phone: params.customer_phone?.trim(),
      customer_address: params.customer_address?.trim(),
      customer_tin: params.customer_tin?.trim(),
      project_site_name: params.project_site_name?.trim(),
      status: 'issued',
      items: params.items,
      subtotal,
      tax_rate,
      tax_amount,
      discount_amount,
      total_amount,
      currency: 'NGN',
      payment_terms: params.payment_terms || 'Net 14 Days',
      bank_name: 'Guaranty Trust Bank (GTBank)',
      bank_account_name: 'Adams Dredging & Haulage Operations Ltd',
      bank_account_number: '0192847581',
      paystack_payment_link: `https://paystack.com/pay/dredgeops-${invoiceNum.toLowerCase()}`,
      notes: params.notes,
      created_at: new Date().toISOString(),
    };

    setInvoices((prev) => [newInvoice, ...prev]);

    addAuditLog({
      entity_name: 'invoices',
      entity_id: newInvoice.id,
      action: 'INVOICE_GENERATED',
      reason: `Commercial Tax Invoice ${newInvoice.invoice_number} generated for ${newInvoice.customer_name} (Total: ₦${newInvoice.total_amount.toLocaleString()})`,
      actor_role: currentRole,
      new_value: {
        invoice_number: newInvoice.invoice_number,
        total_amount: newInvoice.total_amount,
        customer_name: newInvoice.customer_name,
        item_count: newInvoice.items.length,
      },
    });

    return { success: true, invoice: newInvoice };
  };

  const markInvoiceAsPaid = (invoiceId: string, paymentReference: string) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id === invoiceId) {
          const updated: Invoice = {
            ...inv,
            status: 'paid',
            paid_at: new Date().toISOString(),
            paid_reference: paymentReference || `NIBSS-PAY-${Date.now()}`,
          };

          addAuditLog({
            entity_name: 'invoices',
            entity_id: inv.id,
            action: 'INVOICE_PAID',
            reason: `Payment verified & credited for Invoice ${inv.invoice_number}. Payment Reference: ${paymentReference || 'Direct Bank Settlement'}`,
            actor_role: currentRole,
            old_value: { status: inv.status },
            new_value: { status: 'paid', paid_reference: updated.paid_reference, paid_at: updated.paid_at },
          });

          return updated;
        }
        return inv;
      })
    );
  };

  const cancelInvoice = (invoiceId: string, reason: string) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id === invoiceId) {
          const updated: Invoice = { ...inv, status: 'cancelled' };

          addAuditLog({
            entity_name: 'invoices',
            entity_id: inv.id,
            action: 'INVOICE_CANCELLED',
            reason: `Invoice ${inv.invoice_number} marked as cancelled. Reason: ${reason}`,
            actor_role: currentRole,
            old_value: { status: inv.status },
            new_value: { status: 'cancelled', cancellation_reason: reason },
          });

          return updated;
        }
        return inv;
      })
    );
  };

  return (
    <AppContext.Provider
      value={{
        currentRole,
        setCurrentRole,
        currentSiteId,
        setCurrentSiteId,
        sites,
        trucks,
        drivers,
        trips,
        exceptions,
        payoutBatches,
        complianceDocs,
        auditLogs,
        draftTrips,
        invoices,
        isOnline,
        setIsOnline,
        activeSite,
        createLoadingTrip,
        completeOffloadingTrip,
        flagTripException,
        resolveException,
        approvePayoutBatch,
        syncOfflineDrafts,
        addAuditLog,
        addTruck,
        addDriver,
        createInvoice,
        markInvoiceAsPaid,
        cancelInvoice,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppStore = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppStore must be used within an AppProvider');
  }
  return context;
};
