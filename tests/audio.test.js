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
  await assert.rejects(()=>core.activateAudioContext(context),/paused.*state: suspended/i);
});

test('activateAudioContext retries interrupted context and then rejects if still paused',async()=>{
  let calls=0;
  const context={state:'interrupted',async resume(){calls++;}};
  await assert.rejects(()=>core.activateAudioContext(context),/paused.*state: interrupted/i);
  assert.equal(calls,2);
});

function unlockableContext(overrides={}){
  const played=[];
  return {
    state:'running',
    sampleRate:44100,
    played,
    createBuffer(){return {silent:true};},
    createBufferSource(){const src={buffer:null,connect(){},start(){played.push(src.buffer);}};return src;},
    destination:{},
    ...overrides
  };
}

test('ensureAudioUnlocked plays a silent buffer once and marks the context unlocked',async()=>{
  const context=unlockableContext();
  const result=await core.ensureAudioUnlocked(context);
  assert.equal(result,context);
  assert.equal(context._audioUnlocked,true);
  assert.equal(context._audioNeedsReactivation,false);
  assert.equal(context.played.length,1);
  await core.ensureAudioUnlocked(context);
  assert.equal(context.played.length,1);
});

test('ensureAudioUnlocked replays the silent buffer when reactivation is needed',async()=>{
  const context=unlockableContext();
  await core.ensureAudioUnlocked(context);
  context._audioNeedsReactivation=true;
  await core.ensureAudioUnlocked(context);
  assert.equal(context.played.length,2);
  assert.equal(context._audioNeedsReactivation,false);
});

test('ensureAudioUnlocked surfaces silent-buffer playback failures',async()=>{
  const context=unlockableContext({createBufferSource(){throw new Error('boom');}});
  await assert.rejects(()=>core.ensureAudioUnlocked(context),/could not be unlocked.*boom/i);
  assert.equal(context._audioNeedsReactivation,true);
  assert.notEqual(context._audioUnlocked,true);
});

test('ensureAudioUnlocked resumes a suspended context before unlocking',async()=>{
  let resumed=false;
  const context=unlockableContext({state:'suspended',async resume(){resumed=true;this.state='running';}});
  await core.ensureAudioUnlocked(context);
  assert.equal(resumed,true);
  assert.equal(context._audioUnlocked,true);
});

test('ensureAudioUnlocked rejects a closed context without touching buffers',async()=>{
  const context=unlockableContext({state:'closed'});
  await assert.rejects(()=>core.ensureAudioUnlocked(context),/closed/i);
  assert.equal(context.played.length,0);
});
