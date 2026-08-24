# Spec: Adopt ChordBloom Pro v1.4 (single-file) as the app, and harden it

## Decision (user-approved 2026-08-24)

The single-file app in `~/Downloads/ChordBloom_Pro_v1.4_MPE.zip` (`index.html`, 1,725 lines)
replaces the current modular `src/` app as the deployed product. It is a later independent
rewrite sharing the repo's data tables: it adds MPE expression (per-note pitch bend / CC74 /
channel pressure, MPE MIDI export), a 14-technique theory engine, Simple/Expert UI, tooltips,
and a robust export path. The old modular source is retired (remains in git history).
Full re-modularization was explicitly deferred; only targeted hardening is in scope.

## Requirements

1. **Adopt**: `src/index.html` becomes the v1.4 file, verbatim except for the fixes below.
   Old `src/app.js`, `src/audio.js`, `src/styles.css`, `src/engine/` and their tests are removed.
2. **CI stays green**: `npm test` must pass at every commit (GitHub Pages workflow runs it
   before deploy). Replace the old engine tests with a headless harness that evaluates the
   single file's `<script>` in `node:vm` and tests the engine via its `globalThis.__ChordBloomCore`
   export (the file's `init()` is already guarded by `typeof document!=='undefined'`).
3. **Fix mobile audio** (the repo's commit `6de36e7` regression is reintroduced by the zip):
   one shared `AudioContext`, resumed via an `activateAudioContext()` helper before any
   scheduling; no per-play context construction/close churn. `closed`-state gets a clear error.
4. **Fix inert controls**: voicing controls (`voicingMode`, `register`, `pedal`, `bassMovement`,
   `topVoice`, `spread`, `voiceLeading`, `avoidCrossing`, `counterpointAware`) re-voice the
   current progression on change. Harmony controls (`key`, `scale`, `style`, `mood`, `count`,
   `cadence`, `tensionCurve`, `loopFriendly`, `theoryPalette`) and technique checkboxes show a
   status hint that GENERATE applies them (regenerating implicitly would discard user work).
5. **Harden `bindUI`**: the 34-id listener loop must not abort on a missing id (`?.`).
6. **Production hygiene**: browser self-tests run only with `?selftest=1` in the URL, not on
   every load. Remove dead code: `midiTrack`, `bytesToDataUrl`, `weightedPick`. Clamp `vlq`
   input to non-negative integers in both writers. Escape chord fields interpolated into
   `renderProgression` innerHTML with the existing `escapeHtml`.
7. **Docs/version**: `package.json` → version 1.4.0 with description; README merged
   (repo run/deploy instructions + v1.4 feature description). Build (`scripts/build.js`,
   src→dist copy) and Pages workflow stay as-is.
8. **Out of scope**: engine re-modularization, `preserveExact` removal, touch tooltips,
   `CONTROL_HELP` restructuring, new musical features.
9. **Deploy gate**: do not push to `main` (which triggers Pages deploy) without explicit
   user confirmation.

## Source of truth

- Zip: `/Users/stefanodellapietra/Downloads/ChordBloom_Pro_v1.4_MPE.zip` (contains `index.html`, `README.md`).
- Comparison analysis (2026-08-24) identified the defects listed above, verified against the file.
