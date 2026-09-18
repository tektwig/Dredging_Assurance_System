import React, { useState } from 'react';
import { useAppStore } from '../services/store';
import {
  Truck,
  MapPin,
  Users,
  Plus,
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export const MasterDataPortal: React.FC = () => {
  const { trucks, sites, drivers, addTruck, addDriver } = useAppStore();

  // Modals state
  const [showTruckModal, setShowTruckModal] = useState(false);
  const [showDriverModal, setShowDriverModal] = useState(false);

  // New Truck Form state
  const [newPlate, setNewPlate] = useState('');
  const [newCapacity, setNewCapacity] = useState(30);
  const [newCapacityUnit, setNewCapacityUnit] = useState<'m3' | 'tonnes' | 'truckloads'>('m3');
  const [newTruckType, setNewTruckType] = useState('12-Tyre Heavy Tipper');
  const [newOwner, setNewOwner] = useState('');
  const [truckError, setTruckError] = useState('');
  const [truckSuccess, setTruckSuccess] = useState('');

  // New Driver Form state
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [newDriverLicense, setNewDriverLicense] = useState('');
  const [driverError, setDriverError] = useState('');
  const [driverSuccess, setDriverSuccess] = useState('');

  // Handle Truck Submit
  const handleAddTruck = (e: React.FormEvent) => {
    e.preventDefault();
    setTruckError('');
    setTruckSuccess('');

    if (!newPlate.trim() || !newOwner.trim()) {
      setTruckError('Please complete all required fields.');
      return;
    }

    const res = addTruck({
      registration_number: newPlate.trim(),
      capacity: Number(newCapacity),
      capacity_unit: newCapacityUnit,
      truck_type: newTruckType,
      owner_name: newOwner.trim(),
    });

    if (res.success) {
      setTruckSuccess(`Truck ${newPlate.toUpperCase()} successfully registered and normalized.`);
      setTimeout(() => {
        setShowTruckModal(false);
        setNewPlate('');
        setNewOwner('');
        setTruckSuccess('');
      }, 1800);
    } else {
      setTruckError(res.error || 'Failed to register truck.');
    }
  };

  // Handle Driver Submit
  const handleAddDriver = (e: React.FormEvent) => {
    e.preventDefault();
    setDriverError('');
    setDriverSuccess('');

    if (!newDriverName.trim() || !newDriverPhone.trim()) {
      setDriverError('Please complete driver name and phone number.');
      return;
    }

    const res = addDriver({
      full_name: newDriverName.trim(),
      phone: newDriverPhone.trim(),
      license_number: newDriverLicense.trim() || 'N/A',
    });

    if (res.success) {
      setDriverSuccess(`Driver ${newDriverName} successfully registered.`);
      setTimeout(() => {
        setShowDriverModal(false);
        setNewDriverName('');
        setNewDriverPhone('');
        setNewDriverLicense('');
        setDriverSuccess('');
      }, 1800);
    } else {
      setDriverError(res.error || 'Failed to register driver.');
    }
  };

  return (
    <div style={{ maxWidth: '1400px', margin: '1.5rem auto', padding: '0 1.25rem' }}>
      {/* Overview Card */}
      <div className="glass-card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--accent-sand)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-sand)', fontWeight: 700 }}>
              ENTERPRISE MASTER REGISTRY (BRD SECTION 6.1)
            </span>
            <h2 style={{ fontSize: '1.35rem' }}>Operational Assets, Canonical Plates & Drivers</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Enforcing normalized registration index matching, duplicate prevention, and site parameters.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={() => setShowTruckModal(true)}
              className="btn btn-primary btn-sm"
            >
              <Plus size={14} /> Register Vehicle
            </button>
            <button
              onClick={() => setShowDriverModal(true)}
              className="btn btn-secondary btn-sm"
            >
              <Plus size={14} /> Add Driver
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>
        {/* Trucks List & Normalization */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Truck size={20} color="var(--accent-gold)" />
              <h3 style={{ fontSize: '1.1rem' }}>Authorized Fleet ({trucks.length})</h3>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Auto-Normalized</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '500px', overflowY: 'auto' }}>
            {trucks.map((truck) => (
              <div
                key={truck.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span className="license-plate-tag">{truck.registration_number}</span>
                  <span className="badge badge-closed">{truck.status}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <span>Canonical Index: <strong className="mono" style={{ color: 'var(--accent-cyan)' }}>{truck.normalized_registration}</strong></span>
                  <span style={{ color: 'var(--accent-gold)', fontWeight: 600 }}>{truck.capacity} {truck.capacity_unit}</span>
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Owner: {truck.owner_name} • Type: {truck.truck_type}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sites */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MapPin size={20} color="var(--accent-cyan)" />
              <h3 style={{ fontSize: '1.1rem' }}>Active Terminals & Pits ({sites.length})</h3>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {sites.map((site) => (
              <div
                key={site.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{site.name}</span>
                  <span className={`badge ${site.site_type === 'loading' ? 'badge-open' : 'badge-closed'}`}>
                    {site.site_type.toUpperCase()}
                  </span>
                </div>

                <div style={{ fontSize: '0.78rem', color: 'var(--accent-gold)' }} className="mono">
                  Code: {site.site_code} • {site.timezone}
                </div>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {site.location_description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Drivers */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={20} color="var(--accent-emerald)" />
              <h3 style={{ fontSize: '1.1rem' }}>Registered Drivers ({drivers.length})</h3>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '500px', overflowY: 'auto' }}>
            {drivers.map((driver) => (
              <div
                key={driver.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{driver.full_name}</span>
                  <span className="badge badge-closed">{driver.status}</span>
                </div>

                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Phone: <strong>{driver.phone}</strong>
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  License: <span className="mono">{driver.license_number}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal: Register Vehicle */}
      {showTruckModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 120,
            padding: '1rem',
          }}
          onClick={() => setShowTruckModal(false)}
        >
          <div
            className="glass-card"
            style={{ maxWidth: '520px', width: '100%', background: '#0D1424' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.2rem' }}>Register New Haulage Vehicle</h3>
              <button
                onClick={() => setShowTruckModal(false)}
                className="btn btn-secondary btn-sm"
              >
                <X size={16} />
              </button>
            </div>

            {truckError && (
              <div style={{ background: 'rgba(244, 63, 94, 0.15)', border: '1px solid #F43F5E', color: '#FB7185', padding: '0.75rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                <AlertCircle size={16} /> {truckError}
              </div>
            )}

            {truckSuccess && (
              <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10B981', color: '#34D399', padding: '0.75rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                <CheckCircle2 size={16} /> {truckSuccess}
              </div>
            )}

            <form onSubmit={handleAddTruck}>
              <div style={{ marginBottom: '1rem' }}>
                <label className="input-label">Vehicle Registration Number *</label>
                <input
                  type="text"
                  className="input-control"
                  placeholder="e.g. LAG-582-XZ"
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value)}
                  required
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Canonical Index Preview: <code className="mono" style={{ color: 'var(--accent-gold)' }}>{newPlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || '—'}</code>
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label className="input-label">Declared Capacity *</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    className="input-control"
                    value={newCapacity}
                    onChange={(e) => setNewCapacity(Number(e.target.value))}
                    required
                  />
                </div>
                <div>
                  <label className="input-label">Unit</label>
                  <select
                    className="select-control"
                    value={newCapacityUnit}
                    onChange={(e) => setNewCapacityUnit(e.target.value as any)}
                  >
                    <option value="m3">m³</option>
                    <option value="tonnes">Tonnes</option>
                    <option value="truckloads">Loads</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="input-label">Truck Body Type</label>
                <select
                  className="select-control"
                  value={newTruckType}
                  onChange={(e) => setNewTruckType(e.target.value)}
                >
                  <option value="12-Tyre Heavy Tipper">12-Tyre Heavy Tipper</option>
                  <option value="10-Tyre Tipper">10-Tyre Tipper</option>
                  <option value="6-Tyre Standard Tipper">6-Tyre Standard Tipper</option>
                  <option value="16-Tyre Articulated Semi-Trailer">16-Tyre Articulated Semi-Trailer</option>
                </select>
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label className="input-label">Fleet Owner / Contractor Name *</label>
                <input
                  type="text"
                  className="input-control"
                  placeholder="e.g. Lagos Coastline Haulage Ltd"
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                Register & Save to Master Ledger
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Driver */}
      {showDriverModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 120,
            padding: '1rem',
          }}
          onClick={() => setShowDriverModal(false)}
        >
          <div
            className="glass-card"
            style={{ maxWidth: '480px', width: '100%', background: '#0D1424' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.2rem' }}>Register Haulage Driver</h3>
              <button
                onClick={() => setShowDriverModal(false)}
                className="btn btn-secondary btn-sm"
              >
                <X size={16} />
              </button>
            </div>

            {driverError && (
              <div style={{ background: 'rgba(244, 63, 94, 0.15)', border: '1px solid #F43F5E', color: '#FB7185', padding: '0.75rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                <AlertCircle size={16} /> {driverError}
              </div>
            )}

            {driverSuccess && (
              <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10B981', color: '#34D399', padding: '0.75rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                <CheckCircle2 size={16} /> {driverSuccess}
              </div>
            )}

            <form onSubmit={handleAddDriver}>
              <div style={{ marginBottom: '1rem' }}>
                <label className="input-label">Driver Full Name *</label>
                <input
                  type="text"
                  className="input-control"
                  placeholder="e.g. Aliyu Mohammed"
                  value={newDriverName}
                  onChange={(e) => setNewDriverName(e.target.value)}
                  required
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="input-label">Mobile Phone Number *</label>
                <input
                  type="tel"
                  className="input-control"
                  placeholder="e.g. +234 802 123 4567"
                  value={newDriverPhone}
                  onChange={(e) => setNewDriverPhone(e.target.value)}
                  required
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label className="input-label">Commercial Drivers License ID</label>
                <input
                  type="text"
                  className="input-control"
                  placeholder="e.g. LAG-991209-CD"
                  value={newDriverLicense}
                  onChange={(e) => setNewDriverLicense(e.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                Save Driver Record
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
