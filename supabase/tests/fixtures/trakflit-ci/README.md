# TRAKFLIT SQL CI fixtures

These synthetic-only artifacts make the hybrid-cutover and dual-Waybill integration sequence reproducible on an isolated GitHub-hosted runner. They are test inputs, not a replacement for the live migration history.

- `canonical_baseline/` contains the seven canonical replacement migrations used by the previously successful hybrid test baseline.
- `hybrid_cutover_seed.sql` is the recovered synthetic HYB-101/HYB-102 fixture (source SHA-256: `BB2508B1A01EBCAD2F03F7C40246F065AF4A1F78FD622B98DEF651900650E9F2`).
- `payment_free_predecessors/`, `dual_waybill/`, and `banking_correction/` hold the explicitly ordered forward migrations used by this test only. Migration `20261015000200_retire_legacy_waybill_bank_rpcs.sql` is intentionally excluded.
- `MIGRATION_SHA256SUMS` pins the checked-in SQL fixture bytes. Update it together with an approved migration source change.

The baseline and payment-free migration snapshots are copied from the verified isolated-test materialization and release staging. If the deployable migrations are later consolidated into this branch, keep each snapshot byte-for-byte synchronized with its deployable source and add an explicit CI equality check; do not switch this test to the conflicting all-sorted historical migration chain.

All values in these tests are synthetic. No hosted project credentials or records are used.
