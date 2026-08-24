import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

export async function loadCore(){
  const html=await readFile(new URL('../../src/index.html',import.meta.url),'utf8');
  const m=html.match(/<script>([\s\S]*)<\/script>/);
  if(!m) throw new Error('No inline <script> block found in src/index.html');
  const context=vm.createContext({console,TextEncoder});
  vm.runInContext(m[1],context,{filename:'chordbloom-inline-script.js'});
  if(!context.__ChordBloomCore) throw new Error('__ChordBloomCore missing — headless load failed');
  return context.__ChordBloomCore;
}
