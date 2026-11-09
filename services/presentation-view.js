'use strict';
(() => {
  const app=globalThis.D20;
  const PLACEHOLDER='assets/presentation/cocktail-placeholder.svg';
  const ml=value=>String(Number(value));
  function modelFor(state){
    if(!state || typeof state!=='object')throw new Error('Presentation state is invalid.');
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
      ingredients:drink.finalIngredients.map(item=>({slot:item.slot,name:item.displayName,amount:`${ml(item.finalMl)} mL`})),
      additions:drink.generatorAdditions.map(item=>item.kind==='ice'?'Ice':`${item.displayName} — ${ml(item.finalMl)} mL`).join(' · '),
      stats:`${ml(drink.totalVolumeMl)} mL total · ${drink.estimatedAbv.toFixed(1)}% estimated ABV · ${encounter.servings || 2} servings, split evenly`,
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
        leave(displayedKey==='welcome'?'welcome':'drink');
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
    const scenes={welcome:$('#waiting'),drink:$('#encounter')};
    const motion=win.matchMedia?.('(prefers-reduced-motion: reduce)');
    let frame=null,suspended=doc.hidden;
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
    function line(tag,className,text){const node=doc.createElement(tag);if(className)node.className=className;node.textContent=text;return node;}
    const switcher=createSwitcher({
      reducedMotion:()=>Boolean(motion?.matches),
      setTimer:(fn,delay)=>win.setTimeout(fn,delay),clearTimer:id=>win.clearTimeout(id),
      leave:kind=>{scenes[kind].classList.remove('is-entering');scenes[kind].classList.add('is-leaving');},
      show:model=>{
        stage.dataset.encounter=model.key;
        if(model.kind==='welcome'){requestFit();return;}
        $('#drink-title').textContent=model.title;$('#drink-summary').textContent=model.summary;$('#drink-summary').hidden=!model.summary.trim();
        const rows=model.ingredients.map((item,index)=>{
          const row=doc.createElement('li');row.className='ingredient reveal';row.style.setProperty('--row-index',index);
          row.append(line('span','ingredient-roll',item.slot),line('span','ingredient-name',item.name),line('span','ingredient-amount',item.amount));return row;
        });
        $('#display-ingredients').replaceChildren(...rows);
        $('#display-additions').textContent=model.additions?`Bartender's additions: ${model.additions}`:'';
        $('#display-additions').hidden=!model.additions;
        $('#display-stats').textContent=model.stats;$('#display-method').textContent=model.method;
        $('#display-warnings').replaceChildren(...model.warnings.map(warning=>line('p','',warning)));
        $('#display-warnings').hidden=!model.warnings.length;
        $('#display-steps').replaceChildren(...model.steps.map(step=>line('li','',step)));
        const artwork=$('#drink-artwork');if(artwork.getAttribute('src')!==model.artwork)artwork.setAttribute('src',model.artwork);
        requestFit();
      },
      enter:(kind,animate)=>{
        for(const [name,scene]of Object.entries(scenes)){
          scene.classList.remove('is-leaving','is-entering','is-current');scene.hidden=name!==kind;
        }
        scenes[kind].classList.add('is-current');if(animate)scenes[kind].classList.add('is-entering');requestFit();
      },
    });
    const backdrop=$('#tavern-backdrop');
    backdrop?.addEventListener('load',()=>{stage.dataset.backdrop='ready';});
    backdrop?.addEventListener('error',()=>{stage.dataset.backdrop='missing';});
    if(backdrop?.complete)stage.dataset.backdrop=backdrop.naturalWidth?'ready':'missing';
    function suspend(){suspended=true;stage.dataset.suspended='true';switcher.suspend();if(frame!==null&&win.cancelAnimationFrame)win.cancelAnimationFrame(frame);frame=null;}
    function resume(){if(doc.hidden)return;suspended=false;stage.dataset.suspended='false';switcher.resume();requestFit();}
    doc.addEventListener('visibilitychange',()=>doc.hidden?suspend():resume());
    doc.addEventListener('freeze',suspend);doc.addEventListener('resume',resume);
    win.addEventListener('pagehide',suspend);win.addEventListener('pageshow',resume);
    win.addEventListener('resize',requestFit);motion?.addEventListener?.('change',()=>{if(!suspended){switcher.resume();requestFit();}});
    if(win.ResizeObserver){const observer=new win.ResizeObserver(requestFit);observer.observe(stage);}
    doc.fonts?.ready.then(requestFit);if(suspended)suspend();else requestFit();
    return {update:(state,options)=>switcher.update(modelFor(state),options),suspend,resume,fit:requestFit};
  }
  app.presentationView={modelFor,createSwitcher,create};
})();
