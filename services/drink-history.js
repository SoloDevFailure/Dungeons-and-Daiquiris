'use strict';
(() => {
  const app = globalThis.D20;
  const KEY = 'dungeons-daiquiris.drinks.v1';
  const empty = () => ({ version:1, drinks:[], activeDrink:null });
  function validDrink(drink) {
    return drink && typeof drink.id === 'string' && Number.isFinite(Date.parse(drink.createdAt)) &&
      typeof drink.bartenderTitle === 'string' && typeof drink.bartenderSummary === 'string' &&
      Array.isArray(drink.rolledIngredients) && drink.rolledIngredients.length === 3 &&
      Array.isArray(drink.finalIngredients) && drink.finalIngredients.length === 3 &&
      drink.finalIngredients.every(item => Number.isInteger(item.slot) && typeof item.displayName === 'string' && Number.isFinite(item.finalMl) && item.finalMl >= 0) &&
      Array.isArray(drink.generatorAdditions) && Array.isArray(drink.preparationSteps) &&
      Array.isArray(drink.warnings) && Array.isArray(drink.generatorNotes) &&
      Number.isFinite(drink.totalVolumeMl) && drink.totalVolumeMl >= 0 && drink.totalVolumeMl <= 150 &&
      Number.isFinite(drink.pureAlcoholMl) && Number.isFinite(drink.estimatedAbv);
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
