import {RNG} from './random.js';
import {SCALES, STYLES, MOODS} from './music-data.js';
import {buildDiatonicChord, chromaticCandidate, scalePcs} from './theory.js';
import {VoicingEngine, voiceLeadingDistance} from './voicing.js';

const TEMPLATES={
  major:[[0,3,4,0],[0,5,3,4],[5,3,0,4],[0,4,5,3],[0,1,4,0],[0,3,5,4]],
  minor:[[0,5,2,6],[0,6,5,6],[0,3,6,0],[0,5,3,4],[0,3,4,0],[0,1,4,0]],
  modal:[[0,6,3,0],[0,1,6,0],[0,3,1,0],[0,5,6,0]]
};

export class HarmonyEngine{
  constructor(){this.voicer=new VoicingEngine()}
  generate(settings,current=[]){
    const rng=new RNG(settings.seed), len=Number(settings.length||4), scaleName=settings.scale;
    const isMinor=/Minor|Dorian|Phrygian|Locrian|Altered/.test(scaleName), modal=!/Major|Minor/.test(scaleName);
    const bank=modal?TEMPLATES.modal:isMinor?TEMPLATES.minor:TEMPLATES.major;
    let template=rng.pick(bank); let degrees=Array.from({length:len},(_,i)=>template[i%template.length]);
    if(settings.cadence==='Strong Resolution' && len>=2){degrees[len-2]=4;degrees[len-1]=0}
    if(settings.cadence==='No Resolution' && len>=1 && degrees[len-1]===0)degrees[len-1]=5;
    const result=[];
    for(let i=0;i<len;i++){
      if(current[i]?.locked){result.push(structuredClone(current[i]));continue;}
      const nextDeg=degrees[(i+1)%len];
      const chord=this.chooseCandidate({i,degree:degrees[i],nextDegree:nextDeg,settings,rng,previous:result[i-1]||null,isLast:i===len-1,first:result[0]||null});
      result.push(chord);
    }
    if(settings.loopFriendly && result.length>2){
      result[result.length-1]=this.improveLoopLast(result,settings,rng,current[result.length-1]?.locked);
    }
    return result;
  }
  chooseCandidate({i,degree,nextDegree,settings,rng,previous,isLast,first}){
    const style=STYLES[settings.style]||STYLES.HOUSE, mood=MOODS[settings.mood]||MOODS.Dreamy;
    const adv=Number(settings.adventurous||0), complexity=Number(settings.complexity||50), tension=Number(settings.tension||50);
    const candidates=[];
    for(let d=0;d<7;d++){
      const c=buildDiatonicChord({root:settings.key,scale:settings.scale,degree:d,complexity});
      candidates.push({c,score:this.harmonicScore(c,{desiredDegree:degree,nextDegree,previous,settings,style,mood,i})});
    }
    if(adv>=25 && nextDegree!=null){ const c=chromaticCandidate('secondaryDominant',{root:settings.key,scale:settings.scale,targetDegree:nextDegree,tension}); candidates.push({c,score:this.harmonicScore(c,{desiredDegree:degree,nextDegree,previous,settings,style,mood,i})+adv*.12}); }
    if(adv>=38){ const c=chromaticCandidate('borrowedIv',{root:settings.key,scale:settings.scale,tension}); candidates.push({c,score:this.harmonicScore(c,{desiredDegree:degree,nextDegree,previous,settings,style,mood,i})+style.chromatic*10+mood.modal*6}); }
    if(adv>=58 && (nextDegree===0||isLast)){ for(const type of ['tritoneSub','backdoor']){const c=chromaticCandidate(type,{root:settings.key,scale:settings.scale,tension});c&&candidates.push({c,score:this.harmonicScore(c,{desiredDegree:degree,nextDegree,previous,settings,style,mood,i})+adv*.1});}}
    if(adv>=68 && nextDegree!=null){ const c=chromaticCandidate('dimApproach',{root:settings.key,scale:settings.scale,targetDegree:nextDegree,tension}); candidates.push({c,score:this.harmonicScore(c,{desiredDegree:degree,nextDegree,previous,settings,style,mood,i})+tension*.08}); }
    if(adv>=82 && (style===STYLES.CINEMATIC || settings.style==='ROMANTIC' || settings.style==='JAZZY')){ const c=chromaticCandidate('neapolitan',{root:settings.key,scale:settings.scale,tension}); candidates.push({c,score:this.harmonicScore(c,{desiredDegree:degree,nextDegree,previous,settings,style,mood,i})+8}); }
    const bestPool=candidates.sort((a,b)=>b.score-a.score).slice(0,Math.min(4,candidates.length));
    const selected=rng.weighted(bestPool.map((x,idx)=>({value:x.c,weight:Math.max(.3,4-idx*1.05)})));
    const voiced=this.voicer.generate(selected,{previous,spread:Number(settings.spread||50),smoothness:Number(settings.voiceLeading||75),register:style.register,topVoice:settings.topVoice||'Smooth',bassMovement:settings.bassMovement||'Auto'});
    voiced.locked=false; voiced.id=`${settings.seed}-${i}-${Math.floor(rng.next()*1e7)}`; voiced.explanation=this.explain(voiced,previous,nextDegree,settings); return voiced;
  }
  harmonicScore(c,{desiredDegree,nextDegree,previous,settings,style,mood,i}){
    let s=0;
    if(c.degree===desiredDegree)s+=22;
    const fn=c.function;
    if(previous){
      const pf=previous.function;
      if(pf==='TONIC'&&fn==='PREDOMINANT')s+=9;
      if(pf==='PREDOMINANT'&&fn==='DOMINANT')s+=12;
      if((pf==='DOMINANT'||pf==='DOMINANT SUBSTITUTE')&&fn==='TONIC')s+=15;
      if(previous.rootPc===c.rootPc)s-=7;
    }
    const desiredTension=this.tensionTarget(i,Number(settings.length||4),settings.tensionCurve||'Build → Peak → Resolve',Number(settings.tension||50));
    s-=Math.abs((c.tension||40)-desiredTension)*.12;
    s+=style.extensions*(c.pitchClasses.length-3)*3 + style.chromatic*(c.source==='Diatonic'?0:8) + mood.tension*(c.tension||0)*.025;
    if(settings.loopFriendly)s+=style.loop*2;
    if(nextDegree===0 && ['DOMINANT','DOMINANT SUBSTITUTE','CHROMATIC APPROACH'].includes(fn))s+=7;
    return s;
  }
  tensionTarget(i,len,curve,base){ const x=len<=1?0:i/(len-1); if(curve==='Flat')return base; if(curve==='Calm → Build')return Math.min(100,base*.55+x*50); if(curve==='Immediate Tension')return Math.max(base,78-x*25); if(curve==='Long Resolution')return i===len-1?25:Math.min(90,base+20); if(curve==='Wave')return Math.min(100,base+Math.sin(x*Math.PI*2)*25); return Math.min(100, i===len-1?Math.max(20,base-25):base+Math.sin(x*Math.PI)*30); }
  improveLoopLast(result,settings,rng,isLocked){ if(isLocked)return result.at(-1); const prev=result.at(-2), first=result[0]; const options=[]; for(let d=0;d<7;d++){const base=buildDiatonicChord({root:settings.key,scale:settings.scale,degree:d,complexity:settings.complexity});const v=this.voicer.generate(base,{previous:prev,spread:settings.spread,smoothness:settings.voiceLeading,register:(STYLES[settings.style]||STYLES.HOUSE).register,topVoice:settings.topVoice}); const cost=voiceLeadingDistance(v.voicing,first.voicing)+voiceLeadingDistance(prev.voicing,v.voicing);options.push({v,cost});} const best=options.sort((a,b)=>a.cost-b.cost)[0].v;best.id=`${settings.seed}-loop-${rng.int(1,999999)}`;best.locked=false;best.explanation=this.explain(best,prev,0,settings)+' Optimized for the return to the first chord.';return best; }
  alternative(index,settings,progression){ const clone=progression.map(x=>structuredClone(x)); const prev=clone[index-1]||null,next=clone[index+1]||clone[0]||null; const rng=new RNG((settings.seed+index*9973+Date.now()%997)|0); const candidates=[]; for(let d=0;d<7;d++){const c=buildDiatonicChord({root:settings.key,scale:settings.scale,degree:d,complexity:settings.complexity}); if(c.rootPc===clone[index]?.rootPc)continue; const v=this.voicer.generate(c,{previous:prev,spread:settings.spread,smoothness:settings.voiceLeading,register:(STYLES[settings.style]||STYLES.HOUSE).register,topVoice:settings.topVoice}); let score=0;if(next)score-=voiceLeadingDistance(v.voicing,next.voicing);if(prev)score-=voiceLeadingDistance(prev.voicing,v.voicing); if(v.function===clone[index]?.function)score+=8;candidates.push({v,score});} const best=candidates.sort((a,b)=>b.score-a.score).slice(0,3);const chosen=rng.pick(best).v;chosen.locked=false;chosen.id=`alt-${Date.now()}-${index}`;chosen.explanation=this.explain(chosen,prev,next?.degree,settings);clone[index]=chosen;return clone; }
  moreLikeThis(settings,progression){ const next=progression.map(x=>({...structuredClone(x),locked:x.locked||false})); const rng=new RNG(settings.seed^0x9e3779b9); for(let i=0;i<next.length;i++){if(next[i].locked)continue;if(rng.next()<.32)next[i]=this.alternative(i,{...settings,complexity:Math.min(100,Number(settings.complexity)+8)},next)[i];else next[i]=this.voicer.generate(next[i],{previous:next[i-1],spread:Math.min(100,Number(settings.spread)+rng.int(-10,10)),smoothness:settings.voiceLeading,register:(STYLES[settings.style]||STYLES.HOUSE).register+rng.int(-3,3),topVoice:settings.topVoice});}return next; }
  explain(chord,prev,nextDegree,settings){ let txt=`${chord.roman} functions as ${chord.function.toLowerCase().replaceAll('_',' ')}.`; if(chord.source==='Modal Interchange')txt+=` It is borrowed from the parallel minor, adding modal color.`; if(chord.source==='Secondary Dominant')txt+=` It tonicizes the following scale degree as an applied dominant.`; if(chord.source==='Tritone Substitution')txt+=` It substitutes for V7 while preserving the dominant tritone.`; if(chord.source==='Backdoor Dominant')txt+=` It approaches tonic through the backdoor bVII dominant sound.`; if(chord.source==='Diminished Passing Chord')txt+=` Its diminished symmetry creates semitone approach motion.`; if(prev){const common=chord.voicing?.filter(n=>prev.voicing?.includes(n)).length||0;if(common)txt+=` ${common} common tone${common>1?'s are':' is'} retained for continuity.`;} return txt; }
}

export function allChordPcsAreDiatonic(prog,key,scale){const set=new Set(scalePcs(key,scale));return prog.every(c=>c.pitchClasses.every(pc=>set.has(pc)));}
