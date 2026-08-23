export class RNG {
  constructor(seed=1){ this.seed=(Number(seed)>>>0)||1; }
  next(){ let t=this.seed+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }
  int(min,max){ return Math.floor(this.next()*(max-min+1))+min; }
  pick(arr){ return arr[Math.floor(this.next()*arr.length)]; }
  weighted(items){ const sum=items.reduce((a,x)=>a+Math.max(0,x.weight),0); if(!sum) return items[0]?.value; let r=this.next()*sum; for(const x of items){r-=Math.max(0,x.weight); if(r<=0)return x.value;} return items.at(-1)?.value; }
  fork(salt){ return new RNG((this.seed ^ hash32(String(salt)))>>>0); }
}
export function hash32(s){ let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return h>>>0; }
