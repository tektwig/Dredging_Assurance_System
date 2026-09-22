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
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  for (const migration of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
    console.log(`PASS migration ${migration}`);
  }
  for (const test of readdirSync('supabase/tests/database').filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(`supabase/tests/database/${test}`, 'utf8'));
    console.log(`PASS database assertions ${test} (embedded PostgreSQL; simulated Supabase Auth roles)`);
  }
} catch (error) {
  console.error('FAIL', error.message);
  if (error.where) console.error(error.where);
  if (error.detail) console.error(error.detail);
  process.exitCode = 1;
} finally {
  await db.close();
}
