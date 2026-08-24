/**
 * Headless harness for the interaction-state layer.
 *
 * Loads the full inline <script> from src/index.html inside node:vm with a
 * minimal fake DOM. document.readyState stays 'loading' and DOMContentLoaded
 * is never fired, so init() never runs; the harness pre-creates the control
 * elements (seeded from an id→value map mirroring DEFAULTS) and calls
 * core.bindUI() itself, so the real event wiring is exercised via el.dispatch().
 */
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

function makeClassList(){
  const set=new Set();
  return {
    add:c=>set.add(c), remove:c=>set.delete(c), contains:c=>set.has(c),
    toggle(c,f){ const on=f===undefined?!set.has(c):!!f; on?set.add(c):set.delete(c); return on; }
  };
}

export function makeEl(id='',{type='',value='',checked=false,dataset={}}={}){
  const listeners={};
  const el={
    id,type,value,checked,dataset,title:'',textContent:'',innerHTML:'',hidden:false,className:'',
    style:{}, children:[], clientWidth:1200, clientHeight:320,
    classList:makeClassList(),
    addEventListener(t,fn){ (listeners[t] ||= []).push(fn); },
    removeEventListener(){},
    dispatch(t){ const ev={target:el,persisted:false,clientX:0,clientY:0}; (listeners[t]||[]).forEach(fn=>fn(ev)); if(typeof el['on'+t]==='function') el['on'+t](ev); },
    appendChild(c){ el.children.push(c); return c; },
    querySelector(){ return makeEl(); },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    setAttribute(k,v){ el['_attr_'+k]=v; },
    getAttribute(k){ return el['_attr_'+k]??null; },
    getContext(){ return new Proxy({},{get:(t,p)=>p in t?t[p]:()=>{},set:(t,p,v)=>{t[p]=v;return true;}}); }
  };
  return el;
}

// Mirrors DEFAULTS in src/index.html (booleans become checkboxes).
const CONTROL_DEFAULTS = {
  key:'C', scale:'Natural Minor / Aeolian', style:'ELECTRONICA', mood:'Dreamy', count:'4', bpm:'124',
  complexity:'42', tension:'18', adventure:'6', spread:'44', voiceLeading:'100', generationMode:'CHORDS', cadence:'Auto',
  tensionCurve:'Flat', loopFriendly:true, theoryPalette:'Electronic Loop', pedal:'Off', bassMovement:'Auto', topVoice:'Smooth',
  voicingMode:'Auto', register:'Mid', avoidCrossing:true, counterpointAware:true, grid:'1/16', articulation:'Normal', chordPerformance:'NATURAL PLAY',
  harmonicRhythm:'Fixed', rhythmPattern:'Straight', swing:'50', minLen:'1', maxLen:'4', humanize:'0', chordBeats:'4',
  arpPattern:'Up', arpOctaves:'2', crazyArp:false, crazyArpAmount:'62', crazyCycle:'Auto', crazyContinuous:true, strumDirection:'Up', strumWidth:'24', velocityMode:'Dynamic', minVelocity:'78', maxVelocity:'101',
  mpeEnabled:false, mpePower:'35', mpeMode:'NATURAL', mpeBendRange:'48', mpeGlide:'38', mpeVibrato:'16', mpeTimbre:'56', mpePressure:'48', mpeCommonToneHold:true, mpeTheoryAware:true,
  exportMode:'Pattern (single track)', seed:'1979', showTheory:false
};

const EXTRA_IDS = ['generateBtn','mabGenerateBtn','similarBtn','newSeedBtn','playBtn','stopBtn','downloadBtn','undoBtn','redoBtn','saveFavBtn','resetBtn','copyTheoryBtn','simpleViewBtn','expertViewBtn','pendingDirection','status','progression','progressionTitle','durationLabel','pianoRoll','theoryExplanation','favorites','mpeInline'];

export async function loadApp(){
  const html=await readFile(new URL('../../src/index.html',import.meta.url),'utf8');
  const m=html.match(/<script>([\s\S]*?)<\/script>/i);
  if(!m) throw new Error('No inline <script> block found in src/index.html');

  const els=new Map();
  const techEls=[];
  for(const [id,v] of Object.entries(CONTROL_DEFAULTS)){
    const checkbox=typeof v==='boolean';
    els.set(id,makeEl(id,{type:checkbox?'checkbox':'range',value:checkbox?'':String(v),checked:checkbox?v:false}));
  }
  for(const id of EXTRA_IDS) els.set(id,makeEl(id));

  const document={
    readyState:'loading',
    body:makeEl('body'),
    getElementById:id=>els.get(id)||null,
    createElement:tag=>makeEl('',{type:tag==='input'?'checkbox':''}),
    querySelectorAll:sel=>{
      if(sel==='select,input') return [...els.values()].filter(e=>e.type);
      if(sel.includes('data-tech')) return techEls;
      return [];
    },
    addEventListener(){}
  };
  const storage=new Map();
  const window={
    addEventListener(){},
    matchMedia:()=>({matches:false}),
    devicePixelRatio:1,
    localStorage:{
      getItem:k=>storage.has(k)?storage.get(k):null,
      setItem:(k,v)=>storage.set(k,String(v)),
      removeItem:k=>storage.delete(k)
    }
  };

  const context=vm.createContext({console,TextEncoder,crypto,setTimeout,clearTimeout,document,window});
  vm.runInContext(m[1],context,{filename:'chordbloom-inline-script.js'});
  const core=context.__ChordBloomCore;
  if(!core) throw new Error('__ChordBloomCore missing — headless app load failed');

  // Register the theory-technique checkboxes (in the browser initControls builds them).
  core.THEORY_TECHNIQUES.forEach(([id])=>{
    const cb=makeEl('',{type:'checkbox',checked:true,dataset:{tech:id}});
    techEls.push(cb);
  });

  core.bindUI();
  return {core,els,techEls,storage,$:id=>els.get(id)||null};
}
