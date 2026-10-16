import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const required = [
  'E2E_SUPABASE_URL', 'E2E_SUPABASE_SERVICE_ROLE_KEY', 'E2E_LOADING_EMAIL', 'E2E_LOADING_PASSWORD',
  'E2E_OPERATIONS_EMAIL', 'E2E_OPERATIONS_PASSWORD', 'E2E_FINANCE_EMAIL', 'E2E_FINANCE_PASSWORD',
  'E2E_UNASSIGNED_EMAIL', 'E2E_UNASSIGNED_PASSWORD', 'E2E_USER_IDS_FILE',
];
if (required.some(name => !process.env[name])) {
  process.stderr.write('Temporary Auth fixture configuration is incomplete.\n');
  process.exit(2);
}

const client = createClient(process.env.E2E_SUPABASE_URL, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const identities = [
  ['loading', process.env.E2E_LOADING_EMAIL, process.env.E2E_LOADING_PASSWORD],
  ['operations', process.env.E2E_OPERATIONS_EMAIL, process.env.E2E_OPERATIONS_PASSWORD],
  ['finance', process.env.E2E_FINANCE_EMAIL, process.env.E2E_FINANCE_PASSWORD],
  ['unassigned', process.env.E2E_UNASSIGNED_EMAIL, process.env.E2E_UNASSIGNED_PASSWORD],
];

try {
  const ids = {};
  for (const [name, email, password] of identities) {
    const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user?.id) {
      const status = Number.isInteger(error?.status) ? error.status : 'unknown';
      const code = typeof error?.code === 'string' ? error.code : 'unknown';
      throw new Error(`Auth fixture creation failed (${status}/${code}).`);
    }
    ids[name] = data.user.id;
  }
  const output = process.env.E2E_USER_IDS_FILE;
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, JSON.stringify(ids), { mode: 0o600, flag: 'wx' });
  process.stdout.write('Created four temporary, email-confirmed Auth identities.\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Temporary Auth fixture creation failed.'}\n`);
  process.exitCode = 1;
}
