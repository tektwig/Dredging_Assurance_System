-- ====================================================================
-- Sand Dredging Truck Movement Waybill & Revenue Assurance System
-- Adams Project - Row-Level Security (RLS) Policies Migration
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
