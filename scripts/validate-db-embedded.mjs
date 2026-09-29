// Optional PostgreSQL/WASM validation, not a substitute for Supabase integration
// or multi-connection concurrency tests. No remote connections are used.
import { readFileSync, readdirSync } from 'node:fs';

const { PGlite } = await import('../scratch/backend-validation/node_modules/@electric-sql/pglite/dist/index.js');
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    -- Only a SQL policy/metadata mock. This is NOT a Storage HTTP service.
    create schema storage;
    create table storage.buckets(id text primary key, name text not null, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id), name text not null, owner_id text, metadata jsonb,
      unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon,service_role;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  for (const migration of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
    if (migration === '20260924000100_loading_alignment.sql') {
      // Preserve the original contract tests at their actual schema checkpoint.
      for (const test of ['mvp_foundation.sql', 'payment_readiness.sql']) {
        await db.exec(readFileSync(`supabase/tests/database/${test}`, 'utf8'));
        console.log(`PASS legacy checkpoint assertions ${test}`);
      }
      await db.exec(readFileSync('supabase/tests/upgrade/loading_before.sql', 'utf8'));
    }
    await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
    console.log(`PASS migration ${migration}`);
  }
  await db.exec(readFileSync('supabase/tests/upgrade/loading_after.sql', 'utf8'));
  console.log('PASS populated forward-upgrade assertions');
  for (const test of readdirSync('supabase/tests/database').filter(f => f.endsWith('.sql') && f !== 'mvp_foundation.sql').sort()) {
    await db.exec(readFileSync(`supabase/tests/database/${test}`, 'utf8'));
    console.log(`PASS database assertions ${test} (embedded PostgreSQL; simulated Supabase Auth roles)`);
  }
} catch (error) {
  console.error('FAIL', error.message);
  // Do not dump SQL parameters/row details: registration payloads can contain banking.
  if (error.code) console.error('SQLSTATE', error.code);
  process.exitCode = 1;
} finally {
  await db.close();
}
