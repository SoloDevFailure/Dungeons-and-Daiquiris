'use strict';
(() => {
  const app = globalThis.D20;
  const DEFAULT_POLICY = Object.freeze({maxServingMl:90,shotMl:15,maxSpiritMl:30,smallServingMl:30,autoLime:true,waterAvailable:false,iceAvailable:false,dropMl:.05});
  function validatePolicy(value = {}) {
    const policy={...DEFAULT_POLICY,...value};
    for(const [key,min,max]of [['maxServingMl',15,90],['shotMl',5,15],['maxSpiritMl',0,30],['smallServingMl',15,45],['dropMl',.01,.1]]){
      if(!Number.isFinite(policy[key])||policy[key]<min||policy[key]>max)throw new Error('Invalid serving setting: '+key);
    }
    for(const key of ['autoLime','waterAvailable','iceAvailable'])if(typeof policy[key]!=='boolean')throw new Error('Invalid serving setting: '+key);
    if(Math.abs(policy.dropMl*100-Math.round(policy.dropMl*100))>1e-8)throw new Error('Drop calibration must use 0.01 mL increments.');
    return Object.fromEntries(Object.keys(DEFAULT_POLICY).map(key=>[key,policy[key]]));
  }
  const LIMIT_UNITS = 9000; // Integer hundredths of a mL prevent rounding over the ceiling.
  const isCarbonated = item => item.carbonated || item.tags.includes('carbonated');
  const isAcidic = item => item.acidic || item.tags.includes('acidic');
  const isDairy = item => item.dairy || item.tags.includes('dairy');
  const isOverproof = item => item.overproof || item.tags.includes('overproof') || item.abv>50;
  const isSpirit = item => !['beer','cider','stout','wine'].includes(item.category) && (/spirit/.test(item.category) || isOverproof(item) || item.abv>=25);
  const isHot = item => item.heatLevel==='high' || item.tags.includes('hot');
  const isFlavouring = item => item.category==='condiment';
  const amount = item => item.measurementUnit==='drops' ? `${item.displayName} - ${item.drops} ${item.drops===1?'drop':'drops'} (~${item.finalMl} mL)` : `${item.displayName} - ${item.finalMl} mL`;
  function scaleToLimit(items,limit) {
    const total=items.reduce((sum,item)=>sum+item.units,0);if(total<=limit)return;
    if(limit===0){items.forEach(item=>{item.units=0;item.floorUnits=0;});return;}
    let floors=items.reduce((sum,item)=>sum+item.floorUnits,0);
    if(floors>limit){items.forEach(item=>item.floorUnits=0);floors=0;}
    const available=limit-floors,flex=total-floors;
    const parts=items.map(item=>{const ideal=(item.units-item.floorUnits)*available/flex;return {item,units:item.floorUnits+Math.floor(ideal),fraction:ideal-Math.floor(ideal)};});
    let remainder=limit-parts.reduce((sum,part)=>sum+part.units,0);
    parts.sort((a,b)=>b.fraction-a.fraction||a.item.slot-b.item.slot);
    for(const part of parts){if(remainder>0){part.units++;remainder--;}part.item.units=part.units;}
  }
  function reductionPriority(item) {
    if (item.category === 'mixer') return 0;
    if (['beer', 'cider', 'stout'].includes(item.category)) return 1;
    if (item.category === 'wine') return 2;
    if (item.abv < 20 && !item.tags.includes('high-impact')) return 3;
    return 4;
  }
  function compress(items,limitUnits = LIMIT_UNITS) {
    let excess = items.reduce((sum, item) => sum + item.units, 0) - limitUnits;
    for (let priority = 0; priority <= 4 && excess > 0; priority++) {
      // Mixer-first compression is retained; equal-priority pours retain their ratios.
      const group=items.filter(item=>reductionPriority(item)===priority && item.units>item.floorUnits);
      const total=group.reduce((sum,item)=>sum+item.units,0),floors=group.reduce((sum,item)=>sum+item.floorUnits,0);
      const reduction=Math.min(excess,total-floors);
      if(reduction>0){scaleToLimit(group,total-reduction);excess-=reduction;}
    }
    if (excess > 0) throw new Error('Recipe could not fit within the liquid limit.');
  }
  function prepare(items, additions, conflict, policy) {
    const liquids = items.filter(item => item.finalMl > 0);
    const fizzy = liquids.filter(isCarbonated);
    const hot = liquids.filter(item => !isCarbonated(item) && (item.heatLevel === 'high' || item.tags.includes('hot')));
    const base = liquids.filter(item => !isCarbonated(item) && !hot.includes(item));
    const baseNames = [...base.map(amount), ...additions.filter(item=>item.kind!=='ice').map(amount)];
    const steps = [];
    if (!liquids.length) return { method: 'No liquid to prepare', steps: ['All three configured amounts are zero. No liquid has been added.'], iceMode: 'none' };
    let method;
    let iceMode;
    if (conflict || fizzy.length || liquids.some(item => !item.canShake || item.category === 'wine') || hot.length) {
      method = conflict ? (policy.iceAvailable?'Build gently over ice':'Build gently') : fizzy.length ? 'Build in glass / stir gently' : (policy.iceAvailable?'Stir with ice':'Stir gently');
      iceMode = policy.iceAvailable?'serve_over_ice':'none';
      steps.push(policy.iceAvailable?'Place ice in a small serving glass. Measure only the per-serving quantities listed.':'Use a small serving glass. Measure only the per-serving quantities listed.');
      if (baseNames.length) steps.push(`Add ${baseNames.join('; ')}. ${conflict ? 'Combine gently; do not shake this mixture.' : 'Stir briefly to combine and chill.'}`);
      if (fizzy.length) steps.push(`Add the carbonated portion toward the end: ${fizzy.map(amount).join('; ')}. Pour slowly${fizzy.some(item => item.category === 'stout') ? ', especially the stout' : ''}; never shake carbonated ingredients.`);
      if (hot.length) steps.push(`Measure ${hot.map(amount).join('; ')} and add last. Fold in with one gentle stir.`);
      else steps.push('Give the drink one gentle stir and serve chilled.');
      if (conflict) steps.push('Dairy and acid may separate or curdle. Gentle preparation cannot prevent this; do not expect a smooth mixture.');
    } else if (liquids.some(item => item.acidic || item.viscous || item.dairy || item.category === 'condiment')) {
      method = policy.iceAvailable?'Brief shake with ice':'Brief shake';
      iceMode = policy.iceAvailable?'brief_shake_with_ice':'none';
      steps.push(`Measure ${baseNames.join('; ')} into a shaker${policy.iceAvailable?' with ice':''}.`, 'Shake briefly, then strain into a glass.');
    } else {
      method = policy.iceAvailable?'Stir with ice':'Stir gently';
      iceMode = policy.iceAvailable?'stir_with_ice':'none';
      steps.push(`Measure ${baseNames.join('; ')} into a mixing glass${policy.iceAvailable?' with ice':''}.`, policy.iceAvailable?'Stir to chill, then strain over fresh ice.':'Stir briefly to combine, then pour into a small serving glass.');
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
    const policy=validatePolicy(context.policy);
    const warnings=[],generatorNotes=[];
    const dropUnits=Math.max(1,Math.round(policy.dropMl*100));
    const flavourCount=rolledIngredients.filter(isFlavouring).length;
    const working=rolledIngredients.map(item=>{
      let cap=isHot(item)?(flavourCount>=2?1:2)*dropUnits/100:isFlavouring(item)?(item.tags.includes('umami')?1:3):item.category==='citrus'?5:isOverproof(item)?5:isDairy(item)?15:isSpirit(item)?15:90;
      const capped=Math.min(item.defaultMl,item.maxGeneratorMl,cap,90);
      let units=Math.floor(capped*100+1e-8);
      if(isHot(item))units=Math.floor(units/dropUnits)*dropUnits;
      if(units/100<item.defaultMl)generatorNotes.push(`${item.displayName}: requested ${item.defaultMl} mL; ingredient limit applied at ${units/100} mL per serving.`);
      return {...item,units,floorUnits:isHot(item)||isFlavouring(item)?units:Math.min(units,item.category==='citrus'?25:100)};
    });
    scaleToLimit(working.filter(isSpirit),Math.floor(policy.maxSpiritMl*100));
    const initial=working.filter(item=>item.units>0),initialTotal=initial.reduce((sum,item)=>sum+item.units,0);
    const initialAbv=initialTotal?initial.reduce((sum,item)=>sum+item.units*item.abv,0)/initialTotal:0;
    const dairy=initial.some(isDairy),conflict=dairy&&initial.some(isAcidic),overproof=initial.some(isOverproof);
    const spiritCount=initial.filter(isSpirit).length,hot=initial.some(isHot);
    let servingStyle='standard',servingLimitMl=policy.maxServingMl;
    if(flavourCount>=2||overproof){
      servingStyle='shot';servingLimitMl=Math.min(servingLimitMl,policy.shotMl);
    }else if(hot||initialAbv>=30||conflict||flavourCount||initial.some(item=>item.category==='citrus'&&item.units>=300)){
      servingStyle='small';servingLimitMl=Math.min(servingLimitMl,policy.smallServingMl);
    }
    let limitUnits=Math.floor(servingLimitMl*100);const additions=[];
    const inventory=Array.isArray(context.inventory)?context.inventory:[];
    const lime=inventory.find(item=>item.slot===18&&item.category==='citrus'&&item.tags?.includes('citrus')&&item.acidic&&item.abv===0&&item.available!==false&&item.defaultMl>0);
    if(policy.autoLime&&lime&&!dairy&&!initial.some(isAcidic)&&!rolledIngredients.some(item=>item.slot===lime.slot)&&initialTotal>0&&(initial.some(item=>item.savoury)||spiritCount>=2||(initial.some(item=>item.sweet)&&spiritCount>=1))){
      const units=Math.floor(Math.min(servingStyle==='shot'?1:2,lime.defaultMl,lime.maxGeneratorMl,initialTotal/100*.1)*100+1e-8);
      if(units>0)additions.push({id:'balancing-lime',slot:lime.slot,displayName:lime.displayName,finalMl:units/100,abv:0,kind:'lime',source:'inventory',reason:'Small citrus addition for flavour balance, not alcohol reduction.'});
    }
    if(policy.waterAvailable&&initialAbv>=30&&!dairy&&initialTotal>0){
      const waterUnits=Math.floor(Math.min(3,servingLimitMl/5,initialTotal/100*.25)*100+1e-8);
      if(waterUnits>0)additions.push({id:'chilled-water',displayName:'Chilled Water',finalMl:waterUnits/100,abv:0,kind:'water',source:'configured-extra',reason:'Small optional dilution. Water changes concentration, not the amount of alcohol.'});
    }
    let addedUnits=additions.reduce((sum,item)=>sum+Math.round(item.finalMl*100),0);
    const beforeCompression=working.map(item=>item.units);
    compress(working,limitUnits-addedUnits);
    // Mixer-first reductions can raise ABV: reassess the actual compressed pour,
    // not just its originally requested blend, before choosing the final size.
    const compressedTotal=working.reduce((sum,item)=>sum+item.units,0);
    const compressedAbv=compressedTotal?working.reduce((sum,item)=>sum+item.units*item.abv,0)/compressedTotal:0;
    if(compressedAbv>=30&&servingLimitMl>policy.smallServingMl){
      servingStyle='small';servingLimitMl=Math.min(servingLimitMl,policy.smallServingMl);limitUnits=Math.floor(servingLimitMl*100);
      for(const addition of additions)if(addition.kind==='lime')addition.finalMl=Math.min(addition.finalMl,1);
      addedUnits=additions.reduce((sum,item)=>sum+Math.round(item.finalMl*100),0);
      compress(working,limitUnits-addedUnits);
    }
    for(const item of working)if(isHot(item))item.units=Math.floor(item.units/dropUnits)*dropUnits;
    const finalIngredients=working.map(({units,floorUnits,...item},index)=>{
      const finalMl=units/100;
      if(units<beforeCompression[index])generatorNotes.push(`${item.displayName}: reduced to ${finalMl} mL to fit the ${servingLimitMl} mL per-serving limit.`);
      if(!units)generatorNotes.push(`${item.displayName} remains selected with a zero pour.`);
      return {...item,requestedMl:item.defaultMl,finalMl,source:'rolled',...(isHot(item)?{measurementUnit:'drops',drops:Math.round(units/dropUnits),nominalDropMl:dropUnits/100}:{} )};
    });
    const actual=finalIngredients.filter(item=>item.finalMl>0);
    const baseUnits=working.reduce((sum,item)=>sum+item.units,0);
    const pureAlcoholMl=finalIngredients.reduce((sum,item)=>sum+item.finalMl*item.abv/100,0)+additions.reduce((sum,item)=>sum+item.finalMl*item.abv/100,0);
    const totalVolumeMl=(baseUnits+addedUnits)/100;
    const estimatedAbv=totalVolumeMl?pureAlcoholMl/totalVolumeMl*100:0;
    const spiritVolumeMl=actual.filter(isSpirit).reduce((sum,item)=>sum+Math.round(item.finalMl*100),0)/100;
    const compatibilityFlags=conflict?['dairy_acid']:[];
    if(conflict)warnings.push('Dairy + acid may separate or curdle. No automatic balancing lime has been added.');
    if(hot)warnings.push('Hot sauce is measured in drops and added last. Drop volume is an estimate; use the configured drop calibration.');
    if(overproof)warnings.push('Contains overproof alcohol. The portion and overproof pour have been reduced.');
    if(estimatedAbv>=25)warnings.push('Strong drink: small portions do not make alcohol harmless. No one is required to drink it.');
    if(additions.some(item=>item.kind==='water'))warnings.push('Water lowers concentration, not the amount of alcohol.');
    const blockedReasons=[];
    if(actual.some(item=>item.unsafeForConsumption===true||item.foodSafe===false||item.compatibilityTags?.includes('unsafe_for_consumption')))blockedReasons.push('An ingredient is marked unsuitable for consumption.');
    const undilutedAbv=baseUnits?actual.reduce((sum,item)=>sum+item.finalMl*item.abv,0)/(baseUnits/100):0;
    if(undilutedAbv>40+1e-9)blockedReasons.push('The selected portion exceeds the game’s 40% undiluted-ABV serving rule; lime or water cannot clear this block.');
    if(actual.length&&actual.every(item=>isFlavouring(item)||item.category==='citrus')&&actual.some(isFlavouring))blockedReasons.push('This roll contains concentrated flavourings without a beverage base.');
    const safeToServe=totalVolumeMl>0&&!blockedReasons.length;
    let prep=prepare(finalIngredients,additions,conflict,policy);
    if(blockedReasons.length){warnings.unshift('DO NOT PREPARE OR SERVE: '+blockedReasons.join(' '));prep={method:'Do not prepare or serve',steps:['Do not prepare or consume this roll. Keep the snapshot for the record and choose a different roll.'],iceMode:'none'};}
    if(prep.iceMode!=='none')additions.push({id:'ice',displayName:'Ice',kind:'ice',source:'configured-extra',liquidVolumeMl:0,preparation:prep.iceMode});
    generatorNotes.push(`All quantities are per serving. ${servingLimitMl} mL is a ceiling, not a fill target.`);
    generatorNotes.push('Each hard spirit is capped at 15 mL; combined hard spirits at 30 mL per serving or the lower configured limit. Beer, cider, wine and low-alcohol liqueurs are excluded. Ice melt is not included.');
    const servingCount=2;
    const batch={servings:servingCount,totalVolumeMl:totalVolumeMl*servingCount,pureAlcoholMl:pureAlcoholMl*servingCount,estimatedAbv,spiritVolumeMl:spiritVolumeMl*servingCount,
      ingredients:finalIngredients.map(item=>({...app.clone(item),finalMl:Math.round(item.finalMl*100*servingCount)/100,...(item.measurementUnit==='drops'?{drops:item.drops*servingCount}:{})})),
      generatorAdditions:additions.map(item=>({...app.clone(item),...(item.finalMl!==undefined?{finalMl:Math.round(item.finalMl*100*servingCount)/100}:{})}))};
    const bartenderTitle = conflict ? 'The Curdled Prophecy' : actual.some(item => item.heatLevel === 'high') ? 'The Pub Crime'
      : overproof ? 'The Last Roll' : spiritCount === 3 ? 'The Bad Decision'
        : actual.some(isCarbonated) ? 'The Questionable Pint' : 'The Natural Twenty';
    return {
      schemaVersion:2, generatorVersion:'1.2.0',spiritPolicy:'hard_spirits_15_each_30_total',
      quantityBasis:'per_serving',servingCount,servingStyle,servingLimitMl,servingPolicy:app.clone(policy),spiritVolumeMl,batch,
      safeToServe,safety:{status:blockedReasons.length?'blocked':totalVolumeMl?'checked':'empty',reasons:blockedReasons},
      id:context.id || globalThis.crypto.randomUUID(), createdAt:context.createdAt || new Date().toISOString(),
      rolledIngredients, finalIngredients, generatorAdditions:additions,
      totalVolumeMl, pureAlcoholMl, estimatedAbv,
      preparationMethod:prep.method, preparationSteps:prep.steps,
      preparationConstraints:{ neverShakeCarbonated:true, containsCarbonation:actual.some(isCarbonated), avoidShaking:actual.some(isCarbonated) || conflict || actual.some(item => !item.canShake), iceMode:prep.iceMode, maxLiquidVolumeMl:servingLimitMl, maxSpiritVolumeMl:policy.maxSpiritMl, quantitiesAreFinal:true },
      warnings, compatibilityFlags, compatibilityWarning:conflict ? 'dairy_acid' : null, generatorNotes,
      bartenderTitle, bartenderSummary:conflict ? 'The dice have challenged the very idea of texture.' : 'Three rolls. One glass. The tavern accepts no creative responsibility.',
      apiStatus:'not_configured',
    };
  }
  app.drinkGenerator = { generateDrink, defaultPolicy:DEFAULT_POLICY, validatePolicy };
})();

