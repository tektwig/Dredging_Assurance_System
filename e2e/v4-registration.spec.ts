import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const apiUrl = requiredEnv('VITE_SUPABASE_URL');
const anonKey = requiredEnv('VITE_SUPABASE_ANON_KEY');
const accountNumber = '9081726354';
const bankName = 'Synthetic E2E Bank';
const accountName = 'Synthetic E2E Account Holder';
const driverName = 'Synthetic E2E Browser Driver';
const driverPhone = '08025550101';
const rpcPath = '/rest/v1/rpc/register_loading_participant_v4';

type RegistrationPayload = Record<string, unknown>;
type CapturedCall = { payload: RegistrationPayload; authorization: string };
type Guard = {
  blockedSupabaseHosts: string[];
  blockedExternalHosts: string[];
  misdirectedSupabaseOrigins: string[];
  localRequests: Set<string>;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required isolated E2E setting: ${name}`);
  return value;
}

function installNetworkGuard(page: Page): { guard: Guard; calls: CapturedCall[]; responses: string[] } {
  const guard: Guard = {
    blockedSupabaseHosts: [],
    blockedExternalHosts: [],
    misdirectedSupabaseOrigins: [],
    localRequests: new Set(),
  };
  const calls: CapturedCall[] = [];
  const responses: string[] = [];
  const local = new URL(apiUrl);
  if (local.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(local.hostname)) {
    throw new Error('The browser Supabase URL must use loopback HTTP only.');
  }

  page.on('websocket', socket => {
    const host = new URL(socket.url()).hostname.toLowerCase();
    if (!['127.0.0.1', 'localhost'].includes(host)) guard.blockedExternalHosts.push(host);
  });

  page.on('response', response => {
    const responseUrl = new URL(response.url());
    if (responseUrl.origin !== local.origin || !responseUrl.pathname.startsWith('/rest/v1/')) return;
    void response.text().then(body => responses.push(body)).catch(() => responses.push('[unreadable]'));
  });

  void page.routeWebSocket('**/*', route => {
    const host = new URL(route.url()).hostname.toLowerCase();
    if (!['127.0.0.1', 'localhost'].includes(host)) {
      guard.blockedExternalHosts.push(host);
      route.close();
      return;
    }
    route.connectToServer();
  });

  void page.context().route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const host = url.hostname.toLowerCase();
    const isLoopback = ['127.0.0.1', 'localhost'].includes(host);
    const isStaticFont = ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(host) && request.method() === 'GET';
    const isTesseractStatic = host === 'cdn.jsdelivr.net' && request.method() === 'GET' && (
      url.pathname === '/npm/tesseract.js@v7.0.0/dist/worker.min.js'
      || /^\/npm\/tesseract\.js-core@v7\.0\.0\/tesseract-core-(?:relaxedsimd|simd|lstm)(?:-lstm)?\.wasm(?:\.js)?$/.test(url.pathname)
      || url.pathname === '/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
    );
    const isUnapprovedSupabase = /(^|\.)(supabase\.co|supabase\.in|supabase\.net|supabase\.com)$/.test(host);
    const isSupabaseApiPath = /^\/(?:auth|rest|storage|realtime|functions)\/v1\//.test(url.pathname);

    if (isLoopback && isSupabaseApiPath && url.origin !== local.origin) {
      guard.misdirectedSupabaseOrigins.push(url.origin);
      await route.abort('blockedbyclient');
      return;
    }

    if (!isLoopback && !isStaticFont && !isTesseractStatic) {
      (isUnapprovedSupabase ? guard.blockedSupabaseHosts : guard.blockedExternalHosts).push(host);
      await route.abort('blockedbyclient');
      return;
    }
    if (isLoopback) guard.localRequests.add(`${url.host}${url.pathname}`);

    if (isLoopback && url.pathname === rpcPath && request.method() === 'POST') {
      const headers = await request.allHeaders();
      const payload = request.postDataJSON() as RegistrationPayload;
      const authorization = headers.authorization;
      if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
        calls.push({ payload, authorization });
      }
    }
    await route.continue();
  });
  return { guard, calls, responses };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function drawSyntheticPlate(page: Page, text: string) {
  const installed = await page.evaluate(plate => {
    const target = window as Window & { __trakflitSetSyntheticPlate?: (value: string) => void };
    if (typeof target.__trakflitSetSyntheticPlate !== 'function') return false;
    target.__trakflitSetSyntheticPlate(plate);
    return true;
  }, text);
  expect(installed).toBe(true);
}

async function installSyntheticCamera(page: Page) {
  await page.addInitScript(() => {
    let plateText = 'KJA 102 AB';
    let frame: HTMLCanvasElement | null = null;
    const redraw = () => {
      if (!frame) return;
      const context = frame.getContext('2d');
      if (!context) return;
      context.fillStyle = '#494949';
      context.fillRect(0, 0, frame.width, frame.height);
      context.fillStyle = '#f8f8f4';
      context.strokeStyle = '#111111';
      context.lineWidth = 12;
      context.fillRect(170, 286, 940, 148);
      context.strokeRect(170, 286, 940, 148);
      context.fillStyle = '#080808';
      context.font = 'bold 108px Arial, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(plateText, 640, 360, 900);
    };
    Object.defineProperty(window, '__trakflitSetSyntheticPlate', {
      configurable: false,
      value: (value: string) => { plateText = value; redraw(); },
    });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        if (!frame) {
          frame = document.createElement('canvas');
          frame.width = 1280;
          frame.height = 720;
          redraw();
          window.setInterval(redraw, 250);
        }
        return frame.captureStream(5);
      },
    });
  });
}

function normalizePlate(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

async function capturePlate(page: Page, text: string) {
  await drawSyntheticPlate(page, text);
  await page.getByRole('button', { name: 'Scan Number Plate' }).click();
  await expect(page.getByRole('button', { name: 'Capture Plate' })).toBeVisible();
  await page.getByRole('button', { name: 'Capture Plate' }).click();
  await expect(page.getByText(/Truck not registered|Truck found/)).toBeVisible({ timeout: 90_000 });
}

function containsRestrictedBankInformation(responseBody: string): boolean {
  return responseBody.includes(bankName)
    || responseBody.includes(accountName)
    || responseBody.includes(accountNumber)
    || /"(?:bank_name|account_number|account_name|bank_details|bank_capture)"\s*:/i.test(responseBody);
}

test('V4 registration, safe replay, existing driver, and trip opening use the real local backend', async ({ page }) => {
  const { guard, calls, responses } = installNetworkGuard(page);
  await installSyntheticCamera(page);
  const email = requiredEnv('E2E_LOADING_EMAIL');
  const password = requiredEnv('E2E_LOADING_PASSWORD');
  const api = new URL(apiUrl);
  const publicApiKey = anonKey;

  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/loading$/);
  await expect(page.getByRole('heading', { name: 'Loading Portal' })).toBeVisible();
  await expect(page.getByText('Synthetic Loading Yard')).toBeVisible();

  await capturePlate(page, 'KJA 102 AB');
  await page.getByRole('button', { name: 'Register Truck & Driver' }).click();

  const registerButton = page.getByRole('button', { name: 'Register', exact: true });
  const bankInput = page.getByLabel('Bank Name');
  const numberInput = page.getByLabel('Account Number');
  const holderInput = page.getByLabel("Account Holder's Name");
  await expect(registerButton).toBeDisabled();

  await page.getByLabel('Full Name').fill(driverName);
  await page.getByLabel('Phone Number').fill(driverPhone);
  await bankInput.fill(bankName);
  await holderInput.fill(accountName);
  await numberInput.fill('908172635');
  await expect(registerButton).toBeDisabled();
  await numberInput.fill('90817X6354');
  await expect(registerButton).toBeDisabled();
  await numberInput.fill(accountNumber);
  await expect(registerButton).toBeEnabled();
  await bankInput.clear();
  await expect(registerButton).toBeDisabled();
  await bankInput.fill(bankName);
  await holderInput.clear();
  await expect(registerButton).toBeDisabled();
  await holderInput.fill(accountName);
  await numberInput.clear();
  await expect(registerButton).toBeDisabled();
  await numberInput.fill(accountNumber);

  const firstRegistrationResponse = page.waitForResponse(response => response.url().includes(rpcPath));
  await registerButton.click();
  const firstResponse = await firstRegistrationResponse;
  const firstBody = await firstResponse.json() as Record<string, unknown>;
  expect(firstResponse.status()).toBe(200);
  expect(firstBody.ok === true && typeof firstBody.request_id === 'string').toBe(true);
  expect(containsRestrictedBankInformation(JSON.stringify(firstBody))).toBe(false);
  await expect(page.getByLabel('Estimated Tonnage (tonnes)')).toBeVisible({ timeout: 30_000 });
  expect(calls.length).toBeGreaterThan(0);

  const newDriverCall = calls.find(call => normalizePlate(call.payload.p_plate) === 'KJA102AB');
  expect(newDriverCall !== undefined).toBe(true);
  const firstPayload = newDriverCall!.payload;
  const firstRequestId = firstPayload.p_request_id;
  const directReplay = await page.request.post(new URL(rpcPath.slice(1), `${api.origin}/`).toString(), {
    headers: { apikey: publicApiKey, authorization: newDriverCall!.authorization, 'content-type': 'application/json' },
    data: firstPayload,
  });
  const replayBody = await directReplay.json() as Record<string, unknown>;
  expect(directReplay.status()).toBe(200);
  expect(replayBody.ok === true && replayBody.request_id === firstRequestId).toBe(true);
  expect(containsRestrictedBankInformation(JSON.stringify(replayBody))).toBe(false);

  const conflictingPayload = { ...firstPayload, p_account_number: '1098765432' };
  const conflictResponse = await page.request.post(new URL(rpcPath.slice(1), `${api.origin}/`).toString(), {
    headers: { apikey: publicApiKey, authorization: newDriverCall!.authorization, 'content-type': 'application/json' },
    data: conflictingPayload,
  });
  const conflictBody = await conflictResponse.json() as Record<string, unknown>;
  expect(conflictResponse.status()).toBe(200);
  expect(conflictBody.ok === false && conflictBody.code === 'REQUEST_PAYLOAD_CONFLICT').toBe(true);
  expect(containsRestrictedBankInformation(JSON.stringify(conflictBody))).toBe(false);

  const duplicateResponse = await page.request.post(new URL(rpcPath.slice(1), `${api.origin}/`).toString(), {
    headers: { apikey: publicApiKey, authorization: newDriverCall!.authorization, 'content-type': 'application/json' },
    data: { ...firstPayload, p_request_id: crypto.randomUUID() },
  });
  const duplicateBody = await duplicateResponse.json() as Record<string, unknown>;
  expect(duplicateResponse.status()).toBe(200);
  expect(duplicateBody.ok === false && duplicateBody.code === 'PLATE_ALREADY_REGISTERED').toBe(true);
  expect(containsRestrictedBankInformation(JSON.stringify(duplicateBody))).toBe(false);

  await page.getByLabel('Estimated Tonnage (tonnes)').fill('12.50');
  await page.getByRole('button', { name: 'Review Trip' }).click();
  await page.getByRole('button', { name: 'Open Trip' }).click();
  await expect(page.getByRole('heading', { name: 'Trip opened' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Process Next Truck' }).click();
  await capturePlate(page, 'KJA 103 AB');
  const search = page.getByPlaceholder('Name or phone number');
  await search.fill(driverName);
  await page.getByRole('button', { name: 'Search drivers' }).click();
  await expect(page.getByRole('button', { name: 'Choose driver' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose driver' }).click();
  await expect(page.getByText(`Register truck with existing driver`, { exact: false })).toBeVisible();

  const callsBeforeExisting = calls.length;
  const existingDriverResponse = page.waitForResponse(response => response.url().includes(rpcPath));
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  const existingResponse = await existingDriverResponse;
  const existingBody = await existingResponse.json() as Record<string, unknown>;
  expect(existingResponse.status()).toBe(200);
  expect(existingBody.ok === true).toBe(true);
  expect(containsRestrictedBankInformation(JSON.stringify(existingBody))).toBe(false);
  await expect(page.getByLabel('Estimated Tonnage (tonnes)')).toBeVisible({ timeout: 30_000 });
  const existingDriverCall = calls.slice(callsBeforeExisting).find(call => normalizePlate(call.payload.p_plate) === 'KJA103AB');
  expect(existingDriverCall !== undefined).toBe(true);
  expect(typeof existingDriverCall!.payload.p_existing_driver_id === 'string').toBe(true);
  expect(existingDriverCall!.payload.p_bank_name === null
    && existingDriverCall!.payload.p_account_number === null
    && existingDriverCall!.payload.p_account_name === null).toBe(true);

  const browserStorage = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n'));
  expect(browserStorage.includes(accountNumber) || browserStorage.includes(bankName) || browserStorage.includes(accountName)).toBe(false);
  await expect.poll(() => responses.length).toBeGreaterThanOrEqual(2);
  expect(responses.every(response => !containsRestrictedBankInformation(response))).toBe(true);
  expect(guard.blockedSupabaseHosts.length).toBe(0);
  expect(guard.blockedExternalHosts.length).toBe(0);
  expect(guard.misdirectedSupabaseOrigins.length).toBe(0);
  expect(guard.localRequests.size > 0).toBe(true);
  expect([...guard.localRequests].some(request => request.startsWith(`${api.host}/rest/v1/`))).toBe(true);

  const resultPath = requiredEnv('E2E_RESULT_FILE');
  writeFileSync(resultPath, JSON.stringify({
    newRegistrationRequestId: firstRequestId,
    existingDriverRequestId: existingDriverCall!.payload.p_request_id,
  }), { mode: 0o600, flag: 'wx' });
});

test('Operations Manager authenticates into the Operations route', async ({ page }) => {
  const { guard } = installNetworkGuard(page);
  await signIn(page, requiredEnv('E2E_OPERATIONS_EMAIL'), requiredEnv('E2E_OPERATIONS_PASSWORD'));
  await expect(page).toHaveURL(/\/operations(?:\/|$)/);
  await expect(page.getByRole('navigation', { name: 'Operations navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  expect(guard.blockedSupabaseHosts.length).toBe(0);
  expect(guard.blockedExternalHosts.length).toBe(0);
  expect(guard.misdirectedSupabaseOrigins.length).toBe(0);
});

test('Finance Officer cannot enter Loading operations', async ({ page }) => {
  const { guard: financeGuard } = installNetworkGuard(page);
  await signIn(page, requiredEnv('E2E_FINANCE_EMAIL'), requiredEnv('E2E_FINANCE_PASSWORD'));
  await expect(page).toHaveURL(/\/access-denied$/);
  await page.goto('/loading');
  await expect(page).toHaveURL(/\/access-denied$/);
  expect(financeGuard.blockedSupabaseHosts.length).toBe(0);
  expect(financeGuard.blockedExternalHosts.length).toBe(0);
  expect(financeGuard.misdirectedSupabaseOrigins.length).toBe(0);
});

test('unassigned Loading Officer cannot process trucks without a site assignment', async ({ page }) => {
  const { guard: unassignedGuard } = installNetworkGuard(page);
  await signIn(page, requiredEnv('E2E_UNASSIGNED_EMAIL'), requiredEnv('E2E_UNASSIGNED_PASSWORD'));
  await expect(page).toHaveURL(/\/loading$/);
  await expect(page.getByRole('heading', { name: 'Loading site unavailable' })).toBeVisible();
  await expect(page.getByText(/no current loading-site assignment/i)).toBeVisible();
  expect(unassignedGuard.blockedSupabaseHosts.length).toBe(0);
  expect(unassignedGuard.blockedExternalHosts.length).toBe(0);
  expect(unassignedGuard.misdirectedSupabaseOrigins.length).toBe(0);
});
