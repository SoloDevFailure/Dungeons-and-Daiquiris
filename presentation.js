'use strict';
(() => {
  const app = globalThis.D20;
  const $ = selector => document.querySelector(selector);
  function status(message){const element=$('#display-status');if(element.textContent!==message)element.textContent=message;}
  const view=app.presentationView.create({document,window});
  let connection;
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    const supplied = {session:params.get('session'),view:params.get('view')};
    const valid = item => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item?.session || '') && /^[0-9a-f]{64}$/.test(item?.view || '');
    if ((params.has('session') || params.has('view')) && !valid(supplied)) throw new Error('This display link is incomplete or invalid. Copy the full link from the phone.');
    connection = valid(supplied) ? supplied : app.storage.read('dungeons-daiquiris.display-link.v1', null);
    if (!valid(connection)) throw new Error("Open the read-only iPad link from the phone's pairing panel.");
    try { app.storage.write('dungeons-daiquiris.display-link.v1', connection); } catch { /* A valid URL still works if device storage is unavailable. */ }
    if (!globalThis.D20_CONFIG?.supabaseUrl) throw new Error('Supabase is not configured yet.');
    app.supabase.validateConfig(globalThis.D20_CONFIG);
  } catch (error) { status(error.message); return; }
  const cacheKey = `dungeons-daiquiris.display.${connection.session}`;
  const client = app.supabase.createClient(D20_CONFIG);
  try { const cached = app.storage.read(cacheKey, null); if (cached) { view.update(cached,{immediate:true}); $('#display-status').textContent = 'Showing last saved display. Connecting…'; } } catch { /* network can recover an invalid cache */ }
  let lastCached = '';
  async function poll(options) {
      const state = await client.rpc('d20_presentation', {p_session:connection.session,p_view_token:connection.view}, false, options);
      view.update(state);
      if (JSON.stringify(state) !== lastCached) {
        try { app.storage.write(cacheKey, state); lastCached=JSON.stringify(state); } catch { /* live display works with storage full */ }
      }
      status('Live · connected to the bartender.');
  }
  const loop=app.connection.createLoop({
    run:poll,interval:1000,retry:1000,
    onState(state,error){
      if(state==='offline')status(error?.status===403||error?.status===401?'Display link unavailable. Check the link with the host.':'Connection interrupted. Keeping the last display; retrying.');
      if(state==='paused')status('Display paused while this page is hidden.');
    },
  });
  loop.start();
})();
