'use strict';
(() => {
  const app = globalThis.D20;
  const $ = selector => document.querySelector(selector);
  let connection;
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    const supplied = {session:params.get('session'),view:params.get('view')};
    const valid = item => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item?.session || '') && /^[0-9a-f]{64}$/.test(item?.view || '');
    if ((params.has('session') || params.has('view')) && !valid(supplied)) throw new Error('This display link is incomplete or invalid. Copy the full link from the phone.');
    connection = valid(supplied) ? supplied : app.storage.read('dungeons-daiquiris.display-link.v1', null);
    if (!valid(connection)) throw new Error('Open the read-only iPad link from the phone’s Game Session screen.');
    try { app.storage.write('dungeons-daiquiris.display-link.v1', connection); } catch { /* A valid URL still works if device storage is unavailable. */ }
    if (!globalThis.D20_CONFIG?.supabaseUrl) throw new Error('Supabase is not configured yet.');
    app.supabase.validateConfig(globalThis.D20_CONFIG);
  } catch (error) { $('#display-status').textContent = error.message; return; }
  const cacheKey = `dungeons-daiquiris.display.${connection.session}`;
  const client = app.supabase.createClient(D20_CONFIG);
  let lastRender = '';
  function line(tag, text) { const node = document.createElement(tag); node.textContent = text; return node; }
  function render(state) {
    const signature = JSON.stringify(state);
    if (signature === lastRender) return;

    $('#session-label').textContent = state.name;
    const encounter = state.currentEncounter;
    $('#waiting').hidden = Boolean(encounter);
    $('#encounter').hidden = !encounter;
    if (!encounter) { lastRender = signature; return; }
    const drink = encounter.snapshot;
    if (!app.drinkHistory.validDrink(drink)) throw new Error('The current recipe could not be displayed.');
    $('#drink-title').textContent = drink.bartenderTitle;
    $('#drink-summary').textContent = drink.bartenderSummary;
    $('#display-ingredients').replaceChildren();
    for (const item of drink.finalIngredients) $('#display-ingredients').append(line('li', `${item.displayName} — ${item.finalMl} mL`));
    for (const item of drink.generatorAdditions) $('#display-ingredients').append(line('li', item.kind === 'ice' ? 'Ice' : `${item.displayName} — ${item.finalMl} mL`));
    $('#display-stats').textContent = `${drink.totalVolumeMl} mL recipe · ${drink.estimatedAbv.toFixed(1)}% estimated ABV · ${encounter.servings} servings (split evenly)`;
    $('#display-steps').replaceChildren(...drink.preparationSteps.map(step => line('li',step)));
    $('#display-warnings').replaceChildren(...drink.warnings.map(warning => line('p',warning)));
    lastRender = signature;
  }
  try { const cached = app.storage.read(cacheKey, null); if (cached) { render(cached); $('#display-status').textContent = 'Showing last saved display. Connecting…'; } } catch { /* network can recover an invalid cache */ }
  let active = false;
  async function poll() {
    if (active || document.hidden) return;
    active = true;
    try {
      const state = await client.rpc('d20_presentation', {p_session:connection.session,p_view_token:connection.view}, false);
      render(state);
      try { app.storage.write(cacheKey, state); } catch { /* live display works with storage full */ }
      $('#display-status').textContent = `Live · last checked ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      $('#display-status').textContent = error.status === 403 || error.status === 401 ? 'Display link unavailable. Check the link with the host.' : 'Connection interrupted. Keeping the last display; retrying…';
    } finally { active = false; }
  }
  setInterval(() => void poll(), 1000);
  window.addEventListener('online', () => void poll());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });
  void poll();
})();
