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
  await assert.rejects(()=>core.activateAudioContext(context),/paused/i);
});

test('activateAudioContext retries interrupted context and then rejects if still paused',async()=>{
  let calls=0;
  const context={state:'interrupted',async resume(){calls++;}};
  await assert.rejects(()=>core.activateAudioContext(context),/paused/i);
  assert.equal(calls,2);
});
