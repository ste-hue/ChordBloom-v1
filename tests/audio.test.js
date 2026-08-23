import test from 'node:test';
import assert from 'node:assert/strict';
import {activateAudioContext} from '../src/audio.js';

test('resumes a suspended AudioContext before scheduling sound',async()=>{
  let resumed=false;
  const context={
    state:'suspended',
    async resume(){
      resumed=true;
      this.state='running';
    }
  };

  const result=await activateAudioContext(context);

  assert.equal(result,context);
  assert.equal(resumed,true);
  assert.equal(context.state,'running');
});

test('does not resume an already running AudioContext',async()=>{
  let resumeCalls=0;
  const context={
    state:'running',
    async resume(){
      resumeCalls++;
    }
  };

  await activateAudioContext(context);

  assert.equal(resumeCalls,0);
});
