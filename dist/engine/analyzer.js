import {midiName} from './theory.js';
export function progressionExplanation(prog,settings){
  if(!prog.length)return '';
  const chrom=prog.filter(c=>c.source!=='Diatonic'); const common=[]; for(let i=1;i<prog.length;i++){const n=prog[i].voicing.filter(x=>prog[i-1].voicing.includes(x));if(n.length)common.push(`${i}→${i+1}: ${n.map(x=>midiName(x,settings.key)).join(', ')}`)}
  let txt=`The progression balances ${prog.map(c=>c.function.toLowerCase()).join(' → ')}.`;
  if(chrom.length)txt+=` Chromatic color is intentional: ${chrom.map(c=>`${c.symbol} (${c.source})`).join(', ')}.`;
  if(common.length)txt+=` Voice-leading continuity includes ${common.slice(0,2).join('; ')}.`;
  if(settings.loopFriendly)txt+=` The final voicing is scored against the opening chord to improve loop continuity.`;
  return txt;
}
