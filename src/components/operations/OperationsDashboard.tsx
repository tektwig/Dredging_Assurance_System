import React, { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { StatCard } from '../common/StatCard';
import { StatusBadge } from '../common/StatusBadge';
import { PlateDisplay } from '../common/PlateDisplay';
import { ExceptionTriageModal } from './ExceptionTriageModal';
import { TripClosureInvoiceModal } from './TripClosureInvoiceModal';
import { Trip } from '../../types';
import {
  Truck,
  Scale,
  AlertTriangle,
  Clock,
  Search,
  Filter,
  FileSpreadsheet,
  Layers,
} from 'lucide-react';

export const OperationsDashboard: React.FC = () => {
  const { trips, tripInvoices, resolveTripException } = useAppState();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [triagingTrip, setTriagingTrip] = useState<Trip | null>(null);
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
    const matchesSearch =
      trip.trip_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (trip.truck?.registration_number || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (trip.driver?.full_name || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || trip.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleExportCSV = () => {
    const headers = [
      'Trip Number',
      'Truck Plate',
      'Driver Name',
      'Loading Site',
      'Offloading Site',
      'Status',
      'Est Tonnes',
      'Delivered Quantity',
      'Unit',
      'Scale Ticket No',
      'Dispatched Time (UTC)',
      'Closed Time (UTC)',
      'Variance',
      'Notes',
    ];

    const rows = filteredTrips.map((t) => [
      `"${t.trip_number || ''}"`,
      `"${t.truck?.registration_number || ''}"`,
      `"${t.driver?.full_name || ''}"`,
      `"${t.loading_site?.name || ''}"`,
      `"${t.offloading_site?.name || ''}"`,
      `"${t.status.toUpperCase()}"`,
      t.loading_event?.estimated_tonnes || 0,
      t.offloading_event?.quantity || '',
      `"${t.offloading_event?.unit || 'tonnes'}"`,
      `"${t.offloading_event?.scale_ticket_number || ''}"`,
      `"${t.loaded_at || ''}"`,
      `"${t.closed_at || ''}"`,
      t.offloading_event?.variance_from_estimate ?? '',
      `"${(t.offloading_event?.notes || t.loading_event?.notes || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `dredgeops_daily_ledger_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Operations Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
            Operational Control Room & Revenue Assurance
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Real-time movement tracking, dredge pit yield, and weighbridge discrepancy monitoring.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={handleExportCSV}>
            <FileSpreadsheet size={16} />
            Export Daily Ledger (CSV)
          </button>
        </div>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid-4">
        <StatCard
          title="ACTIVE IN TRANSIT"
          value={openCount}
          subtitle="Haulage trucks on road"
          icon={<Truck size={20} />}
          highlightColor="amber"
          trend={{ value: '4 from last hour', isPositive: true }}
        />
        <StatCard
          title="DELIVERED TONNAGE TODAY"
          value={`${totalDeliveredTonnes.toFixed(1)} T`}
          subtitle={`${closedCount} trips verified by scale tickets`}
          icon={<Scale size={20} />}
          highlightColor="emerald"
          trend={{ value: '+12% vs target', isPositive: true }}
        />
        <StatCard
          title="TRIP EXCEPTIONS"
          value={exceptionCount}
          subtitle="Awaiting manager sign-off"
          icon={<AlertTriangle size={20} />}
          highlightColor="crimson"
        />
        <StatCard
          title="AVG. CYCLE TIME"
          value="48 Mins"
          subtitle="Loading gate to scale check"
          icon={<Clock size={20} />}
          highlightColor="blue"
        />
      </div>

      {/* Main Ledger Table Card */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Layers size={18} color="var(--brand-primary)" />
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
              Live Trip Movement Ledger
            </h3>
            <span className="badge badge-blue">{filteredTrips.length} records</span>
          </div>

          {/* Search & Status Filter Controls */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: '240px' }}>
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: '2.25rem', minHeight: '38px', fontSize: '0.8125rem' }}
                placeholder="Filter by plate, trip, driver..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Filter size={14} color="var(--text-muted)" />
              <select
                className="form-select"
                style={{ minHeight: '38px', padding: '0.25rem 0.75rem', fontSize: '0.8125rem', width: 'auto' }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="open">In Transit (Open)</option>
                <option value="closed">Closed & Verified</option>
                <option value="exception">Exceptions</option>
              </select>
            </div>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Trip #</th>
                <th>Truck Registration</th>
                <th>Haulage Driver</th>
                <th>Movement Route</th>
                <th>Est. Loading</th>
                <th>Scale Delivered</th>
                <th>Transit Time</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrips.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    No trips match the selected filter criteria.
                  </td>
                </tr>
              ) : (
                filteredTrips.map((trip) => {
                  const hasException = trip.status === 'exception';
                  const closureInvoice = tripInvoices.find((invoice) => invoice.trip_id === trip.id);
                  const opensInvoice = trip.status === 'closed' && Boolean(closureInvoice);
                  const elapsedMins = Math.floor(
                    (Date.now() - new Date(trip.loaded_at).getTime()) / (60 * 1000)
                  );

                  return (
                    <tr
                      key={trip.id}
                      onClick={() => opensInvoice && setSelectedClosureInvoiceId(trip.id)}
                      style={{ cursor: opensInvoice ? 'pointer' : undefined }}
                      title={opensInvoice ? 'Click to view the closure invoice' : undefined}
                    >
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>
                        {opensInvoice ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedClosureInvoiceId(trip.id);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              color: 'var(--brand-primary)',
                              fontWeight: 800,
                              fontFamily: 'var(--font-mono)',
                              textDecoration: 'underline',
                            }}
                            title="Click to view closure invoice"
                          >
                            {trip.trip_number}
                          </button>
                        ) : (
                          trip.trip_number
                        )}
                      </td>
                      <td>
                        <PlateDisplay plate={trip.truck?.registration_number || 'N/A'} size="sm" />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{trip.driver?.full_name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {trip.truck?.owner_name}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.8125rem' }}>
                          <strong>{trip.loading_site?.code}</strong> → <strong>{trip.offloading_site?.code}</strong>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {trip.loading_site?.name.split(' ')[0]} to {trip.offloading_site?.name.split(' ')[0]}
                        </div>
                      </td>
                      <td className="mono">
                        {trip.loading_event?.estimated_tonnes || 30}T
                      </td>
                      <td className="mono" style={{ fontWeight: 700 }}>
                        {trip.offloading_event ? (
                          <span style={{ color: '#059669' }}>
                            {trip.offloading_event.quantity} {trip.offloading_event.unit}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                        {trip.closed_at ? (
                          <span>Completed</span>
                        ) : (
                          <span style={{ color: '#B45309', fontWeight: 600 }}>
                            {elapsedMins} mins
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={trip.status} size="sm" />
                      </td>
                      <td>
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {hasException && (
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ minHeight: '30px', padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
                              onClick={() => setTriagingTrip(trip)}
                            >
                              <AlertTriangle size={12} />
                              Dispute
                            </button>
                          )}
                          {trip.status === 'closed' && tripInvoices.some((invoice) => invoice.trip_id === trip.id) && (
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ minHeight: '30px', padding: '0.2rem 0.55rem', fontSize: '0.72rem' }}
                              onClick={() => setSelectedClosureInvoiceId(trip.id)}
                              title="View the immutable closure invoice with dispatch snapshots"
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

      {/* Exception Resolution Drawer Modal */}
      {triagingTrip && triagingTrip.exceptions && triagingTrip.exceptions.length > 0 && (
        <ExceptionTriageModal
          trip={triagingTrip}
          exception={triagingTrip.exceptions[0]}
          onClose={() => setTriagingTrip(null)}
          onResolve={resolveTripException}
        />
      )}

      <TripClosureInvoiceModal
        invoice={tripInvoices.find((invoice) => invoice.trip_id === selectedClosureInvoiceId) || null}
        onClose={() => setSelectedClosureInvoiceId(null)}
      />
    </div>
  );
};
