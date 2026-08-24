/**
 * Interaction-state model tests: pending-direction dirty tracking, snapshot
 * authority (apply → undo → redo), technique-state persistence, favorites,
 * desktop/mobile action-label sync, and lock-aware compose state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/load-app.js';

async function freshApp(){
  const app=await loadApp();
  app.core.generate('apply');
  return app;
}

test('complexity, tension and adventure mark the direction dirty on change', async()=>{
  const {core,$}=await freshApp();
  assert.equal(core.composeState().label,'NEW IDEA');
  for(const [id,label,next] of [['complexity','Complexity','80'],['tension','Tension','66'],['adventure','Adventure','90']]){
    const prev=$(id).value;
    $(id).value=next; $(id).dispatch('change');
    const cs=core.composeState();
    assert.equal(cs.pending,true,`${id} should mark direction dirty`);
    assert.ok(cs.diff.includes(`${label} ${prev} → ${next}`),`diff should list ${label}: ${cs.diff}`);
    $(id).value=prev; $(id).dispatch('change');
  }
  assert.equal(core.composeState().pending,false);
});

test('BPM and Spread changes never mark the direction dirty', async()=>{
  const {core,$}=await freshApp();
  $('bpm').value='140'; $('bpm').dispatch('change');
  assert.equal(core.composeState().pending,false,'BPM is a playback setting, not direction');
  assert.equal(core.composeState().label,'NEW IDEA');
  const historyBefore=core.state.history.length;
  $('spread').value='90'; $('spread').dispatch('change');
  assert.equal(core.composeState().pending,false,'Spread revoices immediately, not via APPLY CHANGES');
  assert.equal(core.state.history.length,historyBefore+1,'Spread change is an immediate undoable revoice');
  $('voiceLeading').value='10'; $('voiceLeading').dispatch('change');
  assert.equal(core.composeState().pending,false,'Voice Leading revoices immediately, not via APPLY CHANGES');
});

test('apply → undo → redo keeps the applied brief truthful', async()=>{
  const {core,$}=await freshApp();
  $('style').value='HOUSE'; $('style').dispatch('change');
  assert.equal(core.composeState().label,'APPLY CHANGES');
  $('generateBtn').dispatch('click');
  assert.equal(core.composeState().pending,false,'apply clears the pending state');
  const applied=core.state.progression.map(c=>c.name).join(' ');
  $('undoBtn').dispatch('click');
  const afterUndo=core.composeState();
  assert.equal(afterUndo.pending,true,'undo of APPLY CHANGES must re-report the un-applied brief as dirty');
  assert.ok(afterUndo.diff.some(t=>t.includes('ELECTRONICA → HOUSE')),`diff should still show the style change: ${afterUndo.diff}`);
  $('redoBtn').dispatch('click');
  assert.equal(core.composeState().pending,false,'redo restores the applied (clean) state');
  assert.equal($('style').value,'HOUSE');
  assert.equal(core.state.progression.map(c=>c.name).join(' '),applied,'redo restores the applied progression exactly');
});

test('snapshots carry appliedDirection instead of recomputing it', async()=>{
  const {core}=await freshApp();
  const snap=core.snapshot();
  assert.ok(snap.appliedDirection,'snapshot must include appliedDirection');
  assert.deepEqual({...snap.appliedDirection},{...core.state.appliedDirection});
  const marker={...snap.appliedDirection,style:'AMBIENT'};
  core.restoreSnapshot({...snap,appliedDirection:marker});
  assert.deepEqual({...core.state.appliedDirection},marker,'restoreSnapshot must restore appliedDirection exactly');
  assert.equal(core.composeState().pending,true,'restored stale brief must surface as pending');
});

test('technique state persists through snapshots and undo, and syncs checkboxes', async()=>{
  const {core,techEls}=await freshApp();
  const tsCb=techEls.find(cb=>cb.dataset.tech==='tritoneSub');
  core.state.techniqueEnabled.tritoneSub=false; tsCb.checked=false; core.markDirectionChanged();
  assert.ok(core.composeState().diff.includes('Theory techniques changed'));
  const snap=core.snapshot();
  assert.equal(snap.techniqueEnabled.tritoneSub,false,'snapshot must deep-copy techniqueEnabled');
  core.state.techniqueEnabled.tritoneSub=true;
  assert.equal(snap.techniqueEnabled.tritoneSub,false,'snapshot copy must be independent of live state');
  core.composeAction();
  assert.equal(core.composeState().pending,false);
  core.state.techniqueEnabled.tritoneSub=true; tsCb.checked=true; core.markDirectionChanged();
  const undoSnap=core.state.history.at(-1);
  core.restoreSnapshot(undoSnap);
  assert.equal(core.state.techniqueEnabled.tritoneSub,true,'restore must bring back the recorded technique state');
  assert.equal(tsCb.checked,true,'restore must synchronize data-tech checkboxes');
});

test('reset restores the default technique state', async()=>{
  const {core,techEls,$}=await freshApp();
  core.state.techniqueEnabled.quartal=false;
  const qCb=techEls.find(cb=>cb.dataset.tech==='quartal'); qCb.checked=false;
  $('resetBtn').dispatch('click');
  assert.ok(Object.values(core.state.techniqueEnabled).every(Boolean),'reset re-enables every technique');
  assert.equal(qCb.checked,true,'reset synchronizes the technique checkboxes');
  assert.equal(core.composeState().pending,false,'reset applies immediately and stays clean');
});

test('favorites restore progression, direction brief and technique state', async()=>{
  const {core,$,storage,techEls}=await freshApp();
  core.state.techniqueEnabled.backdoor=false;
  techEls.find(cb=>cb.dataset.tech==='backdoor').checked=false;
  core.markDirectionChanged(); core.composeAction();
  const savedNames=core.state.progression.map(c=>c.name).join(' ');
  const savedApplied={...core.state.appliedDirection};
  core.saveFavorite();
  // Drift away from the favorite.
  core.state.techniqueEnabled.backdoor=true;
  techEls.find(cb=>cb.dataset.tech==='backdoor').checked=true;
  $('mood').value='Dark'; $('mood').dispatch('change');
  core.composeAction();
  const fav=JSON.parse(storage.get('chordbloom.favorites'))[0];
  core.restoreSnapshot(fav.snapshot);
  assert.equal(core.state.progression.map(c=>c.name).join(' '),savedNames,'favorite restores the exact progression');
  assert.deepEqual({...core.state.appliedDirection},savedApplied,'favorite restores the applied brief');
  assert.equal(core.state.techniqueEnabled.backdoor,false,'favorite restores technique state');
  assert.equal(techEls.find(cb=>cb.dataset.tech==='backdoor').checked,false,'favorite syncs technique checkboxes');
  assert.equal(core.composeState().pending,false,'a restored favorite is clean, not pending');
});

test('desktop and mobile action labels stay synchronized', async()=>{
  const {core,$}=await freshApp();
  const labels=()=>({desktop:$('generateBtn').textContent,mobile:$('mabGenerateBtn').textContent});
  core.updateComposeAction();
  assert.deepEqual(labels(),{desktop:'NEW IDEA',mobile:'NEW IDEA'});
  $('mood').value='Dark'; $('mood').dispatch('change');
  assert.deepEqual(labels(),{desktop:'APPLY CHANGES',mobile:'APPLY'});
  $('mood').value='Dreamy'; $('mood').dispatch('change');
  core.state.locks[0]=true; core.updateComposeAction();
  assert.deepEqual(labels(),{desktop:'RECOMPOSE UNLOCKED',mobile:'RECOMPOSE'});
  core.state.locks[0]=false;
  core.state.progression=[]; core.updateComposeAction();
  assert.deepEqual(labels(),{desktop:'CREATE PROGRESSION',mobile:'CREATE'});
});

test('lock state only counts visible progression chords', async()=>{
  const {core}=await freshApp();
  const n=core.state.progression.length;
  // Partial lock → recompose the rest.
  core.state.locks.fill(false); core.state.locks[0]=true;
  assert.equal(core.composeState().label,'RECOMPOSE UNLOCKED');
  // All visible chords locked → recomposing would be a no-op, so the action disables.
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  assert.equal(core.composeState().label,'ALL CHORDS LOCKED','all-locked must disable instead of offering a no-op action');
  assert.equal(core.composeState().disabled,true);
  // Stale lock beyond the current progression length must be ignored.
  core.state.locks.fill(false); core.state.locks[n+3]=true;
  assert.equal(core.composeState().label,'NEW IDEA','out-of-range locks are stale and must be ignored');
  // Pending direction outranks locks.
  core.state.locks.fill(false); core.state.locks[0]=true;
  core.state.appliedDirection={...core.state.appliedDirection,mood:'Dark'};
  assert.equal(core.composeState().label,'APPLY CHANGES');
});

test('all-locked: clicking the composition action is a guarded no-op, not a fake new idea', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  const cs=core.updateComposeAction();
  assert.equal(cs.label,'ALL CHORDS LOCKED');
  assert.equal(cs.disabled,true);
  const before=JSON.stringify(core.state.progression);
  const seedBefore=$('seed').value;
  const historyBefore=core.state.history.length;
  $('generateBtn').dispatch('click');
  assert.equal(JSON.stringify(core.state.progression),before,'clicking while all-locked must not touch the progression');
  assert.equal($('seed').value,seedBefore,'no new-idea seed reroll may happen while disabled');
  assert.equal(core.state.history.length,historyBefore,'a guarded no-op must not pollute undo history');
  assert.match($('status').textContent,/unlock at least one chord/i);
});

test('all-locked + pending direction: apply is blocked and appliedDirection stays truthful', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  $('style').value='HOUSE'; $('style').dispatch('change');
  assert.equal($('status').textContent,'Direction changed — unlock at least one chord to apply it.');
  const applied={...core.state.appliedDirection};
  const before=JSON.stringify(core.state.progression);
  $('generateBtn').dispatch('click');
  core.composeAction();
  assert.deepEqual({...core.state.appliedDirection},applied,'appliedDirection must not claim the blocked brief was applied');
  assert.equal(JSON.stringify(core.state.progression),before,'a fully locked progression must survive a blocked apply untouched');
  assert.equal(core.composeState().pending,true,'the brief stays pending until it can really be applied');
});

test('unlocking one chord re-enables RECOMPOSE UNLOCKED and APPLY CHANGES', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  assert.equal(core.composeState().disabled,true);
  core.state.locks[0]=false;
  let cs=core.updateComposeAction();
  assert.deepEqual({label:cs.label,disabled:cs.disabled},{label:'RECOMPOSE UNLOCKED',disabled:false});
  $('style').value='HOUSE'; $('style').dispatch('change');
  cs=core.composeState();
  assert.deepEqual({label:cs.label,disabled:cs.disabled},{label:'APPLY CHANGES',disabled:false});
});

test('recompose changes the unlocked chord while locked chords remain exact', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  core.state.locks.fill(false);
  for(let i=1;i<n;i++) core.state.locks[i]=true;
  const locked=core.state.progression.slice(1).map(c=>JSON.stringify(c));
  const free=JSON.stringify(core.state.progression[0]);
  assert.equal(core.updateComposeAction().label,'RECOMPOSE UNLOCKED');
  let changed=false;
  for(let t=0;t<12&&!changed;t++){ $('generateBtn').dispatch('click'); changed=JSON.stringify(core.state.progression[0])!==free; }
  assert.ok(changed,'the unlocked chord must actually be recomposed');
  assert.deepEqual(core.state.progression.slice(1).map(c=>JSON.stringify(c)),locked,'locked chords must be preserved exactly');
});

test('raising the chord count re-opens positions even when every current chord is locked', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  assert.equal(core.composeState().disabled,true);
  $('count').value=String(n+2); $('count').dispatch('change');
  const cs=core.composeState();
  assert.deepEqual({label:cs.label,disabled:cs.disabled},{label:'APPLY CHANGES',disabled:false},'new unlocked positions make apply meaningful again');
  const locked=core.state.progression.map(c=>JSON.stringify(c));
  $('generateBtn').dispatch('click');
  assert.equal(core.state.progression.length,n+2,'apply grows the progression to the pending count');
  assert.deepEqual(core.state.progression.slice(0,n).map(c=>JSON.stringify(c)),locked,'existing locked chords survive the count increase');
  assert.equal(core.composeState().pending,false,'the grown brief is genuinely applied');
});

test('desktop and mobile disabled states stay synchronized', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  core.updateComposeAction();
  for(const id of ['generateBtn','mabGenerateBtn']){
    assert.equal($(id).disabled,true,`${id} must be disabled while all chords are locked`);
    assert.equal($(id).getAttribute('aria-disabled'),'true',`${id} must expose aria-disabled`);
  }
  assert.deepEqual({desktop:$('generateBtn').textContent,mobile:$('mabGenerateBtn').textContent},{desktop:'ALL CHORDS LOCKED',mobile:'LOCKED'});
  core.state.locks[0]=false;
  core.updateComposeAction();
  for(const id of ['generateBtn','mabGenerateBtn']){
    assert.equal($(id).disabled,false,`${id} must re-enable after an unlock`);
    assert.equal($(id).getAttribute('aria-disabled'),'false',`${id} must clear aria-disabled after an unlock`);
  }
});

test('reverting direction changes clears the stale pending status', async()=>{
  const {core,$}=await freshApp();
  $('style').value='HOUSE'; $('style').dispatch('change');
  assert.match($('status').textContent,/APPLY CHANGES/);
  $('style').value='ELECTRONICA'; $('style').dispatch('change');
  assert.equal($('status').textContent,'Direction changes reverted.');
  assert.equal(core.composeState().pending,false);
});

test('VARIATION and NEW SEED with all chords locked do not commit a pending direction', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  $('style').value='HOUSE'; $('style').dispatch('change');
  assert.equal(core.composeState().pending,true,'direction is pending before VARIATION');
  const applied={...core.state.appliedDirection};
  $('similarBtn').dispatch('click');
  assert.deepEqual({...core.state.appliedDirection},applied,'VARIATION must not commit a pending direction when all chords are locked');
  assert.equal(core.composeState().pending,true,'direction stays pending after VARIATION');
  $('newSeedBtn').dispatch('click');
  assert.deepEqual({...core.state.appliedDirection},applied,'NEW SEED must not commit a pending direction when all chords are locked');
  assert.equal(core.composeState().pending,true,'direction stays pending after NEW SEED');
});
