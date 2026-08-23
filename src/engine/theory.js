import {ROOT_TO_PC, NOTE_NAMES_FLAT, NOTE_NAMES_SHARP, SCALES} from './music-data.js';

const FLAT_KEYS = new Set(['F','Bb','Eb','Ab','Db','Gb']);
const DEGREE_ROMAN=['I','II','III','IV','V','VI','VII'];
export const mod=(n,m)=>((n%m)+m)%m;
export function noteName(pc,key='C'){ const flats=FLAT_KEYS.has(key)||key.includes('b'); return (flats?NOTE_NAMES_FLAT:NOTE_NAMES_SHARP)[mod(pc,12)]; }
export function midiName(n,key='C'){ return `${noteName(n%12,key)}${Math.floor(n/12)-1}`; }
export function scalePcs(root,scale){ const r=ROOT_TO_PC[root]; return SCALES[scale].map(i=>mod(r+i,12)); }
export function isPitchClassInScale(pc,root,scale){ return scalePcs(root,scale).includes(mod(pc,12)); }

export function diatonicStack(root,scale,degree,size=4){
  const pcs=scalePcs(root,scale), n=pcs.length;
  return Array.from({length:size},(_,i)=>pcs[(degree+i*2)%n]);
}
export function intervalsFromRoot(pcs){ const r=pcs[0]; return pcs.map(p=>mod(p-r,12)); }
export function qualityFromIntervals(ints){
  const s=new Set(ints);
  if(s.has(4)&&s.has(7)&&s.has(11)) return 'maj7';
  if(s.has(3)&&s.has(7)&&s.has(10)) return 'm7';
  if(s.has(4)&&s.has(7)&&s.has(10)) return '7';
  if(s.has(3)&&s.has(6)&&s.has(10)) return 'm7b5';
  if(s.has(3)&&s.has(6)&&s.has(9)) return 'dim7';
  if(s.has(4)&&s.has(7)) return '';
  if(s.has(3)&&s.has(7)) return 'm';
  if(s.has(3)&&s.has(6)) return 'dim';
  if(s.has(4)&&s.has(8)) return 'aug';
  return 'sus';
}
export function romanNumeral(degree,quality,accidental=''){
  let r=DEGREE_ROMAN[mod(degree,7)];
  if(quality.startsWith('m')||quality.startsWith('dim')) r=r.toLowerCase();
  if(quality==='dim'||quality==='dim7') r+='°';
  else if(quality==='m7b5') r+='ø7';
  else if(quality==='maj7') r+='maj7';
  else if(quality==='m7') r+='7';
  else if(quality==='7') r+='7';
  return accidental+r;
}
export function functionForDegree(degree,modeName='Major / Ionian'){
  const d=degree+1;
  if([1,3,6].includes(d)) return d===1?'TONIC':'TONIC PROLONGATION';
  if([2,4].includes(d)) return 'PREDOMINANT';
  if([5,7].includes(d)) return 'DOMINANT';
  return 'MODAL COLOR';
}
export function buildDiatonicChord({root,scale,degree,complexity=50}){
  const size=complexity>28?4:3; const pcs=diatonicStack(root,scale,degree,size); const ints=intervalsFromRoot(pcs); let quality=qualityFromIntervals(ints);
  let extension='';
  if(size===4) extension=quality;
  if(complexity>70 && size===4 && ['maj7','m7','7'].includes(quality)){
    const ninth=scalePcs(root,scale)[(degree+1)%scalePcs(root,scale).length]; pcs.push(ninth); extension=quality==='maj7'?'maj9':quality==='m7'?'m9':'9';
  }
  const symbol=noteName(pcs[0],root)+extension;
  return {rootPc:pcs[0], pitchClasses:[...new Set(pcs)], quality:extension||quality, symbol, degree, roman:romanNumeral(degree,extension||quality), function:functionForDegree(degree,scale), source:'Diatonic', sourceScale:`${root} ${scale}`, tension: Math.min(100, 18+degree*5+(size-3)*12+(complexity>70?14:0))};
}

export function chromaticCandidate(type,{root,scale,targetDegree=0,tension=60}){
  const tonic=ROOT_TO_PC[root], target=scalePcs(root,scale)[targetDegree%scalePcs(root,scale).length];
  if(type==='secondaryDominant'){
    const rp=mod(target+7,12), pcs=[rp,mod(rp+4,12),mod(rp+7,12),mod(rp+10,12)];
    return {rootPc:rp,pitchClasses:pcs,quality:'7',symbol:`${noteName(rp,root)}7`,degree:null,roman:`V/${DEGREE_ROMAN[targetDegree]}`,function:'DOMINANT',source:'Secondary Dominant',sourceScale:`Applied dominant to ${noteName(target,root)}`,tension:Math.max(55,tension)};
  }
  if(type==='tritoneSub'){
    const rp=mod(tonic+1,12), pcs=[rp,mod(rp+4,12),mod(rp+7,12),mod(rp+10,12)];
    return {rootPc:rp,pitchClasses:pcs,quality:'7',symbol:`${noteName(rp,root)}7`,degree:null,roman:'bII7',function:'DOMINANT SUBSTITUTE',source:'Tritone Substitution',sourceScale:'Substitution for V7',tension:Math.max(68,tension)};
  }
  if(type==='borrowedIv'){
    const rp=mod(tonic+5,12), pcs=[rp,mod(rp+3,12),mod(rp+7,12),mod(rp+10,12)];
    return {rootPc:rp,pitchClasses:pcs,quality:'m7',symbol:`${noteName(rp,root)}m7`,degree:3,roman:'iv7',function:'MODAL COLOR',source:'Modal Interchange',sourceScale:`borrowed from ${root} minor`,tension:48};
  }
  if(type==='backdoor'){
    const rp=mod(tonic+10,12), pcs=[rp,mod(rp+4,12),mod(rp+7,12),mod(rp+10,12)];
    return {rootPc:rp,pitchClasses:pcs,quality:'7',symbol:`${noteName(rp,root)}7`,degree:null,roman:'bVII7',function:'DOMINANT SUBSTITUTE',source:'Backdoor Dominant',sourceScale:`backdoor resolution to ${root}`,tension:62};
  }
  if(type==='dimApproach'){
    const rp=mod(target-1,12), pcs=[rp,mod(rp+3,12),mod(rp+6,12),mod(rp+9,12)];
    return {rootPc:rp,pitchClasses:pcs,quality:'dim7',symbol:`${noteName(rp,root)}dim7`,degree:null,roman:'ct°7',function:'CHROMATIC APPROACH',source:'Diminished Passing Chord',sourceScale:`chromatic approach to ${noteName(target,root)}`,tension:76};
  }
  if(type==='neapolitan'){
    const rp=mod(tonic+1,12), pcs=[rp,mod(rp+4,12),mod(rp+7,12)];
    return {rootPc:rp,pitchClasses:pcs,quality:'',symbol:noteName(rp,root),degree:null,roman:'bII',function:'PREDOMINANT',source:'Neapolitan',sourceScale:'Chromatic predominant',tension:72};
  }
  return null;
}
