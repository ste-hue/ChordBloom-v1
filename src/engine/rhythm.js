import {RHYTHM_GRIDS} from './music-data.js';
const PPQ=480;
export class RhythmEngine{
  render(progression,settings){
    const grid=RHYTHM_GRIDS[settings.grid]||120, mode=settings.generationMode||'CHORDS', events=[];
    let cursor=0; const chordGridUnits=this.chordDurations(progression.length,settings);
    progression.forEach((chord,ci)=>{
      const dur=chordGridUnits[ci]*grid, start=cursor; const notes=chord.voicing||[];
      const emit=(n,s,d,v=96,track='Chords')=>events.push({note:n,start:Math.max(0,Math.round(s)),duration:Math.max(1,Math.round(d)),velocity:Math.max(1,Math.min(127,Math.round(v))),track,chordIndex:ci});
      if(mode==='CHORDS'){
        const gate=this.gate(dur,grid,settings); notes.forEach((n,ni)=>emit(n,start,gate,this.velocity(ci,ni,settings)));
      } else if(mode==='RHYTHMIC CHORDS'){
        for(const off of this.patternOffsets(dur,grid,settings.rhythmPattern||'House')){const gate=this.gate(grid,grid,settings);notes.forEach((n,ni)=>emit(n,start+off,gate,this.velocity(ci+off/grid,ni,settings)));}
      } else if(mode==='ARPEGGIO'){
        const seq=this.arpSequence(notes,settings.arpPattern||'Up',Number(settings.arpOctaves||1)); let k=0; for(let off=0;off<dur;off+=grid){const n=seq[k++%seq.length];emit(n,start+off,this.gate(grid,grid,settings),this.velocity(k,0,settings),'Arpeggio');}
      } else if(mode==='BROKEN CHORDS'){
        const groups=[notes.filter((_,i)=>i%2===0),notes.filter((_,i)=>i%2===1)];let k=0;for(let off=0;off<dur;off+=grid*2){for(const n of groups[k++%2])emit(n,start+off,this.gate(grid*2,grid,settings),this.velocity(ci,k,settings));}
      } else if(mode==='STRUM'){
        const ordered=(settings.strumMode==='Down'?[...notes].reverse():notes); const step=Math.max(1,Math.round(grid*Math.min(.5,Number(settings.strumWidth||25)/100))); ordered.forEach((n,ni)=>emit(n,start+ni*step,Math.max(grid,dur-ni*step),this.velocity(ci,ni,settings)));
      } else if(mode==='PULSE'){
        const pulseNotes=notes.length?[notes[0],notes.at(-1)]:[];for(let off=0;off<dur;off+=grid){for(const n of pulseNotes)emit(n,start+off,this.gate(grid,grid,settings),this.velocity(ci+off/grid,0,settings),'Arpeggio');}
      }
      cursor+=dur;
    });
    const swung=events.map(e=>this.applySwing(e,grid,settings));
    return this.normalize(swung,grid,settings);
  }
  chordDurations(len,settings){ const base=Math.max(1,Number(settings.chordGridUnits||8)); if(settings.harmonicRhythm==='Fixed')return Array(len).fill(base); return Array.from({length:len},(_,i)=>{if(settings.harmonicRhythm==='Slow → Fast')return Math.max(2,base-Math.floor(i/2));if(settings.harmonicRhythm==='Fast → Slow')return base+Math.floor(i/2);if(settings.harmonicRhythm==='Tension Driven')return i===len-1?base*2:Math.max(2,base-Math.floor(i%3));return Math.max(2,base+((i%3)-1)*2);}); }
  gate(slot,grid,s){ const art=s.articulation||'Normal'; let units=Math.max(1,Math.round(slot/grid)); let mult={Legato:1,Normal:.9,Tenuto:.98,Staccato:.5,Short:.3}[art]??.9; if(art==='Varied On-Grid'){const min=Math.max(1,Number(s.minNoteLength||1)),max=Math.max(min,Number(s.maxNoteLength||4));const span=max-min+1;units=min+((units*7)%span);return Math.max(grid,Math.min(slot,units*grid));} return Math.max(1,Math.round(slot*mult/grid)*grid); }
  patternOffsets(dur,grid,p){const slots=Math.floor(dur/grid),out=[];for(let i=0;i<slots;i++){if(p==='Straight'||p==='Dense')out.push(i*grid);else if(p==='Offbeat'||p==='House Stabs'||p==='House'){if(i%2===1)out.push(i*grid);}else if(p==='3-3-2 / Tresillo'){if([0,3,6].includes(i%8))out.push(i*grid);}else if(p==='Sparse'){if(i%4===0)out.push(i*grid);}else if(p==='Garage'||p==='Syncopated'){if([1,4,6].includes(i%8))out.push(i*grid);}else if(p.startsWith('Euclidean')){const hits=p.includes('5/8')?5:3;if((i*hits)%8<hits)out.push(i*grid);}else if(i%2===0)out.push(i*grid);}return out.length?out:[0];}
  arpSequence(notes,pattern,octaves){let pool=[];for(let o=0;o<octaves;o++)for(const n of notes){const x=n+o*12;if(x<=127)pool.push(x);}pool=[...new Set(pool)].sort((a,b)=>a-b);if(pattern==='Down')return [...pool].reverse();if(pattern==='Up/Down')return [...pool,...pool.slice(1,-1).reverse()];if(pattern==='Down/Up'){const d=[...pool].reverse();return [...d,...d.slice(1,-1).reverse()];}if(pattern==='Outside → In'){const out=[];let l=0,r=pool.length-1;while(l<=r){out.push(pool[l++]);if(l<=r)out.push(pool[r--]);}return out;}if(pattern==='Inside → Out'){const mid=Math.floor((pool.length-1)/2),out=[];for(let d=0;d<pool.length;d++){const a=mid-d,b=mid+1+d;if(a>=0)out.push(pool[a]);if(b<pool.length)out.push(pool[b]);}return out;}if(pattern==='Alternate')return pool.flatMap((n,i)=>i+1<pool.length?[n,pool.at(-(i+1))]:[n]);return pool;}
  applySwing(e,grid,s){const sw=Number(s.swing||0);if(sw<=50)return e;const idx=Math.round(e.start/grid);if(idx%2===1){const delay=Math.round(grid*((sw-50)/50)*.5);return {...e,start:e.start+delay};}return e;}
  velocity(i,n,s){const min=Number(s.minVelocity||80),max=Number(s.maxVelocity||112);if(s.velocityMode==='Fixed Velocity')return Math.round((min+max)/2);if(s.velocityMode==='Accent Pattern')return i%4===0?max:min+8;if(s.velocityMode==='Dynamic')return Math.round(min+(max-min)*(0.5+0.5*Math.sin(i*.8+n)));return min+((i*17+n*13)%(Math.max(1,max-min+1)));}
  normalize(events,grid,s){return events.map(e=>({...e,note:Math.max(0,Math.min(127,e.note)),duration:Math.max(1,e.duration)})).sort((a,b)=>a.start-b.start||a.note-b.note);}
}
export {PPQ};
