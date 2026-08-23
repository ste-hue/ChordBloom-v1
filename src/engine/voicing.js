import {mod, midiName} from './theory.js';
function nearestPitch(pc,target){ let n=Math.round((target-pc)/12)*12+pc; while(n<0)n+=12; while(n>127)n-=12; return n; }
function uniqueSorted(a){return [...new Set(a)].sort((x,y)=>x-y)}
export class VoicingEngine{
  generate(chord,{previous=null,spread=50,smoothness=75,register=60,topVoice='Smooth',bassMovement='Auto'}={}){
    const pcs=chord.pitchClasses;
    const candidates=[];
    for(let inv=0;inv<Math.min(pcs.length,4);inv++){
      for(const baseShift of [-12,0,12]){
        let notes=[]; let center=register+baseShift;
        for(let i=0;i<pcs.length;i++){
          let pc=pcs[(i+inv)%pcs.length], target=center+(i-(pcs.length-1)/2)*(spread/100*9+3);
          let n=nearestPitch(pc,target); notes.push(n);
        }
        notes=uniqueSorted(notes);
        while(notes.length<pcs.length){ const n=notes.at(-1)+12; if(n<=127)notes.push(n); else break; }
        if(spread>68 && notes.length>=4){notes[1]-=12;notes=uniqueSorted(notes)}
        if(spread>88 && notes.length>=5){notes[2]+=12;notes=uniqueSorted(notes)}
        if(notes.some(n=>n<24||n>108)) continue;
        const cost=this.score(notes,previous?.voicing||null,{smoothness,register,topVoice}); candidates.push({notes,cost,inversion:inv});
      }
    }
    candidates.sort((a,b)=>a.cost-b.cost); const best=candidates[0]||{notes:pcs.map((pc,i)=>nearestPitch(pc,register+i*4)),inversion:0,cost:0};
    const bassPc=best.notes[0]%12; const bassName=midiName(best.notes[0], chord.symbol.replace(/[^A-G#b].*$/,''));
    return {...chord,voicing:best.notes,bassPc,bassName,inversion:best.inversion,voicingCost:best.cost,pitches:best.notes.map(n=>midiName(n))};
  }
  score(notes,prev,{smoothness,register,topVoice}){
    let cost=notes.reduce((a,n)=>a+Math.abs(n-register)*.05,0);
    if(prev?.length){
      const a=[...notes], b=[...prev];
      let movement=0, maxLeap=0, common=0;
      for(const n of a){ const d=Math.min(...b.map(p=>Math.abs(n-p))); movement+=d; maxLeap=Math.max(maxLeap,d); if(b.some(p=>p===n)) common++; }
      cost += movement*(.25+smoothness/100*1.25) + maxLeap*(smoothness/100*.5) - common*3*(smoothness/100);
      if(topVoice==='Smooth') cost += Math.abs(a.at(-1)-b.at(-1))*1.5;
      if(topVoice==='Ascending' && a.at(-1)<b.at(-1)) cost+=12;
      if(topVoice==='Descending' && a.at(-1)>b.at(-1)) cost+=12;
      if(topVoice==='Pedal') cost+=Math.abs(a.at(-1)-b.at(-1))*3;
    }
    for(let i=1;i<notes.length;i++) if(notes[i]<=notes[i-1]) cost+=50;
    return cost;
  }
}
export function voiceLeadingDistance(a,b){ if(!a?.length||!b?.length)return 0; return b.reduce((sum,n)=>sum+Math.min(...a.map(p=>Math.abs(n-p))),0); }
