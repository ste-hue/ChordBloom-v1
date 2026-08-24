/**
 * Tests for contextual-help / tooltip behavior.
 *
 * The help system is DOM-only (init() is guarded by typeof document).
 * We build a minimal DOM-mock environment and re-run the inline setupHelp
 * logic extracted from src/index.html so we can assert on:
 *
 *  • desktop (hover:hover): mouseover shows tooltip, focusin shows tooltip
 *  • touch (no hover):      focusin does NOT show tooltip
 *  • touch + help mode ON:  tap on [data-help] shows tooltip
 *  • tooltip closes on tab change
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Minimal DOM mock helpers
// ---------------------------------------------------------------------------

function makeEl(tag='div',attrs={}){
  const listeners=new Map();
  const el={
    tagName:tag.toUpperCase(),
    classList:{_cls:new Set(),add(c){this._cls.add(c)},remove(c){this._cls.delete(c)},
               toggle(c,f){if(f===undefined){if(this._cls.has(c))this._cls.delete(c);else this._cls.add(c);}else{f?this._cls.add(c):this._cls.delete(c);} return this._cls.has(c);},
               contains(c){return this._cls.has(c)}},
    style:{},
    dataset:{},
    _attrs:{...attrs},
    getAttribute(k){return this._attrs[k]??null},
    setAttribute(k,v){this._attrs[k]=v},
    getBoundingClientRect(){return{left:10,right:110,top:20,bottom:40,width:100,height:20}},
    closest(sel){
      // only supports [data-help] and .tab selectors used by setupHelp
      if(sel==='[data-help]') return this.dataset.help?this:null;
      if(sel==='.tab') return this.classList.contains('tab')?this:null;
      return null;
    },
    matches(sel){
      if(sel==='input,select') return this.tagName==='INPUT'||this.tagName==='SELECT';
      return false;
    },
    addEventListener(ev,fn,opts){
      if(!listeners.has(ev))listeners.set(ev,[]);
      listeners.get(ev).push({fn,opts});
    },
    removeEventListener(ev,fn){
      if(!listeners.has(ev))return;
      listeners.set(ev,listeners.get(ev).filter(h=>h.fn!==fn));
    },
    _dispatch(ev,evObj){
      for(const {fn}of(listeners.get(ev)||[]))fn(evObj);
    },
    get textContent(){return this._text||'';},
    set textContent(v){this._text=v;},
    offsetWidth:280,
    offsetHeight:60,
  };
  return el;
}

function buildEnv(matchesHover){
  const docListeners=new Map();
  const elements={};

  const tip=makeEl('div');
  tip.id='helpTooltip';
  elements['helpTooltip']=tip;

  const helpBtn=makeEl('button');
  helpBtn.id='helpModeBtn';
  elements['helpModeBtn']=helpBtn;

  const ctrlWithHelp=makeEl('button');
  ctrlWithHelp.dataset.help='Test help text';
  ctrlWithHelp.id='someCtrl';
  elements['someCtrl']=ctrlWithHelp;

  const tabBtn=makeEl('button');
  tabBtn.classList.add('tab');
  elements['tabBtn']=tabBtn;

  const querySelectorAllResults={'[data-transform]':[],'[data-help]':[ctrlWithHelp],'.tab':[tabBtn]};

  const docEl={
    addEventListener(ev,fn,opts){
      if(!docListeners.has(ev))docListeners.set(ev,[]);
      docListeners.get(ev).push({fn,capture:!!(opts?.capture||opts===true)});
    },
    querySelectorAll(sel){return querySelectorAllResults[sel]||[];},
    _dispatch(ev,evObj,capture=false){
      for(const {fn,capture:cap}of(docListeners.get(ev)||[])){
        if(cap===capture) fn(evObj);
      }
    },
  };

  const win={
    matchMedia:(q)=>({matches:q.includes('hover:hover')&&matchesHover}),
    innerWidth:375, innerHeight:667,
  };

  const $=(id)=>elements[id]??null;

  return{docEl,win,tip,helpBtn,ctrlWithHelp,tabBtn,$,docListeners};
}

// ---------------------------------------------------------------------------
// Extract the *body* of setupHelp from src/index.html and wrap it for reuse
// ---------------------------------------------------------------------------

const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8');
// Extract setupHelp function body — match greedily up to the closing brace
// immediately before the next `function ` definition at the same indent level.
const fnMatch=html.match(/function setupHelp\(\)\{([\s\S]+?)\n  \}\n\n  function /);
assert.ok(fnMatch,'setupHelp function not found in src/index.html');
const setupHelpBody=fnMatch[1];

function runSetupHelp(env){
  const ctx=vm.createContext({
    window:env.win,
    document:env.docEl,
    innerWidth:env.win.innerWidth,
    innerHeight:env.win.innerHeight,
    $:env.$,
    CONTROL_HELP:{},
    console,
  });
  // Inject setupHelp and call it
  vm.runInContext(`(function setupHelp(){${setupHelpBody}})();`,ctx,{filename:'setup-help-test.js'});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('desktop: mouseover on [data-help] element shows tooltip',()=>{
  const env=buildEnv(true);
  runSetupHelp(env);
  const {tip,ctrlWithHelp,docEl}=env;

  assert.ok(!tip.classList.contains('visible'),'tooltip starts hidden');
  docEl._dispatch('mouseover',{target:ctrlWithHelp,clientX:50,clientY:100});
  assert.ok(tip.classList.contains('visible'),'tooltip visible after mouseover');
  assert.equal(tip.textContent,'Test help text');
});

test('desktop: mouseout hides tooltip',()=>{
  const env=buildEnv(true);
  runSetupHelp(env);
  const {tip,ctrlWithHelp,docEl}=env;

  docEl._dispatch('mouseover',{target:ctrlWithHelp,clientX:50,clientY:100});
  assert.ok(tip.classList.contains('visible'));
  docEl._dispatch('mouseout',{target:ctrlWithHelp});
  assert.ok(!tip.classList.contains('visible'),'tooltip hidden after mouseout');
});

test('desktop: focusin shows tooltip',()=>{
  const env=buildEnv(true);
  runSetupHelp(env);
  const {tip,ctrlWithHelp,docEl}=env;

  docEl._dispatch('focusin',{target:ctrlWithHelp});
  assert.ok(tip.classList.contains('visible'),'tooltip visible after focusin');
});

test('touch: focusin does NOT show tooltip',()=>{
  const env=buildEnv(false);
  runSetupHelp(env);
  const {tip,ctrlWithHelp,docEl}=env;

  docEl._dispatch('focusin',{target:ctrlWithHelp});
  assert.ok(!tip.classList.contains('visible'),'focusin on touch must NOT show tooltip');
});

test('touch: tap on control does NOT show tooltip when help mode is OFF',()=>{
  const env=buildEnv(false);
  runSetupHelp(env);
  const {tip,ctrlWithHelp,docEl}=env;

  let prevented=false;
  const ev={target:ctrlWithHelp,preventDefault(){prevented=true;},stopImmediatePropagation(){}};
  docEl._dispatch('click',ev,/*capture*/true);
  assert.ok(!tip.classList.contains('visible'),'tooltip must not appear on tap in normal mode');
  assert.ok(!prevented,'normal tap must not be prevented');
});

test('touch: tapping helpModeBtn activates help mode',()=>{
  const env=buildEnv(false);
  runSetupHelp(env);
  const {helpBtn}=env;

  helpBtn._dispatch('click',{});
  assert.ok(helpBtn.classList.contains('active'),'helpModeBtn should be active');
  assert.equal(helpBtn.getAttribute('aria-pressed'),'true');
});

test('touch: tapping helpModeBtn again deactivates help mode',()=>{
  const env=buildEnv(false);
  runSetupHelp(env);
  const {helpBtn}=env;

  helpBtn._dispatch('click',{});
  assert.ok(helpBtn.classList.contains('active'),'should be active');
  helpBtn._dispatch('click',{});
  assert.ok(!helpBtn.classList.contains('active'),'should be inactive after second tap');
  assert.equal(helpBtn.getAttribute('aria-pressed'),'false');
});

test('touch: in help mode, tapping a [data-help] control shows tooltip and prevents default',()=>{
  const env=buildEnv(false);
  runSetupHelp(env);
  const {tip,ctrlWithHelp,helpBtn,docEl}=env;

  // Activate help mode
  helpBtn._dispatch('click',{});

  let prevented=false;
  const ev={target:ctrlWithHelp,preventDefault(){prevented=true;},stopImmediatePropagation(){}};
  docEl._dispatch('click',ev,/*capture*/true);

  assert.ok(tip.classList.contains('visible'),'tooltip should show in help mode');
  assert.ok(prevented,'tap should be prevented in help mode');
  assert.equal(tip.textContent,'Test help text');
});

test('touch: tapping outside closes tooltip and exits help mode',()=>{
  const env=buildEnv(false);
  runSetupHelp(env);
  const {tip,ctrlWithHelp,helpBtn,docEl}=env;

  // Activate help mode and show tooltip
  helpBtn._dispatch('click',{});
  const showEv={target:ctrlWithHelp,preventDefault(){},stopImmediatePropagation(){}};
  docEl._dispatch('click',showEv,true);
  assert.ok(tip.classList.contains('visible'));

  // Tap outside (element with no data-help)
  const outside=makeEl('div'); // no data-help
  const outsideEv={target:outside,preventDefault(){},stopImmediatePropagation(){}};
  docEl._dispatch('click',outsideEv,true);
  assert.ok(!tip.classList.contains('visible'),'tooltip should close after tap outside');
});

test('touch: tab change clears tooltip',()=>{
  const env=buildEnv(false);
  runSetupHelp(env);
  const {tip,ctrlWithHelp,helpBtn,docEl,tabBtn}=env;

  // Show tooltip via help mode
  helpBtn._dispatch('click',{});
  docEl._dispatch('click',{target:ctrlWithHelp,preventDefault(){},stopImmediatePropagation(){}},true);
  assert.ok(tip.classList.contains('visible'));

  // Tab click should hide tooltip (capture listener on tab button)
  tabBtn._dispatch('click',{});
  assert.ok(!tip.classList.contains('visible'),'tooltip should be hidden after tab change');
});
