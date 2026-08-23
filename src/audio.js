export async function activateAudioContext(context){
  if(context.state==='closed')throw new Error('Audio output is closed. Reload the page to play sound again.');
  if(context.state==='suspended'&&typeof context.resume==='function')await context.resume();
  return context;
}
