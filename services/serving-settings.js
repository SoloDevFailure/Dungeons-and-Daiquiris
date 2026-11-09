'use strict';
(() => {
  const app=globalThis.D20,KEY='dungeons-daiquiris.serving-policy.v1';
  function createRepository(storage=app.storage){
    let policy=app.clone(app.drinkGenerator.defaultPolicy),warning='';
    try{const saved=storage.read(KEY,null);if(saved!==null)policy=app.drinkGenerator.validatePolicy(saved);}
    catch{warning='Serving settings could not be read. The original record has not been replaced.';}
    return {get:()=>app.clone(policy),getWarning:()=>warning,save(value){const next=app.drinkGenerator.validatePolicy(value);storage.write(KEY,next);policy=next;warning='';}};
  }
  app.servingSettings={key:KEY,createRepository};
})();
