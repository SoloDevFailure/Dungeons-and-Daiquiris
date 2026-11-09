'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../services/storage.js');
require('../services/ingredients.js');
require('../services/drink-generator.js');
require('../services/session.js');
require('../services/supabase.js');
const D = globalThis.D20;
function memory() {
  const data = new Map();
  return {data,storage:D.createStorage({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)})};
}
const config = {supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_example'};
test('reject privileged keys, insecure URLs and third-party endpoints', () => {
  for (const publishableKey of ['sb_secret_bad','eyJhbGciOiJIUzI1NiJ9.service_role.signature','']) assert.throws(()=>D.supabase.validateConfig({...config,publishableKey}));
  for (const supabaseUrl of ['http://example.supabase.co','https://attacker.test','https://example.supabase.co/other']) assert.throws(()=>D.supabase.validateConfig({...config,supabaseUrl}));
});
test('read-only RPC sends no host auth and never creates an anonymous user', async () => {
  const calls=[];
  const client=D.supabase.createClient(config,memory().storage,async (url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({currentEncounter:null})}});
  await client.rpc('d20_presentation',{p_session:'session',p_view_token:'token'},false);
  assert.equal(calls.length,1); assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(calls[0].options.headers.apikey,config.publishableKey);
  assert.equal(calls[0].options.cache,'no-store');
});
test('host auth is persisted, refreshes before expiry, and never replaces a failed identity',async()=>{
  const mem=memory();const calls=[];
  const client=D.supabase.createClient(config,mem.storage,async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/auth/')) return {ok:true,json:async()=>({access_token:'host',refresh_token:'refresh',expires_in:3600})};
    return {ok:true,json:async()=>({id:'session'})};
  });
  await client.rpc('d20_host_state',{});await client.rpc('d20_host_state',{});
  assert.equal(calls.filter(c=>c.url.includes('/signup')).length,1);
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer host');
  const key=[...mem.data.keys()][0];const saved=mem.storage.read(key);saved.expires_at=0;mem.storage.write(key,saved);
  await client.rpc('d20_host_state',{});assert.match(calls.at(-2).url,/grant_type=refresh_token/);
  saved.expires_at=0;mem.storage.write(key,saved);
  const failed=D.supabase.createClient(config,mem.storage,async(url)=>{assert.match(url,/refresh_token/);return {ok:false,status:400,json:async()=>({message:'expired'})}});
  await assert.rejects(failed.rpc('d20_host_state',{}),/expired/);assert.equal(mem.storage.read(key).refresh_token,'refresh');
});
test('queued recipes survive offline/reload, ambiguous acknowledgements and concurrent new work',async()=>{
  const mem=memory(); let failed=true;let created=false;let revision=0;const seen=new Set();let counter=0;
  let repo;const calls=[];
  const remote={id:'session',name:'Poker',config:[],players:[],currentEncounter:null};
  const client={rpc:async(name,params)=>{
    calls.push({name,params});
    if(name==='d20_create_session'){created=true;if(failed)throw new Error('offline');return {...remote,revision};}
    if(name==='d20_host_state')return {...remote,revision};
    if(!seen.has(params.p_operation)){assert.equal(params.p_revision,revision);seen.add(params.p_operation);revision++;}
    if(failed)throw new Error('connection lost after commit');
    if(params.p_kind==='encounter'&&!calls.some(c=>c.params.p_kind==='clear'))repo.enqueue('clear',{});
    return {...remote,revision};
  }};
  repo=D.sessions.createRepository(client,mem.storage,()=>`id-${++counter}`);
  const drink=D.drinkGenerator.generateDrink(D.ingredients.master.slice(0,3));
  await assert.rejects(repo.create('Poker',D.ingredients.master,drink),/offline/);assert.ok(created);
  assert.equal(repo.get().pending.length,1);
  repo=D.sessions.createRepository(client,mem.storage,()=>`id-${++counter}`);
  failed=false;await repo.restore();
  failed=true;await assert.rejects(repo.flush(),/connection lost/);
  const operation=repo.get().pending[0].id;
  failed=false;await repo.flush();
  assert.equal(repo.get().pending.length,0);assert.equal(revision,2);
  assert.equal(calls.filter(c=>c.params.p_operation===operation).length,2);
  assert.deepEqual(calls.find(c=>c.params.p_kind==='encounter').params.p_payload,drink);
});
test('session restoration preserves local settings and pending work',async()=>{
  const mem=memory();mem.storage.write(D.ingredients.key,D.ingredients.master.map(i=>({slot:i.slot,displayName:`Custom ${i.slot}`,defaultMl:42})));
  const before=mem.data.get(D.ingredients.key);let n=0;
  const client={rpc:async()=>({revision:9,config:D.ingredients.master,players:[],currentEncounter:null})};
  const repo=D.sessions.createRepository(client,mem.storage,()=>`id-${++n}`);
  await repo.create('Poker',D.ingredients.master);repo.enqueue('player',{id:'player',name:'Ryan'});
  await repo.restore();assert.equal(repo.get().pending.length,1);assert.equal(mem.data.get(D.ingredients.key),before);
  await assert.rejects(repo.create('Other',[]));
});
test('old saved quantities/names survive adding ABV; ABV edits change alcohol maths',()=>{
  const mem=memory();const old=D.ingredients.master.map(i=>({slot:i.slot,displayName:`Custom ${i.slot}`,defaultMl:20}));
  mem.storage.write(D.ingredients.key,old);const raw=mem.data.get(D.ingredients.key);
  const repo=D.ingredients.createRepository(mem.storage);assert.equal(mem.data.get(D.ingredients.key),raw);
  assert.equal(repo.getById(7).displayName,'Custom 7');assert.equal(repo.getById(7).abv,37.5);
  const edited=repo.getAll();edited[6].abv=0;repo.save(edited);
  const drink=D.drinkGenerator.generateDrink([1,2,7].map(i=>repo.getById(i)));
  assert.equal(drink.pureAlcoholMl,0);
  edited[6].abv=101;assert.throws(()=>repo.save(edited));assert.equal(repo.getById(7).abv,0);
});
test('display link carries only a read capability in its fragment',()=>{
  const link=new URL(D.sessions.presentationLink({id:'session',viewToken:'read-token',refresh_token:'never-share'},'https://example.com/game/index.html#drink'));
  assert.equal(link.pathname,'/game/presentation.html');assert.equal(link.search,'?release=10');assert.equal(link.hash,'#session=session&view=read-token');
  assert.ok(!link.href.includes('never-share'));
});


test('idle sync refreshes server session/player state without touching local ingredients',async()=>{
  const mem=memory();let revision=0;let n=0;
  mem.storage.write(D.ingredients.key,[{saved:'unchanged'}]);
  const client={rpc:async(name)=>({revision:revision++,players:name==='d20_host_state'?[{id:'ryan',name:'Ryan'}]:[],config:[]})};
  const repo=D.sessions.createRepository(client,mem.storage,()=>`id-${++n}`);
  await repo.create('Poker',D.ingredients.master);await repo.flush();
  assert.equal(repo.get().remote.players[0].name,'Ryan');assert.equal(repo.get().revision,1);
  assert.deepEqual(mem.storage.read(D.ingredients.key),[{saved:'unchanged'}]);
});

test('failed idle restoration preserves cached session metadata',async()=>{
  const mem=memory();let offline=false;let n=0;
  const client={rpc:async()=>{if(offline)throw new Error('offline');return {revision:5,players:[{id:'ryan',name:'Ryan'}]}}};
  const repo=D.sessions.createRepository(client,mem.storage,()=>`id-${++n}`);
  await repo.create('Poker',D.ingredients.master);const before=mem.data.get(D.sessions.key);
  offline=true;await assert.rejects(repo.flush(),/offline/);
  assert.equal(mem.data.get(D.sessions.key),before);
});

test('permanent connection adopts existing game, preserving outbox, ingredients and identity',async()=>{
  const mem=memory();let n=0;const token='a'.repeat(64),calls=[];
  const existing={id:'legacy-game',viewToken:token,name:'Poker',revision:3,pending:[{id:'queued',kind:'player',payload:{id:'ryan',name:'Ryan'}}],creating:false,remote:{players:[]}};
  mem.storage.write(D.sessions.key,existing);mem.storage.write(D.ingredients.key,[{custom:'unchanged'}]);mem.storage.write('host-identity',{refresh_token:'never-share'});
  const client={rpc:async(name,p)=>{calls.push({name,p});return {id:existing.id,name:'Christmas Poker',revision:5,players:[{id:'ryan',name:'Ryan'}],viewToken:token,permanent:true}}};
  const repo=D.sessions.createRepository(client,mem.storage,()=>`id-${++n}`);
  const state=await repo.connectPermanent();
  assert.equal(state.id,existing.id);assert.equal(state.permanent,true);assert.equal(state.revision,3);
  assert.deepEqual(state.pending,existing.pending);assert.equal(calls[0].name,'d20_connect_game');
  assert.deepEqual(calls[0].p,{p_existing:existing.id,p_view_token:token});
  assert.deepEqual(mem.storage.read(D.ingredients.key),[{custom:'unchanged'}]);assert.equal(mem.storage.read('host-identity').refresh_token,'never-share');
});

test('permanent restoration without local game metadata recovers the same game, not a new session',async()=>{
  const mem=memory();const calls=[];
  const client={rpc:async(name,p)=>{calls.push({name,p});return {id:'permanent',name:'Poker',revision:7,viewToken:'b'.repeat(64),permanent:true}}};
  const repo=D.sessions.createRepository(client,mem.storage,()=>{throw Error('must not generate game IDs')});
  await repo.connectPermanent();await repo.connectPermanent();
  assert.equal(repo.get().id,'permanent');assert.deepEqual(repo.get().pending,[]);
  assert.ok(calls.every(c=>c.name==='d20_connect_game'));
  assert.deepEqual(calls[0].p,{p_existing:null,p_view_token:null});
});

test('a different permanent game or denied host never overwrites saved game metadata',async()=>{
  const mem=memory();const original={id:'original',viewToken:'a'.repeat(64),pending:[],revision:1};mem.storage.write(D.sessions.key,original);
  const raw=mem.data.get(D.sessions.key);
  const repo=D.sessions.createRepository({rpc:async()=>({id:'different',permanent:true,viewToken:'b'.repeat(64)})},mem.storage);
  await assert.rejects(repo.connectPermanent(),/not been replaced/);assert.equal(mem.data.get(D.sessions.key),raw);
  const empty=memory();const denied=D.sessions.createRepository({rpc:async()=>{throw Error('original host required')}},empty.storage);
  await assert.rejects(denied.connectPermanent(),/original host/);assert.equal(empty.storage.read(D.sessions.key,null),null);
});

test('hiding during outbox upload prevents further RPCs and retains unuploaded changes',async()=>{
  const mem=memory(),controller=new AbortController();let count=0;
  const state={id:'existing',viewToken:'a'.repeat(64),revision:1,creating:false,pending:[{id:'one',kind:'clear',payload:{}},{id:'two',kind:'clear',payload:{}}]};
  mem.storage.write(D.sessions.key,state);
  const repo=D.sessions.createRepository({rpc:async()=>{count++;controller.abort();return {revision:2}}},mem.storage);
  await assert.rejects(repo.flush({signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(count,1);assert.equal(repo.get().pending.length,1);assert.equal(repo.get().pending[0].id,'two');
});

test('an already-started auth refresh persists its identity before cancelling the following RPC',async()=>{
  const mem=memory(),controller=new AbortController();
  const authKey='dungeons-daiquiris.auth.example.supabase.co';
  mem.storage.write(authKey,{access_token:'expired',refresh_token:'old-refresh',expires_at:0});
  let calls=0;
  const client=D.supabase.createClient(config,mem.storage,async url=>{
    calls++;assert.match(url,/refresh_token/);controller.abort();
    return {ok:true,json:async()=>({access_token:'renewed',refresh_token:'rotated',expires_in:3600})};
  });
  await assert.rejects(client.rpc('d20_host_state',{},true,{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(calls,1);assert.equal(mem.storage.read(authKey).refresh_token,'rotated');
});
