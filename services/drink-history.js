'use strict';
(() => {
  const app = globalThis.D20;
  const KEY = 'dungeons-daiquiris.drinks.v1';
  const empty = () => ({ version:1, drinks:[], activeDrink:null });
  const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-7;
  function validServingSnapshot(drink){
    if(drink.schemaVersion!==2)return true; // Keep every legacy snapshot's original basis and limits.
    const batch=drink.batch;
    if(drink.quantityBasis!=='per_serving'||drink.servingCount!==2||drink.totalVolumeMl>90||!Number.isFinite(drink.servingLimitMl)||drink.servingLimitMl>90||drink.totalVolumeMl>drink.servingLimitMl||!Number.isFinite(drink.spiritVolumeMl)||drink.spiritVolumeMl<0||drink.spiritVolumeMl>30||!batch||batch.servings!==2||!near(batch.totalVolumeMl,drink.totalVolumeMl*2)||!near(batch.pureAlcoholMl,drink.pureAlcoholMl*2)||!near(batch.spiritVolumeMl,drink.spiritVolumeMl*2)||!near(batch.estimatedAbv,drink.estimatedAbv)||!Array.isArray(batch.ingredients)||batch.ingredients.length!==3||!Array.isArray(batch.generatorAdditions)||batch.generatorAdditions.length!==drink.generatorAdditions.length||typeof drink.safeToServe!=='boolean'||!drink.safety||!['blocked','checked','empty'].includes(drink.safety.status)||!Array.isArray(drink.safety.reasons))return false;
    const liquids=[...drink.finalIngredients,...drink.generatorAdditions.filter(item=>item.kind!=='ice')];
    if(!liquids.every(item=>Number.isFinite(item.finalMl)&&item.finalMl>=0&&Number.isFinite(item.abv)&&item.abv>=0&&item.abv<=100))return false;
    const volume=liquids.reduce((sum,item)=>sum+item.finalMl,0),alcohol=liquids.reduce((sum,item)=>sum+item.finalMl*item.abv/100,0);
    if(!near(volume,drink.totalVolumeMl)||!near(alcohol,drink.pureAlcoholMl)||!near(volume?alcohol/volume*100:0,drink.estimatedAbv))return false;
    const spirits=drink.finalIngredients.filter(item=>/spirit|liqueur/.test(item.category)||item.overproof||item.tags?.includes('overproof')||item.abv>=20);
    if(!near(spirits.reduce((sum,item)=>sum+item.finalMl,0),drink.spiritVolumeMl))return false;
    if(drink.safety.status==='blocked'&&(drink.safeToServe||drink.preparationMethod!=='Do not prepare or serve'))return false;
    if(drink.safeToServe!==(drink.totalVolumeMl>0&&drink.safety.status!=='blocked'))return false;
    return drink.finalIngredients.every((item,index)=>{
      const batched=batch.ingredients[index];
      return batched.slot===item.slot&&batched.displayName===item.displayName&&near(batched.finalMl,item.finalMl*2)&&near(batched.abv,item.abv)&&(item.measurementUnit!=='drops'||(Number.isInteger(item.drops)&&near(item.finalMl,item.drops*item.nominalDropMl)&&batched.drops===item.drops*2));
    })&&drink.generatorAdditions.every((item,index)=>item.kind===batch.generatorAdditions[index].kind&&(item.kind==='ice'||near(batch.generatorAdditions[index].finalMl,item.finalMl*2)));
  }
  function validDrink(drink) {
    return drink && typeof drink.id === 'string' && Number.isFinite(Date.parse(drink.createdAt)) &&
      typeof drink.bartenderTitle === 'string' && typeof drink.bartenderSummary === 'string' &&
      Array.isArray(drink.rolledIngredients) && drink.rolledIngredients.length === 3 &&
      Array.isArray(drink.finalIngredients) && drink.finalIngredients.length === 3 &&
      drink.finalIngredients.every(item => Number.isInteger(item.slot) && typeof item.displayName === 'string' && Number.isFinite(item.finalMl) && item.finalMl >= 0) &&
      Array.isArray(drink.generatorAdditions) && Array.isArray(drink.preparationSteps) &&
      Array.isArray(drink.warnings) && Array.isArray(drink.generatorNotes) &&
      Number.isFinite(drink.totalVolumeMl) && drink.totalVolumeMl >= 0 && drink.totalVolumeMl <= 150 &&
      Number.isFinite(drink.pureAlcoholMl) && Number.isFinite(drink.estimatedAbv) && validServingSnapshot(drink);
  }
  function createRepository(storage = app.storage) {
    function read() {
      const data = storage.read(KEY, empty());
      if (!data || data.version !== 1 || !Array.isArray(data.drinks) || !data.drinks.every(validDrink) ||
          (data.activeDrink !== null && !validDrink(data.activeDrink))) throw new Error('Drink history could not be read. Stored data has not been replaced.');
      return data;
    }
    function upsert(data, drink) {
      if (!validDrink(drink)) throw new Error('Invalid drink result');
      if (!data.drinks.some(item => item.id === drink.id)) data.drinks.unshift(app.clone(drink));
    }
    return {
      list: () => read().drinks.sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      get: id => read().drinks.find(item => item.id === id) || null,
      getActive: () => read().activeDrink,
      saveGenerated(drink) {
        const data = read();
        if (data.activeDrink && data.activeDrink.id !== drink.id) throw new Error('Finish the current drink before generating another.');
        upsert(data, drink);
        data.activeDrink = app.clone(drink);
        storage.write(KEY, data);
      },
      finish(drink) {
        const data = read();
        if (data.activeDrink && data.activeDrink.id !== drink.id) throw new Error('The active drink changed in another tab. Reload to continue.');
        upsert(data, drink);
        data.activeDrink = null;
        storage.write(KEY, data);
      },
      clear() {
        // Explicitly confirmed deletion can also recover an unreadable history record.
        let activeDrink = null;
        try { activeDrink = read().activeDrink; } catch { /* damaged history remains until this explicit action */ }
        storage.write(KEY, { ...empty(), activeDrink });
      },
    };
  }
  app.drinkHistory = { key:KEY, createRepository, validDrink };
})();
