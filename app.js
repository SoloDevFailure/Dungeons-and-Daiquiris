'use strict';
(() => {
  const app = globalThis.D20;
  const ingredients = app.ingredients.createRepository();
  const drinks = app.drinkHistory.createRepository();
  const servingSettings = app.servingSettings.createRepository();
  const game = app.gameRepository = app.gameplay.createRepository();
  try { const cached=app.storage.read(app.sessions.key,null)?.remote;if(!cached?.gameplay)game.importLegacy(cached?.players); } catch { /* Sync reports recovery errors without replacing records. */ }
  const $ = selector => document.querySelector(selector);
  const screens = {main:$('#main-screen'), options:$('#editor-screen'), history:$('#history-screen'), result:$('#result-screen'), welcome:$('#welcome-screen'), players:$('#players-screen'), winners:$('#winners-screen')};
  const grid = $('#number-grid');
  const rows = $('#ingredient-rows');
  const form = $('#ingredient-form');
  const dialog = $('#confirmation-dialog');
  let activeDrink = null;
  let startupWarning = '';
  try { activeDrink = drinks.getActive(); } catch (error) { startupWarning = error.message; }
  let selected = activeDrink ? activeDrink.rolledIngredients.map(item => item.slot) : [];
  let editorBaseline = '';
  let currentRoute = {name:'main'};
  let routeIndex = 0;
  let restoringNavigation = null;
  const ml = value => Number(value.toFixed(2)).toString();
  const date = value => new Date(value).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'});
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  let resolveDialog = null;
  function settleDialog(confirmed) {
    const resolve = resolveDialog;
    resolveDialog = null;
    dialog.close();
    resolve?.(confirmed);
  }
  function ask(title, description, action, cancel = 'CANCEL') {
    if (resolveDialog) return Promise.resolve(false);
    $('#dialog-title').textContent = title;
    $('#dialog-description').textContent = description;
    $('#dialog-confirm').textContent = action;
    $('#dialog-cancel').textContent = cancel;
    return new Promise(resolve => {
      resolveDialog = resolve;
      dialog.showModal();
      $('#dialog-cancel').focus();
    });
  }
  $('#dialog-cancel').addEventListener('click', () => settleDialog(false));
  $('#dialog-confirm').addEventListener('click', () => settleDialog(true));
  dialog.addEventListener('cancel', event => { event.preventDefault(); settleDialog(false); });
  function draftValues() {
    return [...rows.children].map(row => ({slot:Number(row.dataset.number), displayName:row.querySelector('.ingredient-name').value, amount:row.querySelector('.ingredient-amount').value, abv:row.querySelector('.ingredient-abv').value}));
  }
  function dirty() { return currentRoute.name === 'options' && JSON.stringify(draftValues()) !== editorBaseline; }
  async function allowDiscard() {
    if (!dirty()) return true;
    if (!await ask('Discard your changes?', 'Your ingredient edits have not been saved.', 'DISCARD', 'KEEP EDITING')) return false;
    editorBaseline = JSON.stringify(draftValues());
    return true;
  }
  function hashFor(route) { return route.name === 'result' ? route.historical ? `#history/${encodeURIComponent(route.id)}` : '#drink' : `#${route.name}`; }
  function parseRoute() {
    const hash = location.hash.slice(1);
    if (hash.startsWith('history/')) return {name:'result', historical:true, id:decodeURIComponent(hash.slice(8))};
    if (hash === 'drink') return {name:'result', historical:false};
    return {name:['main','options','history','welcome','players','winners'].includes(hash) ? hash : activeDrink ? 'result' : game.get().started ? 'main' : 'welcome', historical:false};
  }
  function showRoute(route) {
    if(route.name==='winners'&&(!activeDrink||game.get().awards.some(a=>a.encounterId===activeDrink.id)))route={name:activeDrink?'result':'welcome'};
    currentRoute = route;
    Object.entries(screens).forEach(([name, element]) => { element.hidden = name !== route.name; });
    if(route.name==='welcome'){renderWelcome();$('#welcome-title').focus({preventScroll:true});}
    if(route.name==='players'){renderPlayers();$('#players-title').focus({preventScroll:true});}
    if(route.name==='winners'){renderWinners();$('#winners-title').focus({preventScroll:true});}
    if(route.name==='main'&&app.gameplay.isFinished(game.get())){navigate({name:'welcome'},true);return;}
    if (route.name === 'main') { renderSelection(); $('#main-title').focus({preventScroll:true}); }
    if (route.name === 'options') { renderEditor(); $('#editor-title').focus({preventScroll:true}); }
    if (route.name === 'history') { renderHistory(); $('#history-title').focus({preventScroll:true}); }
    if (route.name === 'result') { renderResult(route); $('#result-title').focus({preventScroll:true}); }
  }
  function navigate(route, replace = false) {
    if (!replace) routeIndex++;
    history[replace ? 'replaceState' : 'pushState']({d20:true,index:routeIndex,route}, '', hashFor(route));
    showRoute(route);
  }
  async function back(fallback = {name:'main'}) {
    if (!await allowDiscard()) return;
    if (routeIndex > 0) history.back();
    else navigate(fallback, true);
  }
  window.addEventListener('popstate', async event => {
    const target = event.state?.d20 ? event.state.route : parseRoute();
    const nextIndex = event.state?.d20 ? event.state.index : routeIndex;
    if (restoringNavigation) {
      const pending = restoringNavigation;
      restoringNavigation = null;
      if (await allowDiscard()) history.go(pending.index - routeIndex);
      return;
    }
    if (dirty() && nextIndex !== routeIndex) {
      restoringNavigation = {index:nextIndex};
      history.go(routeIndex - nextIndex);
      return;
    }
    if (dirty() && !await allowDiscard()) {
      history.replaceState({d20:true,index:routeIndex,route:currentRoute}, '', hashFor(currentRoute));
      return;
    }
    routeIndex = nextIndex;
    showRoute(target);
  });
  window.addEventListener('beforeunload', event => {
    if (dirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  function selectionIngredient(slot) {
    return activeDrink?.finalIngredients.find(item => item.slot === slot) || ingredients.getById(slot);
  }
  function describe(item) { return item.measurementUnit==='drops' ? `${item.displayName} - ${item.drops} ${item.drops===1?'drop':'drops'} (~${ml(item.finalMl)} mL)` : `${item.displayName} - ${ml(item.finalMl ?? item.defaultMl)} mL`; }
  function renderSelection() {
    const complete = selected.length === 3;
    for (const button of grid.children) {
      const slot = Number(button.dataset.number);
      const isSelected = selected.includes(slot);
      button.classList.toggle('selected', isSelected);
      button.disabled = Boolean(activeDrink) || (complete && !isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
      button.setAttribute('aria-label', `${slot}: ${describe(selectionIngredient(slot))}`);
      button.title = describe(selectionIngredient(slot));
    }
    $('#count').textContent = `${selected.length} / 3`;
    document.querySelectorAll('.choices span').forEach((slot, index) => {
      const id = selected[index];
      slot.textContent = id ?? '—';
      slot.title = id ? describe(selectionIngredient(id)) : 'No ingredient selected';
      slot.setAttribute('aria-label', id ? `${id}: ${slot.title}` : slot.title);
    });
    $('#confirm').disabled = !complete;
    $('#finish-game').disabled=Boolean(activeDrink)||!game.get().started;
    $('#confirm').textContent = activeDrink ? 'VIEW YOUR DRINK' : 'CONFIRM SELECTION';
    $('#status').textContent = startupWarning || (activeDrink ? 'Your choices are sealed. Your drink is saved.' : complete ? 'Ready to confirm. Tap a number to change.' : selected.length ? `${selected.length} of 3 selected. Tap again to change.` : 'Choose three. Tap again to change.');
  }
  for (const item of ingredients.getAll()) {
    const button = node('button', 'number', item.slot);
    button.type = 'button';
    button.dataset.number = item.slot;
    button.addEventListener('click', () => {
      if (activeDrink) return;
      const index = selected.indexOf(item.slot);
      if (index !== -1) selected.splice(index, 1);
      else if (selected.length < 3) selected.push(item.slot);
      renderSelection();
    });
    grid.append(button);
  }
  $('#confirm').addEventListener('click', () => {
    if (activeDrink) { navigate({name:'result',historical:false}); return; }
    if (selected.length !== 3) return;
    if(app.gameplay.isFinished(game.get())){navigate({name:'welcome'});return;}
    try {
      const result = app.drinkGenerator.generateDrink(selected.map(slot => ingredients.getById(slot)), {inventory:ingredients.getAll(),policy:servingSettings.get()});
      drinks.saveGenerated(result); // Commit history and active result together before locking the UI.
      activeDrink = result;
      app.cloud?.queue('encounter', result);
      startupWarning = '';
      navigate({name:'result',historical:false});
      void app.aiService.promptAPI(app.clone(result)).catch(() => {
        // Presentation integrations must never prevent local generation or alter its recipe.
      });
    } catch {
      $('#status').textContent = 'Could not save this drink. Your choices are still here. Check local storage and try again.';
    }
  });
  function renderEditor() {
    rows.replaceChildren();
    for (const item of ingredients.getAll()) {
      const row = node('div', 'ingredient-row');
      row.dataset.number = item.slot;
      const number = node('span', 'ingredient-id', item.slot);
      const name = node('input', 'ingredient-name');
      name.type = 'text'; name.value = item.displayName; name.required = true; name.maxLength = 100;
      name.setAttribute('aria-label', `Ingredient ${item.slot} name`);
      const amount = node('input', 'ingredient-amount');
      amount.type = 'number'; amount.inputMode = 'decimal'; amount.min = '0'; amount.step = 'any'; amount.required = true; amount.value = item.defaultMl;
      amount.setAttribute('aria-label', `Ingredient ${item.slot} amount in mL`);
      const abv = node('input', 'ingredient-abv');
      abv.type = 'number'; abv.inputMode = 'decimal'; abv.min = '0'; abv.max = '100'; abv.step = 'any'; abv.required = true; abv.value = item.abv;
      abv.setAttribute('aria-label', `Ingredient ${item.slot} ABV percent`);
      row.append(number, name, amount, abv); rows.append(row);
    }
    editorBaseline = JSON.stringify(draftValues());
    $('#editor-status').textContent = ingredients.getWarning() || 'Names, pours and ABV are editable. Slot compatibility and recipe limits still apply.';
    rows.scrollTop = 0;
  }
  $('#options').addEventListener('click', () => navigate({name:'options'}));
  $('#history').addEventListener('click', () => navigate({name:'history'}));
  $('#back').addEventListener('click', () => back());
  $('#history-back').addEventListener('click', () => back());
  $('#result-back').addEventListener('click', () => back(currentRoute.historical ? {name:'history'} : {name:'main'}));
  form.addEventListener('input', event => {
    event.target.setCustomValidity('');
    $('#editor-status').textContent = dirty() ? 'Unsaved changes.' : 'No unsaved changes.';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    for (const input of rows.querySelectorAll('.ingredient-name')) input.setCustomValidity(input.value.trim() ? '' : 'Enter an ingredient name.');
    if (!form.reportValidity()) return;
    try {
      ingredients.save(draftValues().map(item => ({slot:item.slot,displayName:item.displayName.trim(),defaultMl:Number(item.amount),abv:Number(item.abv)})));
      editorBaseline = JSON.stringify(draftValues());
      app.cloud?.queue('config', ingredients.getAll());
      void back();
    } catch {
      $('#editor-status').textContent = 'Unable to save on this device. Your edits are still here; please try again.';
    }
  });
  function renderHistory() {
    const list = $('#history-list');
    list.replaceChildren();
    $('#history-status').textContent = '';
    try {
      const entries = drinks.list();
      $('#clear-history').disabled = entries.length === 0;
      if (!entries.length) list.append(node('p','empty-state','The ledger is empty. Confirm your first three rolls to begin.'));
      for (const drink of entries) {
        const button = node('button','history-entry');
        button.type = 'button';
        button.append(node('span','entry-date',date(drink.createdAt)), node('span','entry-title',drink.bartenderTitle));
        for (const item of drink.finalIngredients) button.append(node('span','entry-ingredient',`${item.slot} · ${describe(item)}`));
        button.append(node('span','entry-volume',`${ml(drink.totalVolumeMl)} mL · VIEW DRINK →`));
        button.addEventListener('click', () => navigate({name:'result',historical:true,id:drink.id}));
        list.append(button);
      }
      $('#history-status').textContent = `${entries.length} ${entries.length === 1 ? 'drink' : 'drinks'} saved on this device.`;
    } catch (error) {
      list.append(node('p','empty-state',error.message));
      $('#clear-history').disabled = false;
    }
    list.scrollTop = 0;
  }
  function resultSection(title) {
    const section = node('section','result-section');
    section.append(node('h2','section-title',title));
    return section;
  }
  function renderResult(route) {
    const content = $('#result-content');
    content.replaceChildren();
    $('#result-status').textContent = '';
    $('#pour-next').hidden = true;
    $('#skip-drink').hidden=true;
    $('#result-context').textContent = route.historical ? 'FROM THE LEDGER · READ ONLY' : 'SEALED & SAVED';
    $('#result-title').textContent = 'YOUR DRINK';
    let drink;
    try { drink = route.historical ? drinks.get(route.id) : activeDrink; } catch { /* show a recoverable missing result */ }
    if (!drink) { content.append(node('p','empty-state','This drink is no longer available. Use Back to return to the game.')); return; }
    content.append(node('p','drink-name',drink.bartenderTitle),node('p','bartender-summary',drink.bartenderSummary),node('p','entry-date',date(drink.createdAt)));
    if(drink.quantityBasis==='per_serving'){
      content.append(node('p','serving-basis',`PER SERVING · ${drink.servingStyle.toUpperCase()} · ${ml(drink.servingLimitMl)} mL ceiling`));
      if(drink.safety?.status==='blocked')content.append(node('p','blocked-recipe','DO NOT PREPARE OR SERVE — choose a different roll.'));
    }
    const recipe = resultSection(drink.quantityBasis==='per_serving'?'THE THREE ROLLS — ONE SERVING':'THE THREE ROLLS');
    for (const item of drink.finalIngredients) {
      const row = node('div','recipe-row');
      row.append(node('span','roll-badge',item.slot));
      const details = node('div','recipe-details');
      details.append(node('strong','',item.displayName));
      if (item.finalMl !== item.requestedMl) details.append(node('small','',`Requested ${ml(item.requestedMl)} mL · adjusted by the generator`));
      row.append(details,node('span','recipe-amount',item.measurementUnit==='drops'?`${item.drops} ${item.drops===1?'drop':'drops'} (~${ml(item.finalMl)} mL)`:`${ml(item.finalMl)} mL`)); recipe.append(row);
    }
    content.append(recipe);
    if (drink.generatorAdditions.length) {
      const additions = resultSection('BARTENDER’S ADDITIONS');
      for (const item of drink.generatorAdditions) additions.append(node('p','addition',item.kind === 'ice' ? `+ Ice · ${item.preparation.replaceAll('_',' ')}` : `+ ${describe(item)}`));
      content.append(additions);
    }
    const stats = node('div','drink-stats');
    for (const [label,value] of [['LIQUID',`${ml(drink.totalVolumeMl)} mL`],['EST. ABV',`${drink.estimatedAbv.toFixed(1)}%`],['PURE ALCOHOL',`${drink.pureAlcoholMl.toFixed(1)} mL`]]) {
      const stat = node('div',''); stat.append(node('span','',label),node('strong','',value)); stats.append(stat);
    }
    content.append(stats);
    if(drink.batch){
      const batch=resultSection('BATCH FOR TWO IDENTICAL SERVINGS');
      for(const item of drink.batch.ingredients)batch.append(node('p','addition',describe(item)));
      for(const item of drink.batch.generatorAdditions)batch.append(node('p','addition',item.kind==='ice'?'Ice (as configured)':describe(item)));
      batch.append(node('p','addition',`${ml(drink.batch.totalVolumeMl)} mL total · ${ml(drink.batch.pureAlcoholMl)} mL pure alcohol in the batch · split equally between two servings`));content.append(batch);
    }
    const orders = resultSection('BARTENDER’S ORDERS');
    orders.append(node('p','preparation-method',drink.preparationMethod));
    const steps = node('ol','preparation-steps');
    drink.preparationSteps.forEach(step => steps.append(node('li','',step)));
    orders.append(steps); content.append(orders);
    if (drink.warnings.length) {
      const warnings = resultSection('A WORD FROM THE BAR'); warnings.classList.add('warning-panel');
      drink.warnings.forEach(warning => warnings.append(node('p','',warning))); content.append(warnings);
    }
    const notes = resultSection('GENERATOR NOTES');
    drink.generatorNotes.forEach(note => notes.append(node('p','generator-note',note)));
    notes.append(node('p','generator-note','Alcohol estimates use the saved ABVs. Renaming a slot does not change its compatibility profile.'));
    content.append(notes);
    $('#pour-next').hidden = Boolean(route.historical);
    const completed=game.get().awards.find(a=>a.encounterId===drink.id),q=app.gameplay.quote(drink);
    $('#pour-next').textContent=q.blocked?'SKIP THIS ROLL':completed?'NEXT DRINK':'SELECT WINNERS';
    $('#skip-drink').hidden=Boolean(route.historical)||q.blocked||Boolean(completed);
    const points=resultSection('AUCTION POINTS');points.append(node('p','addition',q.blocked?'No points: blocked or empty recipe.':`Starting ${q.starting} · allowed ${q.min}–${q.max} per contestant`));
    if(completed)for(const winner of completed.winners)points.append(node('p','addition',`${winner.name}: ${winner.points} points${winner.multiplier===.5?' (50%)':''}`));
    content.insertBefore(points,content.firstChild);
    content.scrollTop = 0;
  }
  function changed(){app.cloud?.wake?.();}
  function finishRound(keepPresentation=false){
    if(!activeDrink)return;
    drinks.finish(activeDrink);activeDrink=null;selected=[];startupWarning='';
    try{game.saveDraft(null);}catch{ /* A stale draft must not prevent the saved round from advancing. */ }
    if(!keepPresentation)app.cloud?.queue('clear',{});navigate({name:'main'},true);
  }
  $('#pour-next').addEventListener('click',async()=>{
    if(!activeDrink||currentRoute.historical)return;
    try{
      if(app.gameplay.quote(activeDrink).blocked){if(await ask('Skip this roll?','The recipe stays in History. No points will be awarded.','SKIP'))finishRound();return;}
      if(game.get().awards.some(a=>a.encounterId===activeDrink.id)){finishRound(true);return;}
      if(!game.get().started){game.start();changed();}
      navigate({name:'winners'});
    }catch(error){$('#result-status').textContent=error.message;}
  });
  $('#skip-drink').addEventListener('click',async()=>{
    if(!activeDrink||currentRoute.historical)return;
    if(!await ask('Skip without points?','Keep this recipe in History and return to the dice. No contestant earns points.','SKIP'))return;
    try{finishRound();}catch(error){$('#result-status').textContent=error.message;}
  });
  function renderWelcome(){
    const state=game.get(),ranking=app.gameplay.rankings(state);
    $('#game-summary').textContent=`${state.players.filter(p=>p.enabled).length} participating · ${app.gameplay.currentAwards(state).length} completed rounds`;
    $('#start-game').textContent=app.gameplay.isFinished(state)?'NEW GAME':state.started?'RESUME GAME':'START GAME';
    $('#leaderboard').replaceChildren(...ranking.map(p=>{const row=node('div','contestant-row');row.append(node('span','',`${p.name}${p.enabled?'':' · not participating'}`),node('strong','',`${p.points} pts`));return row;}));
    $('#welcome-status').textContent=game.pending().length?'Points and contestants saved on this phone; upload pending.':'';
  }
  function renderPlayers(){
    const state=game.get();$('#contestant-list').replaceChildren(...state.players.map(p=>{
      const label=node('label','contestant-row'),input=node('input');input.type='checkbox';input.checked=p.enabled;
      input.addEventListener('change',()=>{try{game.setEnabled(p.id,input.checked);changed();$('#players-status').textContent='Saved on this phone.';}catch(error){input.checked=!input.checked;$('#players-status').textContent=error.message;}});
      label.append(input,node('span','',p.name));return label;
    }));
  }
  function draft(){
    const saved=game.getDraft();return saved?.encounterId===activeDrink?.id?saved:{encounterId:activeDrink?.id,winners:[],agreedPoints:activeDrink?app.gameplay.quote(activeDrink).starting:0};
  }
  function renderWinners(){
    const state=game.get(),current=draft();
    current.winners=current.winners.filter(w=>state.players.some(p=>p.id===w.playerId&&p.enabled));game.saveDraft(current);
    $('#winners-drink').textContent=activeDrink.bartenderTitle;
    $('#winner-list').replaceChildren(...state.players.filter(p=>p.enabled).map(p=>{
      const label=node('label','contestant-row'),input=node('input');input.type='checkbox';input.checked=current.winners.some(w=>w.playerId===p.id);input.disabled=current.winners.length>=3&&!input.checked;
      input.addEventListener('change',()=>{try{const next=draft();next.winners=next.winners.filter(w=>w.playerId!==p.id);if(input.checked)next.winners.push({playerId:p.id,multiplier:1});game.saveDraft(next);renderWinners();}catch(error){$('#winners-status').textContent=error.message;}});
      label.append(input,node('span','',p.name));return label;
    }));
    $('#winners-status').textContent=`${current.winners.length} / 3 chosen`;$('#winners-next').disabled=!current.winners.length;
  }
  function renderAwardRecipients(){
    const current=draft(),state=game.get();$('#award-winners').replaceChildren(...current.winners.map(w=>{
      const row=node('div','award-recipient'),button=node('button','small-button',w.multiplier===.5?'50% POINTS':'FULL POINTS');button.type='button';button.setAttribute('aria-pressed',String(w.multiplier===.5));button.setAttribute('aria-label',`50% points for ${state.players.find(p=>p.id===w.playerId)?.name}`);
      button.addEventListener('click',()=>{try{const next=draft(),winner=next.winners.find(i=>i.playerId===w.playerId);winner.multiplier=winner.multiplier===1?.5:1;game.saveDraft(next);renderAwardRecipients();}catch(error){$('#award-status').textContent=error.message;}});
      row.append(node('span','',state.players.find(p=>p.id===w.playerId)?.name||'Unavailable'),button,node('strong','',`${Number.isFinite(current.agreedPoints)?current.agreedPoints*w.multiplier:0} pts`));return row;
    }));
  }
  $('#winners-next').addEventListener('click',()=>{
    if(!activeDrink||!draft().winners.length)return;const q=app.gameplay.quote(activeDrink);
    $('#award-drink').textContent=activeDrink.bartenderTitle;$('#award-range').textContent=`Starting ${q.starting} · allowed ${q.min}–${q.max}. One agreed value, individual half-points penalties.`;
    const input=$('#agreed-points');input.min=q.min;input.max=q.max;input.value=draft().agreedPoints;$('#award-status').textContent='';renderAwardRecipients();$('#award-dialog').showModal();input.focus();input.select();
  });
  $('#agreed-points').addEventListener('input',()=>{try{const current=draft();current.agreedPoints=Number($('#agreed-points').value);game.saveDraft(current);renderAwardRecipients();}catch(error){$('#award-status').textContent=error.message;}});
  $('#award-cancel').addEventListener('click',()=>$('#award-dialog').close());
  $('#award-form').addEventListener('submit',event=>{
    event.preventDefault();if(!activeDrink||!$('#award-form').reportValidity())return;
    try{
      const current=draft();game.award(activeDrink,current.winners,Number($('#agreed-points').value));changed();
      // Persist the award first. A failed finish/reload can continue without awarding twice.
      $('#award-dialog').close();finishRound(true);
    }catch(error){if(!$('#award-dialog').open)navigate({name:'result'},true);$('#award-status').textContent=error.message;$('#result-status').textContent=error.message;}
  });
  $('#start-game').addEventListener('click',async()=>{
    try{
      if(app.gameplay.isFinished(game.get())){
        if(!await ask('Start a new game?','Current results will be archived. Contestants and ingredients stay saved; the new game begins at zero points.','NEW GAME'))return;
        game.newGame();if(activeDrink){drinks.finish(activeDrink);activeDrink=null;}selected=[];app.cloud?.queue('clear',{});
      }else game.start();
      changed();navigate({name:activeDrink?'result':'main'});
    }catch(error){$('#welcome-status').textContent=error.message;}
  });
  $('#finish-game').addEventListener('click',async()=>{
    if(activeDrink){$('#status').textContent='Award or skip the current drink before finishing.';return;}
    if(!await ask('Finish the game?','The iPad will show final rankings and analytics. Your results remain saved.','FINISH GAME'))return;
    try{game.finish();changed();navigate({name:'welcome'});}catch(error){$('#status').textContent=error.message;}
  });
  $('#game-home').addEventListener('click',()=>navigate({name:'welcome'}));
  $('#welcome-options').addEventListener('click',()=>navigate({name:'players'}));
  $('#welcome-pair').addEventListener('click',()=>$('#session-open').click());
  $('#welcome-history').addEventListener('click',()=>navigate({name:'history'}));
  $('#options-players').addEventListener('click',async()=>{if(await allowDiscard())navigate({name:'players'});});
  $('#players-ingredients').addEventListener('click',()=>navigate({name:'options'}));
  $('#players-back').addEventListener('click',()=>back({name:'welcome'}));
  $('#players-done').addEventListener('click',()=>navigate({name:'welcome'}));
  $('#winners-back').addEventListener('click',()=>navigate({name:'result'}));
  $('#contestant-add').addEventListener('submit',event=>{event.preventDefault();try{game.addPlayer($('#contestant-name').value);$('#contestant-name').value='';changed();renderPlayers();$('#players-status').textContent='Contestant added.';}catch(error){$('#players-status').textContent=error.message;}});
  window.addEventListener('d20-gameplay',()=>{if(currentRoute.name==='welcome')renderWelcome();if(currentRoute.name==='players')renderPlayers();});
  $('#clear-history').addEventListener('click', async () => {
    if (!await ask('Clear drink history?', 'Delete all saved history entries on this device? This cannot be undone. Your active drink, if any, remains available.', 'CLEAR HISTORY')) return;
    try { drinks.clear(); startupWarning = ''; renderHistory(); }
    catch { $('#history-status').textContent = 'History could not be cleared. Nothing has been removed.'; }
  });
  app.controller = {
    getConfig: () => ingredients.getAll(),
    getActive: () => activeDrink && app.clone(activeDrink),
    useConfig(config) {
      if (dirty()) throw new Error('Save or discard your ingredient edits first.');
      // Keep a recovery copy before an explicitly requested shared-settings import.
      app.storage.write('dungeons-daiquiris.ingredients.before-session-import', ingredients.getAll());
      ingredients.save(config);
      if (currentRoute.name === 'options') renderEditor();
      if (currentRoute.name === 'main') renderSelection();
    },
    useDrink(drink) {
      if (dirty()) throw new Error('Save or discard your ingredient edits first.');
      if (!app.drinkHistory.validDrink(drink)) throw new Error('Session recipe is invalid.');
      if (activeDrink && activeDrink.id !== drink.id) throw new Error('Finish your local drink first. It has not been replaced.');
      drinks.saveGenerated(drink); activeDrink = app.clone(drink);
      selected = drink.rolledIngredients.map(item => item.slot);
      navigate({name:'result',historical:false});
    },
  };
  const policyForm=$('#serving-form');
  $('#serving-options').addEventListener('click',()=>{
    const policy=servingSettings.get();
    for(const [key,value]of Object.entries(policy)){const input=policyForm.elements.namedItem(key);if(typeof value==='boolean')input.checked=value;else input.value=value;}
    $('#serving-status').textContent=servingSettings.getWarning();$('#serving-dialog').showModal();
  });
  $('#serving-close').addEventListener('click',()=>$('#serving-dialog').close());
  policyForm.addEventListener('submit',event=>{
    event.preventDefault();if(!policyForm.reportValidity())return;
    try{
      const next={};for(const [key,value]of Object.entries(app.drinkGenerator.defaultPolicy)){const input=policyForm.elements.namedItem(key);next[key]=typeof value==='boolean'?input.checked:Number(input.value);}
      servingSettings.save(next);$('#serving-dialog').close();
    }catch(error){$('#serving-status').textContent=error.message;}
  });
  const initialRoute = parseRoute();
  history.replaceState({d20:true,index:0,route:initialRoute}, '', hashFor(initialRoute));
  showRoute(initialRoute);
})();



