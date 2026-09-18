-- ====================================================================
-- Sand Dredging Truck Movement Waybill & Revenue Assurance System
-- Adams Project - Realistic Seed Data
-- ====================================================================

-- 1. Sites
INSERT INTO sites (id, name, site_code, site_type, location_description, status, timezone) VALUES
('11111111-1111-1111-1111-111111111111', 'Lekki Dredge Basin Alpha', 'LKK-01', 'loading', 'Km 24 Lekki-Epe Expressway, Coastal Corridor, Lagos', 'active', 'Africa/Lagos'),
('22222222-2222-2222-2222-222222222222', 'Badagry Creek Pit 3', 'BDG-03', 'loading', 'Badagry Waterway Extraction Terminal, Lagos', 'active', 'Africa/Lagos'),
('33333333-3333-3333-3333-333333333333', 'Ikorodu Sand Wharf & Stockpile', 'IKR-01', 'offloading', 'Ipakodo Industrial Jetty, Ikorodu, Lagos', 'active', 'Africa/Lagos'),
('44444444-4444-4444-4444-444444444444', 'Epe Reclamation Project Site', 'EPE-02', 'offloading', 'Epe Marina Free Zone Expansion, Epe, Lagos', 'active', 'Africa/Lagos')
ON CONFLICT (site_code) DO NOTHING;

-- 2. Evidence Files (pre-seeded placeholders)
INSERT INTO evidence_files (id, bucket, object_path, file_type, file_size_bytes, checksum) VALUES
('a0000000-0000-0000-0000-000000000001', 'plate-images', 'plates/2026/09/APP-482-XA.jpg', 'image/jpeg', 245120, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
('a0000000-0000-0000-0000-000000000002', 'scale-tickets', 'tickets/2026/09/ST-88291.jpg', 'image/jpeg', 312450, 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'),
('a0000000-0000-0000-0000-000000000003', 'compliance-docs', 'kyc/adams_logistics_cac.pdf', 'application/pdf', 1048576, '88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589')
ON CONFLICT (id) DO NOTHING;

-- 3. Trucks
INSERT INTO trucks (id, registration_number, normalized_registration, capacity, capacity_unit, truck_type, owner_name, status) VALUES
('bbbbbbbb-1111-1111-1111-111111111111', 'APP-482-XA', 'APP482XA', 30.00, 'm3', '12-Tyre Heavy Tipper', 'Adams Haulage Ltd', 'active'),
('bbbbbbbb-2222-2222-2222-222222222222', 'KJA-918-YD', 'KJA918YD', 20.00, 'm3', '6-Tyre Standard Tipper', 'Oasis Marine Transport', 'active'),
('bbbbbbbb-3333-3333-3333-333333333333', 'LSR-234-BC', 'LSR234BC', 45.00, 'tonnes', '16-Tyre Articulated Semi-Trailer', 'Coastline Dredge Fleet', 'active'),
('bbbbbbbb-4444-4444-4444-444444444444', 'EKY-701-LG', 'EKY701LG', 30.00, 'm3', '12-Tyre Heavy Tipper', 'Lekki Aggregate Logistics', 'active'),
('bbbbbbbb-5555-5555-5555-555555555555', 'BDG-551-ZZ', 'BDG551ZZ', 25.00, 'm3', '10-Tyre Tipper', 'West Coast Sand Movers', 'active')
ON CONFLICT (normalized_registration) DO NOTHING;

-- 4. Payment Profiles
INSERT INTO payment_profiles (id, account_name, account_number, account_last4, bank_code, bank_name, paystack_recipient_code, status, verified_at) VALUES
('cccccccc-1111-1111-1111-111111111111', 'Adams Haulage Operations', '0123456789', '6789', '058', 'Guaranty Trust Bank (GTBank)', 'RCP_78x991023a1', 'active', NOW() - INTERVAL '30 days'),
('cccccccc-2222-2222-2222-222222222222', 'Babatunde Aliu Ventures', '2049182736', '2736', '011', 'First Bank of Nigeria', 'RCP_44y129381b2', 'active', NOW() - INTERVAL '20 days'),
('cccccccc-3333-3333-3333-333333333333', 'Chukwuemeka Okonkwo Haulage', '1019283746', '3746', '033', 'United Bank for Africa (UBA)', 'RCP_99z882109c3', 'active', NOW() - INTERVAL '15 days')
ON CONFLICT (id) DO NOTHING;

-- 5. Drivers
INSERT INTO drivers (id, full_name, phone, license_number, status, payment_profile_id) VALUES
('dddddddd-1111-1111-1111-111111111111', 'Babatunde Aliu', '+234 803 111 2233', 'LAG-882910-AA', 'active', 'cccccccc-2222-2222-2222-222222222222'),
('dddddddd-2222-2222-2222-222222222222', 'Chukwuemeka Okonkwo', '+234 802 444 5566', 'EN-771920-BB', 'active', 'cccccccc-3333-3333-3333-333333333333'),
('dddddddd-3333-3333-3333-333333333333', 'Idris Sanusi', '+234 814 777 8899', 'OG-551029-CC', 'active', 'cccccccc-1111-1111-1111-111111111111')
ON CONFLICT (phone) DO NOTHING;

-- 6. Truck Driver Assignments
INSERT INTO truck_driver_assignments (truck_id, driver_id, status) VALUES
('bbbbbbbb-1111-1111-1111-111111111111', 'dddddddd-1111-1111-1111-111111111111', 'active'),
('bbbbbbbb-2222-2222-2222-222222222222', 'dddddddd-2222-2222-2222-222222222222', 'active'),
('bbbbbbbb-3333-3333-3333-333333333333', 'dddddddd-3333-3333-3333-333333333333', 'active')
ON CONFLICT DO NOTHING;

-- 7. Trips
INSERT INTO trips (id, trip_number, truck_id, driver_id, loading_site_id, offloading_site_id, status, loaded_at, closed_at, idempotency_key) VALUES
('eeeeeeee-1111-1111-1111-111111111111', 'TRIP-20260917-001', 'bbbbbbbb-1111-1111-1111-111111111111', 'dddddddd-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'closed', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour', 'idem-trip-001'),
('eeeeeeee-2222-2222-2222-222222222222', 'TRIP-20260917-002', 'bbbbbbbb-2222-2222-2222-222222222222', 'dddddddd-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'open', NOW() - INTERVAL '45 minutes', NULL, 'idem-trip-002'),
('eeeeeeee-3333-3333-3333-333333333333', 'TRIP-20260917-003', 'bbbbbbbb-3333-3333-3333-333333333333', 'dddddddd-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'open', NOW() - INTERVAL '20 minutes', NULL, 'idem-trip-003'),
('eeeeeeee-4444-4444-4444-444444444444', 'TRIP-20260917-004', 'bbbbbbbb-4444-4444-4444-444444444444', 'dddddddd-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'exception', NOW() - INTERVAL '2 hours', NULL, 'idem-trip-004')
ON CONFLICT (trip_number) DO NOTHING;

-- 8. Trip Loading Events
INSERT INTO trip_loading_events (trip_id, plate_image_file_id, extracted_number, confirmed_number, confidence_score, operator_notes) VALUES
('eeeeeeee-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'APP482XA', 'APP-482-XA', 98.40, 'Full bucket load verified at gate'),
('eeeeeeee-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000001', 'KJA918YD', 'KJA-918-YD', 94.10, 'Gate dispatch standard load'),
('eeeeeeee-3333-3333-3333-333333333333', 'a0000000-0000-0000-0000-000000000001', 'LSR234BC', 'LSR-234-BC', 91.50, 'Heavy articulated trailer dispatched'),
('eeeeeeee-4444-4444-4444-444444444444', 'a0000000-0000-0000-0000-000000000001', 'EKY701LG', 'EKY-701-LG', 82.00, 'Partial mud obstruction on rear plate')
ON CONFLICT (trip_id) DO NOTHING;

-- 9. Trip Offloading Events
INSERT INTO trip_offloading_events (trip_id, quantity, unit, weighed_at, evidence_file_id, variance_percentage, operator_notes) VALUES
('eeeeeeee-1111-1111-1111-111111111111', 29.50, 'm3', NOW() - INTERVAL '1 hour', 'a0000000-0000-0000-0000-000000000002', -1.67, 'Delivered within acceptable tolerance')
ON CONFLICT (trip_id) DO NOTHING;

-- 10. Exceptions
INSERT INTO exceptions (id, trip_id, exception_type, description, status, resolution_notes) VALUES
('ffffffff-1111-1111-1111-111111111111', 'eeeeeeee-4444-4444-4444-444444444444', 'volume_variance', 'Delivered quantity flagged at 21.00 m3 vs declared loading capacity 30.00 m3 (>25% shortage anomaly).', 'pending', NULL)
ON CONFLICT (id) DO NOTHING;

-- 11. Payout Batches
INSERT INTO payout_batches (id, batch_number, period_start, period_end, gross_amount, total_trips, status, paystack_transfer_reference) VALUES
('99999999-1111-1111-1111-111111111111', 'PAY-2026-W37', NOW() - INTERVAL '7 days', NOW() - INTERVAL '1 day', 2450000.00, 48, 'approved', 'PST_TRF_BATCH_99210')
ON CONFLICT (batch_number) DO NOTHING;

-- 12. Payout Items
INSERT INTO payout_items (payout_batch_id, driver_id, trip_count, quantity_total, rate_per_unit, amount, status, transfer_code) VALUES
('99999999-1111-1111-1111-111111111111', 'dddddddd-1111-1111-1111-111111111111', 18, 540.00, 1500.00, 810000.00, 'queued', 'TRF_aliu_9812'),
('99999999-1111-1111-1111-111111111111', 'dddddddd-2222-2222-2222-222222222222', 16, 320.00, 1500.00, 480000.00, 'queued', 'TRF_chuwku_1291'),
('99999999-1111-1111-1111-111111111111', 'dddddddd-3333-3333-3333-333333333333', 14, 630.00, 1800.00, 1160000.00, 'queued', 'TRF_idris_7721')
ON CONFLICT DO NOTHING;

-- 13. Business Compliance Docs
INSERT INTO business_compliance_docs (document_type, registration_number, title, status, notes) VALUES
('cac_certificate', 'RC-1849201', 'Corporate Affairs Commission - Certificate of Incorporation', 'verified', 'Verified active company status with RC-1849201'),
('tin_certificate', '23091823-0001', 'Federal Inland Revenue Service (FIRS) Corporate TIN', 'verified', 'Corporate TIN active and in good standing'),
('scuml', 'SC-2023-99120', 'Special Control Unit Against Money Laundering (SCUML)', 'verified', 'Compliance certification confirmed'),
('director_id', 'NIN-99102938102', 'Director Proof of ID & BVN Verification', 'verified', 'Director identity matched against NIBSS BVN records')
ON CONFLICT DO NOTHING;

-- 14. Audit Log initial seed
INSERT INTO audit_log (entity_name, entity_id, action, reason, actor_role) VALUES
('sites', '11111111-1111-1111-1111-111111111111', 'INSERT', 'System setup: Initial dredge basin configured', 'system_admin'),
('trips', 'eeeeeeee-1111-1111-1111-111111111111', 'STATUS_CHANGE', 'Trip completed and verified with weighment scale ticket', 'offloading_officer'),
('exceptions', 'ffffffff-1111-1111-1111-111111111111', 'EXCEPTION_FLAGGED', 'Delivered quantity divergence exceeded 10% threshold', 'offloading_officer');
