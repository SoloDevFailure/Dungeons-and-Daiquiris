'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const file of ['storage','display-pairing','ingredients','drink-generator','drink-history','connection'])require('../services/'+file+'.js');
const D=globalThis.D20,base='https://game.test/event/presentation.html',pairing={session:'10000000-0000-4000-8000-000000000001',view:'a'.repeat(64)};
function memory(){const data=new Map();return {data,storage:D.createStorage({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)})};}
test('installed launch URL carries its own read pairing independent of Safari local storage',async()=>{
 const launch=D.displayPairing.startURL({...pairing,refresh_token:'NEVER'},base);assert.deepEqual(D.displayPairing.fromLink(launch,base),pairing);assert.equal(new URL(launch).search,'?release=11');assert.ok(!launch.includes('NEVER'));
 const mem=memory(),elements=new Map(),timers=new Map();let requests=0,timer=0;
 class Element extends EventTarget{constructor(){super();this.textContent='';this.value='';}showModal(){this.open=true;}close(){this.open=false;}}
 const doc=new EventTarget(),win=new EventTarget();doc.hidden=false;doc.querySelector=s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s)};
 const sandbox={D20:{storage:mem.storage,displayPairing:D.displayPairing,pwa:{setPresentationPairing:p=>assert.deepEqual(JSON.parse(JSON.stringify(p)),pairing)},presentationView:{create:()=>({update(){}})},supabase:{validateConfig(){},createClient:()=>({rpc:async(name,p,host)=>{requests++;assert.equal(host,false);assert.equal(name,'d20_presentation');assert.equal(p.p_session,pairing.session);return {currentEncounter:null};}})},connection:{createLoop:opts=>D.connection.createLoop({...opts,document:doc,window:win,navigator:{onLine:true},setTimer:(fn,delay)=>{timers.set(++timer,{fn,delay});return timer;},clearTimer:id=>timers.delete(id)})}},D20_CONFIG:{supabaseUrl:'https://example.supabase.co'},document:doc,window:win,URLSearchParams,location:{hash:new URL(launch).hash,href:launch},history:{replaceState(){} }};
 vm.runInNewContext(fs.readFileSync(require.resolve('../presentation.js'),'utf8'),sandbox);for(let i=0;i<30;i++)await Promise.resolve();assert.equal(requests,1);assert.deepEqual(mem.storage.read('dungeons-daiquiris.display-link.v1'),pairing);assert.equal([...timers.values()][0].delay,1000);
 // Existing icons launching the old bare URL get an explicit paste-once pairing form.
 const cold={...sandbox,D20:{...sandbox.D20,storage:memory().storage},location:{hash:'',href:base}};vm.runInNewContext(fs.readFileSync(require.resolve('../presentation.js'),'utf8'),cold);assert.equal(elements.get('#display-pair-dialog').open,true);for(let i=0;i<30;i++)await Promise.resolve();
 let replaced;const input=doc.querySelector('#display-pair-url');input.value=launch;cold.history.replaceState=(state,title,url)=>{replaced=url;cold.location.hash=new URL(url).hash;};elements.get('#display-pair-form').dispatchEvent(new Event('submit',{cancelable:true}));for(let i=0;i<30;i++)await Promise.resolve();assert.equal(replaced,launch);assert.deepEqual(cold.D20.storage.read('dungeons-daiquiris.display-link.v1',null),pairing);
});
test('pasted pairing links reject incomplete URLs and other origins',()=>{
 for(const value of [base,base+'#session=bad&view=x','https://evil.test/presentation.html'+new URL(D.displayPairing.startURL(pairing,base)).hash])assert.throws(()=>D.displayPairing.fromLink(value,base));
});
test('Kraken replacement preserves editable quantities/other settings, backs up the 151 config, and uses ordinary spirit pours',()=>{
 const mem=memory(),saved=D.ingredients.master.map(i=>({...D.clone(i),displayName:i.slot===9?'151 Rum':'Custom '+i.slot,abv:i.slot===9?75.5:i.abv,defaultMl:i.slot===9?22:17}));mem.storage.write(D.ingredients.key,saved);
 const repo=D.ingredients.createRepository(mem.storage),rum=repo.getById(9);assert.equal(rum.displayName,'Kraken Black Spiced Rum');assert.equal(rum.abv,40);assert.equal(rum.defaultMl,22);assert.equal(rum.overproof,false);assert.ok(!rum.tags.includes('overproof'));assert.deepEqual(mem.storage.read('dungeons-daiquiris.ingredients.before-kraken.v1'),saved);
 for(const i of repo.getAll().filter(i=>i.slot!==9)){assert.equal(i.displayName,'Custom '+i.slot);assert.equal(i.defaultMl,17);}
 const r=D.drinkGenerator.generateDrink([9,1,2].map(n=>repo.getById(n)));assert.equal(r.finalIngredients[0].finalMl,15);assert.equal(r.safety.status,'checked');assert.equal(r.warnings.some(w=>/overproof/i.test(w)),false);
 const three=D.drinkGenerator.generateDrink([9,7,12].map(n=>repo.getById(n)));assert.equal(three.totalVolumeMl,30);assert.deepEqual(three.finalIngredients.map(i=>i.finalMl),[10,10,10]);
});
test('custom rum identity and ABV are retained; old snapshots are never migrated with inventory',()=>{
 const mem=memory(),saved=D.ingredients.master.map(i=>({...D.clone(i),...(i.slot===9?{displayName:'My custom rum',abv:47,defaultMl:12}:{})}));mem.storage.write(D.ingredients.key,saved);const repo=D.ingredients.createRepository(mem.storage);assert.equal(repo.getById(9).abv,47);assert.equal(repo.getById(9).displayName,'My custom rum');
 const old=D.drinkGenerator.generateDrink([9,7,12].map(n=>({...D.clone(D.ingredients.master[n-1]),...(n===9?{displayName:'151 Rum',abv:75.5,overproof:true,tags:['rum','overproof'],maxGeneratorMl:5}:{})})));const history=D.drinkHistory.createRepository(mem.storage);history.saveGenerated(old);const before=JSON.stringify(history.getActive());repo.save(repo.getAll());assert.equal(JSON.stringify(history.getActive()),before);assert.equal(history.getActive().finalIngredients[0].displayName,'151 Rum');
});
