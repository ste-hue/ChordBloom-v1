import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

export async function loadCore(){
  const html=await readFile(new URL('../../src/index.html',import.meta.url),'utf8');
  const m=html.match(/<script>([\s\S]*)<\/script>/);
  if(!m) throw new Error('No inline <script> block found in src/index.html');
  const context=vm.createContext({console,TextEncoder,crypto});
  vm.runInContext(m[1],context,{filename:'chordbloom-inline-script.js'});
  if(!context.__ChordBloomCore) throw new Error('__ChordBloomCore missing — headless load failed');
  const core=context.__ChordBloomCore;
  // requestSpend resolves with a plain object literal built inside the vm context, so it
  // carries that context's own Object.prototype. structuredClone rebuilds it against this
  // realm's intrinsics so assert.deepEqual (strict) can compare it to a host object literal.
  const rawRequestSpend=core.requestSpend;
  core.requestSpend=async(...args)=>structuredClone(await rawRequestSpend(...args));
  return core;
}
