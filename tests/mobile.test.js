/**
 * Mobile action-bar tests: Save/Undo/Redo/Reset are reachable through the
 * "⋯" quick-actions sheet, the sheet toggles and closes after use, and
 * setStatus mirrors into the mobile status line above the bar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/load-app.js';

const names=core=>core.state.progression.map(c=>c.name).join(' ');

test('mobile Save button saves a favorite', async()=>{
  const app=await loadApp();
  app.core.generate('apply');
  app.$('mabSaveBtn').dispatch('click');
  const favs=JSON.parse(app.storage.get('chordarium.favorites')||'[]');
  assert.equal(favs.length,1,'one favorite should be stored');
  assert.equal(favs[0].snapshot.progression.map(c=>c.name).join(' '),names(app.core));
});

test('mobile Undo/Redo mirror the desktop history', async()=>{
  const app=await loadApp();
  app.core.generate('apply');
  const before=names(app.core);
  app.$('style').value='HOUSE'; app.$('style').dispatch('change');
  app.$('generateBtn').dispatch('click');
  const applied=names(app.core);
  assert.notEqual(applied,before,'apply should change the progression');
  app.$('mabUndoBtn').dispatch('click');
  assert.equal(names(app.core),before,'mobile undo must restore the previous progression');
  app.$('mabRedoBtn').dispatch('click');
  assert.equal(names(app.core),applied,'mobile redo must reapply the change');
});

test('mobile Reset restores default controls', async()=>{
  const app=await loadApp();
  app.core.generate('apply');
  app.$('complexity').value='99'; app.$('complexity').dispatch('change');
  app.$('mabResetBtn').dispatch('click');
  assert.equal(app.$('complexity').value,String(app.core.DEFAULTS.complexity),'reset must restore the default complexity');
  assert.ok(app.core.state.progression.length>0);
});

test('the ⋯ button toggles the quick-actions sheet and actions close it', async()=>{
  const app=await loadApp();
  app.core.generate('apply');
  const more=app.$('mabMore'), btn=app.$('mabMoreBtn');
  assert.equal(more.hidden,true,'sheet starts closed');
  btn.dispatch('click');
  assert.equal(more.hidden,false,'first tap opens the sheet');
  assert.equal(btn.getAttribute('aria-expanded'),'true');
  btn.dispatch('click');
  assert.equal(more.hidden,true,'second tap closes the sheet');
  assert.equal(btn.getAttribute('aria-expanded'),'false');
  btn.dispatch('click');
  app.$('mabSaveBtn').dispatch('click');
  assert.equal(more.hidden,true,'using an action closes the sheet');
});

test('setStatus mirrors into the mobile status line', async()=>{
  const app=await loadApp();
  app.core.generate('apply');
  app.$('mabStopBtn').dispatch('click');
  assert.equal(app.$('status').textContent,'Stopped.');
  assert.equal(app.$('mabStatus').textContent,'Stopped.','mobile status line must mirror setStatus');
});
