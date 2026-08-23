import {PPQ} from './rhythm.js';
const ascii=s=>Array.from(new TextEncoder().encode(s));
const u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]; const u16=n=>[(n>>>8)&255,n&255];
function vlq(n){n=Math.max(0,Math.floor(n));let b=n&0x7f,out=[];while((n>>=7)){b<<=8;b|=((n&0x7f)|0x80)}for(;;){out.push(b&255);if(b&0x80)b>>=8;else break;}return out}
function chunk(type,data){return [...ascii(type),...u32(data.length),...data]}
export class MidiWriter{
  write(events,{bpm=120,trackName='ChordBloom',multiTrack=false}={}){
    if(multiTrack){const groups=new Map();for(const e of events){const k=e.track||'Chords';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}const tracks=[this.metaTrack(bpm,trackName),...Array.from(groups,([name,ev])=>this.noteTrack(ev,name))];return new Uint8Array([...chunk('MThd',[...u16(1),...u16(tracks.length),...u16(PPQ)]),...tracks.flat()]);}
    const tr=this.singleTrack(events,bpm,trackName);return new Uint8Array([...chunk('MThd',[...u16(0),...u16(1),...u16(PPQ)]),...tr]);
  }
  metaTrack(bpm,name){const d=[];d.push(0,0xff,0x03,...vlq(ascii(name).length),...ascii(name));const mpqn=Math.round(60000000/bpm);d.push(0,0xff,0x51,3,(mpqn>>>16)&255,(mpqn>>>8)&255,mpqn&255);d.push(0,0xff,0x58,4,4,2,24,8);d.push(0,0xff,0x2f,0);return chunk('MTrk',d)}
  singleTrack(events,bpm,name){const d=[];d.push(0,0xff,0x03,...vlq(ascii(name).length),...ascii(name));const mpqn=Math.round(60000000/bpm);d.push(0,0xff,0x51,3,(mpqn>>>16)&255,(mpqn>>>8)&255,mpqn&255,0,0xff,0x58,4,4,2,24,8);d.push(...this.serializeNotes(events));d.push(0,0xff,0x2f,0);return chunk('MTrk',d)}
  noteTrack(events,name){const d=[0,0xff,0x03,...vlq(ascii(name).length),...ascii(name),...this.serializeNotes(events),0,0xff,0x2f,0];return chunk('MTrk',d)}
  serializeNotes(events){const points=[];for(const e of events){if(e.note<0||e.note>127||e.duration<=0)continue;points.push({t:e.start,type:1,n:e.note,v:e.velocity||96});points.push({t:e.start+e.duration,type:0,n:e.note,v:0});}points.sort((a,b)=>a.t-b.t||a.type-b.type||a.n-b.n);let last=0,out=[];for(const p of points){out.push(...vlq(p.t-last),p.type?0x90:0x80,p.n,p.v);last=p.t;}return out}
}
export function validateMidi(bytes){const s=String.fromCharCode(...bytes.slice(0,4));if(s!=='MThd')return false;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const headerLen=view.getUint32(4);if(headerLen!==6)return false;const tracks=view.getUint16(10);let pos=14,found=0;while(pos+8<=bytes.length){const tag=String.fromCharCode(...bytes.slice(pos,pos+4));const len=view.getUint32(pos+4);if(tag!=='MTrk'||pos+8+len>bytes.length)return false;found++;pos+=8+len;}return found===tracks&&pos===bytes.length;}
