-- ====================================================================
-- Sand Dredging Truck Movement Waybill & Revenue Assurance System
-- Adams Project - Initial Schema Migration
-- ====================================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ====================================================================
-- 1. SITES (Loading & Offloading Depots)
-- ====================================================================
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    site_code VARCHAR(50) UNIQUE NOT NULL,
    site_type VARCHAR(50) NOT NULL CHECK (site_type IN ('loading', 'offloading', 'hybrid')),
    location_description TEXT,
    gps_coordinates POINT,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
    timezone VARCHAR(50) NOT NULL DEFAULT 'Africa/Lagos',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 2. EVIDENCE FILES (Tamper-evident storage references)
-- ====================================================================
CREATE TABLE IF NOT EXISTS evidence_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket VARCHAR(100) NOT NULL CHECK (bucket IN ('plate-images', 'scale-tickets', 'waybills', 'compliance-docs')),
    object_path TEXT NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT,
    checksum VARCHAR(64) NOT NULL, -- SHA-256 tamper-evident hash
    uploaded_by UUID,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 3. TRUCKS (Master data with canonical plate normalization)
-- ====================================================================
CREATE TABLE IF NOT EXISTS trucks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_number VARCHAR(50) NOT NULL,
    normalized_registration VARCHAR(50) UNIQUE NOT NULL,
    capacity NUMERIC(10, 2) NOT NULL CHECK (capacity > 0),
    capacity_unit VARCHAR(20) NOT NULL DEFAULT 'm3' CHECK (capacity_unit IN ('m3', 'tonnes', 'truckloads')),
    truck_type VARCHAR(100) DEFAULT 'tipping_trailer',
    owner_name VARCHAR(255) NOT NULL,
    owner_contact VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'decommissioned')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Function to normalize license plates (removes spaces, dashes, converts to uppercase)
CREATE OR REPLACE FUNCTION normalize_plate_number(plate TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN UPPER(REGEXP_REPLACE(plate, '[^A-Za-z0-9]', '', 'g'));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to keep normalized_registration automatically up to date
CREATE OR REPLACE FUNCTION set_normalized_registration()
RETURNS TRIGGER AS $$
BEGIN
    NEW.normalized_registration := normalize_plate_number(NEW.registration_number);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_normalize_truck_registration
    BEFORE INSERT OR UPDATE OF registration_number
    ON trucks
    FOR EACH ROW
    EXECUTE FUNCTION set_normalized_registration();

-- ====================================================================
-- 4. PAYMENT PROFILES (Driver & Contractor Bank Accounts)
-- ====================================================================
CREATE TABLE IF NOT EXISTS payment_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(20) NOT NULL,
    account_last4 VARCHAR(4) NOT NULL,
    bank_code VARCHAR(20) NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    bvn_hash VARCHAR(64),
    paystack_recipient_code VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'active', 'suspended', 'rejected')),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 5. DRIVERS (Registered haulage operators)
-- ====================================================================
CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) UNIQUE NOT NULL,
    license_number VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
    payment_profile_id UUID REFERENCES payment_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 6. TRUCK-DRIVER ASSIGNMENTS (Effective-dated mapping)
-- ====================================================================
CREATE TABLE IF NOT EXISTS truck_driver_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 7. TRIPS (The Immutable Primary Movement Ledger)
-- ====================================================================
CREATE TABLE IF NOT EXISTS trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_number VARCHAR(100) UNIQUE NOT NULL,
    truck_id UUID NOT NULL REFERENCES trucks(id),
    driver_id UUID REFERENCES drivers(id),
    loading_site_id UUID NOT NULL REFERENCES sites(id),
    offloading_site_id UUID REFERENCES sites(id),
    status VARCHAR(50) NOT NULL DEFAULT 'draft_capture' CHECK (
        status IN ('draft_capture', 'open', 'closed', 'exception', 'cancelled', 'sync_failed')
    ),
    idempotency_key VARCHAR(100) UNIQUE,
    loaded_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 8. TRIP LOADING EVENTS (Gate capture & OCR confidence)
-- ====================================================================
CREATE TABLE IF NOT EXISTS trip_loading_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID UNIQUE NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    plate_image_file_id UUID REFERENCES evidence_files(id),
    extracted_number VARCHAR(50),
    confirmed_number VARCHAR(50) NOT NULL,
    confidence_score NUMERIC(5, 2) CHECK (confidence_score BETWEEN 0 AND 100),
    captured_by UUID,
    operator_notes TEXT,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 9. TRIP OFFLOADING EVENTS (Discharge verification & weight tickets)
-- ====================================================================
CREATE TABLE IF NOT EXISTS trip_offloading_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID UNIQUE NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    unit VARCHAR(20) NOT NULL DEFAULT 'm3' CHECK (unit IN ('tonnes', 'm3', 'truckloads')),
    weighed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    evidence_file_id UUID REFERENCES evidence_files(id),
    closed_by UUID,
    variance_percentage NUMERIC(6, 2),
    operator_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 10. EXCEPTIONS & DISPUTES
-- ====================================================================
CREATE TABLE IF NOT EXISTS exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    exception_type VARCHAR(100) NOT NULL CHECK (
        exception_type IN ('volume_variance', 'plate_mismatch', 'unregistered_vehicle', 'gate_timeout', 'route_anomaly', 'damaged_seal', 'other')
    ),
    description TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'resolved', 'dismissed')),
    owner_id UUID,
    resolution_notes TEXT,
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 11. PAYOUT BATCHES (Disbursement batches)
-- ====================================================================
CREATE TABLE IF NOT EXISTS payout_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number VARCHAR(100) UNIQUE NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    gross_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    total_trips INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'processing', 'completed', 'failed')),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    paystack_transfer_reference VARCHAR(100),
    paystack_batch_code VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 12. PAYOUT ITEMS (Line items per driver/contractor)
-- ====================================================================
CREATE TABLE IF NOT EXISTS payout_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payout_batch_id UUID NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id),
    trip_count INTEGER NOT NULL DEFAULT 1,
    quantity_total NUMERIC(12, 2) NOT NULL,
    rate_per_unit NUMERIC(10, 2) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'success', 'failed')),
    transfer_code VARCHAR(100),
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 13. BUSINESS COMPLIANCE DOCS (KYC, CAC, TIN for Paystack verification)
-- ====================================================================
CREATE TABLE IF NOT EXISTS business_compliance_docs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type VARCHAR(100) NOT NULL CHECK (
        document_type IN ('cac_certificate', 'tin_certificate', 'scuml', 'director_id', 'bank_statement', 'proof_of_address')
    ),
    registration_number VARCHAR(100),
    title VARCHAR(255) NOT NULL,
    evidence_file_id UUID REFERENCES evidence_files(id),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- 14. IMMUTABLE AUDIT LOG
-- ====================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_name VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL CHECK (
        action IN ('INSERT', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'CORRECTION_APPLIED', 'PAYOUT_APPROVED', 'EXCEPTION_FLAGGED')
    ),
    old_value JSONB,
    new_value JSONB,
    reason TEXT NOT NULL,
    actor_id UUID,
    actor_role VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable security rule: Disallow UPDATE and DELETE on audit_log
CREATE OR REPLACE FUNCTION protect_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit log entries are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_protect_audit_log
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH STATEMENT
    EXECUTE FUNCTION protect_audit_log();

-- Indexes for high performance
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_truck_id ON trips(truck_id);
CREATE INDEX IF NOT EXISTS idx_trips_loading_site ON trips(loading_site_id);
CREATE INDEX IF NOT EXISTS idx_trips_offloading_site ON trips(offloading_site_id);
CREATE INDEX IF NOT EXISTS idx_trucks_normalized ON trucks(normalized_registration);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_name, entity_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_trip_id ON exceptions(trip_id);
