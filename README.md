# ChordBloom

ChordBloom is a browser-first harmony and MIDI composition tool. Its core engine runs locally with no API dependency.

## Architecture

- `src/engine/music-data.js` — scales, styles, moods, grids
- `src/engine/theory.js` — scale/chord construction and chromatic theory candidates
- `src/engine/harmony.js` — contextual progression candidate generation and scoring
- `src/engine/voicing.js` — inversion/register/voice-leading candidate scoring
- `src/engine/rhythm.js` — chord, rhythm, arp, broken-chord, strum and pulse event generation
- `src/engine/midi.js` — dependency-free Standard MIDI File writer
- `src/engine/analyzer.js` — progression-level explanation
- `src/app.js` — browser state, UI, WebAudio, persistence
- `tests/core.test.js` — engine invariants and MIDI tests

## Run

Requires Node 20+ only for tests/build. The app itself is static.

```bash
npm test
npm run build
npm start
```

Then open `http://localhost:4173`.

## Static deployment

Deploy the generated `dist/` directory to Vercel, Netlify, GitHub Pages or Cloudflare Pages. No server runtime is required.

## Implemented theory techniques

Diatonic triads/sevenths/ninths, functional labels, modal interchange iv, secondary dominants, tritone substitution, backdoor dominant, diminished passing harmony, Neapolitan harmony, tension-driven candidate scoring, cadence bias, loop scoring, inversions, spread voicings, common-tone/minimum-motion voice leading.

## Current scope

This production-ready v1 implements the full end-to-end composition path and the most important interaction model. Some items from the maximal product specification are intentionally extension points rather than pretended-complete features: augmented-sixth families, generalized secondary ii–V detection, upper structures/polychords, full quartal voicing palette, editable tension-curve points, dedicated bassline generation, direct browser-to-DAW drag, and audio sample instruments. The architecture isolates these additions in the engine rather than the UI.
