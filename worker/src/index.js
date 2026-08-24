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
    if (!credits || typeof attrs.key !== 'string' || !attrs.key || attrs.order_id == null) return json(200, {ignored: true}, {});
    const wallet = await findOrCreateWallet(env, await hashKey(attrs.key));
    const result = await creditWallet(env, wallet.id, credits, `order-${attrs.order_id}`);
    return json(200, result, {});
  }

  if (event === 'order_created' && custom.wallet_id) {
    const item = attrs.first_order_item || {};
    const credits = productCredits(env, item.product_id);
    if (!credits) return json(200, {ignored: true}, {});
    const orderId = payload.data.id || attrs.identifier;
    if (orderId == null) return json(200, {ignored: true}, {});
    const wallet = await env.DB.prepare('SELECT id FROM wallets WHERE id = ?').bind(custom.wallet_id).first();
    if (!wallet) { console.log(JSON.stringify({level: 'error', alert: 'topup_unknown_wallet', wallet_id: custom.wallet_id, order_id: orderId})); return json(200, {ignored: true, unknown_wallet: true}, {}); }
    const result = await creditWallet(env, wallet.id, credits, `order-${orderId}`);
    return json(200, result, {});
  }

  return json(200, {ignored: true}, {});
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
  if (lsRes.status >= 500) return json(502, {error: 'ls_unavailable'}, cors);
  const ls = await lsRes.json().catch(() => null);
  if (!ls) return json(502, {error: 'ls_unavailable'}, cors);
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
      if (url.pathname === '/webhooks/ls' && request.method === 'POST') return handleWebhook(request, env);
      return json(404, {error: 'not_found'}, cors);
    } catch (err) {
      console.log(JSON.stringify({level: 'error', path: url.pathname, message: String(err)}));
      return json(500, {error: 'internal'}, cors);
    }
  }
};
