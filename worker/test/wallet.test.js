import {env, createExecutionContext, waitOnExecutionContext} from 'cloudflare:test';
import {describe, it, expect, vi, afterEach} from 'vitest';
import worker from '../src/index.js';

const ORIGIN = 'https://ste-hue.github.io';
const LS_VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';

function req(path, {method = 'GET', body, key} = {}) {
  const headers = {Origin: ORIGIN, 'Content-Type': 'application/json'};
  if (key) headers['X-License-Key'] = key;
  return new Request(`https://credits.example${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
}

async function call(request) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function seedWallet(key, balance) {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO wallets (id, license_key_hash, balance) VALUES (?,?,?)')
    .bind(id, hash, balance).run();
  return id;
}

// `fetchMock` from `cloudflare:test` is not exported by the installed
// @cloudflare/vitest-plugin@1.0.0 (confirmed absent from its cloudflare:test.d.ts
// and runtime bundle). Its documented equivalent for mocking outbound requests
// in this version is stubbing the global `fetch`, which works because tests run
// inside the same isolate as the Worker under test.
function mockLemonSqueezy(status, body) {
  vi.stubGlobal('fetch', async (url, init = {}) => {
    if (String(url) !== LS_VALIDATE_URL || (init.method || 'GET') !== 'POST') {
      throw new Error(`unexpected fetch: ${init.method || 'GET'} ${url}`);
    }
    return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('CORS', () => {
  it('answers preflight for an allowed origin', async () => {
    const res = await call(new Request('https://credits.example/wallet/spend', {
      method: 'OPTIONS', headers: {Origin: ORIGIN, 'Access-Control-Request-Method': 'POST'}
    }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-License-Key');
  });

  it('omits ACAO for a disallowed origin', async () => {
    const res = await call(new Request('https://credits.example/wallet', {
      headers: {Origin: 'https://evil.example', 'X-License-Key': 'k'}
    }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('GET /wallet', () => {
  it('404 for an unknown key', async () => {
    expect((await call(req('/wallet', {key: 'nope'}))).status).toBe(404);
  });
  it('returns the balance for a known key', async () => {
    await seedWallet('KEY-A', 7);
    const res = await call(req('/wallet', {key: 'KEY-A'}));
    expect(res.status).toBe(200);
    expect((await res.json()).balance).toBe(7);
  });
});

describe('POST /wallet/activate', () => {
  it('creates a wallet when LS validates the key for our store', async () => {
    mockLemonSqueezy(200, {valid: true, meta: {store_id: 4242}});
    const res = await call(req('/wallet/activate', {method: 'POST', body: {license_key: 'KEY-NEW'}}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(0);
    expect(body.wallet_id).toBeTruthy();
  });

  it('401 when LS says the key is invalid', async () => {
    mockLemonSqueezy(200, {valid: false, error: 'invalid'});
    expect((await call(req('/wallet/activate', {method: 'POST', body: {license_key: 'BAD'}}))).status).toBe(401);
  });

  it("403 when the key belongs to someone else's store", async () => {
    mockLemonSqueezy(200, {valid: true, meta: {store_id: 999}});
    expect((await call(req('/wallet/activate', {method: 'POST', body: {license_key: 'FOREIGN'}}))).status).toBe(403);
  });

  it('502 when Lemon Squeezy is down', async () => {
    mockLemonSqueezy(500, {error: 'internal'});
    expect((await call(req('/wallet/activate', {method: 'POST', body: {license_key: 'DOWN'}}))).status).toBe(502);
  });

  it('502 when Lemon Squeezy returns unparseable JSON', async () => {
    vi.stubGlobal('fetch', async (url, init = {}) => {
      if (String(url) !== LS_VALIDATE_URL || (init.method || 'GET') !== 'POST') {
        throw new Error(`unexpected fetch: ${init.method || 'GET'} ${url}`);
      }
      return new Response('not json', {status: 200, headers: {'Content-Type': 'text/plain'}});
    });
    expect((await call(req('/wallet/activate', {method: 'POST', body: {license_key: 'GARBLED'}}))).status).toBe(502);
  });
});

describe('POST /wallet/spend', () => {
  it('decrements and records the ledger row', async () => {
    const id = await seedWallet('KEY-S1', 2);
    const res = await call(req('/wallet/spend', {
      method: 'POST', key: 'KEY-S1', body: {reason: 'midi_export', idempotency_key: 'i-1'}
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).balance).toBe(1);
    const led = await env.DB.prepare(
      "SELECT delta, type FROM transactions WHERE wallet_id = ? AND idempotency_key = 'i-1'"
    ).bind(id).first();
    expect(led).toEqual({delta: -1, type: 'export'});
  });

  it('replays the same idempotency key without double-spending', async () => {
    await seedWallet('KEY-S2', 2);
    const send = () => call(req('/wallet/spend', {
      method: 'POST', key: 'KEY-S2', body: {reason: 'midi_export', idempotency_key: 'i-2'}
    }));
    expect((await (await send()).json()).balance).toBe(1);
    const replay = await send();
    expect(replay.status).toBe(200);
    const body = await replay.json();
    expect(body.balance).toBe(1);
    expect(body.replayed).toBe(true);
  });

  it('402 at zero balance, and concurrent spends cannot share the last credit', async () => {
    await seedWallet('KEY-S3', 1);
    const spend = (idem) => call(req('/wallet/spend', {
      method: 'POST', key: 'KEY-S3', body: {reason: 'midi_export', idempotency_key: idem}
    }));
    const [a, b] = await Promise.all([spend('i-3a'), spend('i-3b')]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 402]);
    const bal = await env.DB.prepare(
      "SELECT balance FROM wallets WHERE license_key_hash = (SELECT license_key_hash FROM wallets w JOIN transactions t ON t.wallet_id = w.id WHERE t.idempotency_key IN ('i-3a','i-3b') LIMIT 1)"
    ).first();
    expect(bal.balance).toBe(0);
  });

  it('429 beyond 30 exports per minute', async () => {
    const id = await seedWallet('KEY-S4', 100);
    const stmt = env.DB.prepare(
      "INSERT INTO transactions (id, wallet_id, delta, type, idempotency_key) VALUES (?,?,-1,'export',?)"
    );
    for (let i = 0; i < 30; i++) await stmt.bind(crypto.randomUUID(), id, `pre-${i}`).run();
    const res = await call(req('/wallet/spend', {
      method: 'POST', key: 'KEY-S4', body: {reason: 'midi_export', idempotency_key: 'i-4'}
    }));
    expect(res.status).toBe(429);
  });

  it("rejects another wallet's idempotency key with 409 and no debit", async () => {
    await seedWallet('KEY-X1', 5);
    const id2 = await seedWallet('KEY-X2', 5);
    const spend = (key) => call(req('/wallet/spend', {
      method: 'POST', key, body: {reason: 'midi_export', idempotency_key: 'shared-idem'}
    }));
    expect((await spend('KEY-X1')).status).toBe(200);
    const res = await spend('KEY-X2');
    expect(res.status).toBe(409);
    const w2 = await env.DB.prepare('SELECT balance FROM wallets WHERE id = ?').bind(id2).first();
    expect(w2.balance).toBe(5);
  });
});
