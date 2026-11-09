'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
for(const name of ['storage','ingredients','drink-generator','serving-settings','drink-history','presentation-view'])require('../services/'+name+'.js');
const D=globalThis.D20,master=D.ingredients.master;
function recipe(slots,options={}){return D.drinkGenerator.generateDrink(slots.map(n=>D.clone(master[n-1])),{id:'portion',createdAt:'2026-11-09T00:00:00Z',...options})}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const memory=()=>{const data=new Map();const driver={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};return {data,driver,storage:D.createStorage(driver)}};
test('hard spirits have individual 15 mL and combined 30 mL limits; low-alcohol liqueurs are excluded',()=>{
 for(const slots of [[7,8,12],[7,13,15],[1,7,12],[7,8,15]]){
  const r=recipe(slots);assert.ok(r.spiritVolumeMl<=30);assert.ok(r.totalVolumeMl<=90);assert.equal(r.servingCount,2);
  for(const item of r.finalIngredients.filter(i=>/spirit/.test(i.category)))assert.ok(item.finalMl<=15);
  if(slots.every(n=>/spirit/.test(master[n-1].category))){assert.equal(r.servingStyle,'small');assert.equal(r.totalVolumeMl,30);}
 }
 const r=recipe([1,7,12]);assert.equal(r.spiritVolumeMl,30);assert.equal(r.totalVolumeMl,90);
});
test('beer/cider mixtures can reach 90 mL; smaller requested pours are never padded',()=>{
 const r=recipe([3,4,6]);assert.equal(r.totalVolumeMl,90);assert.deepEqual(r.finalIngredients.map(i=>i.finalMl),[30,30,30]);
 const input=[3,4,6].map(n=>({...D.clone(master[n-1]),defaultMl:3}));
 const small=D.drinkGenerator.generateDrink(input,{inventory:master});assert.equal(small.totalVolumeMl,9);assert.equal(small.generatorAdditions.length,0);
});
test('hot sauce is whole drops, savoury flavourings stay sparse, and batch drops double exactly',()=>{
 const r=recipe([20,17,3]);const hot=r.finalIngredients[0],worcester=r.finalIngredients[1];
 assert.equal(hot.measurementUnit,'drops');assert.equal(hot.drops,1);near(hot.finalMl,.05);assert.ok(worcester.finalMl<=1);assert.equal(r.totalVolumeMl,15);
 assert.equal(r.batch.ingredients[0].drops,2);near(r.batch.ingredients[0].finalMl,.1);
 assert.match(r.preparationSteps.join(' '),/1 drop/);assert.ok(r.preparationSteps.at(-1).includes('add last'));
 const calibrated=recipe([1,7,20],{policy:{dropMl:.1}});assert.equal(calibrated.finalIngredients[2].drops,2);near(calibrated.finalIngredients[2].finalMl,.2);
});
test('dairy/citrus keeps compatibility warnings and never receives automatic lime',()=>{
 for(const acid of [6,14,18]){
  const r=recipe([15,acid,7],{inventory:master});assert.ok(r.totalVolumeMl<=30);assert.ok(r.compatibilityFlags.includes('dairy_acid'));
  assert.equal(r.generatorAdditions.some(i=>i.kind==='lime'),false);assert.match(r.warnings.join(' '),/curdle/);assert.ok(!/shake/i.test(r.preparationMethod));
 }
 assert.equal(recipe([1,7,15],{inventory:master}).generatorAdditions.some(i=>i.kind==='lime'),false);
});
test('balancing lime must be available, non-alcoholic, enabled, absent from the roll and useful',()=>{
 const r=recipe([1,7,12],{inventory:master});const lime=r.generatorAdditions.find(i=>i.kind==='lime');assert.ok(lime);assert.equal(lime.slot,18);assert.ok(lime.finalMl<=2);assert.ok(r.totalVolumeMl<=90);
 for(const inventory of [undefined,[],master.map(i=>({...i,...(i.slot===18?{defaultMl:0}:{})})),master.map(i=>({...i,...(i.slot===18?{available:false}:{})})),master.map(i=>({...i,...(i.slot===18?{abv:10}:{})}))])assert.equal(recipe([1,7,12],{inventory}).generatorAdditions.some(i=>i.kind==='lime'),false);
 for(const [slots,policy]of [[[1,7,12],{autoLime:false}],[[3,4,16],{}],[[7,8,18],{}],[[1,6,7],{}]])assert.equal(recipe(slots,{inventory:master,policy}).generatorAdditions.some(i=>i.kind==='lime'),false);
});
test('water and ice are opt-in inventory extras, count liquid additions and preserve alcohol maths',()=>{
 const plain=recipe([7,8,12]);assert.equal(plain.generatorAdditions.length,0);
 const r=recipe([7,8,12],{policy:{waterAvailable:true,iceAvailable:true},inventory:master});assert.ok(r.generatorAdditions.some(i=>i.kind==='water'));assert.ok(r.generatorAdditions.some(i=>i.kind==='ice'));assert.ok(r.totalVolumeMl<=30);
 const liquids=[...r.finalIngredients,...r.generatorAdditions.filter(i=>i.kind!=='ice')];const volume=liquids.reduce((sum,i)=>sum+i.finalMl,0),alcohol=liquids.reduce((sum,i)=>sum+i.finalMl*i.abv/100,0);
 near(r.totalVolumeMl,volume);near(r.pureAlcoholMl,alcohol);near(r.estimatedAbv,alcohol/volume*100);
});
test('two servings are identical; ABV stays constant and every liquid and alcohol total doubles',()=>{
 const r=recipe([7,8,12],{inventory:master,policy:{waterAvailable:true}});
 near(r.batch.totalVolumeMl,r.totalVolumeMl*2);near(r.batch.pureAlcoholMl,r.pureAlcoholMl*2);near(r.batch.spiritVolumeMl,r.spiritVolumeMl*2);near(r.batch.estimatedAbv,r.estimatedAbv);
 r.finalIngredients.forEach((i,n)=>near(r.batch.ingredients[n].finalMl,i.finalMl*2));
 r.generatorAdditions.forEach((i,n)=>near(r.batch.generatorAdditions[n].finalMl,i.finalMl*2));
 assert.ok(D.drinkHistory.validDrink(r));
 const bad=D.clone(r);bad.batch.ingredients[0].finalMl++;assert.equal(D.drinkHistory.validDrink(bad),false);
});
test('all 1,140 combinations with available lime/extras satisfy per-serving, spirit and batch invariants',()=>{
 let count=0;
 for(let a=1;a<19;a++)for(let b=a+1;b<20;b++)for(let c=b+1;c<21;c++){
  const r=recipe([a,b,c],{inventory:master,policy:{waterAvailable:true,iceAvailable:true,maxSpiritMl:20,smallServingMl:25}});count++;
  assert.ok(r.totalVolumeMl<=90&&r.totalVolumeMl<=r.servingLimitMl);assert.ok(r.spiritVolumeMl<=20);assert.ok(D.drinkHistory.validDrink(r));near(r.batch.totalVolumeMl,r.totalVolumeMl*2);
 }
 assert.equal(count,1140);
});
test('unsafe flags, concentrated flavouring-only rolls and excessive undiluted strength never recommend serving',()=>{
 const input=[7,8,12].map(n=>({...D.clone(master[n-1]),unsafeForConsumption:n===7}));
 const marked=D.drinkGenerator.generateDrink(input),sauces=recipe([17,19,20]);
 const concentrated=D.drinkGenerator.generateDrink([1,7,12].map(n=>({...D.clone(master[n-1]),abv:n===1?0:100})),{inventory:master,policy:{waterAvailable:true}});
 for(const r of [marked,sauces,concentrated]){assert.equal(r.safeToServe,false);assert.equal(r.safety.status,'blocked');assert.equal(r.preparationMethod,'Do not prepare or serve');assert.match(r.preparationSteps.join(' '),/Do not prepare or consume/);assert.equal(D.presentationView.modelFor({currentEncounter:{id:r.id,snapshot:r,servings:2}}).blocked,true);assert.ok(D.drinkHistory.validDrink(r));}
});
test('serving settings are persisted separately; hard ceilings cannot be raised by settings',()=>{
 const m=memory();m.storage.write(D.ingredients.key,master.map(i=>({slot:i.slot,displayName:'Saved '+i.slot,defaultMl:42,abv:i.abv})));
 const raw=m.data.get(D.ingredients.key),repo=D.servingSettings.createRepository(m.storage);
 assert.equal(repo.get().maxServingMl,90);assert.equal(m.data.has(D.servingSettings.key),false);
 repo.save({...repo.get(),maxServingMl:60,shotMl:10,maxSpiritMl:12,iceAvailable:true});
 assert.equal(D.servingSettings.createRepository(m.storage).get().shotMl,10);assert.equal(m.data.get(D.ingredients.key),raw);
 for(const changes of [{maxServingMl:91},{shotMl:16},{maxSpiritMl:31},{dropMl:.015},{smallServingMl:46}])assert.throws(()=>repo.save({...repo.get(),...changes}));
 const r=recipe([7,8,12],{policy:repo.get()});assert.ok(r.totalVolumeMl<=12);assert.ok(r.spiritVolumeMl<=12);
});
test('failed/corrupt serving-setting writes preserve records and the previous settings',()=>{
 const m=memory(),repo=D.servingSettings.createRepository(m.storage);repo.save({...repo.get(),shotMl:10});
 const raw=m.data.get(D.servingSettings.key);m.driver.setItem=()=>{throw Error('quota')};assert.throws(()=>repo.save({...repo.get(),shotMl:5}));assert.equal(repo.get().shotMl,10);assert.equal(m.data.get(D.servingSettings.key),raw);
 m.data.set(D.servingSettings.key,'broken');const broken=D.servingSettings.createRepository(m.storage);assert.ok(broken.getWarning());assert.equal(m.data.get(D.servingSettings.key),'broken');
});
test('legacy 150 mL snapshot remains byte-for-byte equivalent when read and after saving a new drink',()=>{
 const m=memory();const old={schemaVersion:1,generatorVersion:'1.0.0',id:'legacy',createdAt:'2026-11-08T00:00:00Z',bartenderTitle:'Original drink',bartenderSummary:'Original commentary',rolledIngredients:D.clone(master.slice(0,3)),finalIngredients:master.slice(0,3).map(i=>({...D.clone(i),finalMl:50})),generatorAdditions:[],totalVolumeMl:150,pureAlcoholMl:2.5,estimatedAbv:2.5/150*100,preparationMethod:'Original method',preparationSteps:['Original steps'],warnings:[],generatorNotes:['Original notes']};
 m.storage.write(D.drinkHistory.key,{version:1,drinks:[old],activeDrink:old});const raw=m.data.get(D.drinkHistory.key),repo=D.drinkHistory.createRepository(m.storage);
 assert.deepEqual(repo.getActive(),old);assert.equal(m.data.get(D.drinkHistory.key),raw);assert.match(D.presentationView.modelFor({currentEncounter:{id:old.id,snapshot:old,servings:2}}).stats,/150 mL total/);
 repo.finish(old);repo.saveGenerated(recipe([7,8,12]));assert.deepEqual(repo.get('legacy'),old);assert.equal(repo.list().length,2);
});
test('new snapshots survive the existing encounter queue and retain visible drops and per-serving labels',async()=>{
 require('../services/session.js');const m=memory(),r=recipe([20,17,3]);
 m.storage.write(D.sessions.key,{id:'existing',viewToken:'a'.repeat(64),pending:[],revision:0,creating:false});
 const received=[];const repo=D.sessions.createRepository({rpc:async(name,p)=>{if(name==='d20_mutate')received.push(p.p_payload);return {revision:1}}},m.storage);
 repo.enqueue('encounter',r);await repo.flush();assert.deepEqual(received[0],r);
 const model=D.presentationView.modelFor({currentEncounter:{id:r.id,snapshot:r,servings:2}});assert.match(model.ingredients[0].amount,/1 drop/);assert.match(model.stats,/per serving/);assert.match(model.stats,/30 mL batch/);
});

test('compressed alcohol-heavy mixtures stay small without becoming mandatory 15 mL shots',()=>{
 const r=recipe([17,3,7],{inventory:master});assert.equal(r.servingStyle,'small');assert.ok(r.totalVolumeMl<=30);
 for(let a=1;a<19;a++)for(let b=a+1;b<20;b++)for(let c=b+1;c<21;c++){
   const result=recipe([a,b,c],{inventory:master});if(result.estimatedAbv>=30)assert.ok(result.totalVolumeMl<=30);
 }
});

test('unavailable ice is never mentioned in preparation, and fractional policies retain exact hundredths',()=>{
 const plain=recipe([7,8,12]);assert.ok(!/\bice\b/i.test(plain.preparationSteps.join(' ')));
 const r=recipe([7,8,12],{inventory:master,policy:{smallServingMl:15.01,waterAvailable:true}});assert.ok(r.totalVolumeMl<=15.01);assert.ok(D.drinkHistory.validDrink(r));
 const tiny=recipe([7,8,12],{inventory:master,policy:{maxSpiritMl:.01,waterAvailable:true}});assert.equal(tiny.generatorAdditions.length,0);assert.ok(D.drinkHistory.validDrink(tiny));
});
