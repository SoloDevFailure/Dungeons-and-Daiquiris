'use strict';
(() => {
  const app = globalThis.D20;
  const definition = (slot, displayName, defaultMl, abv, category, tags, extra = {}) => ({
    slot, displayName, brand: null, productName: null, defaultMl, abv, category, tags,
    carbonated: tags.includes('carbonated'), acidic: tags.includes('acidic'),
    dairy: tags.includes('dairy'), viscous: tags.includes('viscous'),
    sweet: tags.includes('sweet'), savoury: tags.includes('savoury'),
    heatLevel: tags.includes('hot') ? 'high' : 'none', overproof: tags.includes('overproof'),
    canShake: !tags.includes('carbonated') && category !== 'wine',
    maxGeneratorMl: 90, compatibilityTags: [], abvBasis: 'Approximate product/reference value from the game specification',
    ...extra,
  });
  const master = [
    definition(1, 'Coca-Cola', 80, 0, 'mixer', ['sweet', 'carbonated'], { brand: 'Coca-Cola' }),
    definition(2, 'Lemonade', 80, 0, 'mixer', ['sweet', 'citrus', 'carbonated'], { productName: 'Schweppes-style lemonade' }),
    definition(3, 'Peroni', 80, 5, 'beer', ['lager', 'carbonated'], { brand: 'Peroni', productName: 'Peroni Nastro Azzurro' }),
    definition(4, 'Great Northern', 80, 4.2, 'beer', ['lager', 'carbonated'], { productName: 'Great Northern Original' }),
    definition(5, 'XXXX Gold', 80, 3.5, 'beer', ['lager', 'carbonated']),
    definition(6, 'Cider', 80, 4.5, 'cider', ['fruity', 'acidic', 'carbonated']),
    definition(7, 'Vodka', 30, 37.5, 'spirit', ['neutral'], { productName: 'Smirnoff Red-style vodka', maxGeneratorMl: 30 }),
    definition(8, 'Bombay Sapphire', 30, 40, 'spirit', ['gin', 'botanical'], { brand: 'Bombay Sapphire', maxGeneratorMl: 30 }),
    definition(9, '151 Rum', 15, 75.5, 'overproof spirit', ['rum', 'overproof', 'high-alcohol', 'high-impact'], { maxGeneratorMl: 5 }),
    definition(10, 'Tequila', 30, 38, 'spirit', ['tequila', 'agave'], { productName: 'Jose Cuervo Especial Silver-style tequila', maxGeneratorMl: 30 }),
    definition(11, 'Jim Beam', 30, 37, 'spirit', ['bourbon', 'whiskey', 'oak'], { brand: 'Jim Beam', productName: 'Jim Beam White', maxGeneratorMl: 30 }),
    definition(12, "Jack Daniel's", 30, 40, 'spirit', ['whiskey', 'oak'], { brand: "Jack Daniel's", productName: "Jack Daniel's Old No. 7", maxGeneratorMl: 30 }),
    definition(13, 'Fireball', 30, 33, 'spirit/liqueur', ['cinnamon', 'sweet', 'whiskey'], { productName: 'Fireball Cinnamon Whisky', maxGeneratorMl: 30 }),
    definition(14, 'Red Wine', 50, 13.5, 'wine', ['wine', 'acidic', 'tannic']),
    definition(15, 'Baileys', 30, 17, 'cream liqueur', ['dairy', 'creamy', 'sweet'], { productName: 'Baileys Original Irish Cream', maxGeneratorMl: 30, compatibilityTags: ['dairy_acid_sensitive'] }),
    definition(16, 'Guinness', 80, 4.2, 'stout', ['beer', 'stout', 'creamy', 'carbonated'], { productName: 'Guinness Draught' }),
    definition(17, 'Worcestershire Sauce', 10, 0, 'condiment', ['savoury', 'salty', 'umami', 'high-impact'], { productName: 'LEA & PERRINS', maxGeneratorMl: 1 }),
    definition(18, 'Lime Juice', 20, 0, 'citrus', ['acidic', 'sour', 'citrus', 'high-impact'], { maxGeneratorMl: 5 }),
    definition(19, 'Tomato Sauce', 15, 0, 'condiment', ['tomato', 'sweet', 'savoury', 'viscous', 'high-impact'], { productName: 'Heinz-style tomato ketchup', maxGeneratorMl: 3 }),
    definition(20, 'Hot Sauce', 5, 0, 'condiment', ['hot', 'spicy', 'high-impact'], { maxGeneratorMl: .2 }),
  ];
  master.forEach(item => { Object.freeze(item.tags); Object.freeze(item.compatibilityTags); Object.freeze(item); });
  Object.freeze(master);
  const KEY = 'dungeons-daiquiris.ingredients.v2';
  const LEGACY_KEY = 'dungeons-daiquiris.ingredients.v1';
  const legacyDefaults = [
    ['Coke',100],['Lemonade',100],['Peroni',100],['Great Northern',100],['XXXX Gold',100],['Cider',100],
    ['Vodka',30],['Gin',30],['White Rum',30],['Tequila',30],['Bourbon',30],['Whiskey',30],['Spiced Rum',30],
    ['Red Wine',60],['Baileys',30],['Guinness',100],['Worcestershire Sauce',15],['Lime Juice',20],['Tomato Sauce',15],['Hot Sauce',10],
  ];
  const editable = item => ({ slot: item.slot, displayName: item.displayName, defaultMl: item.defaultMl, abv: item.abv ?? master[item.slot - 1].abv });
  function validConfig(items) {
    return Array.isArray(items) && items.length === 20 && items.every((item, index) =>
      item && item.slot === index + 1 && typeof item.displayName === 'string' &&
      item.displayName.trim().length > 0 && item.displayName.length <= 100 &&
      Number.isFinite(item.defaultMl) && item.defaultMl >= 0 &&
      (item.abv === undefined || (Number.isFinite(item.abv) && item.abv >= 0 && item.abv <= 100)));
  }
  function createIngredientRepository(storage = app.storage) {
    let config = master.map(editable);
    let warning = '';
    try {
      let saved = storage.read(KEY, null);
      if (saved === null) {
        const legacy = storage.read(LEGACY_KEY, null);
        if (legacy !== null) {
          const translated = Array.isArray(legacy) ? legacy.map(item => ({slot:item.id,displayName:item.name,defaultMl:item.amountMl})) : null;
          if (!validConfig(translated)) throw new Error('Invalid legacy configuration');
          saved = translated.map((item, index) => ({
            slot: item.slot,
            displayName: item.displayName === legacyDefaults[index][0] ? master[index].displayName : item.displayName,
            defaultMl: item.defaultMl === legacyDefaults[index][1] ? master[index].defaultMl : item.defaultMl,
          }));
          // Retain the legacy record; migration never destroys the original settings.
          try { storage.write(KEY, saved); }
          catch { warning = 'Your previous settings are loaded, but could not be migrated to local storage. Save again when storage is available.'; }
        }
      }
      if (saved !== null) {
        if (!validConfig(saved)) throw new Error('Invalid configuration');
        config = saved.map(editable);
      }
    } catch {
      warning = 'Saved settings could not be loaded. Defaults are shown; the original data has not been overwritten.';
    }
    return {
      getAll: () => master.map((item, index) => app.clone({ ...item, ...config[index] })),
      getById(slot) { return this.getAll().find(item => item.slot === slot) || null; },
      getWarning: () => warning,
      save(items) {
        if (!validConfig(items)) throw new Error('Enter a name and a non-negative amount and ABV from 0 to 100 for every ingredient.');
        const next = items.map(item => ({...editable(item), displayName:item.displayName.trim()}));
        storage.write(KEY, next);
        config = next;
        warning = '';
      },
    };
  }
  app.ingredients = { master, key: KEY, createRepository: createIngredientRepository };
})();

