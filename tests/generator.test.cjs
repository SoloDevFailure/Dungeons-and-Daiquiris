'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
for (const file of ['storage','ingredients','drink-generator','drink-history','ai-service']) require(`../services/${file}.js`);
const D = globalThis.D20;
const context = {id:'test-drink',createdAt:'2026-09-25T12:00:00.000Z'};
const master = D.ingredients.master;
const generate = (slots, edit = {}) => D.drinkGenerator.generateDrink(slots.map(slot => ({...D.clone(master[slot-1]),...edit[slot]})),context);
function memory() {
  const data = new Map();
  const driver = {getItem:key=>data.get(key) ?? null,setItem:(key,value)=>data.set(key,value)};
  return {data,driver,storage:D.createStorage(driver)};
}
test('every default three-slot combination respects volume, alcohol and preparation constraints', () => {
  let checked=0;
  for(let a=1;a<=18;a++) for(let b=a+1;b<=19;b++) for(let c=b+1;c<=20;c++) {
    const result=generate([a,b,c]); checked++;
    assert.equal(result.finalIngredients.length,3);
    assert.ok(result.totalVolumeMl<=90 && result.totalVolumeMl<=result.servingLimitMl && result.totalVolumeMl>=0);
    assert.ok(result.spiritVolumeMl<=30);assert.ok(D.drinkHistory.validDrink(result));
    for(const item of result.finalIngredients) assert.ok(item.finalMl>0 && item.finalMl<=item.defaultMl && item.finalMl<=item.maxGeneratorMl);
    const total=result.finalIngredients.reduce((s,i)=>s+i.finalMl,0)+result.generatorAdditions.filter(i=>i.kind!=='ice').reduce((s,i)=>s+i.finalMl,0);
    assert.ok(Math.abs(total-result.totalVolumeMl)<1e-9);
    const alcohol=result.finalIngredients.reduce((s,i)=>s+i.finalMl*i.abv/100,0);
    assert.equal(alcohol,result.pureAlcoholMl);
    assert.ok(Math.abs(result.estimatedAbv-alcohol/total*100)<1e-9);
    if(result.preparationConstraints.containsCarbonation || result.compatibilityFlags.includes('dairy_acid')) assert.ok(!/shake/i.test(result.preparationMethod));
    assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
  }
  assert.equal(checked,1140);
});
test('mixer compression precedes spirits and equal-priority reductions are shared', () => {
  const r=generate([12,1,16]);
  assert.deepEqual(r.finalIngredients.map(i=>i.finalMl),[15,1,74]);
  assert.equal(r.totalVolumeMl,90);
  const beers=generate([3,4,16]);
  assert.deepEqual(beers.finalIngredients.map(i=>i.finalMl),[30,30,30]);
});
test('triple spirits share the 30 mL spirit allowance without unconfigured extras', () => {
  const r=generate([7,8,12]);
  assert.deepEqual(r.finalIngredients.map(i=>i.finalMl),[10,10,10]);
  assert.equal(r.generatorAdditions.length,0);assert.equal(r.totalVolumeMl,30);
  assert.equal(r.pureAlcoholMl,11.75);assert.ok(Math.abs(r.estimatedAbv-39.16666666666667)<1e-9);
  assert.equal(r.batch.totalVolumeMl,60);assert.equal(r.batch.spiritVolumeMl,60);
});
test('overproof, condiments and extreme editor values cannot bypass caps', () => {
  const r=generate([9,7,12],{9:{defaultMl:300},7:{defaultMl:900},12:{defaultMl:1e100}});
  assert.ok(r.finalIngredients[0].finalMl<=5);
  assert.ok(r.totalVolumeMl<=90);
  assert.equal(r.finalIngredients[0].abv,75.5);
  const condiments=generate([17,19,20],{17:{defaultMl:1000},19:{defaultMl:1000},20:{defaultMl:1000}});
  assert.deepEqual(condiments.finalIngredients.map(i=>i.finalMl),[1,3,.05]);
  assert.equal(condiments.totalVolumeMl,4.05);
  assert.equal(condiments.generatorAdditions.some(i=>i.kind==='water'),false);
});
test('dairy conflicts, carbonation and high-impact ordering', () => {
  for(const acid of [6,14,18]) {
    const r=generate([15,acid,7]);
    assert.ok(r.compatibilityFlags.includes('dairy_acid'));
    assert.ok(!/shake/i.test(r.preparationMethod));
  }
  const r=generate([8,16,20]);
  assert.match(r.preparationSteps.at(-1),/Hot Sauce.*add last/);
  assert.match(r.preparationSteps.join(' '),/never shake carbonated/);
  const future=generate([7,8,12],{7:{tags:['carbonated'],carbonated:false,canShake:true}});
  assert.equal(future.preparationConstraints.containsCarbonation,true);
  assert.ok(!/shake/i.test(future.preparationMethod));
});
test('zero/fractional pours, no fill-to-target, deterministic output and immutable inputs', () => {
  const zero=generate([1,2,3],{1:{defaultMl:0},2:{defaultMl:0},3:{defaultMl:0}});
  assert.equal(zero.totalVolumeMl,0); assert.equal(zero.estimatedAbv,0);
  assert.equal(zero.finalIngredients.length,3);
  assert.equal(generate([17,18,20]).totalVolumeMl,6.05);
  const fractional=generate([1,3,16],{1:{defaultMl:99.999},3:{defaultMl:99.999},16:{defaultMl:99.999}});
  assert.ok(fractional.totalVolumeMl<=90);
  const input=[7,8,9].map(s=>D.clone(master[s-1])); const original=D.clone(input);
  assert.deepEqual(D.drinkGenerator.generateDrink(input,context),D.drinkGenerator.generateDrink(input,context));
  assert.deepEqual(input,original);
});
test('invalid selections fail instead of generating incomplete recipes', () => {
  for(const slots of [[],[1],[1,2],[1,1,2]]) assert.throws(()=>generate(slots));
  assert.throws(()=>generate([1,2,3],{1:{defaultMl:Infinity}}));
});
test('all combinations of extreme defaults still satisfy invariants', () => {
  for(let a=1;a<=18;a++) for(let b=a+1;b<=19;b++) for(let c=b+1;c<=20;c++) {
    const edit=Object.fromEntries([a,b,c].map(s=>[s,{defaultMl:99999}]));
    const r=generate([a,b,c],edit);
    assert.ok(r.totalVolumeMl<=90);
    assert.ok(r.finalIngredients.every(i=>i.finalMl>0 && i.finalMl<=i.maxGeneratorMl));
  }
});
test('editable ABV persists, fixed caps stay protected, and old defaults migrate per field', () => {
  const mem=memory(); const repo=D.ingredients.createRepository(mem.storage);
  const edited=repo.getAll(); edited[8].defaultMl=999; edited[8].abv=0; edited[8].maxGeneratorMl=999;
  repo.save(edited);
  const reloaded=D.ingredients.createRepository(mem.storage);
  assert.equal(reloaded.getById(9).defaultMl,999);
  assert.equal(reloaded.getById(9).abv,0);
  assert.equal(reloaded.getById(9).maxGeneratorMl,5);
  const legacy=[['Coke',100],['Lemonade',100],['Peroni',100],['Great Northern',100],['XXXX Gold',100],['Cider',100],['Vodka',30],['Gin',30],['White Rum',30],['Tequila',30],['Bourbon',30],["Custom whiskey",45],['Spiced Rum',30],['Red Wine',60],['Baileys',30],['Guinness',100],['Worcestershire Sauce',15],['Lime Juice',20],['Tomato Sauce',15],['Hot Sauce',10]].map(([name,amountMl],i)=>({id:i+1,name,amountMl}));
  const old=memory(); old.storage.write('dungeons-daiquiris.ingredients.v1',legacy);
  const migrated=D.ingredients.createRepository(old.storage);
  assert.equal(migrated.getById(1).displayName,'Coca-Cola'); assert.equal(migrated.getById(1).defaultMl,80);
  assert.equal(migrated.getById(12).displayName,'Custom whiskey'); assert.equal(migrated.getById(12).defaultMl,45);
  assert.equal(migrated.getById(9).displayName,'151 Rum'); assert.equal(migrated.getById(9).defaultMl,15);
});
test('history preserves snapshots, ordering, active state and reset independently of ingredient changes', () => {
  const mem=memory(); const repo=D.drinkHistory.createRepository(mem.storage);
  const first=generate([1,8,12]); repo.saveGenerated(first); repo.saveGenerated(first);
  assert.equal(repo.list().length,1);
  first.finalIngredients[0].displayName='Mutated externally';
  assert.equal(repo.get('test-drink').finalIngredients[0].displayName,'Coca-Cola');
  repo.finish(repo.getActive()); assert.equal(repo.getActive(),null);
  const second=D.drinkGenerator.generateDrink([1,3,16].map(s=>master[s-1]),{id:'second',createdAt:'2026-09-26T12:00:00Z'});
  repo.saveGenerated(second); assert.equal(repo.list()[0].id,'second');
  repo.clear(); assert.equal(repo.list().length,0); assert.equal(repo.getActive().id,'second');
  repo.finish(second); assert.equal(repo.list().length,1); assert.equal(repo.getActive(),null);
});
test('failed writes do not discard saved history or ingredient settings', () => {
  const mem=memory(); const repo=D.drinkHistory.createRepository(mem.storage);
  const r=generate([1,2,3]); repo.saveGenerated(r);
  mem.driver.setItem=()=>{throw new Error('Quota exceeded')};
  assert.throws(()=>repo.finish(r)); assert.equal(repo.getActive().id,r.id);
  const ingredients=D.ingredients.createRepository(mem.storage);
  const edit=ingredients.getAll(); edit[0].displayName='Unsaved';
  assert.throws(()=>ingredients.save(edit)); assert.equal(ingredients.getById(1).displayName,'Coca-Cola');
});
test('damaged history is not silently overwritten; clear is an explicit recovery', () => {
  const mem=memory(); mem.data.set(D.drinkHistory.key,'broken JSON');
  const repo=D.drinkHistory.createRepository(mem.storage);
  assert.throws(()=>repo.list()); assert.throws(()=>repo.saveGenerated(generate([1,2,3])));
  assert.equal(mem.data.get(D.drinkHistory.key),'broken JSON');
  repo.clear(); assert.deepEqual(repo.list(),[]);
});
test('AI hook is offline, serialisable and cannot mutate the recipe', async () => {
  const r=generate([9,12,16]); const original=D.clone(r);
  const payload=D.aiService.buildAIPayload(r); payload.finalIngredients[0].finalMl=999;
  assert.deepEqual(r,original);
  const originalFetch=globalThis.fetch; globalThis.fetch=()=>{throw new Error('Network forbidden')};
  try { assert.equal(await D.aiService.promptAPI(r),null); } finally { globalThis.fetch=originalFetch; }
  assert.equal(r.apiStatus,'not_configured');
  assert.deepEqual(JSON.parse(JSON.stringify(D.aiService.buildAIPayload(r))),D.aiService.buildAIPayload(r));
});

test('legacy custom settings remain usable if migration cannot be written', () => {
  const mem=memory();
  const legacy=master.map(item=>({id:item.slot,name:`Custom ${item.slot}`,amountMl:42}));
  mem.storage.write('dungeons-daiquiris.ingredients.v1',legacy);
  mem.driver.setItem=()=>{throw new Error('Storage full')};
  const repo=D.ingredients.createRepository(mem.storage);
  assert.equal(repo.getById(12).displayName,'Custom 12');
  assert.equal(repo.getById(12).defaultMl,42);
  assert.match(repo.getWarning(),/could not be migrated/);
});
