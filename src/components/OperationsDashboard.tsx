import React, { useState } from 'react';
import { useAppStore } from '../services/store';
import { TripStatus, Trip } from '../types';
import {
  TrendingUp,
  Truck,
  AlertTriangle,
  Scale,
  ChevronRight,
  Download,
  Eye,
} from 'lucide-react';
import { TripDetailModal } from './TripDetailModal';

export const OperationsDashboard: React.FC = () => {
  const { trips, exceptions, auditLogs } = useAppStore();
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<'today' | 'all'>('all');
  const [selectedTripForModal, setSelectedTripForModal] = useState<Trip | null>(null);

  // Compute live KPIs
  const activeTrips = trips.filter((t) => t.status === 'open').length;
  const closedTrips = trips.filter((t) => t.status === 'closed');
  const exceptionCount = exceptions.filter((e) => e.status === 'pending').length;

  const totalDeliveredVolume = closedTrips.reduce((acc, t) => {
    return acc + (t.offloading_event?.quantity || t.truck?.capacity || 0);
  }, 0);

  // Revenue Assurance: ₦1,500/m³ rate
  const assuredRevenue = totalDeliveredVolume * 1500;

  const filteredTrips = trips.filter((t) => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (periodFilter === 'today') {
      const todayStr = new Date().toISOString().slice(0, 10);
      return t.loaded_at.slice(0, 10) === todayStr;
    }
    return true;
  });

  const handleExportCSV = () => {
    const headers = [
      'Trip Number',
      'Truck Plate',
      'Driver Name',
      'Loading Site',
      'Offload Site',
      'Delivered Qty',
      'Unit',
      'Status',
      'Loaded At',
      'Closed At',
    ];

    const rows = filteredTrips.map((t) => [
      t.trip_number,
      t.truck?.registration_number || '',
      t.driver?.full_name || '',
      t.loading_site?.name || '',
      t.offloading_site?.name || '',
      t.offloading_event?.quantity || t.truck?.capacity || '',
      t.offloading_event?.unit || t.truck?.capacity_unit || 'm3',
      t.status,
      t.loaded_at,
      t.closed_at || '',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.map((val) => `"${val}"`).join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `DredgeOps_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: TripStatus) => {
    switch (status) {
      case 'open':
        return <span className="badge badge-open">IN TRANSIT</span>;
      case 'closed':
        return <span className="badge badge-closed">VERIFIED & CLOSED</span>;
      case 'exception':
        return <span className="badge badge-exception">DISCREPANCY</span>;
      case 'draft_capture':
        return <span className="badge badge-draft">OFFLINE DRAFT</span>;
      default:
        return <span className="badge badge-draft">{status}</span>;
    }
  };

  return (
    <div style={{ maxWidth: '1400px', margin: '1.5rem auto', padding: '0 1.25rem' }}>
      {/* Metric KPI Cards */}
      <div className="grid-responsive-cards" style={{ marginBottom: '1.75rem' }}>
        {/* KPI 1: Active In-Transit */}
        <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-cyan)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                Active In-Transit
              </span>
              <h2 style={{ fontSize: '2rem', marginTop: '0.2rem', color: '#fff' }}>{activeTrips}</h2>
            </div>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(6, 182, 212, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Truck size={22} color="var(--accent-cyan)" />
            </div>
          </div>
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <span className="pulse-dot" style={{ marginRight: '6px' }} />
            Real-time dredge terminal dispatch queue
          </div>
        </div>

        {/* KPI 2: Total Delivered Volume */}
        <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-emerald)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                Delivered Volume
              </span>
              <h2 style={{ fontSize: '2rem', marginTop: '0.2rem', color: '#fff' }}>
                {totalDeliveredVolume.toLocaleString()} <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>m³</span>
              </h2>
            </div>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(16, 185, 129, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Scale size={22} color="var(--accent-emerald)" />
            </div>
          </div>
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {closedTrips.length} verified electronic scale waybills
          </div>
        </div>

        {/* KPI 3: Derived Revenue Assurance */}
        <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-gold)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                Assured Revenue (Event-Derived)
              </span>
              <h2 style={{ fontSize: '2rem', marginTop: '0.2rem', color: 'var(--accent-gold)' }}>
                ₦{assuredRevenue.toLocaleString()}
              </h2>
            </div>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(245, 158, 11, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingUp size={22} color="var(--accent-gold)" />
            </div>
          </div>
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            100% verified against tamper-evident audit logs
          </div>
        </div>

        {/* KPI 4: Exceptions */}
        <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-rose)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                Pending Exceptions
              </span>
              <h2 style={{ fontSize: '2rem', marginTop: '0.2rem', color: exceptionCount > 0 ? '#FB7185' : '#fff' }}>
                {exceptionCount}
              </h2>
            </div>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(244, 63, 94, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertTriangle size={22} color="var(--accent-rose)" />
            </div>
          </div>
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Requires managerial review & audit sign-off
          </div>
        </div>
      </div>

      {/* Movement Ledger Section */}
      <div className="glass-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            marginBottom: '1.25rem',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '1rem',
          }}
        >
          <div>
            <h3 style={{ fontSize: '1.25rem' }}>Primary Movement Ledger</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Immutable transactional trip records across all dredging corridors.
            </p>
          </div>

          {/* Filters & Export */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Period Filter */}
            <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', borderRadius: 'var(--radius-md)', padding: '2px' }}>
              <button
                type="button"
                onClick={() => setPeriodFilter('today')}
                style={{
                  padding: '0.3rem 0.6rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  background: periodFilter === 'today' ? 'var(--accent-gold)' : 'transparent',
                  color: periodFilter === 'today' ? '#000' : 'var(--text-secondary)',
                }}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setPeriodFilter('all')}
                style={{
                  padding: '0.3rem 0.6rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  background: periodFilter === 'all' ? 'var(--accent-gold)' : 'transparent',
                  color: periodFilter === 'all' ? '#000' : 'var(--text-secondary)',
                }}
              >
                All Time
              </button>
            </div>

            {/* Status Filter */}
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {[
                { id: 'all', label: 'All' },
                { id: 'open', label: 'In Transit' },
                { id: 'closed', label: 'Closed' },
                { id: 'exception', label: 'Exceptions' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterStatus(f.id)}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: filterStatus === f.id ? 'var(--accent-gold)' : 'rgba(255, 255, 255, 0.05)',
                    color: filterStatus === f.id ? '#000' : 'var(--text-secondary)',
                    border: 'none',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Export CSV Button */}
            <button
              type="button"
              onClick={handleExportCSV}
              className="btn btn-secondary btn-sm"
              title="Export verified report as CSV"
              style={{ fontSize: '0.78rem' }}
            >
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>

        {/* Ledger Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Waybill / Trip ID</th>
                <th>Truck Plate</th>
                <th>Driver</th>
                <th>Route Corridor</th>
                <th>Volume / Capacity</th>
                <th>Loaded At</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrips.map((tr) => (
                <tr
                  key={tr.id}
                  onClick={() => setSelectedTripForModal(tr)}
                  style={{ cursor: 'pointer' }}
                  title="Click to drill down into event history & evidence"
                >
                  <td>
                    <span className="mono" style={{ fontWeight: 600, color: '#F8FAFC' }}>
                      {tr.trip_number}
                    </span>
                  </td>
                  <td>
                    <span className="license-plate-tag">{tr.truck?.registration_number}</span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{tr.driver?.full_name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tr.driver?.phone}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{tr.loading_site?.site_code}</span>
                      <ChevronRight size={12} color="var(--text-muted)" />
                      <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>
                        {tr.offloading_site?.site_code || 'En Route'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {tr.loading_site?.name.slice(0, 24)}...
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--accent-gold)' }}>
                      {tr.offloading_event ? `${tr.offloading_event.quantity} ${tr.offloading_event.unit}` : `${tr.truck?.capacity} ${tr.truck?.capacity_unit}`}
                    </div>
                    {tr.offloading_event?.variance_percentage !== undefined && (
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: Math.abs(tr.offloading_event.variance_percentage) > 10 ? '#FB7185' : '#34D399',
                        }}
                      >
                        Variance: {tr.offloading_event.variance_percentage > 0 ? `+${tr.offloading_event.variance_percentage}%` : `${tr.offloading_event.variance_percentage}%`}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ fontSize: '0.8rem' }}>
                      {new Date(tr.loaded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {new Date(tr.loaded_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td>{getStatusBadge(tr.status)}</td>
                  <td>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTripForModal(tr);
                      }}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                    >
                      <Eye size={13} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down modal */}
      <TripDetailModal
        trip={selectedTripForModal}
        onClose={() => setSelectedTripForModal(null)}
        auditLogs={auditLogs}
      />
    </div>
  );
};
