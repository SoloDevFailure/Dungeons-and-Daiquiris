'use strict';
(() => {
  const app=globalThis.D20;
  const PLACEHOLDER='assets/presentation/cocktail-placeholder.svg';
  const ml=value=>String(Number(value));
  function modelFor(state){
    if(!state || typeof state!=='object')throw new Error('Presentation state is invalid.');
    const game=state.gameplay;
    if(game&&app.gameplay?.valid(game)){
      if(app.gameplay.isFinished(game))return {key:`analytics:${game.gameNumber||1}:${game.finishedAt}`,kind:'analytics',report:app.analytics.report(game,state.awardEncounters||[])};
      const award=app.gameplay.currentAwards(game).at(-1);
      if(award&&(state.currentEncounter?state.currentEncounter.id===award.encounterId:!state.lastRolledEncounterId||state.lastRolledEncounterId===award.encounterId)){
        return {key:`award:${award.encounterId}`,kind:'award',title:award.title,agreedPoints:award.agreedPoints,winners:award.winners};
      }
    }
    if(!state.currentEncounter)return {key:'welcome',kind:'welcome'};
    const encounter=state.currentEncounter,drink=encounter.snapshot;
    if(!app.drinkHistory.validDrink(drink))throw new Error('The current recipe could not be displayed.');
    return {
      key:`drink:${encounter.id || drink.id}`,kind:'drink',
      title:drink.bartenderTitle || 'An unnamed abomination',
      summary:[
        'Three rolls. One glass. The tavern accepts no creative responsibility.',
        'Three rolls. Two servings. Questionable decisions.',
      ].includes((drink.bartenderSummary || '').trim())?'':(drink.bartenderSummary || ''),
      ingredients:drink.finalIngredients.map(item=>({slot:item.slot,name:item.displayName,amount:item.measurementUnit==='drops'?`${item.drops} ${item.drops===1?'drop':'drops'} (~${ml(item.finalMl)} mL)`:`${ml(item.finalMl)} mL`})),
      additions:drink.generatorAdditions.map(item=>item.kind==='ice'?'Ice':`${item.displayName} — ${ml(item.finalMl)} mL`).join(' · '),
      stats:drink.quantityBasis==='per_serving'?`${ml(drink.totalVolumeMl)} mL per serving · ${drink.estimatedAbv.toFixed(1)}% estimated ABV · 2 servings / ${ml(drink.batch.totalVolumeMl)} mL batch`:`${ml(drink.totalVolumeMl)} mL total · ${drink.estimatedAbv.toFixed(1)}% estimated ABV · ${encounter.servings || 2} servings, split evenly`,
      blocked:drink.safety?.status==='blocked',
      method:drink.preparationMethod || '',warnings:drink.warnings.map(String),steps:drink.preparationSteps.map(String),artwork:PLACEHOLDER,
    };
  }
  // Keyed scene coordinator. Revision/leader/player-only updates never replay entry.
  function createSwitcher({show,leave,enter,setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout,reducedMotion=()=>false}){
    let displayedKey='welcome',signature='',pending=null,timer=null,paused=false;
    const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
    function commit(model,animate){
      const next=JSON.stringify(model);displayedKey=model.key;pending=null;
      if(next!==signature){show(model);signature=next;}
      enter(model.kind,animate);
    }
    return {
      update(model,{immediate=false}={}){
        const next=JSON.stringify(model);
        if(!pending&&next===signature)return false;
        pending=model;
        if(paused)return true;
        if(immediate||reducedMotion()){clear();commit(model,false);return true;}
        if(model.key===displayedKey){clear();commit(model,false);return true;}
        if(timer!==null)return true; // Coalesce rapid changes into the newest target.
        leave(displayedKey.split(':')[0]);
        timer=setTimer(()=>{timer=null;if(pending&&!paused)commit(pending,true);},420);
        return true;
      },
      suspend(){paused=true;clear();},
      resume(){paused=false;if(pending)commit(pending,false);},
      getKey:()=>displayedKey,
    };
  }
  function create({document:doc=globalThis.document,window:win=globalThis.window}={}){
    const $=selector=>doc.querySelector(selector),stage=$('#presentation-stage');
    const scenes={welcome:$('#waiting'),drink:$('#encounter'),award:$('#award-scene'),analytics:$('#analytics-scene')};
    const motion=win.matchMedia?.('(prefers-reduced-motion: reduce)');
    let frame=null,suspended=doc.hidden,reportModel=null,reportPages=[],reportPage=0,reportTimer=null,lastKind='welcome';
    function fit(){
      frame=null;if(suspended)return;
      const outer=$('#drink-copy'),inner=$('#drink-copy-content');
      if(outer?.clientHeight>0&&inner){
        let low=.08,high=1;
        const apply=scale=>stage.style.setProperty('--copy-scale',scale.toFixed(4));
        const fits=()=>inner.scrollHeight<=outer.clientHeight+1&&inner.scrollWidth<=outer.clientWidth+1;
        apply(1);
        if(!fits()){for(let i=0;i<13;i++){const mid=(low+high)/2;apply(mid);if(fits())low=mid;else high=mid;}apply(low);}
      }
      for(const [kind,selector]of [['award','#award-content'],['analytics','#analytics-content']]){
        const outer=scenes[kind],inner=$(selector);if(outer.hidden||!outer.clientHeight||!inner)continue;
        let low=.08,high=1;const apply=n=>stage.style.setProperty(`--${kind}-scale`,n.toFixed(4));
        const fits=()=>inner.scrollHeight<=outer.clientHeight+1&&inner.scrollWidth<=outer.clientWidth+1;
        apply(1);if(!fits()){for(let i=0;i<13;i++){const mid=(low+high)/2;apply(mid);if(fits())low=mid;else high=mid;}apply(low);}
      }
      const welcome=scenes.welcome;
      if(!welcome.hidden&&welcome.clientHeight>0){
        // The static rules are also fitted for smaller television/browser viewports.
        let scale=1;stage.style.setProperty('--welcome-scale','1');
        while(scale>.45&&(welcome.scrollHeight>welcome.clientHeight+1||welcome.scrollWidth>welcome.clientWidth+1)){
          scale-=.025;stage.style.setProperty('--welcome-scale',scale.toFixed(3));
        }
      }
    }
    function requestFit(){if(suspended)return;if(frame!==null)return;if(win.requestAnimationFrame)frame=win.requestAnimationFrame(fit);else fit();}
    const number=value=>String(Number(value.toFixed(2)));
    function stopReport(){if(reportTimer!==null)win.clearTimeout(reportTimer);reportTimer=null;}
    function reportContent(){
      const page=reportPages[reportPage];if(!page)return;
      $('#analytics-page-label').textContent=`${page.kind==='rankings'?'FINAL RANKINGS':'DRINK LEDGER'} · ${reportPage+1} / ${reportPages.length}`;
      const rows=page.rows.map((entry,index)=>{
        const row=line('div','analytics-row','');
        if(page.kind==='rankings')row.append(line('span','analytics-rank',page.offset+index+1),line('span','',entry.name),line('strong','',`${entry.points} pts`),line('small','',`${entry.drinks} ${entry.drinks===1?'round':'rounds'} · ${number(entry.alcoholMl)} mL alcohol`));
        else row.append(line('strong','',entry.title),line('span','',entry.winners.map(w=>`${w.name} ${w.points} pts${w.multiplier===.5?' (50%)':''}`).join(' · ')));
        return row;
      });
      $('#analytics-rows').replaceChildren(...rows);
      if(!rows.length)$('#analytics-rows').append(line('p','','No completed rounds recorded.'));
    }
    function scheduleReport(){stopReport();if(suspended||lastKind!=='analytics'||reportPages.length<2)return;reportTimer=win.setTimeout(()=>{reportTimer=null;reportPage=(reportPage+1)%reportPages.length;reportContent();requestFit();scheduleReport();},12000);}
    function showReport(result){
      if(JSON.stringify(reportModel)===JSON.stringify(result))return;
      reportModel=result;reportPages=app.analytics.pages(result);reportPage=0;
      const leaders=result.players.filter(p=>p.points===result.players[0]?.points);
      $('#analytics-title').textContent=leaders.length&&result.totals.rounds?`${leaders.map(p=>p.name).join(' & ')} ${leaders.length>1?'win':'wins'}!`:'The tavern is closed';
      $('#analytics-summary').textContent=`Game ${result.number} · ${result.totals.rounds} drinks · ${result.totals.recipients} awards · ${result.totals.points} points`;
      $('#analytics-stats').replaceChildren(...[
        ['EST. SERVED ALCOHOL',`${number(result.totals.alcoholMl)} mL`],['HOT SAUCE',`${number(result.totals.hotMl)} mL / ${number(result.totals.hotDrops)} recorded drops`],['HALF-POINT PENALTIES',result.totals.penalties],
        ['LARGEST BID',result.contested?`${result.contested.title} · ${result.contested.agreedPoints} pts (${Math.round(result.contested.agreedPoints/result.contested.startingPoints*100)}% of start)`:'No bids recorded'],
        ['LOWEST BID',result.discounted?`${result.discounted.title} · ${result.discounted.agreedPoints} pts (${Math.round(result.discounted.agreedPoints/result.discounted.startingPoints*100)}% of start)`:'No bids recorded'],
        ['STRONGEST RECIPE',result.strongest?`${result.strongest.bartenderTitle} · ${result.strongest.estimatedAbv.toFixed(1)}% ABV`:'No recipe data'],
      ].map(([label,value])=>{const item=line('div','analytics-stat','');item.append(line('span','',label),line('strong','',String(value)));return item;}));
      $('#analytics-note').textContent=result.note+(result.totals.missingRecipes?` ${result.totals.missingRecipes} recipe snapshots unavailable; estimates exclude these.`:'');
      reportContent();
    }
    function line(tag,className,text){const node=doc.createElement(tag);if(className)node.className=className;node.textContent=text;return node;}
    const switcher=createSwitcher({
      reducedMotion:()=>Boolean(motion?.matches),
      setTimer:(fn,delay)=>win.setTimeout(fn,delay),clearTimer:id=>win.clearTimeout(id),
      leave:kind=>{scenes[kind].classList.remove('is-entering');scenes[kind].classList.add('is-leaving');},
      show:model=>{
        stage.dataset.encounter=model.key;
        if(model.kind==='welcome'){requestFit();return;}
        if(model.kind==='analytics'){showReport(model.report);return;}
        if(model.kind==='award'){
          $('#awarded-title').textContent=model.title;
          $('#awarded-points').textContent=`Agreed value: ${model.agreedPoints} points each`;
          $('#awarded-recipients').replaceChildren(...model.winners.map(w=>{const row=line('div','award-winner reveal','');row.append(line('h3','',w.name),line('strong','',`${w.points} points`),line('span','',w.multiplier===.5?'50% award':'Full points'));return row;}));return;
        }
        $('#drink-title').textContent=model.title;$('#drink-summary').textContent=model.summary;$('#drink-summary').hidden=!model.summary.trim();
        const rows=model.ingredients.map((item,index)=>{
          const row=doc.createElement('li');row.className='ingredient reveal';row.style.setProperty('--row-index',index);
          row.append(line('span','ingredient-roll',item.slot),line('span','ingredient-name',item.name),line('span','ingredient-amount',item.amount));return row;
        });
        $('#display-ingredients').replaceChildren(...rows);
        $('#display-additions').textContent=model.additions?`Bartender's additions: ${model.additions}`:'';
        $('#display-additions').hidden=!model.additions;
        $('#display-safety').textContent=model.blocked?'DO NOT PREPARE OR SERVE — choose a different roll.':'';$('#display-safety').hidden=!model.blocked;
        $('#display-stats').textContent=model.stats;$('#display-method').textContent=model.method;
        $('#display-warnings').replaceChildren(...model.warnings.map(warning=>line('p','',warning)));
        $('#display-warnings').hidden=!model.warnings.length;
        $('#display-steps').replaceChildren(...model.steps.map(step=>line('li','',step)));
        const artwork=$('#drink-artwork');if(artwork.getAttribute('src')!==model.artwork)artwork.setAttribute('src',model.artwork);
        requestFit();
      },
      enter:(kind,animate)=>{
        lastKind=kind;stopReport();
        for(const [name,scene]of Object.entries(scenes)){
          scene.classList.remove('is-leaving','is-entering','is-current');scene.hidden=name!==kind;
        }
        scenes[kind].classList.add('is-current');if(animate)scenes[kind].classList.add('is-entering');requestFit();if(kind==='analytics')scheduleReport();
      },
    });
    const backdrop=$('#tavern-backdrop');
    backdrop?.addEventListener('load',()=>{stage.dataset.backdrop='ready';});
    backdrop?.addEventListener('error',()=>{stage.dataset.backdrop='missing';});
    if(backdrop?.complete)stage.dataset.backdrop=backdrop.naturalWidth?'ready':'missing';
    function suspend(){suspended=true;stopReport();stage.dataset.suspended='true';switcher.suspend();if(frame!==null&&win.cancelAnimationFrame)win.cancelAnimationFrame(frame);frame=null;}
    function resume(){if(doc.hidden)return;suspended=false;stage.dataset.suspended='false';switcher.resume();requestFit();scheduleReport();}
    doc.addEventListener('visibilitychange',()=>doc.hidden?suspend():resume());
    doc.addEventListener('freeze',suspend);doc.addEventListener('resume',resume);
    win.addEventListener('pagehide',suspend);win.addEventListener('pageshow',resume);
    win.addEventListener('resize',requestFit);motion?.addEventListener?.('change',()=>{if(!suspended){switcher.resume();requestFit();scheduleReport();}});
    if(win.ResizeObserver){const observer=new win.ResizeObserver(requestFit);observer.observe(stage);}
    doc.fonts?.ready.then(requestFit);if(suspended)suspend();else requestFit();
    return {update:(state,options)=>{
      const game=state.gameplay;
      const drink=state.currentEncounter?.snapshot;
      const q=drink&&app.gameplay?.quote(drink);
      const finished=game&&app.gameplay?.isFinished(game);
      $('#points-info').textContent=finished?`GAME ${game.gameNumber||1} COMPLETE`:q&&!q.blocked?`START ${q.starting} PTS`:'POINTS —';
      $('#bidding-range').textContent=finished?`${app.gameplay.currentAwards(game).length} COMPLETED ROUNDS`:q&&!q.blocked?`BID ${q.min}–${q.max}`:'BID RANGE —';
      const ranking=game&&app.gameplay?.valid(game)?app.gameplay.rankings(game):[];
      const leaders=ranking.filter(p=>p.points>0&&p.points===ranking[0]?.points);
      $('#current-leader').textContent=leaders.length?`${leaders.map(p=>p.name).join(' & ')} · ${leaders[0].points} pts`:'';
      return switcher.update(modelFor(state),options);
    },disconnect(){if(lastKind==='analytics')switcher.update({key:'welcome',kind:'welcome'},{immediate:true});},suspend,resume,fit:requestFit};
  }
  app.presentationView={modelFor,createSwitcher,create};
})();
