'use strict';
(() => {
  const app = globalThis.D20;
  function buildAIPayload(drinkResult) {
    return app.clone({
      schemaVersion:1, drinkId:drinkResult.id,
      finalIngredients:drinkResult.finalIngredients,
      generatorAdditions:drinkResult.generatorAdditions,
      preparationConstraints:drinkResult.preparationConstraints,
      compatibilityFlags:drinkResult.compatibilityFlags,
      warnings:drinkResult.warnings,
      totalVolumeMl:drinkResult.totalVolumeMl,
      pureAlcoholMl:drinkResult.pureAlcoholMl,
      estimatedAbv:drinkResult.estimatedAbv,
      preparationMethod:drinkResult.preparationMethod,
      preparationSteps:drinkResult.preparationSteps,
      instruction:'The quantities and ingredients have already been determined by the local game engine. Do not change the recipe or increase alcohol or ingredient quantities. Give the drink a creative name, describe how to assemble the exact provided recipe within its preparation constraints, and provide brief humorous bartender commentary. Water and ice do not remove alcohol. Your role is presentation only.',
    });
  }
  async function promptAPI(drinkResult) {
    // Intentionally offline. A future secure-backend adapter receives this payload.
    // Keep any presentation response separate from the immutable local recipe.
    buildAIPayload(drinkResult);
    return null;
  }
  app.aiService = { buildAIPayload, promptAPI };
})();
