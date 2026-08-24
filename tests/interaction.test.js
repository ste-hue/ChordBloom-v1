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
  // All visible chords locked → explicit disabled state, not a silent no-op.
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  assert.equal(core.composeState().label,'ALL CHORDS LOCKED','all-locked must surface a disabled state');
  assert.equal(core.composeState().disabled,true);
  // Stale lock beyond the current progression length must be ignored.
  core.state.locks.fill(false); core.state.locks[n+3]=true;
  assert.equal(core.composeState().label,'NEW IDEA','out-of-range locks are stale and must be ignored');
  // Pending direction outranks partial locks.
  core.state.locks.fill(false); core.state.locks[0]=true;
  core.state.appliedDirection={...core.state.appliedDirection,mood:'Dark'};
  assert.equal(core.composeState().label,'APPLY CHANGES');
});

test('all chords locked: composeAction is a guarded no-op, not a fake new idea', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  core.updateComposeAction();
  const before=JSON.stringify(core.state.progression), seedBefore=$('seed').value, historyBefore=core.state.history.length;
  $('generateBtn').dispatch('click');
  assert.equal(JSON.stringify(core.state.progression),before,'progression must not change');
  assert.equal($('seed').value,seedBefore,'seed must not be rerolled');
  assert.equal(core.state.history.length,historyBefore,'no history entry for a no-op');
  assert.ok($('status').textContent.includes('unlock at least one chord'),`status must tell the user to unlock: ${$('status').textContent}`);
  core.composeAction();
  assert.equal(JSON.stringify(core.state.progression),before,'direct composeAction() invocation is guarded too');
});

test('all chords locked + pending Style change: appliedDirection stays unchanged', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  const appliedBefore={...core.state.appliedDirection};
  $('style').value='HOUSE'; $('style').dispatch('change');
  const cs=core.composeState();
  assert.equal(cs.label,'UNLOCK A CHORD');
  assert.equal(cs.disabled,true);
  assert.ok($('status').textContent.includes('unlock at least one chord'),'status must tell the user to unlock');
  $('generateBtn').dispatch('click');
  assert.deepEqual({...core.state.appliedDirection},appliedBefore,'APPLY must not mark the new brief as applied');
  assert.equal(core.composeState().pending,true,'the brief stays pending');
});

test('all chords locked + increased chord count re-enables APPLY CHANGES', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  $('count').value=String(n+2); $('count').dispatch('change');
  const cs=core.composeState();
  assert.equal(cs.label,'APPLY CHANGES','a larger count creates new unlocked positions');
  assert.equal(cs.disabled,false);
  const locked=core.state.progression.map(c=>JSON.stringify(c.notes));
  $('generateBtn').dispatch('click');
  assert.equal(core.state.progression.length,n+2);
  assert.deepEqual(core.state.progression.slice(0,n).map(c=>JSON.stringify(c.notes)),locked,'existing locked chords stay exact');
  assert.equal(core.composeState().pending,false,'the enlarged brief is genuinely applied');
});

test('unlocking one chord re-enables RECOMPOSE/APPLY and only recomposes unlocked chords', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  core.updateComposeAction();
  assert.equal($('generateBtn').disabled,true);
  core.state.locks[n-1]=false; core.updateComposeAction();
  assert.equal(core.composeState().label,'RECOMPOSE UNLOCKED');
  assert.equal($('generateBtn').disabled,false,'unlocking a chord re-enables the action');
  const lockedBefore=core.state.progression.slice(0,n-1).map(c=>JSON.stringify(c.notes));
  const unlockedBefore=JSON.stringify(core.state.progression[n-1].notes);
  // Each click rerolls the seed; retry a few times so the "chord changed" check
  // never flakes on a coincidental identical voicing, while locked chords must
  // stay exact on every recompose.
  let changed=false;
  for(let attempt=0;attempt<5 && !changed;attempt++){
    $('generateBtn').dispatch('click');
    assert.deepEqual(core.state.progression.slice(0,n-1).map(c=>JSON.stringify(c.notes)),lockedBefore,'locked chords remain exact');
    changed=JSON.stringify(core.state.progression[n-1].notes)!==unlockedBefore;
  }
  assert.ok(changed,'the unlocked chord is recomposed');
  // With a pending direction and one unlocked chord, APPLY is available again.
  $('mood').value='Dark'; $('mood').dispatch('change');
  assert.equal(core.composeState().label,'APPLY CHANGES');
  assert.equal(core.composeState().disabled,false);
});

test('desktop and mobile disabled states stay synchronized', async()=>{
  const {core,$}=await freshApp();
  const n=core.state.progression.length;
  const stateOf=id=>({disabled:$(id).disabled,aria:$(id).getAttribute('aria-disabled'),label:$(id).textContent});
  for(let i=0;i<n;i++) core.state.locks[i]=true;
  core.updateComposeAction();
  assert.deepEqual(stateOf('generateBtn'),{disabled:true,aria:'true',label:'ALL CHORDS LOCKED'});
  assert.deepEqual(stateOf('mabGenerateBtn'),{disabled:true,aria:'true',label:'LOCKED'});
  $('style').value='HOUSE'; $('style').dispatch('change');
  assert.deepEqual(stateOf('generateBtn'),{disabled:true,aria:'true',label:'UNLOCK A CHORD'});
  assert.deepEqual(stateOf('mabGenerateBtn'),{disabled:true,aria:'true',label:'UNLOCK'});
  core.state.locks[0]=false; core.updateComposeAction();
  assert.deepEqual(stateOf('generateBtn'),{disabled:false,aria:'false',label:'APPLY CHANGES'});
  assert.deepEqual(stateOf('mabGenerateBtn'),{disabled:false,aria:'false',label:'APPLY'});
});

test('reverting Direction changes clears the stale APPLY CHANGES status', async()=>{
  const {core,$}=await freshApp();
  $('mood').value='Dark'; $('mood').dispatch('change');
  assert.ok($('status').textContent.includes('press APPLY CHANGES'));
  $('mood').value='Dreamy'; $('mood').dispatch('change');
  assert.equal(core.composeState().pending,false);
  assert.equal($('status').textContent,'Direction changes reverted.','stale press-APPLY prompt must be cleared');
  // A non-direction status is left untouched by a clean direction change event.
  $('mood').dispatch('change');
  assert.equal($('status').textContent,'Direction changes reverted.');
});
