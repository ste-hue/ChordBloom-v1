# ChordBloom Pro v1.4 — MPE Expression

ChordBloom is a browser-first harmony and MIDI composition tool. The whole app is one
dependency-free static file: `src/index.html`. The music engine runs locally — no API calls.

## Features

- Seeded, deterministic progression engine: 20 scales/modes, 21 styles, 13 moods,
  14 chromatic techniques (secondary dominants & ii–V, tritone sub, backdoor, modal
  interchange, Neapolitan, augmented sixths, chromatic mediants, diminished approach,
  quartal, upper structures, line clichés), 17 cadence types, 7 tension curves.
- Voice-leading–scored voicings: close/open/drop-2/drop-3/drop-2&4/quartal/spread,
  registers, pedal tones, bass/top-voice shaping, per-chord lock / audition / alternative.
- Rhythm engine: chords, rhythmic chords, arpeggio (incl. polymetric "Crazy Arp"),
  broken chords, strum, pulse; Euclidean and style patterns; swing; Natural Play gating.
- **MPE**: theory-aware per-note pitch bend, CC74 timbre and channel pressure
  (common tones held stable, tendency tones lean into resolution). MIDI export writes an
  MPE zone (manager ch 1, members 2–16, RPN 6) at PPQ 960; the browser preview simulates
  MPE with WebAudio.
- Simple/Expert UI with contextual help on every control; undo/redo; local favorites;
  robust MIDI export (file picker → iOS share sheet → download fallback).

## Run

The app is static — open `src/index.html` directly, or:

```bash
npm test        # headless engine tests (Node 20+, no dependencies)
npm run build   # copies src/ → dist/
npm start       # serves dist/ at http://localhost:4173
```

Append `?selftest=1` to the URL to run the in-browser self-test suite
(results in the console and `window.__CHORDBLOOM_TESTS__`).

## Testing

`tests/` evaluates the app's inline script in `node:vm` (no DOM, no browser) and tests
the engine through its `__ChordBloomCore` export: MIDI file validity, MPE RPN
configuration and channel allocation, expression curves, determinism, grid math,
and audio-context activation.

## Deployment

Pushes to `main` run tests and deploy `dist/` to GitHub Pages
(`.github/workflows/pages.yml`). Any static host works.
