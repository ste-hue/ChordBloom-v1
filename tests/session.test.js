/**
 * Session persistence tests: every refreshAll writes the current snapshot to
 * localStorage ('chordarium.session'), and bootSession() restores it at startup
 * (falling back to a fresh generate when the store is empty or corrupt).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/load-app.js';

const names=core=>core.state.progression.map(c=>c.name).join(' ');

test('refreshAll persists the current session snapshot to localStorage', async()=>{
  const app=await loadApp();
  app.core.generate('apply');
  const raw=app.storage.get('chordarium.session');
  assert.ok(raw,'chordarium.session should be written after generate/refreshAll');
  const data=JSON.parse(raw);
  assert.equal(data.snapshot.progression.length,app.core.state.progression.length);
  assert.equal(data.snapshot.progression.map(c=>c.name).join(' '),names(app.core));
  assert.equal(data.snapshot.controls.seed,app.$('seed').value);
});

test('bootSession restores the saved session across app loads', async()=>{
  const storage=new Map();
  const first=await loadApp({storage});
  first.$('seed').value='424242'; first.$('style').value='HOUSE';
  first.core.generate('apply');
  const saved=names(first.core);
  const second=await loadApp({storage});
  assert.equal(second.core.bootSession(),true,'bootSession should report a restored session');
  assert.equal(names(second.core),saved,'restored progression must match the saved one');
  assert.equal(second.$('seed').value,'424242');
  assert.equal(second.$('style').value,'HOUSE');
});

test('bootSession generates fresh when nothing is stored', async()=>{
  const app=await loadApp();
  assert.equal(app.core.bootSession(),false);
  assert.ok(app.core.state.progression.length>0,'fallback must still produce a progression');
});

test('bootSession survives corrupt session JSON', async()=>{
  const storage=new Map([['chordarium.session','{not json']]);
  const app=await loadApp({storage});
  assert.equal(app.core.bootSession(),false);
  assert.ok(app.core.state.progression.length>0);
});
