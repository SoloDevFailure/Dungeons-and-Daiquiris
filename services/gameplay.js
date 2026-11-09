'use strict';
(() => {
  const app=globalThis.D20,KEY='dungeons-daiquiris.gameplay.v1';
  const defaults=['Dave','Tom','Dan','Damo','Nic','Jamie','Chris','Wes','Fletcher','Aaron'];
  const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
  const normalized=name=>name.trim().replace(/\s+/g,' ').toLowerCase();
  function quote(drink){
    if(!app.drinkHistory.validDrink(drink))throw new Error('Recipe unavailable.');
    const items=drink.finalIngredients.filter(i=>i.finalMl>0);
    if(!drink.totalVolumeMl||drink.safeToServe===false||drink.safety?.status==='blocked')return {version:1,starting:0,min:0,max:0,blocked:true};
    const savoury=items.filter(i=>i.savoury||i.tags?.includes('savoury')).length;
    const hot=items.some(i=>i.heatLevel==='high'||i.tags?.includes('hot'));
    const raw=20+drink.pureAlcoholMl*4+savoury*20+(hot?30:0)+(drink.compatibilityFlags?.includes('dairy_acid')?20:0);
    const starting=Math.ceil((raw-1e-8)/2)*2;
    return {version:1,starting,min:starting/2,max:starting*2,blocked:false};
  }
  const currentAwards=state=>state.awards.slice(state.roundStart||0);
  const isFinished=state=>Boolean(state.finishedAt);
  function valid(state){
    if(!state||state.schemaVersion!==1||!Number.isInteger(state.version)||state.version<0||typeof state.started!=='boolean'||!Array.isArray(state.players)||!Array.isArray(state.awards))return false;
    if(!state.players.every(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=80&&typeof p.enabled==='boolean'))return false;
    if(new Set(state.players.map(p=>p.id)).size!==state.players.length||new Set(state.players.map(p=>normalized(p.name))).size!==state.players.length)return false;
    if(!state.started&&state.awards.length)return false;
    if(state.roundStart!==undefined&&(!Number.isInteger(state.roundStart)||state.roundStart<0||state.roundStart>state.awards.length))return false;
    if(state.gameNumber!==undefined&&(!Number.isInteger(state.gameNumber)||state.gameNumber<1))return false;
    if(state.finishedAt!==undefined&&state.finishedAt!==null&&!Number.isFinite(Date.parse(state.finishedAt)))return false;
    if(state.finishedAt&&!state.started)return false;
    if((state.gameNumber||1)!==(state.archives||[]).length+1||(state.roundStart||0)!==((state.archives||[]).at(-1)?.end||0))return false;
    if(state.archives!==undefined&&(!Array.isArray(state.archives)||!state.archives.every((a,i)=>a.number===i+1&&Number.isInteger(a.start)&&Number.isInteger(a.end)&&a.start>=0&&a.end>=a.start&&a.end<=state.awards.length&&Number.isFinite(Date.parse(a.finishedAt)))))return false;
    return new Set(state.awards.map(a=>a.encounterId)).size===state.awards.length&&state.awards.every(a=>a&&typeof a.encounterId==='string'&&typeof a.title==='string'&&Number.isFinite(Date.parse(a.createdAt))&&Number.isInteger(a.startingPoints)&&a.startingPoints>0&&Number.isInteger(a.agreedPoints)&&a.agreedPoints>=a.startingPoints/2&&a.agreedPoints<=a.startingPoints*2&&Array.isArray(a.winners)&&a.winners.length>=1&&a.winners.length<=3&&new Set(a.winners.map(w=>w.playerId)).size===a.winners.length&&a.winners.every(w=>state.players.some(p=>p.id===w.playerId)&&typeof w.name==='string'&&[1,.5].includes(w.multiplier)&&w.points===a.agreedPoints*w.multiplier));
  }
  function rankings(state){return state.players.map(p=>({...p,points:currentAwards(state).reduce((sum,a)=>sum+(a.winners.find(w=>w.playerId===p.id)?.points||0),0)})).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));}
  function createRepository(storage=app.storage,uuid=()=>crypto.randomUUID()){
    // Keep defaults in memory until an explicit edit/start; remote data wins on first connection.
    const initial={schemaVersion:1,version:0,started:false,players:defaults.map(name=>({id:uuid(),name,enabled:true})),awards:[]};
    function read(){const doc=storage.read(KEY,null);if(doc===null)return {state:app.clone(initial),outbox:[],draft:null};if(!valid(doc.state)||!Array.isArray(doc.outbox)||!doc.outbox.every(o=>typeof o.id==='string'&&valid(o.state)))throw new Error('Saved contestants or points are unreadable. Nothing has been replaced.');return doc;}
    function write(doc){storage.write(KEY,doc);}
    function mutate(change){const doc=read(),next=app.clone(doc.state);change(next);next.version++;if(!valid(next))throw new Error('Invalid game change.');doc.state=next;doc.outbox.push({id:uuid(),state:app.clone(next)});write(doc);return next;}
    return {
      get:()=>read().state,
      pending:()=>read().outbox,
      getDraft:()=>read().draft,
      saveDraft(draft){const doc=read();doc.draft=app.clone(draft);write(doc);},
      addPlayer(name){name=name.trim().replace(/\s+/g,' ');return mutate(s=>{if(!name||name.length>80)throw new Error('Enter a name between 1 and 80 characters.');if(s.players.some(p=>normalized(p.name)===normalized(name)))throw new Error('That contestant is already listed.');s.players.push({id:uuid(),name,enabled:true});});},
      setEnabled(id,enabled){return mutate(s=>{const p=s.players.find(p=>p.id===id);if(!p)throw new Error('Contestant unavailable.');p.enabled=Boolean(enabled);});},
      finish(){const state=read().state;if(isFinished(state))return state;return mutate(s=>{if(!s.started)throw new Error('Start the game first.');s.finishedAt=new Date().toISOString();});},
      newGame(){return mutate(s=>{
        if(!isFinished(s))throw new Error('Finish the current game first.');
        if(!s.players.some(p=>p.enabled))throw new Error('Enable at least one contestant first.');
        s.archives=s.archives||[];s.archives.push({number:s.gameNumber||1,start:s.roundStart||0,end:s.awards.length,finishedAt:s.finishedAt});
        s.gameNumber=(s.gameNumber||1)+1;s.roundStart=s.awards.length;s.finishedAt=null;s.started=true;
      });},
      start(){const state=read().state;if(isFinished(state))throw new Error('This game has finished. Choose New Game to begin again.');if(state.started)return state;return mutate(s=>{if(!s.players.some(p=>p.enabled))throw new Error('Enable at least one contestant first.');s.started=true;});},
      award(drink,winners,agreedPoints){
        return mutate(s=>{
          if(!s.started||isFinished(s))throw new Error('The game is not active.');
          if(s.awards.some(a=>a.encounterId===drink.id))throw new Error('This drink has already been awarded.');
          const q=quote(drink);if(q.blocked)throw new Error('Blocked or empty drinks cannot earn points.');
          if(!Number.isInteger(agreedPoints)||agreedPoints<q.min||agreedPoints>q.max)throw new Error(`Enter whole points from ${q.min} to ${q.max}.`);
          if(!Array.isArray(winners)||winners.length<1||winners.length>3||new Set(winners.map(w=>w.playerId)).size!==winners.length)throw new Error('Choose one to three different contestants.');
          const awarded=winners.map(w=>{const p=s.players.find(p=>p.id===w.playerId&&p.enabled);if(!p||![1,.5].includes(w.multiplier))throw new Error('Choose participating contestants and full or half points.');return {playerId:p.id,name:p.name,multiplier:w.multiplier,points:agreedPoints*w.multiplier};});
          s.awards.push({encounterId:drink.id,title:drink.bartenderTitle,createdAt:new Date().toISOString(),startingPoints:q.starting,agreedPoints,winners:awarded});
        });
      },
      accept(remote){
        const doc=read();if(!remote)return;
        if(!valid(remote))throw new Error('Shared contestants/points are invalid. Local data is unchanged.');
        if(doc.outbox.length)return;
        if(remote.version<doc.state.version)throw new Error('Shared points are older than this phone. Local points are preserved.');
        if(remote.version===doc.state.version&&remote.version>0&&canonical(remote)!==canonical(doc.state))throw new Error('Points differ on another host. Local changes are preserved.');
        doc.state=app.clone(remote);write(doc);
      },
      acknowledge(id){const doc=read();doc.outbox=doc.outbox.filter(o=>o.id!==id);write(doc);},
      importLegacy(players){
        if(!players?.length)return;
        const doc=read(),before=canonical(doc),ids=new Map();
        for(const p of players){const existing=doc.state.players.find(i=>normalized(i.name)===normalized(p.name));if(existing)ids.set(existing.id,p.id);}
        function merge(state){
          for(const p of state.players)p.id=ids.get(p.id)||p.id;
          for(const p of players)if(!state.players.some(i=>i.id===p.id))state.players.push({id:p.id,name:p.name,enabled:true});
          for(const a of state.awards)for(const w of a.winners)w.playerId=ids.get(w.playerId)||w.playerId;
          if(!valid(state))throw new Error('Existing player names need review. Nothing has been replaced.');
        }
        merge(doc.state);for(const operation of doc.outbox)merge(operation.state);
        for(const w of doc.draft?.winners||[])w.playerId=ids.get(w.playerId)||w.playerId;
        if(canonical(doc)!==before)write(doc);
      },
    };
  }
  app.gameplay={key:KEY,defaults,quote,valid,rankings,currentAwards,isFinished,createRepository};
})();
