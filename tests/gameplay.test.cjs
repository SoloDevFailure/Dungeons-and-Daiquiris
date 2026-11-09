'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
for(const name of ['storage','ingredients','drink-generator','drink-history','gameplay','session'])require('../services/'+name+'.js');
const D=globalThis.D20;
function memory(){const data=new Map();return {data,storage:D.createStorage({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)})};}
const drink=(id='drink',slots=[1,7,12])=>D.drinkGenerator.generateDrink(slots.map(n=>D.ingredients.master[n-1]),{id,createdAt:'2026-11-09T00:00:00Z'});
function setup(){const mem=memory();return {...mem,game:D.gameplay.createRepository(mem.storage)};}
test('default contestants, duplicate prevention, enabled state and additions persist without touching old data',()=>{
 const {game,storage,data}=setup();storage.write(D.ingredients.key,{sentinel:true});storage.write(D.drinkHistory.key,{sentinel:true});const before=[data.get(D.ingredients.key),data.get(D.drinkHistory.key)];
 assert.deepEqual(game.get().players.map(p=>p.name),['Dave','Tom','Dan','Damo','Nic','Jamie','Chris','Wes','Fletcher','Aaron']);assert.equal(data.has(D.gameplay.key),false);
 game.setEnabled(game.get().players[0].id,false);game.addPlayer('  Jeremy  ');assert.throws(()=>game.addPlayer('dAvE'),/already/);
 const restored=D.gameplay.createRepository(storage);assert.equal(restored.get().players[0].enabled,false);assert.equal(restored.get().players.at(-1).name,'Jeremy');assert.equal(restored.pending().length,2);
 assert.deepEqual([data.get(D.ingredients.key),data.get(D.drinkHistory.key)],before);
});
test('start requires a participant; resume never zeros points or creates a second game',()=>{
 const {game}=setup();for(const p of game.get().players)game.setEnabled(p.id,false);assert.throws(()=>game.start(),/at least one/);
 const id=game.get().players[0].id;game.setEnabled(id,true);game.start();const q=D.gameplay.quote(drink());game.award(drink(),[{playerId:id,multiplier:1}],q.starting);
 const before=game.get();game.start();assert.deepEqual(game.get(),before);assert.equal(D.gameplay.rankings(game.get())[0].points,q.starting);
});
test('one to three winners share agreed points; half points applies individually and never rounds silently',()=>{
 for(const count of [1,2,3]){const {game}=setup();game.start();const recipe=drink(),q=D.gameplay.quote(recipe),winners=game.get().players.slice(0,count).map((p,i)=>({playerId:p.id,multiplier:i===1?.5:1}));
 game.award(recipe,winners,q.min+1);const award=game.get().awards[0];assert.equal(award.winners.length,count);assert.equal(award.winners[0].points,q.min+1);if(count>1)assert.equal(award.winners[1].points,(q.min+1)/2);
 assert.throws(()=>game.award(recipe,winners,q.min+1),/already/);assert.equal(game.get().awards.length,1);}
});
test('reject invalid ranges, four/duplicate/disabled winners and blocked or empty recipes atomically',()=>{
 const {game}=setup();game.start();const recipe=drink(),q=D.gameplay.quote(recipe),ids=game.get().players.map(p=>p.id),one=[{playerId:ids[0],multiplier:1}];
 for(const pts of [q.min-1,q.max+1,q.min+.5,NaN])assert.throws(()=>game.award(recipe,one,pts));
 assert.throws(()=>game.award(recipe,[],q.starting));assert.throws(()=>game.award(recipe,ids.slice(0,4).map(playerId=>({playerId,multiplier:1})),q.starting));assert.throws(()=>game.award(recipe,[...one,...one],q.starting));
 game.setEnabled(ids[0],false);assert.throws(()=>game.award(recipe,one,q.starting));
 const blocked=drink('blocked',[17,18,20]);assert.equal(D.gameplay.quote(blocked).blocked,true);assert.throws(()=>game.award(blocked,[{playerId:ids[1],multiplier:1}],20));assert.equal(game.get().awards.length,0);
});
test('points use exact actual alcohol, savoury, hot and compatibility flags; snapshots remain untouched',()=>{
 const recipe=drink('hot',[1,7,20]),before=JSON.stringify(recipe),q=D.gameplay.quote(recipe);
 assert.equal(q.starting,Math.ceil((20+recipe.pureAlcoholMl*4+30-1e-8)/2)*2);assert.equal(q.min,q.starting/2);assert.equal(q.max,q.starting*2);assert.equal(JSON.stringify(recipe),before);
 for(const slots of [[1,7,12],[15,18,7],[17,3,4]]){const r=drink('q',slots),q=D.gameplay.quote(r);assert.equal(q.starting%2,0);assert.ok(q.starting>0);}
});
test('refresh preserves winner/penalty draft; scored drink and recipe history remain separate',()=>{
 const {game,storage}=setup();game.start();const recipe=drink(),current={encounterId:recipe.id,winners:[{playerId:game.get().players[0].id,multiplier:.5}],agreedPoints:D.gameplay.quote(recipe).min};
 game.saveDraft(current);const reload=D.gameplay.createRepository(storage);assert.deepEqual(reload.getDraft(),current);reload.award(recipe,current.winners,current.agreedPoints);assert.equal(reload.get().awards.length,1);assert.equal(storage.read(D.drinkHistory.key,null),null);
});
test('unreadable records and failed writes do not overwrite saved data or drop points',()=>{
 const {game,storage,data}=setup();game.start();const original=data.get(D.gameplay.key);const failing=D.gameplay.createRepository({read:storage.read,write:()=>{throw new Error('quota')}});assert.throws(()=>failing.addPlayer('Jeremy'),/quota/);assert.equal(data.get(D.gameplay.key),original);
 storage.write(D.gameplay.key,{broken:true});const raw=data.get(D.gameplay.key);assert.throws(()=>game.start(),/unreadable/);assert.equal(data.get(D.gameplay.key),raw);
});
test('legacy registrations reuse IDs, remote recovery restores scores, key order does not create conflicts',()=>{
 const {game,storage}=setup();game.importLegacy([{id:'existing-dave',name:'Dave'},{id:'existing-ryan',name:'Ryan'}]);assert.equal(game.get().players[0].id,'existing-dave');assert.equal(game.get().players.at(-1).name,'Ryan');
 game.start();for(const op of game.pending())game.acknowledge(op.id);const remote=game.get();const reordered=JSON.parse(JSON.stringify(remote,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value));game.accept(reordered);
 const fresh=D.gameplay.createRepository(memory().storage);fresh.accept(remote);assert.deepEqual(fresh.get(),remote);assert.throws(()=>fresh.accept({...remote,version:0}),/older/);
});
test('gameplay sync retries the same operation after response loss without duplicate awards or changing recipe revision',async()=>{
 const {game,storage}=setup();let server=null,fail=true;const seen=new Set(),calls=[];const client={rpc:async(name,p)=>{
  if(name==='d20_host_state')return {id:'game',revision:7,players:[],gameplay:server};
  calls.push(p);if(!seen.has(p.p_operation)){assert.equal(p.p_revision,server?.version||0);seen.add(p.p_operation);server=p.p_state;}
  if(fail)throw new Error('lost acknowledgement');return {id:'game',revision:7,players:[],gameplay:server};
 }};
 storage.write(D.sessions.key,{id:'game',viewToken:'a'.repeat(64),revision:7,pending:[],remote:{players:[],gameplay:null}});
 const repo=D.sessions.createRepository(client,storage);game.start();game.award(drink(),[{playerId:game.get().players[0].id,multiplier:.5}],D.gameplay.quote(drink()).starting);
 await assert.rejects(repo.syncGameplay(game),/lost/);assert.equal(game.pending().length,2);const first=game.pending()[0].id;
 fail=false;await repo.syncGameplay(game);assert.equal(game.pending().length,0);assert.equal(server.awards.length,1);assert.equal(repo.get().revision,7);assert.equal(calls.filter(c=>c.p_operation===first).length,2);
});
test('server version conflict retains outbox and local points for review',async()=>{
 const {game,storage}=setup();game.start();storage.write(D.sessions.key,{id:'game',viewToken:'a'.repeat(64),revision:0,pending:[],remote:{gameplay:null,players:[]}});
 const repo=D.sessions.createRepository({rpc:async()=>{throw new Error('changed elsewhere')}},storage);const before=game.get();await assert.rejects(repo.syncGameplay(game),/changed/);assert.deepEqual(game.get(),before);assert.equal(game.pending().length,1);
});

test('preconnection actions are queued durably and transferred before gameplay uploads',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 class Element extends EventTarget{constructor(){super();this.dataset={};this.children=[];this.value='';}setAttribute(){}replaceChildren(){this.children=[];}append(x){this.children.push(x);}showModal(){}close(){}}
 const elements=new Map(),document={readyState:'loading',querySelector:s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s);},createElement:()=>new Element(),addEventListener:()=>{}},window=new EventTarget();
 const mem=memory();let state=null,loopOptions;const order=[],repo={get:()=>state,enqueue:(kind,payload)=>{if(!state)return false;state.pending.push({kind,payload});return true;},connectPermanent:async()=>{state={id:'game',permanent:true,pending:[],remote:{players:[]}};},flush:async()=>{order.push(...state.pending.map(o=>o.kind));state.pending=[];},syncGameplay:async()=>order.push('gameplay')};
 const context={D20:{storage:mem.storage,clone:D.clone,gameRepository:{get:()=>({players:[]}),pending:()=>[]},supabase:{createClient:()=>({})},sessions:{createRepository:()=>repo,presentationLink:()=>''},connection:{createLoop:o=>{loopOptions=o;return {wake(){},start(){}};}}},D20_CONFIG:{supabaseUrl:'https://example.supabase.co'},document,window,Event,crypto};
 vm.runInNewContext(fs.readFileSync(require.resolve('../session-ui.js'),'utf8'),context);
 assert.equal(context.D20.cloud.queue('encounter',drink()),true);assert.equal(context.D20.cloud.queue('clear',{}),true);
 assert.equal(mem.storage.read('dungeons-daiquiris.unconnected-outbox.v1').length,2);
 await loopOptions.run({});assert.deepEqual(order,['encounter','clear','gameplay']);assert.deepEqual(mem.storage.read('dungeons-daiquiris.unconnected-outbox.v1'),[]);
});

test('legacy players arriving after offline start preserve awards and reuse IDs in every unsubmitted snapshot',()=>{
 const {game}=setup();game.start();const id=game.get().players[0].id,recipe=drink();game.award(recipe,[{playerId:id,multiplier:1}],D.gameplay.quote(recipe).starting);
 game.saveDraft({encounterId:'next',winners:[{playerId:id,multiplier:.5}],agreedPoints:40});
 game.importLegacy([{id:'original-dave',name:'Dave'},{id:'original-ryan',name:'Ryan'}]);
 assert.equal(game.get().players[0].id,'original-dave');assert.equal(game.get().awards[0].winners[0].playerId,'original-dave');assert.equal(game.getDraft().winners[0].playerId,'original-dave');
 for(const op of game.pending()){assert.equal(op.state.players[0].id,'original-dave');assert.ok(op.state.players.some(p=>p.id==='original-ryan'));}
});
