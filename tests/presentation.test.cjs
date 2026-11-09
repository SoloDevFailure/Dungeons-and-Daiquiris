'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
require('../services/storage.js');require('../services/connection.js');require('../services/drink-history.js');require('../services/ingredients.js');require('../services/drink-generator.js');require('../services/presentation-view.js');
const D=globalThis.D20;
class Element {
  constructor(){
    this.textContent='';this.children=[];this.hidden=false;this.dataset={};this.attributes={};
    this.style={setProperty:()=>{}};this.classList={add:()=>{},remove:()=>{}};
  }
  setAttribute(name,value){this.attributes[name]=value}
  getAttribute(name){return this.attributes[name]??null}
  addEventListener(){}
  append(item){this.children.push(item)}
  replaceChildren(...items){this.children=items}
}
async function settle(){for(let i=0;i<20;i++)await Promise.resolve()}
function connectionFor(document,timers=[]){return {createLoop:options=>D.connection.createLoop({...options,document,window:{addEventListener:()=>{},matchMedia:()=>({matches:true})},navigator:{onLine:true},setTimer:fn=>timers.push(fn),clearTimer:()=>{}})}}
test('presentation polls without overlap, retains cached encounter through outages and resumes after clear',async()=>{
  const elements=new Map();const data=new Map();const timers=[];let requests=0,fail=false,hold=false,resume;
  const storage=D.createStorage({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)});
  const snapshot=D.drinkGenerator.generateDrink(D.ingredients.master.slice(0,3));
  let state={id:'10000000-0000-4000-8000-000000000001',name:'Poker',revision:1,currentEncounter:{id:snapshot.id,snapshot,servings:2}};
  const document={hidden:false,querySelector:s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s)},createElement:()=>new Element(),addEventListener:()=>{}};
  const sandbox={D20:{presentationView:D.presentationView,connection:connectionFor(document,timers),storage,drinkHistory:D.drinkHistory,supabase:{validateConfig:()=>{},createClient:()=>({rpc:async(name,p,host)=>{
    assert.equal(name,'d20_presentation');assert.equal(host,false);assert.equal(p.p_view_token,'a'.repeat(64));requests++;
    if(hold)await new Promise(resolve=>resume=resolve);if(fail)throw new Error('offline');return state;
  }})}},D20_CONFIG:{supabaseUrl:"https://example.supabase.co"},document,location:{hash:`#session=${state.id}&view=${'a'.repeat(64)}`},URLSearchParams,Date,setInterval:fn=>timers.push(fn),window:{addEventListener:()=>{},matchMedia:()=>({matches:true})}};
  const run=()=>vm.runInNewContext(fs.readFileSync(require.resolve('../presentation.js'),'utf8'),sandbox);
  run();await settle();assert.equal(elements.get('#encounter').hidden,false);assert.equal(elements.get('#drink-title').textContent,snapshot.bartenderTitle);
  fail=true;timers[0]();await settle();assert.match(elements.get('#display-status').textContent,/Connection interrupted/);assert.equal(elements.get('#encounter').hidden,false);
  run();await settle();assert.equal(elements.get('#drink-title').textContent,snapshot.bartenderTitle); // refresh from cached state
  fail=false;hold=true;const before=requests;timers.at(-1)();timers.at(-1)();assert.equal(requests,before+1);hold=false;resume();await settle();
  state={...state,revision:2,currentEncounter:null};timers.at(-1)();await settle();assert.equal(elements.get('#encounter').hidden,true);assert.equal(elements.get('#waiting').hidden,false);
  document.hidden=true;const count=requests;timers.at(-1)();await settle();assert.equal(requests,count);
});


test('presentation still goes live when device storage cannot be written',async()=>{
  const elements=new Map();let requests=0;
  const document={hidden:false,querySelector:s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s)},createElement:()=>new Element(),addEventListener:()=>{}};
  const sandbox={D20:{presentationView:D.presentationView,connection:connectionFor(document),storage:{read:()=>{throw Error('blocked')},write:()=>{throw Error('blocked')}},drinkHistory:D.drinkHistory,supabase:{validateConfig:()=>{},createClient:()=>({rpc:async()=>{requests++;return {name:'Poker',currentEncounter:null}}})}},D20_CONFIG:{supabaseUrl:'https://example.supabase.co'},document,location:{hash:`#session=10000000-0000-4000-8000-000000000001&view=${'a'.repeat(64)}`},URLSearchParams,Date,setInterval:()=>{},window:{addEventListener:()=>{},matchMedia:()=>({matches:true})}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../presentation.js'),'utf8'),sandbox);await settle();
  assert.equal(requests,1);assert.match(elements.get('#display-status').textContent,/Live/);
});

test('a newly scanned fragment re-pairs an open display; late responses cannot overwrite the new encounter',async()=>{
 const document=new EventTarget(),window=new EventTarget(),timers=new Map(),elements=new Map(),updates=[],requests=[];let timer=0;
 document.hidden=false;document.querySelector=s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s);};
 const storage=D.createStorage({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}),data=new Map();
 const first={session:'10000000-0000-4000-8000-000000000001',view:'a'.repeat(64)},second={session:'10000000-0000-4000-8000-000000000002',view:'b'.repeat(64)};
 storage.write('dungeons-daiquiris.display-link.v1',first);
 const location={hash:`#session=${first.session}&view=${first.view}`};
 const sandbox={D20:{storage,presentationView:{create:()=>({update:state=>updates.push(state)})},supabase:{validateConfig(){},createClient:()=>({rpc:(name,p,host)=>{assert.equal(host,false);return new Promise(resolve=>requests.push({p,resolve}));}})},connection:{createLoop:options=>D.connection.createLoop({...options,document,window,navigator:{onLine:true},setTimer:(fn,delay)=>{timers.set(++timer,{fn,delay});return timer;},clearTimer:id=>timers.delete(id)})}},D20_CONFIG:{supabaseUrl:'https://example.supabase.co'},document,window,location,URLSearchParams};
 vm.runInNewContext(fs.readFileSync(require.resolve('../presentation.js'),'utf8'),sandbox);assert.equal(requests.length,1);
 location.hash=`#session=${second.session}&view=${second.view}`;window.dispatchEvent(new Event('hashchange'));
 requests[0].resolve({id:first.session,currentEncounter:{id:'stale'}});await settle();assert.equal(updates.some(s=>s.currentEncounter?.id==='stale'),false);
 assert.deepEqual(storage.read('dungeons-daiquiris.display-link.v1'),first,'pairing is not replaced before server verification');
 const pending=[...timers.values()].at(-1);pending.fn();assert.equal(requests[1].p.p_session,second.session);
 requests[1].resolve({id:second.session,currentEncounter:{id:'latest'}});await settle();assert.equal(updates.at(-1).currentEncounter.id,'latest');assert.deepEqual(storage.read('dungeons-daiquiris.display-link.v1'),second);
 location.hash='#session=broken';window.dispatchEvent(new Event('hashchange'));assert.deepEqual(storage.read('dungeons-daiquiris.display-link.v1'),second);assert.match(elements.get('#display-status').textContent,/incomplete/);
});
