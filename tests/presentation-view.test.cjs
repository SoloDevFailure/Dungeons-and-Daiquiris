'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../services/storage.js');require('../services/drink-history.js');require('../services/ingredients.js');require('../services/drink-generator.js');require('../services/presentation-view.js');
const D=globalThis.D20;
const state=(id='a',slots=[1,7,12])=>({revision:1,currentEncounter:{id,servings:2,snapshot:D.drinkGenerator.generateDrink(slots.map(n=>D.ingredients.master[n-1]),{id,createdAt:'2026-11-09T00:00:00Z'})}});
function setup(){const events=[],timers=new Map();let id=0,reduced=false;
 const scene=D.presentationView.createSwitcher({show:model=>events.push(['show',model]),leave:kind=>events.push(['leave',kind]),enter:(kind,animate)=>events.push(['enter',kind,animate]),setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id},clearTimer:id=>timers.delete(id),reducedMotion:()=>reduced});
 return {scene,events,timers,reduced:()=>reduced=true,finish:()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn()}};
}
test('welcome model and exact recipe model are built from remote snapshots without mutation',()=>{
 assert.deepEqual(D.presentationView.modelFor({currentEncounter:null}),{key:'welcome',kind:'welcome'});
 const source=state();const before=JSON.stringify(source),model=D.presentationView.modelFor(source);
 assert.equal(model.title,source.currentEncounter.snapshot.bartenderTitle);
 assert.deepEqual(model.ingredients.map(item=>item.amount),source.currentEncounter.snapshot.finalIngredients.map(item=>`${item.finalMl} mL`));
 assert.match(model.additions,/Ice/);assert.match(model.stats,/2 servings/);assert.equal(JSON.stringify(source),before);
 assert.throws(()=>D.presentationView.modelFor({currentEncounter:{id:'bad',snapshot:{}}}),/could not be displayed/);
});
test('new drink waits for outgoing fade before reveal; ordinary polling/revision changes do nothing',()=>{
 const h=setup(),source=state();h.scene.update(D.presentationView.modelFor(source));
 assert.equal(h.events[0][0],'leave');assert.equal(h.events.some(e=>e[0]==='show'),false);assert.equal([...h.timers.values()][0].delay,420);
 h.finish();assert.equal(h.scene.getKey(),'drink:a');assert.deepEqual(h.events.at(-1),['enter','drink',true]);
 const count=h.events.length;
 for(let revision=2;revision<=10;revision++)h.scene.update(D.presentationView.modelFor({...source,revision,players:[{name:'Ryan'}]}));
 assert.equal(h.events.length,count);assert.equal(h.timers.size,0);
});
test('new encounter with identical title still animates once; returning to welcome fades out',()=>{
 const h=setup();h.scene.update(D.presentationView.modelFor(state('a')),{immediate:true});
 h.scene.update(D.presentationView.modelFor(state('b')));h.finish();assert.equal(h.scene.getKey(),'drink:b');
 h.scene.update(D.presentationView.modelFor({currentEncounter:null}));h.finish();assert.equal(h.scene.getKey(),'welcome');assert.deepEqual(h.events.at(-1),['enter','welcome',true]);
});
test('rapid updates coalesce; stale transitions never paint a replaced encounter',()=>{
 const h=setup();h.scene.update(D.presentationView.modelFor(state('a')),{immediate:true});
 h.scene.update(D.presentationView.modelFor(state('b')));h.scene.update(D.presentationView.modelFor(state('c')));
 assert.equal(h.timers.size,1);h.finish();assert.equal(h.scene.getKey(),'drink:c');
 assert.equal(h.events.filter(e=>e[0]==='show'&&e[1].key==='drink:b').length,0);
});
test('hidden presentation cancels transition timers and resumes the latest state without replay',()=>{
 const h=setup();h.scene.update(D.presentationView.modelFor(state('a')),{immediate:true});
 h.scene.update(D.presentationView.modelFor(state('b')));h.scene.suspend();assert.equal(h.timers.size,0);
 const count=h.events.length;h.scene.update(D.presentationView.modelFor(state('c')));assert.equal(h.events.length,count);
 h.scene.resume();assert.equal(h.scene.getKey(),'drink:c');assert.deepEqual(h.events.at(-1),['enter','drink',false]);
});
test('refresh restoration and reduced motion show the right scene immediately',()=>{
 const h=setup();h.scene.update(D.presentationView.modelFor(state()),{immediate:true});assert.equal(h.timers.size,0);assert.deepEqual(h.events.at(-1),['enter','drink',false]);
 h.reduced();h.scene.update(D.presentationView.modelFor(state('b')));assert.equal(h.timers.size,0);assert.equal(h.scene.getKey(),'drink:b');
});
test('same-encounter commentary updates never replay entrance animations',()=>{
 const h=setup(),source=state();h.scene.update(D.presentationView.modelFor(source),{immediate:true});
 source.currentEncounter.snapshot.bartenderSummary='Updated commentary';h.scene.update(D.presentationView.modelFor(source));
 assert.equal(h.events.at(-2)[1].summary,'Updated commentary');assert.deepEqual(h.events.at(-1),['enter','drink',false]);assert.equal(h.timers.size,0);
});
test('long names and fractional mL remain exact rather than being truncated for the TV',()=>{
 const source=state();source.currentEncounter.snapshot.bartenderTitle='An extremely long title '.repeat(20);
 source.currentEncounter.snapshot.finalIngredients[0].displayName='A'.repeat(100);source.currentEncounter.snapshot.finalIngredients[0].finalMl=0.01;
 const model=D.presentationView.modelFor(source);assert.equal(model.title,source.currentEncounter.snapshot.bartenderTitle);assert.equal(model.ingredients[0].name.length,100);assert.equal(model.ingredients[0].amount,'0.01 mL');
});

test('stock tagline is suppressed while an actual drink description is preserved',()=>{
 const source=state();assert.equal(D.presentationView.modelFor(source).summary,'');
 source.currentEncounter.snapshot.bartenderSummary='A smoky citrus drink with a sharp finish.';
 assert.equal(D.presentationView.modelFor(source).summary,'A smoky citrus drink with a sharp finish.');
 source.currentEncounter.snapshot.bartenderSummary='';assert.equal(D.presentationView.modelFor(source).summary,'');
});
