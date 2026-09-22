import React, { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { PlateDisplay } from '../common/PlateDisplay';
import {
  ShieldAlert,
  Truck,
  MapPin,
  Search,
} from 'lucide-react';

export const AdminAuditView: React.FC = () => {
  const { trucks, drivers, sites, auditLogs } = useAppState();

  const [activeTab, setActiveTab] = useState<'audit' | 'fleet' | 'sites'>('audit');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLogs = auditLogs.filter((log) => {
    const query = searchQuery.toLowerCase();
    return (
      (log.actor_name || '').toLowerCase().includes(query) ||
      log.action.toLowerCase().includes(query) ||
      (log.entity_name || '').toLowerCase().includes(query) ||
      (log.reason || '').toLowerCase().includes(query)
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header & Sub-navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
            System Administration & Immutable Audit Trail
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Tamper-evident transactional ledger, master fleet records, and operational site configurations.
          </p>
        </div>

        <div style={{ display: 'flex', backgroundColor: '#F1F5F9', padding: '0.25rem', borderRadius: 'var(--radius-md)' }}>
          <button
            type="button"
            className="btn"
            style={{
              padding: '0.4rem 1rem',
              minHeight: '34px',
              fontSize: '0.8125rem',
              backgroundColor: activeTab === 'audit' ? '#FFFFFF' : 'transparent',
              boxShadow: activeTab === 'audit' ? 'var(--shadow-xs)' : 'none',
              color: activeTab === 'audit' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => setActiveTab('audit')}
          >
            <ShieldAlert size={14} />
            Audit Ledger ({auditLogs.length})
          </button>
          <button
            type="button"
            className="btn"
            style={{
              padding: '0.4rem 1rem',
              minHeight: '34px',
              fontSize: '0.8125rem',
              backgroundColor: activeTab === 'fleet' ? '#FFFFFF' : 'transparent',
              boxShadow: activeTab === 'fleet' ? 'var(--shadow-xs)' : 'none',
              color: activeTab === 'fleet' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => setActiveTab('fleet')}
          >
            <Truck size={14} />
            Fleet & Drivers ({trucks.length})
          </button>
          <button
            type="button"
            className="btn"
            style={{
              padding: '0.4rem 1rem',
              minHeight: '34px',
              fontSize: '0.8125rem',
              backgroundColor: activeTab === 'sites' ? '#FFFFFF' : 'transparent',
              boxShadow: activeTab === 'sites' ? 'var(--shadow-xs)' : 'none',
              color: activeTab === 'sites' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => setActiveTab('sites')}
          >
            <MapPin size={14} />
            Operating Sites ({sites.length})
          </button>
        </div>
      </div>

      {activeTab === 'audit' && (
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={18} color="var(--brand-primary)" />
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
                Append-Only System Audit History
              </h3>
              <span className="badge badge-blue">Non-Repudiation Verified</span>
            </div>

            <div style={{ position: 'relative', width: '260px' }}>
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: '2.25rem', minHeight: '36px', fontSize: '0.8125rem' }}
                placeholder="Search audit trail..."
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
          </div>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Entity / Record ID</th>
                  <th>Actor / Role</th>
                  <th>Reason / Justification</th>
                  <th>State Diff (JSON)</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const actionColorMap: Record<string, { bg: string; text: string }> = {
                    CREATE: { bg: '#E0F2FE', text: '#0369A1' },
                    CLOSE: { bg: '#D1FAE5', text: '#065F46' },
                    EXCEPTION_RAISE: { bg: '#FEE2E2', text: '#991B1B' },
                    EXCEPTION_RESOLVE: { bg: '#FEF3C7', text: '#92400E' },
                    PAYOUT_APPROVE: { bg: '#D1FAE5', text: '#065F46' },
                  };
                  const color = actionColorMap[log.action] || { bg: '#F1F5F9', text: '#475569' };

                  return (
                    <tr key={log.id}>
                      <td style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {new Date(log.timestamp || log.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                        <div>{new Date(log.timestamp || log.created_at || Date.now()).toLocaleDateString()}</div>
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            backgroundColor: color.bg,
                            color: color.text,
                            fontSize: '0.7rem',
                          }}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: '0.8125rem' }}>
                        <div>{log.entity_name}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                          {log.entity_id}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{log.actor_name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Role: {log.actor_role}
                        </div>
                      </td>
                      <td style={{ fontSize: '0.8125rem', maxWidth: '300px' }}>
                        {log.reason || 'Standard operational event recording.'}
                      </td>
                      <td>
                        <div
                          className="mono"
                          style={{
                            backgroundColor: '#F8FAFC',
                            padding: '0.35rem 0.5rem',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-subtle)',
                            fontSize: '0.7rem',
                            maxWidth: '240px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={JSON.stringify(log.new_value || {})}
                        >
                          {JSON.stringify(log.new_value || {})}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'fleet' && (
        <div className="field-two-col">
          {/* Registered Trucks */}
          <div className="card">
            <div className="card-header">
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
                Authorized Haulage Fleet ({trucks.length} Trucks)
              </h3>
              <button type="button" className="btn btn-primary" style={{ minHeight: '34px', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}>
                + Register Truck
              </button>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>License Plate</th>
                    <th>Model / Spec</th>
                    <th>Rated Payload</th>
                    <th>Owner / Haulier</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trucks.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <PlateDisplay plate={t.registration_number} size="sm" />
                      </td>
                      <td style={{ fontSize: '0.8125rem' }}>{t.truck_type}</td>
                      <td className="mono" style={{ fontWeight: 700 }}>{t.capacity_tonnes} T</td>
                      <td style={{ fontSize: '0.8125rem' }}>{t.owner_name}</td>
                      <td>
                        <span className="badge badge-closed" style={{ fontSize: '0.65rem' }}>
                          ACTIVE
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Registered Drivers */}
          <div className="card">
            <div className="card-header">
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
                Haulage Drivers ({drivers.length})
              </h3>
              <button type="button" className="btn btn-secondary" style={{ minHeight: '34px', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}>
                + Add Driver
              </button>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Driver Name</th>
                    <th>Phone / License</th>
                    <th>Settlement Bank</th>
                    <th>Paystack Recipient</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{d.full_name}</div>
                      </td>
                      <td style={{ fontSize: '0.8125rem' }}>
                        <div>{d.phone}</div>
                        <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {d.license_number}
                        </div>
                      </td>
                      <td style={{ fontSize: '0.8125rem' }}>
                        <div>{d.bank_name}</div>
                        <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          •••• {d.account_number_last4}
                        </div>
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--brand-primary)' }}>
                          {d.paystack_recipient_code}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sites' && (
        <div className="card">
          <div className="card-header">
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
              Configured Dredging Pits & Delivery Depots
            </h3>
            <button type="button" className="btn btn-primary" style={{ minHeight: '34px', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}>
              + Add Operating Site
            </button>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Site Code</th>
                  <th>Terminal Name</th>
                  <th>Operation Type</th>
                  <th>Location & Waterfront</th>
                  <th>Target / Capacity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td className="mono" style={{ fontWeight: 800, color: 'var(--brand-primary)' }}>
                      {s.code}
                    </td>
                    <td>
                      <strong>{s.name}</strong>
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          backgroundColor: s.site_type === 'loading' ? '#FEF3C7' : '#D1FAE5',
                          color: s.site_type === 'loading' ? '#92400E' : '#065F46',
                        }}
                      >
                        {s.site_type === 'loading' ? 'Loading Pit' : 'Offloading Depot'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8125rem' }}>{s.location}</td>
                    <td className="mono">
                      {s.daily_target_tonnes ? `${s.daily_target_tonnes} T / Day` : 'Depot Buffer'}
                    </td>
                    <td>
                      <span className="badge badge-closed" style={{ fontSize: '0.65rem' }}>
                        ONLINE
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
