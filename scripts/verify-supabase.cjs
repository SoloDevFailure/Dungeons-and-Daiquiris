'use strict';
// Live smoke test: creates two anonymous identities and one clearly named test
// session. Does not read, modify or delete any existing application/user data.
const assert=require('node:assert/strict');
require('../config.js');require('../services/storage.js');require('../services/ingredients.js');
require('../services/drink-generator.js');require('../services/drink-history.js');require('../services/supabase.js');
const D=globalThis.D20;
const memory=()=>{const data=new Map();return D.createStorage({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)})};
async function denied(task,label){await assert.rejects(task,error=>[401,403].includes(error.status),label)}
(async()=>{
  const host=D.supabase.createClient(D20_CONFIG,memory());
  const other=D.supabase.createClient(D20_CONFIG,memory());
  const id=crypto.randomUUID(),view=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const ingredients=D.clone(D.ingredients.master);let revision=0;
  const call=(name,params)=>host.rpc(name,params);
  const mutate=(kind,payload,operation=crypto.randomUUID(),expected=revision)=>call('d20_mutate',{p_session:id,p_operation:operation,p_revision:expected,p_kind:kind,p_payload:payload});
  let state=await call('d20_create_session',{p_id:id,p_name:`Phase 1 verification ${new Date().toISOString()}`,p_view_token:view,p_config:ingredients});
  assert.equal(state.id,id);assert.equal(state.revision,0);console.log('PASS: anonymous auth and session creation');
  state=await mutate('player',{id:crypto.randomUUID(),name:'Verification player'});revision=state.revision;
  assert.equal(state.players[0].name,'Verification player');
  ingredients[6].displayName='Verification vodka';ingredients[6].abv=10;ingredients[6].defaultMl=20;
  state=await mutate('config',ingredients);revision=state.revision;
  assert.equal(state.config[6].abv,10);assert.equal((await call('d20_host_state',{p_session:id})).players.length,1);
  console.log('PASS: player/settings persistence and session restoration');
  const drink=D.drinkGenerator.generateDrink([1,7,12].map(slot=>ingredients[slot-1]));
  const op=crypto.randomUUID(),before=revision;
  state=await mutate('encounter',drink,op);revision=state.revision;
  const replay=await mutate('encounter',drink,op,before);assert.equal(replay.revision,revision);
  assert.deepEqual(state.currentEncounter.snapshot,drink);
  let display=await host.rpc('d20_presentation',{p_session:id,p_view_token:view},false);
  assert.deepEqual(display.currentEncounter.snapshot,drink);
  for(const key of ['owner_id','config','players','view_token_hash'])assert.equal(key in display,false);
  await denied(()=>host.rpc('d20_presentation',{p_session:id,p_view_token:'b'.repeat(64)},false),'wrong read capability');
  await denied(()=>other.rpc('d20_host_state',{p_session:id}),'other host read');
  await denied(()=>other.rpc('d20_mutate',{p_session:id,p_operation:crypto.randomUUID(),p_revision:revision,p_kind:'clear',p_payload:{}}),'other host write');
  await denied(()=>host.rpc('d20_host_state',{p_session:id},false),'unsigned host read');
  // The table endpoint must be denied independently of the RPC capabilities.
  const table=await fetch(D20_CONFIG.supabaseUrl+'/rest/v1/d20_sessions?select=id&limit=1',{headers:{apikey:D20_CONFIG.publishableKey}});
  assert.ok([401,403].includes(table.status),'raw table access must be denied');
  console.log('PASS: immutable snapshot replay, display projection, read-token and owner isolation');
  await assert.rejects(()=>mutate('clear',{},crypto.randomUUID(),0),error=>error.code==='40001');
  state=await mutate('clear',{});revision=state.revision;
  display=await host.rpc('d20_presentation',{p_session:id,p_view_token:view},false);assert.equal(display.currentEncounter,null);
  console.log('PASS: next drink returns shared display to waiting; stale writes rejected');
  console.log('Live API smoke test passed. Test session retained:',id);
})().catch(error=>{console.error('Live verification failed:',error.message);process.exitCode=1});
