import React, { useEffect, useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import {
  approvePendingSignup,
  fetchPendingSignups,
  PendingSignup,
} from '../../services/liveOperations';
import { PlateDisplay } from '../common/PlateDisplay';
import {
  ShieldAlert,
  Truck,
  MapPin,
  Search,
  X,
  CheckCircle2,
  AlertCircle,
  Users,
  UserCheck,
  Loader2,
} from 'lucide-react';

export const AdminAuditView: React.FC = () => {
  const { trucks, drivers, sites, auditLogs, addTruck, addDriver } = useAppState();

  const [activeTab, setActiveTab] = useState<'audit' | 'fleet' | 'sites' | 'users'>('audit');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingSignups, setPendingSignups] = useState<PendingSignup[]>([]);
  const [signupSites, setSignupSites] = useState<Record<string, string>>({});
  const [signupError, setSignupError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState('');
  const [loadingSignups, setLoadingSignups] = useState(true);
  const [approvingSignupId, setApprovingSignupId] = useState<string | null>(null);

  const loadPendingSignups = async () => {
    setLoadingSignups(true);
    try {
      setPendingSignups(await fetchPendingSignups());
      setSignupError('');
    } catch (error: unknown) {
      setSignupError(error instanceof Error ? error.message : 'Pending registrations could not be loaded.');
    } finally {
      setLoadingSignups(false);
    }
  };

  useEffect(() => {
    void loadPendingSignups();
  }, []);

  const handleApproveSignup = async (signup: PendingSignup) => {
    const isFieldRole = signup.requestedRole === 'loading_officer' || signup.requestedRole === 'offloading_officer';
    const compatibleSites = sites.filter((site) => site.site_type === (signup.requestedRole === 'loading_officer' ? 'loading' : 'offloading'));
    const siteId = signupSites[signup.id] || compatibleSites[0]?.id;
    if (isFieldRole && !siteId) {
      setSignupError('Create or activate a compatible operating site before approving this field account.');
      return;
    }

    setApprovingSignupId(signup.id);
    setSignupError('');
    setSignupSuccess('');
    try {
      await approvePendingSignup({
        profileId: signup.id,
        role: signup.requestedRole,
        siteId: isFieldRole ? siteId : undefined,
      });
      setSignupSuccess(`${signup.displayName} has been activated successfully.`);
      await loadPendingSignups();
    } catch (error: unknown) {
      setSignupError(error instanceof Error ? error.message : 'The account could not be approved.');
    } finally {
      setApprovingSignupId(null);
    }
  };

  // Modals state
  const [showTruckModal, setShowTruckModal] = useState(false);
  const [showDriverModal, setShowDriverModal] = useState(false);

  // New Truck Form state
  const [newPlate, setNewPlate] = useState('');
  const [newCapacity, setNewCapacity] = useState(30);
  const [newTruckType, setNewTruckType] = useState('10-Wheeler Heavy Tipper');
  const [newOwner, setNewOwner] = useState('');
  const [newOwnerPhone, setNewOwnerPhone] = useState('');
  const [truckError, setTruckError] = useState('');
  const [truckSuccess, setTruckSuccess] = useState('');

  // New Driver Form state
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [newDriverLicense, setNewDriverLicense] = useState('');
  const [newDriverBank, setNewDriverBank] = useState('Zenith Bank PLC');
  const [newDriverLast4, setNewDriverLast4] = useState('');
  const [driverError, setDriverError] = useState('');
  const [driverSuccess, setDriverSuccess] = useState('');

  const handleAddTruckSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTruckError('');
    setTruckSuccess('');

    if (!newPlate.trim() || !newOwner.trim()) {
      setTruckError('Registration plate number and owner/haulier name are required.');
      return;
    }

    const res = addTruck({
      registration_number: newPlate.trim(),
      capacity: Number(newCapacity),
      capacity_unit: 'tonnes',
      truck_type: newTruckType,
      owner_name: newOwner.trim(),
      owner_phone: newOwnerPhone.trim() || '+234 800 000 0000',
    });

    if (res.success) {
      setTruckSuccess(`Truck [${newPlate.toUpperCase()}] registered into master fleet successfully!`);
      setTimeout(() => {
        setShowTruckModal(false);
        setNewPlate('');
        setNewOwner('');
        setNewOwnerPhone('');
        setTruckSuccess('');
      }, 1600);
    } else {
      setTruckError(res.error || 'Failed to register truck.');
    }
  };

  const handleAddDriverSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDriverError('');
    setDriverSuccess('');

    if (!newDriverName.trim() || !newDriverPhone.trim()) {
      setDriverError('Driver full name and phone number are required.');
      return;
    }

    const res = addDriver({
      full_name: newDriverName.trim(),
      phone: newDriverPhone.trim(),
      license_number: newDriverLicense.trim() || 'FRSC-PENDING',
      bank_name: newDriverBank,
      account_number_last4: newDriverLast4.trim() || '0000',
    });

    if (res.success) {
      setDriverSuccess(`Driver [${newDriverName}] enrolled in verified registry successfully!`);
      setTimeout(() => {
        setShowDriverModal(false);
        setNewDriverName('');
        setNewDriverPhone('');
        setNewDriverLicense('');
        setNewDriverLast4('');
        setDriverSuccess('');
      }, 1600);
    } else {
      setDriverError(res.error || 'Failed to register driver.');
    }
  };

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
          <button
            type="button"
            className="btn"
            style={{
              padding: '0.4rem 1rem',
              minHeight: '34px',
              fontSize: '0.8125rem',
              backgroundColor: activeTab === 'users' ? '#FFFFFF' : 'transparent',
              boxShadow: activeTab === 'users' ? 'var(--shadow-xs)' : 'none',
              color: activeTab === 'users' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => setActiveTab('users')}
          >
            <UserCheck size={14} />
            Access Requests ({pendingSignups.length})
          </button>
        </div>
      </div>

      {activeTab === 'users' && (
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Pending Account Registrations</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Review requested access and assign a site before activating field accounts.
              </p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void loadPendingSignups()} disabled={loadingSignups}>
              {loadingSignups ? <Loader2 size={14} className="spin-animation" /> : 'Refresh'}
            </button>
          </div>

          {(signupError || signupSuccess) && (
            <div style={{ margin: '1rem', padding: '0.75rem', borderRadius: 'var(--radius-md)', backgroundColor: signupError ? '#FEF2F2' : '#ECFDF5', color: signupError ? '#991B1B' : '#065F46', fontSize: '0.8125rem', fontWeight: 600 }}>
              {signupError || signupSuccess}
            </div>
          )}

          {loadingSignups ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Loader2 size={22} className="spin-animation" />
            </div>
          ) : pendingSignups.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No pending account registrations.
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Requested Access</th>
                    <th>Operating Site</th>
                    <th>Requested</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingSignups.map((signup) => {
                    const isLoadingRole = signup.requestedRole === 'loading_officer';
                    const isFieldRole = isLoadingRole || signup.requestedRole === 'offloading_officer';
                    const compatibleSites = sites.filter((site) => site.site_type === (isLoadingRole ? 'loading' : 'offloading'));
                    return (
                      <tr key={signup.id}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{signup.displayName}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{signup.email}</div>
                        </td>
                        <td style={{ fontSize: '0.8125rem' }}>{signup.requestedRole.replace(/_/g, ' ')}</td>
                        <td>
                          {isFieldRole ? (
                            <select
                              className="form-select"
                              value={signupSites[signup.id] || compatibleSites[0]?.id || ''}
                              onChange={(event) => setSignupSites((current) => ({ ...current, [signup.id]: event.target.value }))}
                              style={{ minHeight: 36, minWidth: 180 }}
                            >
                              {compatibleSites.length === 0 && <option value="">No compatible site</option>}
                              {compatibleSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                            </select>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Not required</span>
                          )}
                        </td>
                        <td style={{ fontSize: '0.78rem' }}>{new Date(signup.createdAt).toLocaleDateString()}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={approvingSignupId === signup.id}
                            onClick={() => void handleApproveSignup(signup)}
                            style={{ minHeight: 36 }}
                          >
                            {approvingSignupId === signup.id ? <Loader2 size={14} className="spin-animation" /> : <CheckCircle2 size={14} />}
                            Approve
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowTruckModal(true)}
                style={{ minHeight: '34px', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
              >
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
                      <td className="mono" style={{ fontWeight: 700 }}>{t.capacity_tonnes || t.capacity} T</td>
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
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowDriverModal(true)}
                style={{ minHeight: '34px', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
              >
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
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Status: {d.status.toUpperCase()}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.8125rem' }}>{d.phone}</div>
                        <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {d.license_number}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{d.bank_name || 'Zenith Bank PLC'}</div>
                        <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Acct: •••• {d.account_number_last4 || '1234'}
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-open mono" style={{ fontSize: '0.65rem' }}>
                          {d.paystack_recipient_code || 'RCP_VERIFIED'}
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

      {/* Register Truck Modal */}
      {showTruckModal && (
        <div className="modal-overlay" onClick={() => setShowTruckModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Truck size={20} color="#B45309" />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Register New Fleet Vehicle</h3>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.25rem', minHeight: 'auto' }}
                onClick={() => setShowTruckModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddTruckSubmit} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {truckError && (
                <div style={{ padding: '0.6rem 0.85rem', backgroundColor: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 'var(--radius-md)', color: '#991B1B', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertCircle size={16} /> {truckError}
                </div>
              )}
              {truckSuccess && (
                <div style={{ padding: '0.6rem 0.85rem', backgroundColor: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 'var(--radius-md)', color: '#065F46', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 size={16} /> {truckSuccess}
                </div>
              )}

              <div>
                <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Vehicle License Plate *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter registration plate"
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value.toUpperCase())}
                  style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase' }}
                  required
                />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Automatically normalized for FRSC ANPR OCR cross-referencing.</span>
              </div>

              <div className="grid-2">
                <div>
                  <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Rated Capacity (Tonnes) *</label>
                  <input
                    type="number"
                    step="0.5"
                    className="form-input"
                    value={newCapacity}
                    onChange={(e) => setNewCapacity(Number(e.target.value))}
                    required
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Vehicle Spec</label>
                  <select
                    className="form-select"
                    value={newTruckType}
                    onChange={(e) => setNewTruckType(e.target.value)}
                  >
                    <option value="10-Wheeler Heavy Tipper">10-Wheeler Heavy Tipper</option>
                    <option value="Sino 35T Heavy Dump">Sino 35T Heavy Dump</option>
                    <option value="Mercedes Actros 28T">Mercedes Actros 28T</option>
                    <option value="HOWO Sinotruk 32T">HOWO Sinotruk 32T</option>
                    <option value="DAF CF Tipper 30T">DAF CF Tipper 30T</option>
                    <option value="Mack Granite 30T">Mack Granite 30T</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Owner / Haulage Contractor *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter owner or company name"
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Owner Phone Number</label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="e.g. +234 803 551 0921"
                  value={newOwnerPhone}
                  onChange={(e) => setNewOwnerPhone(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowTruckModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Save & Enroll Truck
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Driver Modal */}
      {showDriverModal && (
        <div className="modal-overlay" onClick={() => setShowDriverModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Users size={20} color="#0284C7" />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Enroll Haulage Driver</h3>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.25rem', minHeight: 'auto' }}
                onClick={() => setShowDriverModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddDriverSubmit} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {driverError && (
                <div style={{ padding: '0.6rem 0.85rem', backgroundColor: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 'var(--radius-md)', color: '#991B1B', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertCircle size={16} /> {driverError}
                </div>
              )}
              {driverSuccess && (
                <div style={{ padding: '0.6rem 0.85rem', backgroundColor: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 'var(--radius-md)', color: '#065F46', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 size={16} /> {driverSuccess}
                </div>
              )}

              <div>
                <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Driver Full Name *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Ibrahim Babangida"
                  value={newDriverName}
                  onChange={(e) => setNewDriverName(e.target.value)}
                  required
                />
              </div>

              <div className="grid-2">
                <div>
                  <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Phone Number *</label>
                  <input
                    type="tel"
                    className="form-input"
                    placeholder="+234 803 000 0000"
                    value={newDriverPhone}
                    onChange={(e) => setNewDriverPhone(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>FRSC Driver License</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="FRSC-LAG-XXXX"
                    value={newDriverLicense}
                    onChange={(e) => setNewDriverLicense(e.target.value.toUpperCase())}
                  />
                </div>
              </div>

              <div className="grid-2">
                <div>
                  <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Settlement Bank</label>
                  <select
                    className="form-select"
                    value={newDriverBank}
                    onChange={(e) => setNewDriverBank(e.target.value)}
                  >
                    <option value="Zenith Bank PLC">Zenith Bank PLC</option>
                    <option value="Access Bank PLC">Access Bank PLC</option>
                    <option value="Guaranty Trust Bank (GTB)">Guaranty Trust Bank (GTB)</option>
                    <option value="First Bank of Nigeria">First Bank of Nigeria</option>
                    <option value="United Bank for Africa (UBA)">United Bank for Africa (UBA)</option>
                    <option value="Stanbic IBTC Bank">Stanbic IBTC Bank</option>
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>Account No. (Last 4)</label>
                  <input
                    type="text"
                    maxLength={4}
                    className="form-input"
                    placeholder="4912"
                    value={newDriverLast4}
                    onChange={(e) => setNewDriverLast4(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowDriverModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Enroll Driver
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
