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

  it('ignores a license_key_created with no order id', async () => {
    const body = licenseKeyCreated({key: 'LSK-NOORDER', productId: 111});
    const res = await post(body, await sign(body, SECRET));
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe(true);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('LSK-NOORDER'));
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const w = await env.DB.prepare('SELECT id FROM wallets WHERE license_key_hash = ?').bind(hash).first();
    expect(w).toBeNull();
  });

  it('ignores events for unmapped products', async () => {
    const body = licenseKeyCreated({key: 'LSK-ODD', orderId: 400, productId: 999});
    const res = await post(body, await sign(body, SECRET));
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe(true);
  });
});
