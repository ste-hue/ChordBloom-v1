import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './helpers/load-core.js';

const core=await loadCore();
const {shouldShowHelp,clampTooltipPos}=core;

test('desktop hover can open help',()=>{
  assert.equal(shouldShowHelp({hoverCapable:true,helpMode:false,trigger:'hover'}),true);
});

test('desktop keyboard focus can open help',()=>{
  assert.equal(shouldShowHelp({hoverCapable:true,helpMode:false,trigger:'focus'}),true);
});

test('desktop taps never route through help interception',()=>{
  assert.equal(shouldShowHelp({hoverCapable:true,helpMode:false,trigger:'tap'}),false);
  assert.equal(shouldShowHelp({hoverCapable:true,helpMode:true,trigger:'tap'}),false);
});

test('touch interaction does not automatically open help',()=>{
  assert.equal(shouldShowHelp({hoverCapable:false,helpMode:false,trigger:'hover'}),false);
  assert.equal(shouldShowHelp({hoverCapable:false,helpMode:false,trigger:'focus'}),false);
  assert.equal(shouldShowHelp({hoverCapable:false,helpMode:false,trigger:'tap'}),false);
});

test('touch help mode ON shows help only for explicit taps',()=>{
  assert.equal(shouldShowHelp({hoverCapable:false,helpMode:true,trigger:'tap'}),true);
  assert.equal(shouldShowHelp({hoverCapable:false,helpMode:true,trigger:'hover'}),false);
  assert.equal(shouldShowHelp({hoverCapable:false,helpMode:true,trigger:'focus'}),false);
});

test('tooltip position stays inside the viewport',()=>{
  const vw=390,vh=844,w=280,h=60;
  const nearRight=clampTooltipPos(vw-10,100,w,h,vw,vh);
  assert.ok(nearRight.left+w<=vw-14);
  const nearBottom=clampTooltipPos(20,vh-5,w,h,vw,vh);
  assert.ok(nearBottom.top+h<=vh-14);
  const offscreen=clampTooltipPos(-50,-50,w,h,vw,vh);
  assert.equal(offscreen.left,14);
  assert.equal(offscreen.top,14);
});
