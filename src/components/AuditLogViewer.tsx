import React, { useState } from 'react';
import { useAppStore } from '../services/store';
import {
  Search,
  FileCode,
  Lock,
} from 'lucide-react';

export const AuditLogViewer: React.FC = () => {
  const { auditLogs } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const filteredLogs = auditLogs.filter((log) => {
    const search = searchTerm.toLowerCase();
    return (
      (log.entity_name || '').toLowerCase().includes(search) ||
      log.action.toLowerCase().includes(search) ||
      (log.reason || '').toLowerCase().includes(search) ||
      (String(log.actor_role) || '').toLowerCase().includes(search)
    );
  });

  const selectedLog = auditLogs.find((l) => l.id === selectedLogId);

  return (
    <div style={{ maxWidth: '1400px', margin: '1.5rem auto', padding: '0 1.25rem' }}>
      {/* Header Banner */}
      <div
        className="glass-card"
        style={{
          marginBottom: '1.75rem',
          borderLeft: '4px solid #10B981',
          background: 'linear-gradient(135deg, rgba(19, 27, 46, 0.9) 0%, rgba(11, 15, 23, 0.9) 100%)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <Lock size={16} color="#10B981" />
              <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700 }}>
                CRYPTOGRAPHICALLY PROTECTED LEDGER
              </span>
              <span className="badge badge-closed">IMMUTABLE</span>
            </div>
            <h2 style={{ fontSize: '1.4rem' }}>System-Wide Transactional Audit Trail</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Complete chronological ledger of all trip events, gate OCR confirmations, managerial corrections, and payout disbursements.
            </p>
          </div>

          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Recorded Events</span>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#F8FAFC' }}>
              {auditLogs.length}
            </div>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="glass-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          {/* Search box */}
          <div style={{ position: 'relative', minWidth: '300px' }}>
            <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '12px' }} />
            <input
              type="text"
              className="input-control"
              style={{ paddingLeft: '2.4rem' }}
              placeholder="Filter by entity, action, role or reason..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Showing {filteredLogs.length} verified immutable records
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Target Entity</th>
                <th>Action Taken</th>
                <th>Audited Justification / Reason</th>
                <th>Actor Role</th>
                <th>Payload Diff</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: '0.85rem' }}>
                      {new Date(log.created_at || log.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {new Date(log.created_at || log.timestamp || Date.now()).toLocaleDateString()}
                    </div>
                  </td>
                  <td>
                    <span className="mono" style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>
                      {log.entity_name}
                    </span>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }} className="mono">
                      {(log.entity_id || '').slice(0, 18)}...
                    </div>
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        background:
                          log.action === 'INSERT'
                            ? 'rgba(6, 182, 212, 0.15)'
                            : log.action === 'CORRECTION_APPLIED'
                            ? 'rgba(245, 158, 11, 0.15)'
                            : 'rgba(16, 185, 129, 0.15)',
                        color:
                          log.action === 'INSERT'
                            ? '#38BDF8'
                            : log.action === 'CORRECTION_APPLIED'
                            ? '#FCD34D'
                            : '#34D399',
                      }}
                    >
                      {log.action}
                    </span>
                  </td>
                  <td style={{ maxWidth: '400px' }}>
                    <div style={{ fontSize: '0.85rem' }}>{log.reason}</div>
                  </td>
                  <td>
                    <span className="badge badge-draft">{log.actor_role}</span>
                  </td>
                  <td>
                    <button
                      onClick={() => setSelectedLogId(log.id)}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.75rem' }}
                    >
                      <FileCode size={14} /> Diff
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* JSON Diff Modal */}
      {selectedLog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
          onClick={() => setSelectedLogId(null)}
        >
          <div
            className="glass-card"
            style={{ maxWidth: '750px', width: '100%', background: '#0D1424' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.2rem' }}>State Transition Payload Diff</h3>
              <button
                onClick={() => setSelectedLogId(null)}
                className="btn btn-secondary btn-sm"
              >
                Close
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              <strong>Reason:</strong> {selectedLog.reason}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Old Value */}
              <div>
                <span className="input-label" style={{ color: '#FB7185' }}>Prior State (old_value)</span>
                <pre
                  style={{
                    background: '#070B14',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.78rem',
                    color: '#94A3B8',
                    overflowX: 'auto',
                    maxHeight: '260px',
                  }}
                >
                  {selectedLog.old_value ? JSON.stringify(selectedLog.old_value, null, 2) : 'null (Initial record)'}
                </pre>
              </div>

              {/* New Value */}
              <div>
                <span className="input-label" style={{ color: '#34D399' }}>Updated State (new_value)</span>
                <pre
                  style={{
                    background: '#070B14',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.78rem',
                    color: '#38BDF8',
                    overflowX: 'auto',
                    maxHeight: '260px',
                  }}
                >
                  {selectedLog.new_value ? JSON.stringify(selectedLog.new_value, null, 2) : 'null'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
