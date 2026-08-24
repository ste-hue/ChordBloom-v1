# Spec: Credit-based paywall for MIDI export

## Decision (user-approved 2026-08-24)

ChordBloom monetizes via **consumable credits**: the app stays free and fully
client-side (generation, playback, MPE preview), and **1 successful MIDI/MPE
export consumes 1 credit**. No free downloads: a user with no credits hits the
purchase panel on first DOWNLOAD click.

Robustness target is "verified license" tier, chosen explicitly: the money
(balances, grants) is inviolable server-side; the export gate is client-
orchestrated and therefore bypassable by a determined DevTools user. This is
an **accepted, documented limit** — the music engine stays client-side by
design.

**Product principle:** the paywall sits at the moment value leaves ChordBloom
— *creating is free; taking it into your DAW costs 1 credit*. Everything
before that moment (generating, regenerating, editing, previewing, MPE
preview, Expert mode, Crazy Arp, theory features) stays frictionless and free.

**Initial pricing:** one product — **€10 = 100 credits** (100 MIDI/MPE
exports). Pack sizes/prices live in the LS dashboard; the Worker's
variant→credits mapping is the only code-side knowledge of them.

**Provider-behavior constraint (binding):** before implementing the Lemon
Squeezy integration, verify against current LS documentation the actual API,
webhook and license-key behavior — in particular the repeat-purchase/top-up
flow. Do NOT assume checkout custom data can attach a purchase to an existing
license key unless LS explicitly supports it; if it does not, the Worker maps
repeat purchases to an existing `wallet_id` independently of LS key issuance
(e.g. wallet id carried in checkout custom data, key hash only for first
purchase). Design around verified behavior, not assumptions. Findings are
recorded in the "Verified Lemon Squeezy behavior" section below before any
plan is written.

## Roles

- **Lemon Squeezy** — Merchant of Record: checkout, EU VAT/invoices, license
  key generation. Sells credit-pack products.
- **Cloudflare Worker** (new, dedicated) — owns the credit API and the Lemon
  Squeezy webhook. Lives in `worker/` in THIS repo, with its own
  `package.json` and `wrangler.jsonc`. It gets its **own D1 database** and
  must NOT couple to the user's existing Cloudflare applications.
- **ChordBloom app** (`src/index.html`) — unchanged engine; gains a Credits
  panel and a spend-gate around the existing `saveMidiFile()`.
- **Identity** — no user accounts in v1. The Lemon Squeezy license key IS the
  wallet. Client stores the key in `localStorage`; the server stores only its
  hash.

## Data model (D1)

```
wallets
  id                TEXT PK
  license_key_hash  TEXT UNIQUE      -- SHA-256 of the LS license key
  balance           INTEGER NOT NULL -- consistent cache of the ledger
  created_at        TEXT

transactions                          -- immutable ledger
  id               TEXT PK
  wallet_id        TEXT REFERENCES wallets(id)
  delta            INTEGER            -- +N purchase / -1 export
  type             TEXT               -- 'purchase' | 'export'
  external_id      TEXT               -- LS order id (webhook idempotency)
  idempotency_key  TEXT UNIQUE        -- client-generated per export attempt
  created_at       TEXT
```

Spend is atomic: `UPDATE wallets SET balance = balance - 1 WHERE id = ? AND
balance > 0` plus the ledger insert in the same D1 transaction. Two
concurrent requests cannot spend the same last credit. Balance is always
reconstructible from the ledger.

## API (Worker)

All endpoints CORS-allowlisted to the app origin (`https://ste-hue.github.io`)
plus localhost for dev. License key travels in the `X-License-Key` header,
never in URLs.

- `POST /wallet/activate` `{license_key}` — validates the key against the LS
  License API server-side (LS API key is a Worker secret), creates the wallet
  row if new, returns `{balance}`.
- `GET /wallet` — returns `{balance}` for the key's wallet; 404 if unknown.
- `POST /wallet/spend` `{reason:'midi_export', idempotency_key}` — atomic
  decrement; `200 {balance}` on success, `402` when balance is 0, replayed
  idempotency_key returns the original `200` without double-spending.
- `POST /webhooks/lemonsqueezy` — HMAC signature verified (webhook secret is
  a Worker secret). On order events: credit the wallet named by checkout
  `custom` data if present (top-up), otherwise create a wallet from the
  order's newly generated license key (first purchase). `external_id`
  uniqueness makes webhook delivery idempotent.

Credit amounts per product: a small variant→credits mapping in Worker
configuration (the user defines pack sizes/prices in the LS dashboard;
the mapping is the single place the Worker learns them).

## Purchase flows

- **First purchase:** app opens the LS checkout URL → LS generates a license
  key → webhook creates the wallet and credits it → the user pastes the key
  (from checkout/email) into the Credits panel → `activate` shows the balance.
- **Top-up:** the checkout URL opened from the app carries the current
  license key as LS checkout `custom` data, so the webhook credits the
  EXISTING wallet. Without this every top-up would mint a new orphan wallet.

## Export flow (app side)

DOWNLOAD MIDI click → if no stored key or known-zero balance, open the
Credits panel (paywall direct) → otherwise `POST /wallet/spend` with the
current attempt's idempotency key → on `200`, run the existing local
`saveMidiFile()`; on `402`, open the purchase panel; on network failure, do
not export and explain (no export while the API is unreachable — accepted
for v1).

The idempotency key is minted per export *intent* and kept until a save
completes successfully: if the user cancels the file picker (AbortError) or
the save fails, the retry reuses the same key, the server replays the
original `200` without decrementing again, and the user is never charged
twice for one download. A new key is minted only after a completed save.

## App changes

- A "Credits" panel visible in both Simple and Expert views: paste/activate
  key, show balance, "Buy credits" button (LS checkout link), status of last
  spend. Key persisted in `localStorage` (`chordbloom.licenseKey`).
- `saveMidiFile()` wrapped by the spend gate; everything else untouched. The
  app remains fully functional (generate/play/preview) with no key, no
  credits, or no network — only the download is gated.
- The app repo stays zero-dependency: the gate is plain fetch; API base URL
  is a constant.

## Security & config

- Secrets (LS API key, webhook secret) via `wrangler secret` — never in the
  repo. Server stores only hashed license keys. No PII in D1 (email stays at
  LS). Basic per-key rate limiting on `spend`/`activate`.

## Testing

- Worker: its own suite in `worker/` (vitest + Cloudflare workers pool),
  covering atomic spend under contention, idempotent spend replay, webhook
  signature rejection, webhook replay idempotency, first-purchase vs top-up
  crediting.
- App: gate logic (spend-before-save, 402 path, idempotency key generation)
  testable in the existing `node:vm` harness with a stubbed `fetch`.
- End-to-end: LS test mode + a browser pass mirroring the Task-6 ritual.

## Out of scope (v1)

Free/trial credits, refund handling beyond LS's own flow (a `refund` ledger
type is a natural later addition), user accounts, subscriptions, moving MIDI
generation server-side, multi-currency pack logic (LS handles pricing).

## Deploy

Worker deployed with wrangler (separate from Pages). The GitHub Pages
workflow is untouched. Worker deploy is manual in v1 (`wrangler deploy`),
CI integration deferred.
