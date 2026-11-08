'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
require('../services/storage.js');require('../services/drink-history.js');require('../services/ingredients.js');require('../services/drink-generator.js');
const D=globalThis.D20;
class Element {
  constructor(){this.textContent='';this.children=[];this.hidden=false;}
  append(item){this.children.push(item)}
  replaceChildren(...items){this.children=items}
}
async function settle(){for(let i=0;i<6;i++)await Promise.resolve()}
test('presentation polls without overlap, retains cached encounter through outages and resumes after clear',async()=>{
  const elements=new Map();const data=new Map();const timers=[];let requests=0,fail=false,hold=false,resume;
  const storage=D.createStorage({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)});
  const snapshot=D.drinkGenerator.generateDrink(D.ingredients.master.slice(0,3));
  let state={id:'10000000-0000-4000-8000-000000000001',name:'Poker',revision:1,currentEncounter:{id:snapshot.id,snapshot,servings:2}};
  const document={hidden:false,querySelector:s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s)},createElement:()=>new Element(),addEventListener:()=>{}};
  const sandbox={D20:{storage,drinkHistory:D.drinkHistory,supabase:{validateConfig:()=>{},createClient:()=>({rpc:async(name,p,host)=>{
    assert.equal(name,'d20_presentation');assert.equal(host,false);assert.equal(p.p_view_token,'a'.repeat(64));requests++;
    if(hold)await new Promise(resolve=>resume=resolve);if(fail)throw new Error('offline');return state;
  }})}},D20_CONFIG:{supabaseUrl:"https://example.supabase.co"},document,location:{hash:`#session=${state.id}&view=${'a'.repeat(64)}`},URLSearchParams,Date,setInterval:fn=>timers.push(fn),window:{addEventListener:()=>{}}};
  const run=()=>vm.runInNewContext(fs.readFileSync(require.resolve('../presentation.js'),'utf8'),sandbox);
  run();await settle();assert.equal(elements.get('#encounter').hidden,false);assert.equal(elements.get('#drink-title').textContent,snapshot.bartenderTitle);
  fail=true;timers[0]();await settle();assert.match(elements.get('#display-status').textContent,/Connection interrupted/);assert.equal(elements.get('#encounter').hidden,false);
  run();await settle();assert.equal(elements.get('#drink-title').textContent,snapshot.bartenderTitle); // refresh from cached state
  fail=false;hold=true;const before=requests;timers.at(-1)();timers.at(-1)();assert.equal(requests,before+1);hold=false;resume();await settle();
  state={...state,revision:2,currentEncounter:null};timers.at(-1)();await settle();assert.equal(elements.get('#encounter').hidden,true);assert.equal(elements.get('#waiting').hidden,false);
  document.hidden=true;const count=requests;timers.at(-1)();await settle();assert.equal(requests,count);
});

