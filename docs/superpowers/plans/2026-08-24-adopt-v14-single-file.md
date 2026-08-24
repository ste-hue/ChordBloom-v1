# Adopt ChordBloom Pro v1.4 Single-File App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the modular src/ app with the single-file ChordBloom Pro v1.4 (MPE) app and harden it: headless CI tests, mobile-safe audio, live voicing controls, resilient UI wiring, production hygiene.

**Architecture:** The entire app lives in `src/index.html` (one IIFE). A Node test harness extracts its `<script>` block and evaluates it in `node:vm` — the file's `init()` is guarded by `typeof document!=='undefined'` and it exports ~45 engine functions on `globalThis.__ChordBloomCore`, so the engine is testable headlessly without a DOM. `scripts/build.js` copies src→dist unchanged; GitHub Pages deploys dist.

**Tech Stack:** Vanilla JS single-file app, WebAudio, Standard MIDI File writing (PPQ 960, MPE per MIDI 1.0), Node 20+ `node --test` + `node:vm` for CI. Zero dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-adopt-v14-harden.md`

## Global Constraints

- Zero npm dependencies — Node stdlib only for tests/build; the app itself is static.
- `npm test` must pass at every commit (the Pages workflow runs `npm test` before deploy).
- All app-behavior changes go in `src/index.html`; never hand-edit `dist/` (generated).
- The v1.4 source of truth is `/Users/stefanodellapietra/Downloads/ChordBloom_Pro_v1.4_MPE.zip`.
- MIDI: PPQ 960; MPE manager channel 1 (status nibble 0), members 2–16 (status nibbles 1–15).
- Commit after each task. Do NOT `git push` to `main` (it triggers deploy) — the user confirms pushes.
- Line numbers below refer to the pristine v1.4 file; they shift as tasks land. Locate code by the quoted snippets, not by line number alone.

---

### Task 1: Vendor v1.4 as the app + headless engine test suite

**Files:**
- Create: `tests/helpers/load-core.js`
- Create: `tests/engine.test.js`
- Replace: `src/index.html` (from the zip)
- Delete: `src/app.js`, `src/audio.js`, `src/styles.css`, `src/engine/` (whole dir), `tests/core.test.js`, `tests/audio.test.js`

**Interfaces:**
- Produces: `loadCore(): Promise<object>` — evaluates the `<script>` of `src/index.html` in a `node:vm` context and returns the `__ChordBloomCore` export. All later test tasks consume this.
- Produces: `src/index.html` — the single-file app all later tasks modify.

- [ ] **Step 1: Write the harness and the failing engine tests**

`tests/helpers/load-core.js`:

```js
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

export async function loadCore(){
  const html=await readFile(new URL('../../src/index.html',import.meta.url),'utf8');
  const m=html.match(/<script>([\s\S]*)<\/script>/);
  if(!m) throw new Error('No inline <script> block found in src/index.html');
  const context=vm.createContext({console,TextEncoder});
  vm.runInContext(m[1],context,{filename:'chordbloom-inline-script.js'});
  if(!context.__ChordBloomCore) throw new Error('__ChordBloomCore missing — headless load failed');
  return context.__ChordBloomCore;
}
```

`tests/engine.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './helpers/load-core.js';

const core=await loadCore();

function mpeSettings(over={}){
  return {bpm:120,grid:'1/16',count:4,loopFriendly:true,exportMode:'Pattern (single track)',
    mpeEnabled:true,mpePower:.5,mpeMode:'EXPRESSIVE',mpeBendRange:48,mpeGlide:.5,mpeVibrato:.4,
    mpeTimbre:.8,mpePressure:.8,mpeCommonToneHold:true,mpeTheoryAware:true,...over};
}
const ev=(start,end,note,velocity=100)=>({track:'Pattern',start,end,note,velocity});

test('headless core exposes the engine (init skipped without DOM)',()=>{
  for(const fn of ['chooseChord','voiceChord','diatonicChord','makeMpeCurve','allocateMpeChannels',
                   'pitchBend14','midiBytesFrom','mulberry32','hashSeed','gridTicks','noteName'])
    assert.equal(typeof core[fn],'function',`missing ${fn}`);
  assert.equal(core.PPQ,960);
});

test('pitchBend14 centers at 8192 and clamps to 14-bit range',()=>{
  assert.equal(core.pitchBend14(0,48),8192);
  assert.equal(core.pitchBend14(48,48),16383);
  assert.equal(core.pitchBend14(-48,48),0);
  assert.equal(core.pitchBend14(999,48),16383);
});

test('allocateMpeChannels gives overlapping notes distinct member channels 1..15',()=>{
  const out=core.allocateMpeChannels([ev(0,960,60),ev(0,960,64),ev(0,960,67)]);
  const chans=out.map(e=>e._mpeChannel);
  assert.equal(new Set(chans).size,3);
  for(const c of chans) assert.ok(c>=1&&c<=15,`channel ${c} out of member range`);
});

test('non-MPE export is a valid single-track SMF at PPQ 960',()=>{
  const bytes=core.midiBytesFrom(mpeSettings({mpeEnabled:false}),[ev(0,960,60),ev(960,1920,64)]);
  assert.equal(String.fromCharCode(...bytes.slice(0,4)),'MThd');
  assert.equal((bytes[8]<<8)|bytes[9],0);           // format 0
  assert.equal((bytes[10]<<8)|bytes[11],1);         // one track
  assert.equal((bytes[12]<<8)|bytes[13],960);       // division
  assert.deepEqual([...bytes.slice(-4)],[0,0xFF,0x2F,0]); // end of track
});

test('MPE export writes RPN 6 configuration and member-channel note-ons',()=>{
  const a=Array.from(core.midiBytesFrom(mpeSettings(),[ev(0,960,60),ev(0,960,64)]));
  // Delta-time 0 sits between same-tick messages: ... B0 65 00 <dt=0> B0 64 06 ...
  const hasRpn6=a.some((v,i)=>v===0xB0&&a[i+1]===101&&a[i+2]===0&&a[i+3]===0&&a[i+4]===0xB0&&a[i+5]===100&&a[i+6]===6);
  assert.ok(hasRpn6,'MPE Configuration RPN 6 not found');
  assert.ok(a.some((v,i)=>(v&0xF0)===0x90&&(v&0x0F)>=1&&a[i+2]>0),'no member-channel note-on');
});

test('makeMpeCurve is null when disabled and lane values are in range when enabled',()=>{
  const ch={root:60,notes:[48,60,64,67],pcs:[0,4,7],intervals:[0,4,7]};
  const e=ev(0,960,64);
  const rng=core.mulberry32(core.hashSeed(42));
  assert.equal(core.makeMpeCurve(e,ch,null,mpeSettings({mpeEnabled:false}),rng),null);
  const curve=core.makeMpeCurve(e,ch,null,mpeSettings(),core.mulberry32(core.hashSeed(42)));
  assert.ok(curve&&Array.isArray(curve.bend)&&Array.isArray(curve.timbre)&&Array.isArray(curve.pressure));
  for(const p of [...curve.timbre,...curve.pressure]) assert.ok(p.value>=0&&p.value<=127);
  for(const p of [...curve.bend,...curve.timbre,...curve.pressure]) assert.ok(p.tick>=0&&p.tick<=960);
});

test('seeded RNG is deterministic',()=>{
  const a=core.mulberry32(core.hashSeed(12345)), b=core.mulberry32(core.hashSeed(12345));
  for(let i=0;i<50;i++) assert.equal(a(),b());
});

test('gridTicks maps subdivisions to PPQ fractions',()=>{
  assert.equal(core.gridTicks('1/4'),960);
  assert.equal(core.gridTicks('1/16'),240);
  assert.equal(core.gridTicks('nonsense'),240);
});
```

- [ ] **Step 2: Run tests to verify the new suite fails against the old app**

Run: `npm test`
Expected: `tests/engine.test.js` FAILS (old `src/index.html` is a modular shell with no inline engine script / `__ChordBloomCore`); old `core.test.js`/`audio.test.js` still pass.

- [ ] **Step 3: Swap in the v1.4 file and remove the old app + old tests**

```bash
cd /Users/stefanodellapietra/dev/Projects/ChordBloom-v1
unzip -p /Users/stefanodellapietra/Downloads/ChordBloom_Pro_v1.4_MPE.zip index.html > src/index.html
git rm -q src/app.js src/audio.js src/styles.css tests/core.test.js tests/audio.test.js
git rm -qr src/engine
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — only `tests/engine.test.js`, 8/8.

- [ ] **Step 5: Verify the build still works**

Run: `npm run build && cmp dist/index.html src/index.html && ls dist`
Expected: `Built static site → dist/`, `cmp` silent (identical), `dist` contains only `index.html`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: adopt ChordBloom Pro v1.4 single-file app with headless engine tests

Replaces the modular src/ app with the v1.4 MPE single-file build.
Engine is tested headlessly via node:vm + __ChordBloomCore.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Mobile-safe shared AudioContext

**Files:**
- Modify: `src/index.html` — `auditionChord` (~line 1404), `play`/`stopAudio` (~1427–1432), `__ChordBloomCore` export (~1718)
- Create: `tests/audio.test.js`

**Interfaces:**
- Consumes: `loadCore()` from Task 1.
- Produces: `activateAudioContext(context): Promise<context>` inside the app, exported on `__ChordBloomCore`; `state.audio` now holds the active master `GainNode` (not an `AudioContext`).

- [ ] **Step 1: Write the failing tests**

`tests/audio.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './helpers/load-core.js';

const core=await loadCore();

test('activateAudioContext resumes a suspended context',async()=>{
  let resumed=false;
  const context={state:'suspended',async resume(){resumed=true;this.state='running';}};
  const result=await core.activateAudioContext(context);
  assert.equal(result,context);
  assert.equal(resumed,true);
  assert.equal(context.state,'running');
});

test('activateAudioContext does not resume a running context',async()=>{
  let calls=0;
  const context={state:'running',async resume(){calls++;}};
  await core.activateAudioContext(context);
  assert.equal(calls,0);
});

test('activateAudioContext rejects a closed context',async()=>{
  await assert.rejects(()=>core.activateAudioContext({state:'closed'}),/closed/i);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`
Expected: `tests/audio.test.js` FAILS with `core.activateAudioContext is not a function`.

- [ ] **Step 3: Implement the shared, resume-safe audio path**

In `src/index.html`, replace the block from `function auditionChord(ch) {` through the end of `function stopAudio(){ ... }` (currently lines ~1404–1432; `scheduleTone`/`scheduleExpressiveTone` in between stay byte-identical) with:

```js
  let sharedAudioCtx=null;
  async function activateAudioContext(context){
    if(context.state==='closed')throw new Error('Audio output is closed. Reload the page to play sound again.');
    if(context.state==='suspended'&&typeof context.resume==='function')await context.resume();
    return context;
  }
  function audioContext(){
    const AudioCtx=window.AudioContext||window.webkitAudioContext; if(!AudioCtx)return null;
    if(!sharedAudioCtx||sharedAudioCtx.state==='closed')sharedAudioCtx=new AudioCtx();
    return sharedAudioCtx;
  }

  async function auditionChord(ch) {
    stopAudio(); const ctx=audioContext(); if(!ctx){setStatus('WebAudio unavailable. MIDI export still works.');return;}
    try{await activateAudioContext(ctx);}catch(err){setStatus(String(err.message||err));return;}
    const master=ctx.createGain(); master.gain.value=.14; master.connect(ctx.destination); state.audio=master; const now=ctx.currentTime+.03;
    ch.notes.forEach(n=>scheduleTone(ctx,master,n,now,1.0,.8)); setTimeout(()=>{if(state.audio===master)stopAudio();},1300);
  }
```

(keep `scheduleTone` and `scheduleExpressiveTone` exactly as they are between the two functions, then:)

```js
  async function play() {
    stopAudio(); if(!state.events.length)generatePatternEvents();
    const ctx=audioContext(); if(!ctx){setStatus('WebAudio unavailable. MIDI export still works.');return;}
    try{await activateAudioContext(ctx);}catch(err){setStatus(String(err.message||err));return;}
    const master=ctx.createGain();master.gain.value=.18;master.connect(ctx.destination);state.audio=master;
    const secPerTick=60/(settings().bpm*PPQ), now=ctx.currentTime+.05; const audible=state.events.filter(e=>e.track==='Pattern');
    for(const e of audible) scheduleExpressiveTone(ctx,master,e,now+e.start*secPerTick,Math.max(.025,(e.end-e.start)*secPerTick),e.velocity/127,settings(),secPerTick);
    const end=Math.max(...audible.map(e=>e.end),PPQ)*secPerTick+1; setStatus(`Playing ${settings().generationMode} at ${settings().bpm} BPM.`); setTimeout(()=>{if(state.audio===master){stopAudio();setStatus('Ready.');}},end*1000);
  }
  function stopAudio(){ if(state.audio){try{state.audio.disconnect();}catch{} state.audio=null;} }
```

Then add `activateAudioContext` to the `globalThis.__ChordBloomCore={...}` object (append `,activateAudioContext` before the closing brace).

Check for stale `state.audio` context assumptions: `grep -n 'state\.audio' src/index.html` — only the three functions above may reference it; fix any other hit to the master-gain semantics.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — engine 8/8 + audio 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/index.html tests/audio.test.js
git commit -m "fix: shared AudioContext with suspend-resume for mobile playback

Restores the mobile audio unlock (previously commit 6de36e7) lost in the
v1.4 rewrite; one context reused across plays instead of per-play churn.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Live voicing controls + resilient bindUI

**Files:**
- Modify: `src/index.html` — `bindUI` (~1672–1685), `initControls` technique-checkbox wiring (~1649)

**Interfaces:**
- Consumes: existing `revoiceFrom(start)`, `pushHistory()`, `refreshAll(rebuildEvents)`, `setStatus(t)`, `state.progression`, `state.techniqueEnabled`.
- Produces: no new API; behavior only.

- [ ] **Step 1: Make the bulk listener loop null-safe**

In `bindUI`, in the long array line beginning `['generationMode','grid','articulation',...` change

```js
.forEach(id=>$(id).addEventListener('change',()=>refreshAll(true)));
```

to

```js
.forEach(id=>$(id)?.addEventListener('change',()=>refreshAll(true)));
```

- [ ] **Step 2: Wire voicing controls to re-voice, harmony controls to hint**

In `bindUI`, immediately after the line `$('showTheory').onchange=()=>refreshAll(false);` insert:

```js
    ['voicingMode','register','pedal','bassMovement','topVoice','spread','voiceLeading','avoidCrossing','counterpointAware'].forEach(id=>$(id)?.addEventListener('change',()=>{ if(!state.progression.length)return; pushHistory(); revoiceFrom(0); refreshAll(true); setStatus('Voicing updated.'); }));
    ['key','scale','style','mood','count','cadence','tensionCurve','loopFriendly','theoryPalette'].forEach(id=>$(id)?.addEventListener('change',()=>setStatus('Harmony settings changed — press GENERATE to apply.')));
```

- [ ] **Step 3: Give technique checkboxes the same hint**

In `initControls`, change

```js
lab.querySelector('input').onchange=e=>{state.techniqueEnabled[id]=e.target.checked;};
```

to

```js
lab.querySelector('input').onchange=e=>{state.techniqueEnabled[id]=e.target.checked;setStatus('Technique palette changed — press GENERATE to apply.');};
```

- [ ] **Step 4: Run tests to verify no regression**

Run: `npm test`
Expected: PASS (11/11). DOM behavior itself is verified in Task 6's browser check.

- [ ] **Step 5: Commit**

```bash
git add src/index.html
git commit -m "fix: voicing controls re-voice live; harmony controls hint GENERATE; null-safe bindUI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Production hygiene — gated self-tests, dead code, vlq clamp, HTML escaping

**Files:**
- Modify: `src/index.html` — `init` (~1713), `vlq` (~1434), `midiTrackWithSettings` (~1497), `renderProgression` (~1374–1376); delete `midiTrack` (~1439–1447), `bytesToDataUrl` (~1509–1516), `weightedPick` (~393–396)

**Interfaces:**
- Consumes: existing `escapeHtml(s)` (defined near the favorites renderer), `runSelfTests()`.
- Produces: self-tests run only when the URL has `?selftest=1`; `window.ChordBloom.runSelfTests` remains for manual runs.

- [ ] **Step 1: Gate the startup self-tests**

In `init()`, change

```js
generate('apply');refreshAll(true);setTimeout(runSelfTests,50);
```

to

```js
generate('apply');refreshAll(true);if(new URLSearchParams(location.search).has('selftest'))setTimeout(runSelfTests,50);
```

- [ ] **Step 2: Delete dead code**

Remove these three complete function declarations (definition-only, zero call sites):
- `function midiTrack(name,events,channel=0,includeTempo=false) { ... }` (the near-duplicate of `midiTrackWithSettings` that reads `settings()` internally)
- `function bytesToDataUrl(bytes){ ... }`
- `function weightedPick(rng, items){ ... }`

- [ ] **Step 3: Clamp vlq input in both writers**

Change `function vlq(v){ let buffer=v&0x7F, out=[];` to:

```js
  function vlq(v){ v=Math.max(0,Math.floor(v)); let buffer=v&0x7F, out=[];
```

In `midiTrackWithSettings`, change `bytes.push(...vlq(m.tick-last),...m.data);` to `bytes.push(...vlq(Math.max(0,m.tick-last)),...m.data);` (matching the MPE writer, which already clamps).

- [ ] **Step 4: Escape engine strings in chord cards**

In `renderProgression`, in the `card.innerHTML=` template, wrap the chord-derived interpolations with `escapeHtml`: `${escapeHtml(ch.roman)}`, `${escapeHtml(ch.name)}`, `${escapeHtml(ch.functionName)}`, `${escapeHtml(ch.source)}`, `${escapeHtml(ch.detail)}`, and `${escapeHtml(notes)}`. Leave the `data-help` button markup and `${inversion}`/`${noteName(...)}` (fixed vocabulary) as-is.

- [ ] **Step 5: Verify removal and run tests**

Run: `grep -c 'function midiTrack(\|bytesToDataUrl\|weightedPick' src/index.html; npm test`
Expected: grep prints `0` (exit 1 is fine); tests PASS 11/11.

- [ ] **Step 6: Commit**

```bash
git add src/index.html
git commit -m "chore: gate self-tests behind ?selftest=1, drop dead code, clamp vlq, escape chord card HTML

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Version + README

**Files:**
- Modify: `package.json` (version, description)
- Replace: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update package.json**

Set `"version": "1.4.0"` and `"description": "Browser-first harmony and MIDI composition tool with MPE expression. Single-file app, no dependencies."`. Leave scripts untouched.

- [ ] **Step 2: Rewrite README.md**

```markdown
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
```

- [ ] **Step 3: Run tests and build**

Run: `npm test && npm run build`
Expected: PASS 11/11; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "docs: v1.4.0 README and package metadata

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end browser verification

**Files:** none (verification; fixes loop back into the task that owns the code).

**Interfaces:**
- Consumes: the built app in `dist/`, the in-page suites `window.__CHORDBLOOM_TESTS__` and status line `#status`.

- [ ] **Step 1: Build and serve**

Run: `npm run build`, then start `npm start` in the background (serves `dist/` at `http://localhost:4173`).

- [ ] **Step 2: Verify the self-test gate**

Open `http://localhost:4173/` in Chrome (claude-in-chrome). Evaluate `window.__CHORDBLOOM_TESTS__` — Expected: `undefined` (self-tests gated off by default).

- [ ] **Step 3: Run the in-browser self-tests**

Open `http://localhost:4173/?selftest=1`. Wait ~1s, evaluate `window.__CHORDBLOOM_TESTS__`.
Expected: an array with every entry `pass: true` (progression, MIDI validity, grid-locking, lock preservation, FULL LENGTH vs NATURAL PLAY, crazy arp, MPE curves, RPN 6, member note-ons). Any `pass: false` → fix in the owning task, re-run.

- [ ] **Step 4: Verify the interaction fixes**

Still on the page:
1. Click **PLAY** — `#status` shows `Playing … BPM.` (no exception; audio path resumed).
2. Switch to Expert view, open the Voicing tab, change **Register** — `#status` shows `Voicing updated.` and the chord-card notes change.
3. Change **Key** — `#status` shows `Harmony settings changed — press GENERATE to apply.`
4. Take a screenshot for the user.

- [ ] **Step 5: Final check and report**

Run: `npm test` one last time. Expected: PASS 11/11.
Stop the server. Report results to the user and ask whether to push to `main` (push = deploy to GitHub Pages).
