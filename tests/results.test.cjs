'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
for(const file of ['storage','ingredients','drink-generator','drink-history','gameplay','analytics','presentation-view'])require('../services/'+file+'.js');
const D=globalThis.D20;
function setup(){const data=new Map(),storage=D.createStorage({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)});return {storage,game:D.gameplay.createRepository(storage)};}
const recipe=(id,slots=[1,7,12])=>D.drinkGenerator.generateDrink(slots.map(n=>D.ingredients.master[n-1]),{id,createdAt:'2026-11-09T00:00:00Z'});
function award(game,r,count=2){const winners=game.get().players.slice(0,count).map((p,i)=>({playerId:p.id,multiplier:i===1?.5:1}));game.award(r,winners,D.gameplay.quote(r).starting);}
test('award presentation persists after clearing and refresh, updates exact winners/points, and yields to the next recipe',()=>{
 const {game,storage}=setup();game.start();const r=recipe('one');award(game,r,3);const source={gameplay:game.get(),currentEncounter:{id:r.id,snapshot:r}};
 const model=D.presentationView.modelFor(source);assert.equal(model.kind,'award');assert.equal(model.winners.length,3);assert.equal(model.winners[1].points,model.agreedPoints/2);
 assert.deepEqual(D.presentationView.modelFor({...source,currentEncounter:null}),model);
 assert.deepEqual(D.presentationView.modelFor({gameplay:D.gameplay.createRepository(storage).get(),currentEncounter:null}),model);
 assert.equal(D.presentationView.modelFor({...source,currentEncounter:null,lastRolledEncounterId:'skipped-new-roll'}).kind,'welcome');
 const next=recipe('two');assert.equal(D.presentationView.modelFor({...source,currentEncounter:{id:next.id,snapshot:next}}).kind,'drink');
});
test('finish is durable/idempotent and blocks further awards; new game archives results without changing the ledger',()=>{
 const {game,storage}=setup();game.start();const r=recipe('first');award(game,r);const before=D.clone(game.get().awards);game.finish();const finished=game.get();game.finish();assert.deepEqual(game.get(),finished);
 assert.equal(D.presentationView.modelFor({gameplay:finished,currentEncounter:{id:r.id,snapshot:r},awardEncounters:[{id:r.id,snapshot:r}]}).kind,'analytics');
 assert.throws(()=>game.award(recipe('no'),[{playerId:game.get().players[0].id,multiplier:1}],40),/not active/);assert.throws(()=>game.start(),/finished/);
 assert.ok(D.gameplay.isFinished(D.gameplay.createRepository(storage).get()));game.newGame();assert.equal(game.get().gameNumber,2);assert.deepEqual(game.get().awards,before);assert.equal(game.get().archives.length,1);assert.equal(D.gameplay.currentAwards(game.get()).length,0);assert.ok(D.gameplay.rankings(game.get()).every(p=>p.points===0));
 assert.equal(D.presentationView.modelFor({gameplay:game.get(),currentEncounter:null}).kind,'welcome');award(game,recipe('second'));assert.equal(game.get().awards.length,2);assert.equal(D.gameplay.currentAwards(game.get()).length,1);
});
test('analytics use actual recipients, points, half penalties and shared two-serving quantities, not an invented third serving',()=>{
 for(const n of [1,2,3]){const {game}=setup();game.start();const r=recipe('hot',[1,7,20]);award(game,r,n);game.finish();const report=D.analytics.report(game.get(),[{id:r.id,snapshot:r}]);
 assert.equal(report.totals.recipients,n);assert.equal(report.totals.penalties,n>1?1:0);assert.ok(Math.abs(report.totals.alcoholMl-r.pureAlcoholMl*Math.min(n,2))<1e-9);assert.equal(report.totals.points,game.get().awards[0].winners.reduce((s,w)=>s+w.points,0));assert.ok(report.totals.hotDrops>0);
 assert.ok(Math.abs(report.players.reduce((s,p)=>s+p.alcoholMl,0)-report.totals.alcoholMl)<1e-9);}
});
test('legacy batch quantities are halved for a single recipient; missing recipes are disclosed',()=>{
 const {game}=setup();game.start();const r=recipe('legacy');r.schemaVersion=1;delete r.quantityBasis;award(game,r,1);game.finish();const report=D.analytics.report(game.get(),[{id:r.id,snapshot:r}]);assert.equal(report.totals.alcoholMl,r.pureAlcoholMl/2);
 const unknown=D.analytics.report(game.get());assert.equal(unknown.totals.missingRecipes,1);assert.equal(unknown.totals.alcoholMl,0);
});
test('report pagination includes every contestant/round; identical finished polls do not restart scene animations',()=>{
 const {game}=setup();game.start();for(let n=0;n<12;n++)award(game,recipe('round-'+n));game.finish();const source={gameplay:game.get(),currentEncounter:null};const report=D.analytics.report(source.gameplay),pages=D.analytics.pages(report);
 assert.equal(pages.filter(p=>p.kind==='rankings').flatMap(p=>p.rows).length,10);assert.equal(pages.filter(p=>p.kind==='rounds').flatMap(p=>p.rows).length,12);assert.ok(pages.every(p=>p.rows.length<9));
 let enters=0;const view=D.presentationView.createSwitcher({show(){},leave(){},enter(){enters++},reducedMotion:()=>true});for(let n=0;n<10;n++)view.update(D.presentationView.modelFor({...source,revision:n}));assert.equal(enters,1);
});
test('spirit correction allows full mixed drinks, enforces each hard spirit at 15 mL and excludes lower-alcohol categories',()=>{
 for(const [slots,expectedSpirit]of [[[7,1,2],15],[[7,8,1],30],[[7,8,12],30],[[14,3,4],0],[[15,1,2],0]]){
 const r=recipe('limits',slots);assert.equal(r.spiritVolumeMl,expectedSpirit);assert.equal(r.totalVolumeMl,slots.every(n=>[7,8,12].includes(n))?30:90);assert.ok(D.drinkHistory.validDrink(r));
 for(const i of r.finalIngredients.filter(i=>/spirit/.test(i.category)))assert.ok(i.finalMl<=15);
 }
});
test('old 1.1 spirit/liqueur snapshots retain their original calculation semantics',()=>{
 const old=recipe('old',[7,8,15]);old.generatorVersion='1.1.0';delete old.spiritPolicy;old.totalVolumeMl=15;old.spiritVolumeMl=15;
 old.finalIngredients.forEach(i=>i.finalMl=5);old.pureAlcoholMl=old.finalIngredients.reduce((s,i)=>s+i.finalMl*i.abv/100,0);old.estimatedAbv=old.pureAlcoholMl/15*100;
 old.batch.totalVolumeMl=30;old.batch.spiritVolumeMl=30;old.batch.pureAlcoholMl=old.pureAlcoholMl*2;old.batch.estimatedAbv=old.estimatedAbv;old.batch.ingredients.forEach(i=>i.finalMl=10);
 assert.ok(D.drinkHistory.validDrink(old));const {storage}=setup(),history=D.drinkHistory.createRepository(storage);history.saveGenerated(old);assert.deepEqual(history.getActive(),old);
});
