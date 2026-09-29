import React, { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { StatCard } from '../common/StatCard';
import { StatusBadge } from '../common/StatusBadge';
import { PlateDisplay } from '../common/PlateDisplay';
import { ExceptionTriageModal } from './ExceptionTriageModal';
import { TripClosureInvoiceModal } from './TripClosureInvoiceModal';
import { Trip, TripException } from '../../types';
import {
  Truck,
  Scale,
  AlertTriangle,
  Clock,
  Search,
  FileSpreadsheet,
  Layers,
  X,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import '../../features/operations/trips/trips.css';

export const OperationsDashboard: React.FC = () => {
  const { trips, tripInvoices, resolveTripException } = useAppState();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [inspectingTrip, setInspectingTrip] = useState<Trip | null>(null);
  const [triagingItem, setTriagingItem] = useState<{ trip: Trip; exception: TripException } | null>(null);
  const [selectedClosureInvoiceId, setSelectedClosureInvoiceId] = useState<string | null>(null);

  // Derived Metrics
  const openCount = trips.filter((t) => t.status === 'open').length;
  const closedCount = trips.filter((t) => t.status === 'closed').length;
  const exceptionCount = trips.filter((t) => t.status === 'exception').length;

  const totalDeliveredTonnes = trips
    .filter((t) => t.status === 'closed')
    .reduce((acc, t) => acc + (t.offloading_event?.quantity || 0), 0);

  // Filtered trips
  const filteredTrips = trips.filter((trip) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      trip.trip_number.toLowerCase().includes(query) ||
      (trip.truck?.registration_number || trip.truck_registration_at_loading || '').toLowerCase().includes(query) ||
      (trip.driver?.full_name || trip.driver_name_at_loading || '').toLowerCase().includes(query);

    const matchesStatus = statusFilter === 'all' || trip.status === statusFilter;

    let matchesDate = true;
    const tripDate = trip.loaded_at || trip.created_at;
    if (dateFrom && tripDate) {
      matchesDate = matchesDate && new Date(tripDate) >= new Date(dateFrom);
    }
    if (dateTo && tripDate) {
      matchesDate = matchesDate && new Date(tripDate) <= new Date(`${dateTo}T23:59:59`);
    }

    return matchesSearch && matchesStatus && matchesDate;
  });

  const handleExportCSV = () => {
    const headers = [
      'Trip Number',
      'Truck Plate',
      'Driver Name',
      'Driver Phone',
      'Loading Site',
      'Offloading Site',
      'Status',
      'Est Tonnes',
      'Delivered Quantity',
      'Scale Ticket No',
      'Dispatched Time',
      'Closed Time',
    ];

    const rows = filteredTrips.map((t) => [
      t.trip_number,
      t.truck?.registration_number || t.truck_registration_at_loading || '',
      t.driver?.full_name || t.driver_name_at_loading || '',
      t.driver?.phone || t.driver_phone_at_loading || '',
      t.loading_site?.name || '',
      t.offloading_site?.name || '',
      t.status.toUpperCase(),
      t.loading_event?.estimated_tonnes || '',
      t.offloading_event?.quantity || '',
      t.offloading_event?.scale_ticket_number || '',
      t.loading_event?.captured_at || t.loaded_at || '',
      t.offloading_event?.weighed_at || t.closed_at || '',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val) => `"${val}"`).join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Dredging_Ledger_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDate = (val?: string | null) => {
    if (!val) return '—';
    try {
      return new Intl.DateTimeFormat('en-NG', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Africa/Lagos',
      }).format(new Date(val));
    } catch {
      return val;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
      {/* Control Room Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#172B3A', margin: 0, letterSpacing: '-0.02em' }}>
              Operations Control Room & Revenue Assurance
            </h2>
          </div>
          <p style={{ fontSize: '0.84rem', color: '#60717E', margin: '0.2rem 0 0 0' }}>
            Live fleet movement tracking, weighbridge gross/tare verification, and revenue audit register.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button type="button" className="btn btn-secondary" onClick={handleExportCSV}>
            <FileSpreadsheet size={16} />
            <span>Export Register (CSV)</span>
          </button>
        </div>
      </div>

      {/* KPI Metrics Row (Sixtus Clean Industrial Tiles) */}
      <div className="grid-4">
        <StatCard
          title="ACTIVE IN TRANSIT"
          value={openCount}
          subtitle="Haulage trucks on road"
          icon={<Truck size={20} />}
          highlightColor="amber"
          trend={{ value: 'Real-time telemetry', isPositive: true }}
        />
        <StatCard
          title="DELIVERED TONNAGE TODAY"
          value={`${totalDeliveredTonnes.toFixed(1)} T`}
          subtitle={`${closedCount} trips verified by scale tickets`}
          icon={<Scale size={20} />}
          highlightColor="emerald"
          trend={{ value: `${closedCount} deliveries closed`, isPositive: true }}
        />
        <StatCard
          title="TRIP EXCEPTIONS"
          value={exceptionCount}
          subtitle="Triage required by manager"
          icon={<AlertTriangle size={20} />}
          highlightColor="crimson"
        />
        <StatCard
          title="AVG. CYCLE TIME"
          value="48 Mins"
          subtitle="Pit loading to weighbridge check"
          icon={<Clock size={20} />}
          highlightColor="blue"
        />
      </div>

      {/* Sixtus Advanced Filter Panel */}
      <div className="trip-filter-panel" style={{ backgroundColor: '#FFFFFF', border: '1px solid #DCE4E9', borderRadius: '0.75rem', padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Layers size={16} color="#125B59" />
            <span style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#172B3A' }}>
              Filter Movement Register
            </span>
          </div>
          {(searchQuery || statusFilter !== 'all' || dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setDateFrom('');
                setDateTo('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#125B59',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Clear Filters
            </button>
          )}
        </div>

        <div className="trip-filter-grid">
          {/* Search Box */}
          <div className="trip-filter-field trip-filter-search">
            <label htmlFor="filter-search" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#243D4B' }}>
              Search Trip #, Plate, or Driver
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="filter-search"
                type="search"
                className="form-input"
                placeholder="e.g. TRP-2026, AAA-123-XY, Danjuma..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '2.1rem' }}
              />
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#60717E',
                }}
              />
            </div>
          </div>

          {/* Status Dropdown */}
          <div className="trip-filter-field">
            <label htmlFor="filter-status" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#243D4B' }}>
              Operational Status
            </label>
            <select
              id="filter-status"
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses ({trips.length})</option>
              <option value="open">In Transit / Open ({openCount})</option>
              <option value="closed">Verified & Closed ({closedCount})</option>
              <option value="exception">Discrepancy Exception ({exceptionCount})</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Date From */}
          <div className="trip-filter-field">
            <label htmlFor="filter-date-from" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#243D4B' }}>
              Date From
            </label>
            <input
              id="filter-date-from"
              type="date"
              className="form-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Main Trips Register Card & Table */}
      <div className="field-manifest-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: '#F8FAFC',
            borderBottom: '1px solid #DCE4E9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#172B3A' }}>
              Trips Register & Movement Audit
            </span>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                backgroundColor: '#E7F3EE',
                color: '#125B59',
                padding: '0.15rem 0.5rem',
                borderRadius: '1rem',
              }}
            >
              {filteredTrips.length} matching trips
            </span>
          </div>

          <span style={{ fontSize: '0.75rem', color: '#60717E' }}>
            Click any trip to inspect complete lifecycle & weighing audit
          </span>
        </div>

        <div className="table-responsive" style={{ margin: 0 }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#FFFFFF', borderBottom: '1px solid #DCE4E9' }}>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', fontWeight: 800, color: '#60717E', textAlign: 'left' }}>TRIP #</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', fontWeight: 800, color: '#60717E', textAlign: 'left' }}>STATUS</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', fontWeight: 800, color: '#60717E', textAlign: 'left' }}>TRUCK PLATE</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', fontWeight: 800, color: '#60717E', textAlign: 'left' }}>DRIVER</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', fontWeight: 800, color: '#60717E', textAlign: 'left' }}>ROUTE & SITES</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', fontWeight: 800, color: '#60717E', textAlign: 'left' }}>PAYLOAD (TONNES)</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', fontWeight: 800, color: '#60717E', textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrips.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '3rem 1rem', textAlign: 'center', color: '#60717E' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <Layers size={32} color="#CBD5E1" />
                      <strong style={{ color: '#172B3A' }}>No matching movements found</strong>
                      <span style={{ fontSize: '0.8rem' }}>Try clearing or adjusting the search and status filters above.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredTrips.map((trip) => {
                  const plate = trip.truck?.registration_number || trip.truck_registration_at_loading || 'TRUCK';
                  const driverName = trip.driver?.full_name || trip.driver_name_at_loading || 'Driver';
                  const deliveredTonnage = trip.offloading_event?.quantity;
                  const estimatedTonnage = trip.loading_event?.estimated_tonnes || 30;

                  return (
                    <tr
                      key={trip.id}
                      style={{
                        borderBottom: '1px solid #EDF2F7',
                        transition: 'background-color 0.1s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      {/* Trip Number */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <button
                          type="button"
                          onClick={() => setInspectingTrip(trip)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            fontFamily: 'monospace',
                            fontSize: '0.84rem',
                            fontWeight: 800,
                            color: '#125B59',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          <span>{trip.trip_number}</span>
                          <ChevronRight size={13} />
                        </button>
                        <span style={{ fontSize: '0.7rem', color: '#60717E', display: 'block', marginTop: '0.15rem' }}>
                          {formatDate(trip.loaded_at || trip.created_at)}
                        </span>
                      </td>

                      {/* Status */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <StatusBadge status={trip.status} />
                      </td>

                      {/* Truck Plate */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <PlateDisplay plate={plate} size="sm" />
                        <span style={{ fontSize: '0.72rem', color: '#60717E', display: 'block', marginTop: '0.2rem' }}>
                          {trip.truck?.truck_type || 'Tipper'} • {trip.truck?.owner_name || 'Haulier'}
                        </span>
                      </td>

                      {/* Driver */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#172B3A' }}>{driverName}</div>
                        <span style={{ fontSize: '0.72rem', color: '#60717E' }}>
                          {trip.driver?.phone || trip.driver_phone_at_loading || 'No phone recorded'}
                        </span>
                      </td>

                      {/* Route */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ fontSize: '0.8rem', color: '#172B3A', fontWeight: 600 }}>
                          {trip.loading_site?.name || 'Pit'} &rarr;{' '}
                          {trip.offloading_site?.name || 'Weighbridge Depot'}
                        </div>
                        {trip.status === 'closed' && (
                          <span style={{ fontSize: '0.7rem', color: '#059669', fontWeight: 600, display: 'block', marginTop: '0.15rem' }}>
                            Closed: {formatDate(trip.closed_at || trip.offloading_event?.weighed_at)}
                          </span>
                        )}
                      </td>

                      {/* Payload */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#172B3A', fontVariantNumeric: 'tabular-nums' }}>
                          {deliveredTonnage ? `${deliveredTonnage.toFixed(2)} T` : `${estimatedTonnage} T (Est.)`}
                        </div>
                        {trip.offloading_event?.scale_ticket_number && (
                          <span style={{ fontSize: '0.7rem', color: '#60717E', display: 'block', marginTop: '0.15rem' }}>
                            Ticket #{trip.offloading_event.scale_ticket_number}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setInspectingTrip(trip)}
                            style={{ minHeight: '30px', padding: '0.2rem 0.55rem', fontSize: '0.74rem' }}
                            title="Inspect complete lifecycle"
                          >
                            Inspect
                          </button>

                          {trip.status === 'exception' && (
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => {
                                const exc: TripException = trip.exceptions?.[0] || {
                                  id: `exc-${trip.id}`,
                                  trip_id: trip.id,
                                  trip_number: trip.trip_number,
                                  exception_type: 'volume_variance',
                                  description: 'Payload discrepancy detected between loading and delivery weighbridge.',
                                  severity: 'high',
                                  status: 'open',
                                };
                                setTriagingItem({ trip, exception: exc });
                              }}
                              style={{
                                minHeight: '30px',
                                padding: '0.2rem 0.55rem',
                                fontSize: '0.74rem',
                                backgroundColor: '#DC2626',
                                borderColor: '#DC2626',
                              }}
                            >
                              Triage
                            </button>
                          )}

                          {trip.status === 'closed' && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => setSelectedClosureInvoiceId(trip.id)}
                              style={{
                                minHeight: '30px',
                                padding: '0.2rem 0.55rem',
                                fontSize: '0.74rem',
                                color: '#125B59',
                                borderColor: '#CBDDE0',
                              }}
                            >
                              Invoice
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sixtus Trip Lifecycle Detail Inspector Modal */}
      {inspectingTrip && (
        <div className="trip-modal-backdrop" onClick={() => setInspectingTrip(null)}>
          <div
            className="field-manifest-card"
            style={{
              width: 'min(720px, calc(100vw - 2rem))',
              maxHeight: '90vh',
              overflowY: 'auto',
              borderTop: '5px solid #16706E',
              margin: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #DCE4E9', paddingBottom: '0.85rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#172B3A', fontFamily: 'monospace' }}>
                    {inspectingTrip.trip_number}
                  </span>
                  <StatusBadge status={inspectingTrip.status} />
                </div>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#60717E' }}>
                  Trip Lifecycle & Verification Audit Trail
                </p>
              </div>

              <button
                type="button"
                onClick={() => setInspectingTrip(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#60717E',
                  padding: '0.25rem',
                }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* Lifecycle 3-Step Timeline (Sixtus Visual Architecture) */}
            <div className="trip-lifecycle" style={{ marginBottom: '1.5rem' }}>
              {/* Step 1: Loading Dispatch */}
              <div className="trip-lifecycle-step trip-lifecycle-complete">
                <span className="eyebrow" style={{ color: '#256657' }}>STAGE 1 • DISPATCH</span>
                <h3 style={{ fontSize: '0.92rem', color: '#172B3A' }}>Loading & ANPR Scan</h3>
                <p style={{ color: '#60717E', fontSize: '0.78rem' }}>
                  Site: {inspectingTrip.loading_site?.name || 'Loading Pit'}
                </p>
                <p style={{ color: '#60717E', fontSize: '0.78rem' }}>
                  Time: {formatDate(inspectingTrip.loaded_at || inspectingTrip.loading_event?.captured_at)}
                </p>
                <p style={{ color: '#059669', fontSize: '0.75rem', fontWeight: 700 }}>
                  Est. Payload: {inspectingTrip.loading_event?.estimated_tonnes || 30}T
                </p>
              </div>

              {/* Step 2: Transit */}
              <div
                className={`trip-lifecycle-step ${
                  inspectingTrip.status === 'open'
                    ? 'trip-lifecycle-current'
                    : inspectingTrip.status === 'closed'
                    ? 'trip-lifecycle-complete'
                    : 'trip-lifecycle-cancelled'
                }`}
              >
                <span className="eyebrow" style={{ color: inspectingTrip.status === 'open' ? '#BD780D' : '#256657' }}>
                  STAGE 2 • TRANSIT
                </span>
                <h3 style={{ fontSize: '0.92rem', color: '#172B3A' }}>
                  {inspectingTrip.status === 'open' ? 'In Transit Haulage' : 'Transit Completed'}
                </h3>
                <p style={{ color: '#60717E', fontSize: '0.78rem' }}>
                  Truck: {inspectingTrip.truck?.registration_number || inspectingTrip.truck_registration_at_loading || 'TRUCK'}
                </p>
                <p style={{ color: '#60717E', fontSize: '0.78rem' }}>
                  Driver: {inspectingTrip.driver?.full_name || inspectingTrip.driver_name_at_loading || 'Assigned'}
                </p>
                <p style={{ color: '#0284C7', fontSize: '0.75rem', fontWeight: 700 }}>
                  Target: {inspectingTrip.offloading_site?.name || 'Delivery Weighbridge'}
                </p>
              </div>

              {/* Step 3: Weighbridge Discharge */}
              <div
                className={`trip-lifecycle-step ${
                  inspectingTrip.status === 'closed'
                    ? 'trip-lifecycle-complete'
                    : inspectingTrip.status === 'exception'
                    ? 'trip-lifecycle-cancelled'
                    : 'trip-lifecycle-upcoming'
                }`}
              >
                <span className="eyebrow" style={{ color: inspectingTrip.status === 'closed' ? '#256657' : '#60717E' }}>
                  STAGE 3 • DISCHARGE
                </span>
                <h3 style={{ fontSize: '0.92rem', color: '#172B3A' }}>Weighbridge Verification</h3>
                <p style={{ color: '#60717E', fontSize: '0.78rem' }}>
                  Delivered: {inspectingTrip.offloading_event?.quantity ? `${inspectingTrip.offloading_event.quantity} T` : '—'}
                </p>
                <p style={{ color: '#60717E', fontSize: '0.78rem' }}>
                  Ticket: {inspectingTrip.offloading_event?.scale_ticket_number || '—'}
                </p>
                <p style={{ color: inspectingTrip.status === 'closed' ? '#059669' : '#60717E', fontSize: '0.75rem', fontWeight: 700 }}>
                  {inspectingTrip.status === 'closed' ? 'Closed & Verified' : 'Awaiting scale verification'}
                </p>
              </div>
            </div>

            {/* Trip Details Grid */}
            <div style={{ backgroundColor: '#F8FAFC', borderRadius: '0.65rem', padding: '1.1rem', border: '1px solid #DCE4E9' }}>
              <span style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', color: '#172B3A', letterSpacing: '0.05em', display: 'block', marginBottom: '0.75rem' }}>
                Operational Manifest & Vehicle Audit
              </span>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
                <div>
                  <span style={{ fontSize: '0.72rem', color: '#60717E', fontWeight: 700 }}>Assigned Driver</span>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#172B3A' }}>
                    {inspectingTrip.driver?.full_name || inspectingTrip.driver_name_at_loading || 'Driver'}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: '#60717E' }}>
                    {inspectingTrip.driver?.phone || inspectingTrip.driver_phone_at_loading || 'No phone'}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', color: '#60717E', fontWeight: 700 }}>Vehicle / Truck Type</span>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#172B3A' }}>
                    {inspectingTrip.truck?.registration_number || inspectingTrip.truck_registration_at_loading || 'TRUCK'}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: '#60717E' }}>
                    {inspectingTrip.truck?.truck_type || 'Tipper'} ({inspectingTrip.truck?.capacity_tonnes || 30}T Capacity)
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', color: '#60717E', fontWeight: 700 }}>Fleet Haulier / Owner</span>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#172B3A' }}>
                    {inspectingTrip.truck?.owner_name || 'Fleet Operator'}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', color: '#60717E', fontWeight: 700 }}>Dispatched From</span>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#172B3A' }}>
                    {inspectingTrip.loading_site?.name || 'Loading Pit'}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', color: '#60717E', fontWeight: 700 }}>Destination Site</span>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#172B3A' }}>
                    {inspectingTrip.offloading_site?.name || 'Depot'}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', color: '#60717E', fontWeight: 700 }}>Scale Weigh Ticket</span>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#172B3A' }}>
                    {inspectingTrip.offloading_event?.scale_ticket_number || 'Pending Weighing'}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Bottom Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '1.25rem' }}>
              {inspectingTrip.status === 'closed' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const id = inspectingTrip.id;
                    setInspectingTrip(null);
                    setSelectedClosureInvoiceId(id);
                  }}
                >
                  <ExternalLink size={14} />
                  <span>Generate / View Commercial Invoice</span>
                </button>
              )}

              {inspectingTrip.status === 'exception' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const trip = inspectingTrip;
                    const exc: TripException = trip.exceptions?.[0] || {
                      id: `exc-${trip.id}`,
                      trip_id: trip.id,
                      trip_number: trip.trip_number,
                      exception_type: 'volume_variance',
                      description: 'Payload discrepancy detected between loading and delivery weighbridge.',
                      severity: 'high',
                      status: 'open',
                    };
                    setInspectingTrip(null);
                    setTriagingItem({ trip, exception: exc });
                  }}
                  style={{ backgroundColor: '#DC2626', borderColor: '#DC2626' }}
                >
                  <AlertTriangle size={14} />
                  <span>Triage Exception</span>
                </button>
              )}

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setInspectingTrip(null)}
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exception Triage Modal */}
      {triagingItem && (
        <ExceptionTriageModal
          trip={triagingItem.trip}
          exception={triagingItem.exception}
          onClose={() => setTriagingItem(null)}
          onResolve={async (tripId, params) => {
            await resolveTripException(tripId, params);
            setTriagingItem(null);
          }}
        />
      )}

      {/* Commercial Invoice Modal */}
      <TripClosureInvoiceModal
        invoice={tripInvoices.find((inv) => inv.trip_id === selectedClosureInvoiceId) || null}
        onClose={() => setSelectedClosureInvoiceId(null)}
      />
    </div>
  );
};
