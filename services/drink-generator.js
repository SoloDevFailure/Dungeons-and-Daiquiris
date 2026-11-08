'use strict';
(() => {
  const app = globalThis.D20;
  const LIMIT_UNITS = 15000; // Integer hundredths of a mL prevent rounding over the ceiling.
  const isCarbonated = item => item.carbonated || item.tags.includes('carbonated');
  const isAcidic = item => item.acidic || item.tags.includes('acidic');
  const isDairy = item => item.dairy || item.tags.includes('dairy');
  const isOverproof = item => item.overproof || item.tags.includes('overproof');
  const isSpirit = item => item.category.includes('spirit') || isOverproof(item);
  const amount = item => `${item.displayName} — ${item.finalMl} mL`;
  function reductionPriority(item) {
    if (item.category === 'mixer') return 0;
    if (['beer', 'cider', 'stout'].includes(item.category)) return 1;
    if (item.category === 'wine') return 2;
    if (item.abv < 20 && !item.tags.includes('high-impact')) return 3;
    return 4;
  }
  function compress(items) {
    let excess = items.reduce((sum, item) => sum + item.units, 0) - LIMIT_UNITS;
    for (let priority = 0; priority <= 4 && excess > 0; priority++) {
      // Equal-priority ingredients share the reduction; retain every positive roll.
      let group = items.filter(item => reductionPriority(item) === priority && item.units > item.floorUnits);
      while (group.length && excess > 0) {
        const share = Math.max(1, Math.floor(excess / group.length));
        for (const item of group) {
          const reduction = Math.min(share, excess, item.units - item.floorUnits);
          item.units -= reduction;
          excess -= reduction;
        }
        group = group.filter(item => item.units > item.floorUnits);
      }
    }
    if (excess > 0) throw new Error('Recipe could not fit within the liquid limit.');
  }
  function prepare(items, additions, conflict) {
    const liquids = items.filter(item => item.finalMl > 0);
    const fizzy = liquids.filter(isCarbonated);
    const hot = liquids.filter(item => !isCarbonated(item) && (item.heatLevel === 'high' || item.tags.includes('hot')));
    const base = liquids.filter(item => !isCarbonated(item) && !hot.includes(item));
    const water = additions.find(item => item.kind === 'water');
    const baseNames = [...base.map(amount), ...(water ? [amount(water)] : [])];
    const steps = [];
    if (!liquids.length) return { method: 'No liquid to prepare', steps: ['All three configured amounts are zero. No liquid has been added.'], iceMode: 'none' };
    let method;
    let iceMode;
    if (conflict || fizzy.length || liquids.some(item => !item.canShake || item.category === 'wine') || hot.length) {
      method = conflict ? 'Build gently over ice' : fizzy.length ? 'Build in glass / stir gently' : 'Stir with ice';
      iceMode = 'serve_over_ice';
      steps.push('Place ice in a serving glass. Measure only the final quantities listed.');
      if (baseNames.length) steps.push(`Add ${baseNames.join('; ')}. ${conflict ? 'Combine gently; do not shake this mixture.' : 'Stir briefly to combine and chill.'}`);
      if (fizzy.length) steps.push(`Add the carbonated portion toward the end: ${fizzy.map(amount).join('; ')}. Pour slowly${fizzy.some(item => item.category === 'stout') ? ', especially the stout' : ''}; never shake carbonated ingredients.`);
      if (hot.length) steps.push(`Measure ${hot.map(amount).join('; ')} and add last. Fold in with one gentle stir.`);
      else steps.push('Give the drink one gentle stir and serve chilled.');
      if (conflict) steps.push('Dairy and acid may separate or curdle. Gentle preparation cannot prevent this; do not expect a smooth mixture.');
    } else if (liquids.some(item => item.acidic || item.viscous || item.dairy || item.category === 'condiment')) {
      method = 'Brief shake with ice';
      iceMode = 'brief_shake_with_ice';
      steps.push(`Measure ${baseNames.join('; ')} into a shaker with ice.`, 'Shake briefly, then strain into a glass.');
    } else {
      method = 'Stir with ice';
      iceMode = 'stir_with_ice';
      steps.push(`Measure ${baseNames.join('; ')} into a mixing glass with ice.`, 'Stir to chill, then strain over fresh ice.');
    }
    return { method, steps, iceMode };
  }
  function generateDrink(selectedIngredients, context = {}) {
    if (!Array.isArray(selectedIngredients) || selectedIngredients.length !== 3 ||
      new Set(selectedIngredients.map(item => item.slot)).size !== 3) throw new Error('Select three different ingredients.');
    const rolledIngredients = app.clone(selectedIngredients);
    for (const item of rolledIngredients) {
      if (!Number.isInteger(item.slot) || !item.displayName || !Array.isArray(item.tags) || typeof item.category !== 'string' ||
          !Number.isFinite(item.defaultMl) || item.defaultMl < 0 || !Number.isFinite(item.abv) || item.abv < 0 || item.abv > 100 ||
          !Number.isFinite(item.maxGeneratorMl) || item.maxGeneratorMl < 0) throw new Error('Invalid ingredient metadata.');
    }
    const warnings = [];
    const generatorNotes = [];
    const working = rolledIngredients.map(item => {
      const capped = Math.min(item.defaultMl, item.maxGeneratorMl, 150);
      const units = Math.floor(capped * 100 + 1e-8);
      if (capped < item.defaultMl) generatorNotes.push(`${item.displayName}: requested ${item.defaultMl} mL; ingredient limit applied at ${capped} mL.`);
      if (units === 0) generatorNotes.push(`${item.displayName} remains in the roll with 0 mL (configured amount is zero or below 0.01 mL).`);
      return { ...item, units, floorUnits: Math.min(units, 1) };
    });
    const beforeCompression = working.map(item => item.units);
    compress(working);
    const finalIngredients = working.map(({units, floorUnits, ...item}, index) => {
      const finalMl = units / 100;
      if (units < beforeCompression[index]) generatorNotes.push(`${item.displayName}: reduced from ${beforeCompression[index] / 100} to ${finalMl} mL to keep the drink within 150 mL.`);
      return { ...item, requestedMl: item.defaultMl, finalMl, source: 'rolled' };
    });
    const actual = finalIngredients.filter(item => item.finalMl > 0);
    const baseUnits = working.reduce((sum, item) => sum + item.units, 0);
    const pureAlcoholMl = finalIngredients.reduce((sum, item) => sum + item.finalMl * item.abv / 100, 0);
    const baseAbv = baseUnits ? pureAlcoholMl / (baseUnits / 100) * 100 : 0;
    const spiritCount = actual.filter(isSpirit).length;
    const overproof = actual.some(isOverproof);
    const strong = baseAbv >= 30 || spiritCount === 3 || (overproof && spiritCount >= 2);
    const additions = [];
    if (strong) {
      const desiredUnits = overproof && spiritCount >= 2 ? 4500 : baseAbv >= 30 ? 3000 : 1500;
      const waterUnits = Math.max(0, Math.min(desiredUnits, LIMIT_UNITS - baseUnits));
      if (waterUnits) additions.push({ id:'chilled-water', displayName:'Chilled Water', finalMl:waterUnits / 100, abv:0, kind:'water', source:'generator' });
      warnings.push(waterUnits ? 'Strong drink — water added for dilution. Water lowers concentration, not the amount of alcohol.' : 'Strong drink — no room for added water within 150 mL. Ice does not remove alcohol.');
    }
    if (overproof) warnings.push(`Overproof: ${actual.filter(isOverproof).map(item => `${item.displayName} (${item.abv}% reference ABV)`).join(', ')}. Its alcohol content is included in the calculation; its pour is never increased.`);
    const conflict = actual.some(isDairy) && actual.some(isAcidic);
    const compatibilityFlags = conflict ? ['dairy_acid'] : [];
    if (conflict) warnings.push('Dairy + acid may separate or curdle. The rolled ingredients are retained.');
    if (actual.some(item => item.heatLevel === 'high')) warnings.push('Hot sauce is measured separately and added last; its amount has not been increased.');
    const prep = prepare(finalIngredients, additions, conflict);
    if (prep.iceMode !== 'none') additions.push({ id:'ice', displayName:'Ice', kind:'ice', source:'generator', liquidVolumeMl:0, preparation:prep.iceMode });
    const totalVolumeMl = (baseUnits + additions.filter(item => item.kind === 'water').reduce((sum, item) => sum + Math.round(item.finalMl * 100), 0)) / 100;
    generatorNotes.push('150 mL is a ceiling, not a target. Ice melt is not included in the liquid estimate.');
    const bartenderTitle = conflict ? 'The Curdled Prophecy' : actual.some(item => item.heatLevel === 'high') ? 'The Pub Crime'
      : overproof ? 'The Last Roll' : spiritCount === 3 ? 'The Bad Decision'
        : actual.some(isCarbonated) ? 'The Questionable Pint' : 'The Natural Twenty';
    return {
      schemaVersion:1, generatorVersion:'1.0.0',
      id:context.id || globalThis.crypto.randomUUID(), createdAt:context.createdAt || new Date().toISOString(),
      rolledIngredients, finalIngredients, generatorAdditions:additions,
      totalVolumeMl, pureAlcoholMl, estimatedAbv:totalVolumeMl ? pureAlcoholMl / totalVolumeMl * 100 : 0,
      preparationMethod:prep.method, preparationSteps:prep.steps,
      preparationConstraints:{ neverShakeCarbonated:true, containsCarbonation:actual.some(isCarbonated), avoidShaking:actual.some(isCarbonated) || conflict || actual.some(item => !item.canShake), iceMode:prep.iceMode, maxLiquidVolumeMl:150, quantitiesAreFinal:true },
      warnings, compatibilityFlags, compatibilityWarning:conflict ? 'dairy_acid' : null, generatorNotes,
      bartenderTitle, bartenderSummary:conflict ? 'The dice have challenged the very idea of texture.' : 'Three rolls. One glass. The tavern accepts no creative responsibility.',
      apiStatus:'not_configured',
    };
  }
  app.drinkGenerator = { generateDrink };
})();

