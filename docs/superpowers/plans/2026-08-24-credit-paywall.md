# Credit Paywall (LS + Worker + D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate MIDI/MPE export behind consumable credits: Lemon Squeezy sells packs (€10 = 100 exports), a dedicated Cloudflare Worker + D1 owns wallets and an immutable ledger, the app spends 1 credit per successful export.

**Architecture:** New `worker/` package (JS ESM Worker, own D1 database, own wrangler.jsonc, deployed with wrangler — fully decoupled from any other Cloudflare app). The app (`src/index.html`) gains a Credits panel and a spend-gate wrapping the existing `saveMidiFile()`; the music engine stays client-side. Identity = LS license key (server stores only its SHA-256). The client gate is dark-launched: with `CREDITS_API===''` exports stay free, so app code merges before the Worker exists.

**Tech Stack:** Cloudflare Workers (JS modules), D1 (SQLite: CHECK/UNIQUE constraints + `batch()` transactions for atomicity), `@cloudflare/vitest-plugin` (formerly vitest-pool-workers; config API unchanged), Lemon Squeezy License API (public) + signed webhooks (X-Signature, HMAC-SHA256). App side stays zero-dependency.

**Spec:** `docs/superpowers/specs/2026-08-24-paywall-crediti-design.md` (includes the "Verified Lemon Squeezy behavior" section — the webhook/custom-data/license-key facts below are verified, not assumed).

## Global Constraints

- The app repo root stays zero-dependency; all npm deps live under `worker/` only. Root `npm test` (11 tests + new credits tests) must pass at every commit; `worker/` has its own `npm test`.
- `worker/` is self-contained: own `package.json`, `wrangler.jsonc`, own D1 database. NO coupling to any existing Cloudflare application (explicit user constraint).
- Engine and MIDI generation stay client-side. Accepted v1 tradeoff: a modified client can bypass `/wallet/spend`; balances/ledger in D1 are the protected asset. No DRM, no server-side MIDI.
- 1 successful export = 1 credit. No free exports. Idempotency key is minted per export intent and kept until a save completes (`saveMidiFile()` returns `true`); retries and cancelled pickers reuse it and are never double-charged.
- Exact status strings (browser verification matches them): `Export costs 1 credit — paste your license key or buy credits below.` / `No credits left — buy a pack to export.` / `Credit service unreachable — export needs a connection.`
- License key travels ONLY in the `X-License-Key` header (never URLs). Server stores only SHA-256 hex of keys. One Worker secret: `LS_WEBHOOK_SECRET`.
- Verified LS behavior (spec §Verified): every purchase mints a NEW license key; checkout custom data (`checkout[custom][...]`) arrives as `meta.custom_data` in order AND license-key webhook events; License API (`/v1/licenses/validate`) is public (key is the credential); webhooks signed with HMAC-SHA256 hex in `X-Signature` over the raw body.
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Never `git push` (deploys are user-gated).
- Vitest integration: `@cloudflare/vitest-plugin@^1.0.0` — v1 API: `cloudflareTest` plugin + `readD1Migrations` imported from the package root, inside vitest 4's `defineConfig`; peer dep `vitest ^4.1.0`. Test files import `env`/`createExecutionContext`/`waitOnExecutionContext`/`fetchMock`/`applyD1Migrations` from `cloudflare:test` as written. Sanctioned deviation: if a `cloudflare:test` import name differs under v1, use the name the installed package's README shows and report it.

---

### Task 1: Worker scaffold — D1 schema, config, test harness

**Files:**
- Create: `worker/package.json`, `worker/wrangler.jsonc`, `worker/migrations/0001_init.sql`, `worker/vitest.config.js`, `worker/test/apply-migrations.js`, `worker/test/schema.test.js`, `worker/src/index.js` (health stub), `worker/.gitignore`

**Interfaces:**
- Produces: D1 schema (`wallets`, `transactions` — exact columns below) and a vitest harness where `env.DB` is a migrated D1; every later Worker task adds tests to this harness.
- Produces: `worker/src/index.js` default export with `fetch(request, env, ctx)` — later tasks replace the stub body.

- [ ] **Step 1: Write the failing schema test**

`worker/test/schema.test.js`:

```js
import {env} from 'cloudflare:test';
import {describe, it, expect} from 'vitest';

describe('schema', () => {
  it('applies migrations: wallets and transactions exist', async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('wallets','transactions') ORDER BY name"
    ).all();
    expect(tables.results.map(r => r.name)).toEqual(['transactions', 'wallets']);
  });

  it('CHECK constraint refuses a negative balance', async () => {
    await env.DB.prepare(
      "INSERT INTO wallets (id, license_key_hash, balance) VALUES ('w1','h1',0)"
    ).run();
    await expect(
      env.DB.prepare("UPDATE wallets SET balance = balance - 1 WHERE id = 'w1'").run()
    ).rejects.toThrow(/CHECK/i);
  });

  it('idempotency_key and external_id are UNIQUE', async () => {
    await env.DB.prepare("INSERT INTO wallets (id, license_key_hash, balance) VALUES ('w2','h2',5)").run();
    await env.DB.prepare(
      "INSERT INTO transactions (id, wallet_id, delta, type, idempotency_key) VALUES ('t1','w2',-1,'export','idem-1')"
    ).run();
    await expect(env.DB.prepare(
      "INSERT INTO transactions (id, wallet_id, delta, type, idempotency_key) VALUES ('t2','w2',-1,'export','idem-1')"
    ).run()).rejects.toThrow(/UNIQUE/i);
    await env.DB.prepare(
      "INSERT INTO transactions (id, wallet_id, delta, type, external_id) VALUES ('t3','w2',100,'purchase','order-9')"
    ).run();
    await expect(env.DB.prepare(
      "INSERT INTO transactions (id, wallet_id, delta, type, external_id) VALUES ('t4','w2',100,'purchase','order-9')"
    ).run()).rejects.toThrow(/UNIQUE/i);
  });
});
```

- [ ] **Step 2: Create the package and config files**

`worker/package.json`:

```json
{
  "name": "chordbloom-credits",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "^1.0.0",
    "vitest": "~4.1.0",
    "wrangler": "^4.0.0"
  }
}
```

`worker/wrangler.jsonc`:

```jsonc
{
  "name": "chordbloom-credits",
  "main": "src/index.js",
  "compatibility_date": "2026-08-24",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true, "logs": { "head_sampling_rate": 1 } },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "chordbloom-credits",
      // database_id is filled in by the deploy task after `wrangler d1 create`
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ],
  "vars": {
    "ALLOWED_ORIGINS": "https://ste-hue.github.io,http://localhost:4173",
    // Real values set in the deploy task from the user's LS dashboard:
    "LS_STORE_ID": "0",
    "PRODUCT_CREDITS": "{}"
  }
}
```

`worker/migrations/0001_init.sql`:

```sql
CREATE TABLE wallets (
  id TEXT PRIMARY KEY,
  license_key_hash TEXT UNIQUE NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  delta INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('purchase','export')),
  external_id TEXT UNIQUE,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_transactions_wallet_created ON transactions (wallet_id, created_at);
```

`worker/vitest.config.js` (v1 plugin API, verified against the current Workers vitest-integration docs):

```js
import path from 'node:path';
import {cloudflareTest, readD1Migrations} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
      return {
        wrangler: {configPath: './wrangler.jsonc'},
        // Test-only binding values; production vars/secrets stay placeholders in wrangler.jsonc.
        miniflare: {bindings: {
          TEST_MIGRATIONS: migrations,
          LS_WEBHOOK_SECRET: 'test-secret',
          LS_STORE_ID: '4242',
          PRODUCT_CREDITS: '{"111": 100}'
        }}
      };
    })
  ],
  test: {setupFiles: ['./test/apply-migrations.js']}
});
```

`worker/test/apply-migrations.js`:

```js
import {applyD1Migrations, env} from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`worker/src/index.js` (stub for this task):

```js
export default {
  async fetch(request, env, ctx) {
    return new Response('chordbloom-credits', {status: 200});
  }
};
```

`worker/.gitignore`:

```
node_modules/
.wrangler/
```

- [ ] **Step 3: Install and run the tests**

Run: `cd worker && npm install && npm test`
Expected: 3/3 passing. (If the `@cloudflare/vitest-plugin/config` subpath errors, apply the Global Constraints package-name note and report the deviation.)

- [ ] **Step 4: Confirm root suite untouched**

Run from repo root: `npm test`
Expected: 11/11 — root scripts don't traverse `worker/`.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat(worker): scaffold credits Worker — D1 schema, wrangler config, vitest harness

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Wallet API — activate, balance, atomic spend, CORS

**Files:**
- Replace: `worker/src/index.js` (full implementation below)
- Create: `worker/test/wallet.test.js`

**Interfaces:**
- Consumes: Task 1 schema and harness.
- Produces HTTP API (all JSON): `POST /wallet/activate` `{license_key}` → `200 {wallet_id, balance}` | `401` invalid | `403` foreign store; `GET /wallet` (X-License-Key) → `200 {wallet_id, balance}` | `404`; `POST /wallet/spend` `{reason, idempotency_key}` → `200 {wallet_id, balance, replayed?}` | `402 {error:'insufficient_credits'}` | `404` | `409 {error:'idempotency_conflict'}` (key already used by ANOTHER wallet — never a free success) | `429`. CORS per `ALLOWED_ORIGINS`.
- Produces internals Task 3 reuses: `hashKey(key)`, `json(status, body, corsHeaders)`, `creditWallet(env, walletId, credits, externalId)`.

- [ ] **Step 1: Write the failing tests**

`worker/test/wallet.test.js`:

```js
import {env, createExecutionContext, waitOnExecutionContext, fetchMock} from 'cloudflare:test';
import {describe, it, expect, beforeAll, afterEach} from 'vitest';
import worker from '../src/index.js';

const ORIGIN = 'https://ste-hue.github.io';

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

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

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
    fetchMock.get('https://api.lemonsqueezy.com')
      .intercept({path: '/v1/licenses/validate', method: 'POST'})
      .reply(200, JSON.stringify({valid: true, meta: {store_id: 4242}}),
             {headers: {'Content-Type': 'application/json'}});
    const res = await call(req('/wallet/activate', {method: 'POST', body: {license_key: 'KEY-NEW'}}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(0);
    expect(body.wallet_id).toBeTruthy();
  });

  it('401 when LS says the key is invalid', async () => {
    fetchMock.get('https://api.lemonsqueezy.com')
      .intercept({path: '/v1/licenses/validate', method: 'POST'})
      .reply(200, JSON.stringify({valid: false, error: 'invalid'}),
             {headers: {'Content-Type': 'application/json'}});
    expect((await call(req('/wallet/activate', {method: 'POST', body: {license_key: 'BAD'}}))).status).toBe(401);
  });

  it("403 when the key belongs to someone else's store", async () => {
    fetchMock.get('https://api.lemonsqueezy.com')
      .intercept({path: '/v1/licenses/validate', method: 'POST'})
      .reply(200, JSON.stringify({valid: true, meta: {store_id: 999}}),
             {headers: {'Content-Type': 'application/json'}});
    expect((await call(req('/wallet/activate', {method: 'POST', body: {license_key: 'FOREIGN'}}))).status).toBe(403);
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
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd worker && npm test`
Expected: schema tests pass; wallet tests FAIL (stub Worker returns plain text).

- [ ] **Step 3: Implement the Worker**

Replace `worker/src/index.js` with:

```js
const JSON_HEADERS = {'Content-Type': 'application/json'};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-License-Key',
    'Vary': 'Origin'
  };
}

function json(status, body, cors) {
  return new Response(JSON.stringify(body), {status, headers: {...JSON_HEADERS, ...cors}});
}

async function hashKey(key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function walletByHeader(request, env) {
  const key = request.headers.get('X-License-Key');
  if (!key) return null;
  const hash = await hashKey(key);
  return env.DB.prepare('SELECT id, balance FROM wallets WHERE license_key_hash = ?').bind(hash).first();
}

async function findOrCreateWallet(env, keyHash) {
  const existing = await env.DB.prepare(
    'SELECT id, balance FROM wallets WHERE license_key_hash = ?'
  ).bind(keyHash).first();
  if (existing) return existing;
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare('INSERT INTO wallets (id, license_key_hash, balance) VALUES (?,?,0)')
      .bind(id, keyHash).run();
    return {id, balance: 0};
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return env.DB.prepare('SELECT id, balance FROM wallets WHERE license_key_hash = ?').bind(keyHash).first();
    }
    throw err;
  }
}

// Shared with the webhook (Task 3). Idempotent on externalId (UNIQUE external_id).
export async function creditWallet(env, walletId, credits, externalId) {
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO transactions (id, wallet_id, delta, type, external_id) VALUES (?,?,?,'purchase',?)"
      ).bind(crypto.randomUUID(), walletId, credits, externalId),
      env.DB.prepare('UPDATE wallets SET balance = balance + ? WHERE id = ?').bind(credits, walletId)
    ]);
    return {credited: true};
  } catch (err) {
    if (String(err).includes('UNIQUE')) return {credited: false, duplicate: true};
    throw err;
  }
}

async function handleActivate(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json(400, {error: 'bad_json'}, cors); }
  const key = body && body.license_key;
  if (typeof key !== 'string' || !key || key.length > 256) return json(400, {error: 'missing_license_key'}, cors);

  const lsRes = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
    method: 'POST',
    headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
    body: JSON.stringify({license_key: key})
  });
  const ls = await lsRes.json().catch(() => ({}));
  if (!ls.valid) return json(401, {error: 'invalid_license'}, cors);
  if (!ls.meta || Number(ls.meta.store_id) !== Number(env.LS_STORE_ID)) {
    return json(403, {error: 'wrong_store'}, cors);
  }
  const wallet = await findOrCreateWallet(env, await hashKey(key));
  return json(200, {wallet_id: wallet.id, balance: wallet.balance}, cors);
}

async function handleSpend(request, env, cors) {
  const wallet = await walletByHeader(request, env);
  if (!wallet) return json(404, {error: 'unknown_wallet'}, cors);
  let body;
  try { body = await request.json(); } catch { return json(400, {error: 'bad_json'}, cors); }
  const idem = body && body.idempotency_key;
  if (typeof idem !== 'string' || !idem || idem.length > 128) return json(400, {error: 'missing_idempotency_key'}, cors);

  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM transactions WHERE wallet_id = ? AND type = 'export' AND created_at > datetime('now','-60 seconds')"
  ).bind(wallet.id).first();
  if (recent.n >= 30) return json(429, {error: 'rate_limited'}, cors);

  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO transactions (id, wallet_id, delta, type, idempotency_key) VALUES (?,?,-1,'export',?)"
      ).bind(crypto.randomUUID(), wallet.id, idem),
      // CHECK (balance >= 0) turns an over-spend into an error that aborts the whole batch.
      env.DB.prepare('UPDATE wallets SET balance = balance - 1 WHERE id = ?').bind(wallet.id)
    ]);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('UNIQUE')) {
      // idempotency_key is globally UNIQUE: a collision is only a replay if the
      // prior row belongs to THIS wallet — otherwise it's a cross-wallet conflict.
      const prior = await env.DB.prepare('SELECT wallet_id FROM transactions WHERE idempotency_key = ?').bind(idem).first();
      if (!prior || prior.wallet_id !== wallet.id) return json(409, {error: 'idempotency_conflict'}, cors);
      const fresh = await env.DB.prepare('SELECT balance FROM wallets WHERE id = ?').bind(wallet.id).first();
      return json(200, {wallet_id: wallet.id, balance: fresh.balance, replayed: true}, cors);
    }
    if (msg.includes('CHECK')) return json(402, {error: 'insufficient_credits'}, cors);
    throw err;
  }
  const fresh = await env.DB.prepare('SELECT balance FROM wallets WHERE id = ?').bind(wallet.id).first();
  return json(200, {wallet_id: wallet.id, balance: fresh.balance}, cors);
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
      if (url.pathname === '/wallet' && request.method === 'GET') {
        const wallet = await walletByHeader(request, env);
        if (!wallet) return json(404, {error: 'unknown_wallet'}, cors);
        return json(200, {wallet_id: wallet.id, balance: wallet.balance}, cors);
      }
      if (url.pathname === '/wallet/activate' && request.method === 'POST') return handleActivate(request, env, cors);
      if (url.pathname === '/wallet/spend' && request.method === 'POST') return handleSpend(request, env, cors);
      return json(404, {error: 'not_found'}, cors);
    } catch (err) {
      console.log(JSON.stringify({level: 'error', path: url.pathname, message: String(err)}));
      return json(500, {error: 'internal'}, cors);
    }
  }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: schema 3 + wallet 12, all passing.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat(worker): wallet API — activate via public LS License API, atomic spend, CORS, rate limit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Lemon Squeezy webhook — signature, first purchase, top-up

**Files:**
- Modify: `worker/src/index.js` (add webhook route + handler)
- Create: `worker/test/webhook.test.js`

**Interfaces:**
- Consumes: `hashKey`, `findOrCreateWallet`, `creditWallet`, `json` from Task 2.
- Produces: `POST /webhooks/ls` — `401` bad/missing signature; `200 {credited|duplicate|ignored}` otherwise. Crediting rules (spec §Verified 5): `license_key_created` with NO `meta.custom_data.wallet_id` → create wallet from the key, credit `PRODUCT_CREDITS[product_id]`; `order_created` WITH `wallet_id` → credit that wallet (top-up; the order's new key is ignored). `external_id = 'order-' + order_id` (UNIQUE) makes retries and double-fires single-credit.

- [ ] **Step 1: Write the failing tests**

`worker/test/webhook.test.js`:

```js
import {env, createExecutionContext, waitOnExecutionContext} from 'cloudflare:test';
import {describe, it, expect} from 'vitest';
import worker from '../src/index.js';

async function sign(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function post(body, signature) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request('https://credits.example/webhooks/ls', {
    method: 'POST',
    headers: signature ? {'X-Signature': signature} : {},
    body
  }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const SECRET = env.LS_WEBHOOK_SECRET; // 'test-secret' via vitest miniflare bindings

function licenseKeyCreated({key, orderId, productId = 111, custom = {}}) {
  return JSON.stringify({
    meta: {event_name: 'license_key_created', custom_data: custom},
    data: {attributes: {key, order_id: orderId, product_id: productId}}
  });
}

function orderCreated({orderId, productId = 111, custom = {}}) {
  return JSON.stringify({
    meta: {event_name: 'order_created', custom_data: custom},
    data: {id: String(orderId), attributes: {first_order_item: {product_id: productId}}}
  });
}

describe('POST /webhooks/ls', () => {
  it('401 without a valid signature', async () => {
    const body = orderCreated({orderId: 1});
    expect((await post(body)).status).toBe(401);
    expect((await post(body, 'deadbeef')).status).toBe(401);
  });

  it('first purchase: license_key_created creates the wallet and credits it', async () => {
    const body = licenseKeyCreated({key: 'LSK-FIRST', orderId: 100});
    const res = await post(body, await sign(body, SECRET));
    expect(res.status).toBe(200);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('LSK-FIRST'));
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const w = await env.DB.prepare('SELECT balance FROM wallets WHERE license_key_hash = ?').bind(hash).first();
    expect(w.balance).toBe(100); // PRODUCT_CREDITS maps product 111 -> 100
  });

  it('webhook redelivery credits only once (external_id)', async () => {
    const body = licenseKeyCreated({key: 'LSK-DUP', orderId: 200});
    const sig = await sign(body, SECRET);
    await post(body, sig);
    const replay = await post(body, sig);
    expect(replay.status).toBe(200);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('LSK-DUP'));
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const w = await env.DB.prepare('SELECT balance FROM wallets WHERE license_key_hash = ?').bind(hash).first();
    expect(w.balance).toBe(100);
  });

  it('top-up: order_created with wallet_id credits the existing wallet; the new key is ignored', async () => {
    const first = licenseKeyCreated({key: 'LSK-TOPUP', orderId: 300});
    await post(first, await sign(first, SECRET));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('LSK-TOPUP'));
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const wallet = await env.DB.prepare('SELECT id FROM wallets WHERE license_key_hash = ?').bind(hash).first();

    const topupOrder = orderCreated({orderId: 301, custom: {wallet_id: wallet.id}});
    await post(topupOrder, await sign(topupOrder, SECRET));
    const topupKey = licenseKeyCreated({key: 'LSK-TOPUP-NEWKEY', orderId: 301, custom: {wallet_id: wallet.id}});
    const res = await post(topupKey, await sign(topupKey, SECRET));
    expect(res.status).toBe(200);

    const w = await env.DB.prepare('SELECT balance FROM wallets WHERE id = ?').bind(wallet.id).first();
    expect(w.balance).toBe(200); // 100 + 100, the duplicate order-301 credit blocked by external_id
    const newKeyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('LSK-TOPUP-NEWKEY'));
    const newHash = [...new Uint8Array(newKeyDigest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const orphan = await env.DB.prepare('SELECT id FROM wallets WHERE license_key_hash = ?').bind(newHash).first();
    expect(orphan).toBeNull();
  });

  it('ignores events for unmapped products', async () => {
    const body = licenseKeyCreated({key: 'LSK-ODD', orderId: 400, productId: 999});
    const res = await post(body, await sign(body, SECRET));
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe(true);
  });
});
```

(The secret and `PRODUCT_CREDITS` test values already exist as miniflare bindings from Task 1's `vitest.config.js`.)

- [ ] **Step 2: Run tests to verify failure**

Run: `cd worker && npm test`
Expected: webhook tests FAIL with 404 responses; earlier suites still pass.

- [ ] **Step 3: Implement the webhook**

In `worker/src/index.js`, add below `creditWallet`:

```js
function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function verifySignature(rawBody, signatureHex, secret) {
  if (!signatureHex || !secret) return false;
  const sigBytes = hexToBytes(signatureHex);
  if (!sigBytes || sigBytes.length !== 32) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  return crypto.subtle.timingSafeEqual(digest, sigBytes);
}

function productCredits(env, productId) {
  try {
    const map = JSON.parse(env.PRODUCT_CREDITS || '{}');
    const n = map[String(productId)];
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const ok = await verifySignature(rawBody, request.headers.get('X-Signature'), env.LS_WEBHOOK_SECRET);
  if (!ok) return json(401, {error: 'bad_signature'}, {});
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json(400, {error: 'bad_json'}, {}); }

  const event = payload && payload.meta && payload.meta.event_name;
  const custom = (payload && payload.meta && payload.meta.custom_data) || {};
  const attrs = (payload && payload.data && payload.data.attributes) || {};

  if (event === 'license_key_created' && !custom.wallet_id) {
    const credits = productCredits(env, attrs.product_id);
    if (!credits || typeof attrs.key !== 'string' || !attrs.key) return json(200, {ignored: true}, {});
    const wallet = await findOrCreateWallet(env, await hashKey(attrs.key));
    const result = await creditWallet(env, wallet.id, credits, `order-${attrs.order_id}`);
    return json(200, result, {});
  }

  if (event === 'order_created' && custom.wallet_id) {
    const item = attrs.first_order_item || {};
    const credits = productCredits(env, item.product_id);
    if (!credits) return json(200, {ignored: true}, {});
    const wallet = await env.DB.prepare('SELECT id FROM wallets WHERE id = ?').bind(custom.wallet_id).first();
    if (!wallet) return json(200, {ignored: true, unknown_wallet: true}, {});
    const orderId = payload.data.id || attrs.identifier;
    const result = await creditWallet(env, wallet.id, credits, `order-${orderId}`);
    return json(200, result, {});
  }

  return json(200, {ignored: true}, {});
}
```

And register the route in the `fetch` dispatcher, before the final 404:

```js
      if (url.pathname === '/webhooks/ls' && request.method === 'POST') return handleWebhook(request, env);
```

Note the top-up test uses order id 301 in BOTH events: crediting is attempted twice for `order-301` and the `external_id` UNIQUE makes the second a `{duplicate: true}` no-op — that is the invariant under test. `PRODUCT_CREDITS`/`LS_WEBHOOK_SECRET` test values come from the miniflare bindings set in Task 1's `vitest.config.js`; the wrangler.jsonc placeholders stay untouched until the deploy task.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: schema 3 + wallet 12 + webhook 5, all passing.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat(worker): LS webhook — HMAC verify, first-purchase wallet, wallet_id top-up, order idempotency

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: App — Credits panel and dark-launched spend gate

**Files:**
- Modify: `src/index.html` (markup after the favorites section ~line 224-227; JS: constants, credit functions, gate wiring at `bindUI` line ~1668 `const dl=$('downloadBtn');dl.addEventListener('click',()=>saveMidiFile());`; `__ChordBloomCore` export list; two CONTROL_HELP entries)
- Modify: `tests/helpers/load-core.js` (add `crypto` to the vm context)
- Create: `tests/credits.test.js`

**Interfaces:**
- Consumes: existing `saveMidiFile()` (returns `true` saved / `false` cancelled or failed), `storageGet/storageSet`, `setStatus`, `escapeHtml`, `$`.
- Produces on `__ChordBloomCore`: `requestSpend(fetchImpl, apiBase, licenseKey, idemKey)` → `{ok, status, balance?, walletId?}` (status 0 on network failure) and `mintIdempotencyKey()`.
- Dark launch: `CREDITS_API = ''` → `exportWithCredit()` falls straight through to `saveMidiFile()`; the panel shows "Credits not enabled yet." The deploy task flips the constants.

- [ ] **Step 1: Write the failing headless tests**

In `tests/helpers/load-core.js` change the context line to include Node's webcrypto:

```js
  const context=vm.createContext({console,TextEncoder,crypto});
```

`tests/credits.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './helpers/load-core.js';

const core=await loadCore();

test('mintIdempotencyKey returns unique non-empty strings',()=>{
  const a=core.mintIdempotencyKey(), b=core.mintIdempotencyKey();
  assert.ok(typeof a==='string'&&a.length>0);
  assert.notEqual(a,b);
});

test('requestSpend success path returns balance and wallet id',async()=>{
  let seen;
  const fetchImpl=async(url,opts)=>{ seen={url,opts}; return {ok:true,status:200,json:async()=>({wallet_id:'w-1',balance:41})}; };
  const res=await core.requestSpend(fetchImpl,'https://api.example','KEY','idem-1');
  assert.deepEqual(res,{ok:true,status:200,balance:41,walletId:'w-1'});
  assert.equal(seen.url,'https://api.example/wallet/spend');
  assert.equal(seen.opts.headers['X-License-Key'],'KEY');
  assert.equal(JSON.parse(seen.opts.body).idempotency_key,'idem-1');
});

test('requestSpend surfaces 402 without throwing',async()=>{
  const fetchImpl=async()=>({ok:false,status:402,json:async()=>({error:'insufficient_credits'})});
  const res=await core.requestSpend(fetchImpl,'https://api.example','KEY','idem-2');
  assert.equal(res.ok,false); assert.equal(res.status,402);
});

test('requestSpend maps a network failure to status 0',async()=>{
  const fetchImpl=async()=>{ throw new Error('offline'); };
  const res=await core.requestSpend(fetchImpl,'https://api.example','KEY','idem-3');
  assert.deepEqual(res,{ok:false,status:0});
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`
Expected: existing 11 pass; `tests/credits.test.js` FAILS (`mintIdempotencyKey`/`requestSpend` not exported).

- [ ] **Step 3: Implement the app side**

(a) Markup — insert after the favorites `</section>` (line ~227):

```html
  <section class="panel credits-panel" id="creditsPanel">
    <div class="section-heading compact"><h3>Export credits</h3><span id="creditBalance" class="source">—</span></div>
    <div class="credits-row">
      <input id="licenseKeyInput" type="password" placeholder="Paste your license key" autocomplete="off" data-help="Your Lemon Squeezy license key is your credit wallet. It is stored only in this browser.">
      <button id="activateKeyBtn" class="tiny" data-help="Check the key and load your credit balance.">ACTIVATE</button>
      <a id="buyCreditsBtn" class="tiny accent" target="_blank" rel="noopener" data-help="Buy an export credit pack. €10 = 100 MIDI/MPE exports.">BUY CREDITS</a>
    </div>
    <div id="creditsStatus" class="source"></div>
  </section>
```

And in the `<style>` block append:

```css
.credits-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.credits-row input{flex:1;min-width:180px}
.credits-panel.attention{outline:2px solid var(--accent, #b5ff7a)}
```

(b) JS — add near the top of the IIFE (after the `DEFAULTS` constant):

```js
  // Credits: dark-launched. Empty CREDITS_API = credits disabled, export stays free.
  const CREDITS_API='';
  const LS_CHECKOUT_URL='';
```

Add before `saveMidiFile` (~line 1528):

```js
  const creditState={key:storageGet('chordbloom.licenseKey',''),walletId:storageGet('chordbloom.walletId',''),balance:null,pendingIdem:null};
  function mintIdempotencyKey(){ return (globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+'-'+Math.floor(Math.random()*1e9); }
  async function requestSpend(fetchImpl,apiBase,licenseKey,idemKey){
    try{
      const r=await fetchImpl(apiBase+'/wallet/spend',{method:'POST',headers:{'Content-Type':'application/json','X-License-Key':licenseKey},body:JSON.stringify({reason:'midi_export',idempotency_key:idemKey})});
      const body=await r.json().catch(()=>({}));
      return {ok:r.ok,status:r.status,balance:body.balance,walletId:body.wallet_id};
    }catch{ return {ok:false,status:0}; }
  }
  function renderCredits(msg=''){
    const bal=$('creditBalance'); if(bal) bal.textContent=!CREDITS_API?'—':(creditState.balance==null?'—':`${creditState.balance} credits`);
    const buy=$('buyCreditsBtn');
    if(buy){ const custom=creditState.walletId?`?checkout[custom][wallet_id]=${encodeURIComponent(creditState.walletId)}`:''; buy.href=LS_CHECKOUT_URL?LS_CHECKOUT_URL+custom:'#'; buy.style.display=LS_CHECKOUT_URL?'':'none'; }
    const st=$('creditsStatus'); if(st) st.textContent=msg||(!CREDITS_API?'Credits not enabled yet.':'');
  }
  function highlightCreditsPanel(){ const p=$('creditsPanel'); if(!p)return; p.classList.add('attention'); p.scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(()=>p.classList.remove('attention'),2500); }
  function rememberWallet(balance,walletId){ if(typeof balance==='number')creditState.balance=balance; if(walletId){creditState.walletId=walletId;storageSet('chordbloom.walletId',walletId);} renderCredits(); }
  async function activateKey(){
    if(!CREDITS_API){renderCredits();return;}
    const key=($('licenseKeyInput')?.value||'').trim(); if(!key){renderCredits('Paste the license key from your purchase email.');return;}
    try{
      const r=await fetch(CREDITS_API+'/wallet/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({license_key:key})});
      const body=await r.json().catch(()=>({}));
      if(!r.ok){renderCredits(r.status===401?'That license key is not valid.':'Could not activate the key. Try again.');return;}
      creditState.key=key;storageSet('chordbloom.licenseKey',key);rememberWallet(body.balance,body.wallet_id);renderCredits('Key activated.');
    }catch{renderCredits('Credit service unreachable — try again with a connection.');}
  }
  async function refreshBalance(){
    if(!CREDITS_API||!creditState.key)return;
    try{ const r=await fetch(CREDITS_API+'/wallet',{headers:{'X-License-Key':creditState.key}}); if(r.ok){const b=await r.json();rememberWallet(b.balance,b.wallet_id);} }catch{}
  }
  async function exportWithCredit(){
    if(!CREDITS_API){ await saveMidiFile(); return; }
    if(!creditState.key){ setStatus('Export costs 1 credit — paste your license key or buy credits below.'); highlightCreditsPanel(); return; }
    if(!creditState.pendingIdem) creditState.pendingIdem=mintIdempotencyKey();
    const res=await requestSpend((...a)=>fetch(...a),CREDITS_API,creditState.key,creditState.pendingIdem);
    if(res.status===402){ setStatus('No credits left — buy a pack to export.'); highlightCreditsPanel(); rememberWallet(0,res.walletId); return; }
    if(!res.ok){ setStatus('Credit service unreachable — export needs a connection.'); return; }
    rememberWallet(res.balance,res.walletId);
    const saved=await saveMidiFile();
    if(saved===true) creditState.pendingIdem=null; // cancelled/failed saves keep the key: the replay is free
  }
```

(c) Wiring — in `bindUI`, change

```js
const dl=$('downloadBtn');dl.addEventListener('click',()=>saveMidiFile());
```

to

```js
const dl=$('downloadBtn');dl.addEventListener('click',()=>{exportWithCredit();});
```

and append to `bindUI`:

```js
    $('activateKeyBtn')?.addEventListener('click',()=>{activateKey();});
```

In `init()`, after `refreshAll(true);` add `renderCredits();refreshBalance();`.

(d) Add to the `globalThis.__ChordBloomCore={...}` export list: `,requestSpend,mintIdempotencyKey`.

(e) Add two `CONTROL_HELP` entries: `"licenseKeyInput": "Your license key from the purchase email. It is your credit wallet and is stored only in this browser."`, `"buyCreditsBtn": "Buy 100 MIDI/MPE export credits for €10 via Lemon Squeezy."`.

- [ ] **Step 4: Run tests + build + browser sanity**

Run: `npm test` (expect 15/15) and `npm run build`.
Then headless-Chromium sanity on the built app (mirror of the v1.4 Task-6 ritual): serve `dist/`, open `/?selftest=1`, expect all in-page self-tests still green and DOWNLOAD MIDI still downloads (CREDITS_API is empty → gate dark, behavior unchanged), and the Credits panel shows "Credits not enabled yet."

- [ ] **Step 5: Commit**

```bash
git add src/index.html tests/credits.test.js tests/helpers/load-core.js
git commit -m "feat(app): credits panel and dark-launched spend gate for MIDI export

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Go-live — D1, secrets, deploy, LS wiring, enable the gate

This task has USER-GATED steps: it needs values only the user can provide (Lemon Squeezy store/product/webhook) and permission to deploy to their Cloudflare account. Prepare everything, then STOP and ask; never deploy or push without their explicit go.

**Files:**
- Modify: `worker/wrangler.jsonc` (real `database_id`, real `LS_STORE_ID`, real `PRODUCT_CREDITS`), `src/index.html` (set `CREDITS_API` and `LS_CHECKOUT_URL`), `README.md` (credits section), `package.json` (version 1.5.0)

**Interfaces:**
- Consumes: everything above.
- Produces: live Worker at its `workers.dev` URL, wired LS store, gate enabled in production.

- [ ] **Step 1: Preflight (no side effects)**

Run: `cd worker && npx wrangler whoami` — confirm the intended Cloudflare account is logged in. If not, ask the user to run `! npx wrangler login` themselves.

- [ ] **Step 2: Collect from the user (STOP and ask)**

Ask the user for, or walk them through creating in the LS dashboard (test mode first):
1. A product "ChordBloom — 100 export credits", €10, **license keys ENABLED** → note `store_id`, `product_id`, and the product's checkout URL.
2. A webhook pointing at `https://chordbloom-credits.<their-subdomain>.workers.dev/webhooks/ls`, subscribed to `order_created` and `license_key_created` → note the signing secret. (The workers.dev subdomain is known after the first deploy — create the webhook after Step 3.)
3. Explicit confirmation to deploy to their Cloudflare account.

- [ ] **Step 3: Create D1, apply migrations, deploy**

```bash
cd worker
npx wrangler d1 create chordbloom-credits          # paste returned database_id into wrangler.jsonc
npx wrangler d1 migrations apply chordbloom-credits --remote
npx wrangler secret put LS_WEBHOOK_SECRET          # value from the user's LS webhook config
npx wrangler deploy                                # note the printed workers.dev URL
```

Update `wrangler.jsonc` vars with the real `LS_STORE_ID` and `PRODUCT_CREDITS` (`{"<product_id>": 100}`) and re-deploy.

- [ ] **Step 4: Enable the gate in the app**

In `src/index.html` set `CREDITS_API` to the deployed URL and `LS_CHECKOUT_URL` to the product's checkout URL. Run `npm test && npm run build`.

- [ ] **Step 5: End-to-end in LS test mode**

With the user: make a test purchase → license key email arrives → webhook credits the wallet (verify `npx wrangler d1 execute chordbloom-credits --remote --command "SELECT balance FROM wallets"`); paste the key in the app → balance shows; export → balance decrements → the `.mid` downloads; cancel a file picker and retry → no double charge; spend to zero → `No credits left — buy a pack to export.`; top-up via the BUY CREDITS link (carries `wallet_id`) → same wallet credited. Then switch LS out of test mode.

- [ ] **Step 6: Docs, version, commit**

`package.json` → `"version": "1.5.0"`. README: add a "Credits" section (what costs a credit, €10 = 100 exports, license key = wallet, `worker/` runbook: `npm test`, `wrangler deploy`, secret name, vars). Commit:

```bash
git add worker/wrangler.jsonc src/index.html README.md package.json
git commit -m "feat: enable credit gate — live Worker URL, LS product wiring, v1.5.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Pushing `main` (deploying the gated app to Pages) remains a separate explicit user decision.
