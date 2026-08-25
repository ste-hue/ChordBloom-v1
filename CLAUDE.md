# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chordarium (formerly ChordBloom, renamed 2026-08-25 — the Pentacom "ChordBloom" plugin collision): a browser music-composition tool (chord progressions, theory engine, MIDI/MPE export) that is **one single file**, `src/index.html` (~1,800 dense lines, one-statement-per-line style), plus a Cloudflare Worker in `worker/` that runs the **credit paywall**. The app is free; downloading a `.mid` costs 1 credit. Live at **https://chordarium.com** (GitHub Pages, repo `ste-hue/ChordBloom-v1`; `chordbloom.app` 301-redirects there). Internal infra names (worker `chordbloom-credits`, D1, repo) deliberately keep the old name.

## Commands

```bash
npm test          # root suite (node --test tests/*.test.js) — no dependencies, must stay that way
npm run build     # copies src/ → dist/ (dist is committed; never hand-edit it)
npm start         # serves dist/ at http://localhost:4173
node --test tests/engine.test.js          # single test file

npm --prefix worker test                  # worker suite (vitest + @cloudflare/vitest-plugin, migrated D1 per run)
cd worker && npx wrangler deploy          # deploy the credit API (user-gated: ask before deploying)
cd worker && npx wrangler d1 execute chordbloom-credits --remote --command "SELECT ..."   # inspect prod ledger
```

Pushing `main` deploys to Pages via `.github/workflows/pages.yml` (runs `npm test` first). **Never push without the user's explicit ok** — a push is a deploy.

## Architecture

**The app has no modules.** Everything lives in `src/index.html` inside one IIFE: data tables → theory engine → progression/voicing → rhythm/MPE → MIDI writer → UI. It exposes ~50 engine functions on `globalThis.__ChordariumCore`, and `init()` is guarded by `typeof document!=='undefined'`. That guard is load-bearing: the root test suite (`tests/helpers/load-core.js`) extracts the inline `<script>` and evaluates it headlessly in `node:vm`, then tests the engine through `__ChordariumCore`. If you add engine code you want tested, export it there. In-browser self-tests run only with `?selftest=1` (results in `window.__CHORDARIUM_TESTS__`).

**Money model** (spec: `docs/superpowers/specs/2026-08-24-paywall-crediti-design.md`, verified Lemon Squeezy behavior included): the LS license key IS the wallet; the server stores only its SHA-256. `worker/src/index.js` holds the wallet API (`/wallet/activate` via LS's public License API, `/wallet`, `/wallet/spend`) and the HMAC-verified LS webhook (`/webhooks/ls`). Correctness is enforced by the D1 schema, not app logic: `CHECK (balance >= 0)` + UNIQUE `idempotency_key`/`external_id` + `DB.batch()` transactions; the code classifies constraint failures by error text ('UNIQUE' → idempotent replay after an ownership check → else 409; 'CHECK' → 402). First purchase credits via `license_key_created`; top-ups carry `checkout[custom][wallet_id]` and credit via `order_created` (every LS purchase mints a NEW key — the new key is deliberately ignored on top-ups).

**Client gate**: `exportWithCredit()` wraps `saveMidiFile()`; the idempotency key persists until a save returns `true` (cancelled pickers retry free). `CREDITS_API=''` disables the gate entirely (dark launch). Accepted v1 tradeoff: a DevTools user can bypass the client gate; balances/ledger server-side are the protected asset. Do not add DRM or move the engine server-side for this.

## Deployed infrastructure (production)

- Worker: `chordbloom-credits` → https://chordbloom-credits.ste-dellapietra.workers.dev (account ste.dellapietra@gmail.com)
- D1: `chordbloom-credits`, id `2f48b43e-1ec4-4cb4-b450-3c5269ed807b`; secret: `LS_WEBHOOK_SECRET` (never handle the value — the user pipes it from clipboard: `pbpaste | npx wrangler secret put ...`)
- Lemon Squeezy: store `459198` (chordarium.lemonsqueezy.com), **live** and activated. Live product `1315315` = 100 credits / €9.99 (test-mode product `1313055` coexists in `PRODUCT_CREDITS`); checkout URL is the `LS_CHECKOUT_URL` const in `src/index.html`. LS webhooks are per-mode: the live webhook must exist with test mode OFF.
- DNS: Cloudflare zone `chordarium.com` (id `5013b51cbef566f37bc3fa889cb33cc6`) → GitHub Pages (A/AAAA apex + www CNAME, DNS-only); old zone `chordbloom.app` is proxied with a 301 redirect rule to chordarium.com

## Conventions

- Root stays **zero-dependency**; all npm deps live in `worker/` only.
- Match the file's dense one-line style when editing `src/index.html`; escape chord-derived strings with `escapeHtml` when they reach `innerHTML`.
- Design docs live in `docs/superpowers/` (specs + plans); significant work goes through spec → plan → review.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Open items (as of 2026-08-25)

- Verify the LIVE-mode LS webhook exists (Settings → Webhooks with test mode off) and confirm the first real sale credits a wallet (`wrangler tail` + LS webhook delivery log). No real-card test purchases (LS forbids them).
- Rate limit on `/wallet/activate`: deferred — needs the Worker behind a custom domain (e.g. `api.chordarium.com`) so a zone WAF rate rule can apply (workers.dev is outside the user's zone).
- Spec still says "€10" in one spot (price is €9.99).
- Unknown-wallet top-up webhook logs `alert:'topup_unknown_wallet'` and ignores; recovery is manual webhook resend from the LS dashboard.
- Brand assets (Note Bloom flower, product image 1600×1200, logo 512) live in the "Chordarium Brand" design canvas artifact and `~/Downloads/chordarium-*.png`; old ChordBloom assets in `~/Downloads/chordbloom-*.png`.
- `chordarium.app` was NOT registered (only .com); grab it if brand protection matters.
