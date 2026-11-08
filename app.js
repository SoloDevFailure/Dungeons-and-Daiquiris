'use strict';
(() => {
  const app = globalThis.D20;
  const ingredients = app.ingredients.createRepository();
  const drinks = app.drinkHistory.createRepository();
  const $ = selector => document.querySelector(selector);
  const screens = {main:$('#main-screen'), options:$('#editor-screen'), history:$('#history-screen'), result:$('#result-screen')};
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
    return [...rows.children].map(row => ({slot:Number(row.dataset.number), displayName:row.querySelector('.ingredient-name').value, amount:row.querySelector('.ingredient-amount').value}));
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
    return {name:['main','options','history'].includes(hash) ? hash : activeDrink ? 'result' : 'main', historical:false};
  }
  function showRoute(route) {
    currentRoute = route;
    Object.entries(screens).forEach(([name, element]) => { element.hidden = name !== route.name; });
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
  function describe(item) { return `${item.displayName} — ${ml(item.finalMl ?? item.defaultMl)} mL`; }
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
    try {
      const result = app.drinkGenerator.generateDrink(selected.map(slot => ingredients.getById(slot)));
      drinks.saveGenerated(result); // Commit history and active result together before locking the UI.
      activeDrink = result;
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
      row.append(number, name, amount); rows.append(row);
    }
    editorBaseline = JSON.stringify(draftValues());
    $('#editor-status').textContent = ingredients.getWarning() || 'Names and requested pours are editable. Recipe limits still apply.';
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
      ingredients.save(draftValues().map(item => ({slot:item.slot,displayName:item.displayName.trim(),defaultMl:Number(item.amount)})));
      editorBaseline = JSON.stringify(draftValues());
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
    $('#result-context').textContent = route.historical ? 'FROM THE LEDGER · READ ONLY' : 'SEALED & SAVED';
    $('#result-title').textContent = 'YOUR DRINK';
    let drink;
    try { drink = route.historical ? drinks.get(route.id) : activeDrink; } catch { /* show a recoverable missing result */ }
    if (!drink) { content.append(node('p','empty-state','This drink is no longer available. Use Back to return to the game.')); return; }
    content.append(node('p','drink-name',drink.bartenderTitle),node('p','bartender-summary',drink.bartenderSummary),node('p','entry-date',date(drink.createdAt)));
    const recipe = resultSection('THE THREE ROLLS');
    for (const item of drink.finalIngredients) {
      const row = node('div','recipe-row');
      row.append(node('span','roll-badge',item.slot));
      const details = node('div','recipe-details');
      details.append(node('strong','',item.displayName));
      if (item.finalMl !== item.requestedMl) details.append(node('small','',`Requested ${ml(item.requestedMl)} mL · adjusted by the generator`));
      row.append(details,node('span','recipe-amount',`${ml(item.finalMl)} mL`)); recipe.append(row);
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
    notes.append(node('p','generator-note','Alcohol estimates use the stored reference ABVs. Editing a name does not change its slot’s alcohol or compatibility profile.'));
    content.append(notes);
    $('#pour-next').hidden = Boolean(route.historical);
    content.scrollTop = 0;
  }
  $('#pour-next').addEventListener('click', async () => {
    if (!activeDrink || currentRoute.historical) return;
    if (!await ask('Pour the next drink?', 'Your current selection will be cleared so a new roll can begin. This drink stays in History.', 'POUR NEXT DRINK')) return;
    try {
      drinks.finish(activeDrink); // Ensure the snapshot exists before releasing the current roll.
      activeDrink = null; selected = []; startupWarning = '';
      navigate({name:'main'},true);
    } catch {
      $('#result-status').textContent = 'Could not save the reset. Your current drink is still here. Please try again.';
    }
  });
  $('#clear-history').addEventListener('click', async () => {
    if (!await ask('Clear drink history?', 'Delete all saved history entries on this device? This cannot be undone. Your active drink, if any, remains available.', 'CLEAR HISTORY')) return;
    try { drinks.clear(); startupWarning = ''; renderHistory(); }
    catch { $('#history-status').textContent = 'History could not be cleared. Nothing has been removed.'; }
  });
  const initialRoute = parseRoute();
  history.replaceState({d20:true,index:0,route:initialRoute}, '', hashFor(initialRoute));
  showRoute(initialRoute);
})();



