-- ====================================================================
-- Sand Dredging Truck Movement Waybill & Revenue Assurance System
-- Adams Project - Row-Level Security (RLS) Policies Migration
-- ====================================================================

-- ====================================================================
-- SCHEMA REPAIR: Ensure pre-existing remote tables have all required
-- columns. Uses ADD COLUMN IF NOT EXISTS so it is safe to run when the
-- columns already exist.
-- ====================================================================

-- SITES
ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_code VARCHAR(50);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_type VARCHAR(50);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS location_description TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS gps_coordinates POINT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Africa/Lagos';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sites ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- TRUCKS
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS normalized_registration VARCHAR(50);
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS capacity NUMERIC(10, 2);
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS capacity_unit VARCHAR(20) DEFAULT 'm3';
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS truck_type VARCHAR(100) DEFAULT 'tipping_trailer';
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS owner_name VARCHAR(255);
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS owner_contact VARCHAR(100);
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- DRIVERS
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_number VARCHAR(100);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS payment_profile_id UUID;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- TRIPS
ALTER TABLE trips ADD COLUMN IF NOT EXISTS trip_number VARCHAR(100);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS driver_id UUID;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS offloading_site_id UUID;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'draft_capture';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE trips ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- EXCEPTIONS
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS resolved_by UUID;
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- AUDIT_LOG
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS old_value JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS new_value JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_role VARCHAR(100);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ====================================================================
-- 1. Enable RLS on all operational and financial tables
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE trucks ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE truck_driver_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_loading_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_offloading_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_compliance_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Helper function to extract user role from JWT claims
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
BEGIN
    RETURN COALESCE(
        current_setting('request.jwt.claim.user_role', true),
        (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role'),
        'authenticated'
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ====================================================================
-- SITES POLICIES
-- ====================================================================
CREATE POLICY "Public authenticated read on active sites"
    ON sites FOR SELECT
    TO authenticated
    USING (status = 'active');

CREATE POLICY "Admin full access on sites"
    ON sites FOR ALL
    TO authenticated
    USING (current_user_role() = 'system_admin');

-- ====================================================================
-- TRUCKS & DRIVERS POLICIES
-- ====================================================================
CREATE POLICY "Authenticated read trucks"
    ON trucks FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admin write trucks"
    ON trucks FOR ALL
    TO authenticated
    USING (current_user_role() IN ('system_admin', 'operations_manager'));

CREATE POLICY "Authenticated read drivers"
    ON drivers FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admin write drivers"
    ON drivers FOR ALL
    TO authenticated
    USING (current_user_role() IN ('system_admin', 'operations_manager'));

CREATE POLICY "Authenticated read truck assignments"
    ON truck_driver_assignments FOR SELECT
    TO authenticated
    USING (true);

-- ====================================================================
-- TRIPS POLICIES
-- ====================================================================
CREATE POLICY "Field officers and managers can read trips"
    ON trips FOR SELECT
    TO authenticated
    USING (
        current_user_role() IN ('loading_officer', 'offloading_officer', 'operations_manager', 'audit_reviewer', 'system_admin')
    );

CREATE POLICY "Loading officers can insert new trips"
    ON trips FOR INSERT
    TO authenticated
    WITH CHECK (
        current_user_role() IN ('loading_officer', 'operations_manager', 'system_admin')
    );

CREATE POLICY "Offloading officers and managers can update trips"
    ON trips FOR UPDATE
    TO authenticated
    USING (
        current_user_role() IN ('offloading_officer', 'operations_manager', 'system_admin')
    );

-- ====================================================================
-- LOADING & OFFLOADING EVENTS POLICIES
-- ====================================================================
CREATE POLICY "Read loading events"
    ON trip_loading_events FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Insert loading events"
    ON trip_loading_events FOR INSERT
    TO authenticated
    WITH CHECK (
        current_user_role() IN ('loading_officer', 'operations_manager', 'system_admin')
    );

CREATE POLICY "Read offloading events"
    ON trip_offloading_events FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Insert offloading events"
    ON trip_offloading_events FOR INSERT
    TO authenticated
    WITH CHECK (
        current_user_role() IN ('offloading_officer', 'operations_manager', 'system_admin')
    );

-- ====================================================================
-- EXCEPTIONS POLICIES
-- ====================================================================
CREATE POLICY "Operations and field officers read exceptions"
    ON exceptions FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Field and ops can flag exceptions"
    ON exceptions FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Operations managers resolve exceptions"
    ON exceptions FOR UPDATE
    TO authenticated
    USING (
        current_user_role() IN ('operations_manager', 'system_admin')
    );

-- ====================================================================
-- FINANCIAL & PAYOUT POLICIES (Strict Finance segregation)
-- ====================================================================
CREATE POLICY "Finance and admin read payout batches"
    ON payout_batches FOR SELECT
    TO authenticated
    USING (
        current_user_role() IN ('finance_officer', 'audit_reviewer', 'system_admin')
    );

CREATE POLICY "Finance and admin manage payout batches"
    ON payout_batches FOR ALL
    TO authenticated
    USING (
        current_user_role() IN ('finance_officer', 'system_admin')
    );

CREATE POLICY "Finance and admin read payout items"
    ON payout_items FOR SELECT
    TO authenticated
    USING (
        current_user_role() IN ('finance_officer', 'audit_reviewer', 'system_admin')
    );

CREATE POLICY "Finance and admin read payment profiles"
    ON payment_profiles FOR SELECT
    TO authenticated
    USING (
        current_user_role() IN ('finance_officer', 'system_admin')
    );

CREATE POLICY "Finance and admin manage compliance docs"
    ON business_compliance_docs FOR ALL
    TO authenticated
    USING (
        current_user_role() IN ('finance_officer', 'audit_reviewer', 'system_admin')
    );

-- ====================================================================
-- IMMUTABLE AUDIT LOG POLICIES
-- ====================================================================
CREATE POLICY "Insert audit log allowed for system & triggers"
    ON audit_log FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Audit reviewers, managers and admins read audit logs"
    ON audit_log FOR SELECT
    TO authenticated
    USING (
        current_user_role() IN ('audit_reviewer', 'operations_manager', 'finance_officer', 'system_admin')
    );
