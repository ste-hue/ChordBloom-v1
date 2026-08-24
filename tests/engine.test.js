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
