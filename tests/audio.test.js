import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './helpers/load-core.js';

const core=await loadCore();

// --- activateAudioContext tests (unchanged) ---

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

test('activateAudioContext resumes an interrupted context',async()=>{
  let resumed=false;
  const context={state:'interrupted',async resume(){resumed=true;this.state='running';}};
  const result=await core.activateAudioContext(context);
  assert.equal(result,context);
  assert.equal(resumed,true);
  assert.equal(context.state,'running');
});

test('activateAudioContext rejects if context stays paused',async()=>{
  const context={state:'suspended',async resume(){}};
  await assert.rejects(()=>core.activateAudioContext(context),/paused|unavailable/i);
});

test('activateAudioContext retries interrupted context and then rejects if still paused',async()=>{
  let calls=0;
  const context={state:'interrupted',async resume(){calls++;}};
  await assert.rejects(()=>core.activateAudioContext(context),/paused|unavailable/i);
  assert.equal(calls,2);
});

// --- ensureAudioUnlocked tests ---

function mockCtx(initialState,resumeTransition){
  let startCalled=false;
  const ctx={
    state:initialState,
    sampleRate:44100,
    currentTime:0,
    destination:{},
    async resume(){if(resumeTransition)this.state=resumeTransition;},
    createBuffer(){return {};},
    createBufferSource(){return {buffer:null,connect(){},start(){startCalled=true;},stop(){}};},
    get unlockBufferPlayed(){return startCalled;}
  };
  return ctx;
}

test('ensureAudioUnlocked: first user-gesture unlock from suspended plays silent buffer',async()=>{
  core.setAudioNeedsReactivation(true);
  const ctx=mockCtx('suspended','running');
  const result=await core.ensureAudioUnlocked(ctx);
  assert.equal(result,ctx);
  assert.equal(ctx.state,'running');
  assert.equal(ctx.unlockBufferPlayed,true);
});

test('ensureAudioUnlocked: already-running context is not resumed and plays silent buffer when reactivation needed',async()=>{
  core.setAudioNeedsReactivation(true);
  let resumeCalls=0;
  const ctx=mockCtx('running',null);
  const origResume=ctx.resume.bind(ctx);
  ctx.resume=async function(){resumeCalls++;await origResume();};
  await core.ensureAudioUnlocked(ctx);
  assert.equal(resumeCalls,0);
  assert.equal(ctx.unlockBufferPlayed,true);
});

test('ensureAudioUnlocked: interrupted context is resumed and unlocked',async()=>{
  core.setAudioNeedsReactivation(true);
  const ctx=mockCtx('interrupted','running');
  const result=await core.ensureAudioUnlocked(ctx);
  assert.equal(result,ctx);
  assert.equal(ctx.state,'running');
  assert.equal(ctx.unlockBufferPlayed,true);
});

test('ensureAudioUnlocked: context returning from background (running) plays silent buffer',async()=>{
  core.setAudioNeedsReactivation(true);
  const ctx=mockCtx('running',null);
  const result=await core.ensureAudioUnlocked(ctx);
  assert.equal(result,ctx);
  assert.equal(ctx.unlockBufferPlayed,true);
});

test('ensureAudioUnlocked: skips silent buffer when reactivation not needed',async()=>{
  core.setAudioNeedsReactivation(false);
  const ctx=mockCtx('running',null);
  const result=await core.ensureAudioUnlocked(ctx);
  assert.equal(result,ctx);
  assert.equal(ctx.unlockBufferPlayed,false);
});

test('ensureAudioUnlocked: failed unlock (context stays suspended) rejects with state in message',async()=>{
  core.setAudioNeedsReactivation(true);
  const ctx=mockCtx('suspended',null);
  await assert.rejects(()=>core.ensureAudioUnlocked(ctx),err=>{
    assert.ok(/unavailable/i.test(err.message),'message should mention unavailable');
    assert.ok(/suspended/i.test(err.message),`message should include state, got: ${err.message}`);
    return true;
  });
});

