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
