'use strict';
(() => {
 const app=globalThis.D20;
 function report(game,encounters=[]){
   if(!app.gameplay.valid(game))throw new Error('Game results are unavailable.');
   const awards=app.gameplay.currentAwards(game),recipes=new Map(encounters.map(e=>[e.id,e.snapshot]));
   const players=app.gameplay.rankings(game).map(p=>({...p,drinks:0,alcoholMl:0,hotMl:0,hotDrops:0}));
   let alcoholMl=0,hotMl=0,hotDrops=0,recipients=0,penalties=0,missingRecipes=0;
   const rounds=awards.map(a=>{
     const r=recipes.get(a.encounterId),known=app.drinkHistory.validDrink(r);
     const servings=Math.min(a.winners.length,2),factor=known?(r.quantityBasis==='per_serving'?1:.5):0;
     const pure=known?r.pureAlcoholMl*factor*servings:0;
     const hot=known?r.finalIngredients.filter(i=>i.heatLevel==='high'||i.tags?.includes('hot')):[];
     const sauce=hot.reduce((sum,i)=>sum+i.finalMl,0)*factor*servings;
     const drops=hot.reduce((sum,i)=>sum+(i.measurementUnit==='drops'?i.drops:0),0)*factor*servings;
     if(!known)missingRecipes++;
     alcoholMl+=pure;hotMl+=sauce;hotDrops+=drops;recipients+=a.winners.length;
     for(const w of a.winners){const p=players.find(p=>p.id===w.playerId);p.drinks++;p.alcoholMl+=pure/a.winners.length;p.hotMl+=sauce/a.winners.length;p.hotDrops+=drops/a.winners.length;if(w.multiplier===.5)penalties++;}
     return {...a,estimatedAlcoholMl:pure,hotMl:sauce,knownRecipe:known};
   });
   const contested=[...awards].sort((a,b)=>b.agreedPoints/b.startingPoints-a.agreedPoints/a.startingPoints)[0];
   const discounted=[...awards].sort((a,b)=>a.agreedPoints/a.startingPoints-b.agreedPoints/b.startingPoints)[0];
   const strongest=[...recipes.values()].filter(app.drinkHistory.validDrink).sort((a,b)=>b.estimatedAbv-a.estimatedAbv)[0];
   return {number:game.gameNumber||1,finishedAt:game.finishedAt||null,players:players.filter(p=>p.enabled||p.drinks>0),rounds,
     totals:{rounds:awards.length,recipients,points:awards.reduce((sum,a)=>sum+a.winners.reduce((s,w)=>s+w.points,0),0),alcoholMl,hotMl,hotDrops,penalties,missingRecipes},contested,discounted,strongest,
     note:'Alcohol and hot sauce are estimates of allocated recipe quantities, not measured consumption. Three recipients share the two-serving batch. Bidding highlights compare agreed points with starting points; individual bids were not recorded.'};
 }
 function pages(result){
   const pages=[];for(let i=0;i<result.players.length;i+=8)pages.push({kind:'rankings',offset:i,rows:result.players.slice(i,i+8)});
   for(let i=0;i<result.rounds.length;i+=5)pages.push({kind:'rounds',offset:i,rows:result.rounds.slice(i,i+5)});
   if(!pages.length)pages.push({kind:'rankings',offset:0,rows:[]});return pages;
 }
 app.analytics={report,pages};
})();
