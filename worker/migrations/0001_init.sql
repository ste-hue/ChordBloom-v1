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
