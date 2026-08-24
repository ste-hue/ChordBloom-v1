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
