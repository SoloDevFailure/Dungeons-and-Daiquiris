'use strict';
(() => {
  const app = globalThis.D20;
  const $ = selector => document.querySelector(selector);
  let repository = null;
  let lastError = '';
  let busy = false;
  try {
    if (globalThis.D20_CONFIG?.supabaseUrl) repository = app.sessions.createRepository(app.supabase.createClient(D20_CONFIG));
  } catch (error) { lastError = error.message; }
  function render() {
    let state;
    try { state = repository?.get(); } catch (error) { lastError = error.message; }
    $('#cloud-status').textContent = lastError || (!repository ? 'Offline mode. Supabase is not configured yet.' : state ? state.pending.length ? `${state.pending.length} changes waiting to sync.` : state.creating ? 'Session creation waiting for connection.' : 'Session synced.' : 'Ready to create a session using this device’s ingredient settings.');
    $('#session-open').textContent = lastError ? 'SESSION · SYNC ERROR' : state?.pending.length ? 'SESSION · SYNC PENDING' : 'GAME SESSION';
    $('#session-create').hidden = Boolean(state);
    $('#session-detail').textContent = state ? `${state.name} · ${state.id}${state.remote ? ` · revision ${state.remote.revision}` : ''}` : '';
    $('#presentation-link').value = state && !state.creating ? app.sessions.presentationLink(state) : '';
    for (const id of ['session-restore','session-retry','session-publish-config','session-publish-drink','player-register']) $( '#' + id).hidden = !state;
    $('#session-use-config').hidden = !state?.remote?.config;
    $('#session-use-drink').hidden = !state?.remote?.currentEncounter;
    $('#session-players').replaceChildren();
    const names = new Map((state?.remote?.players || []).map(player => [player.id,player.name]));
    for (const operation of state?.pending || []) if (operation.kind === 'player') names.set(operation.payload.id, `${operation.payload.name} (pending)`);
    for (const name of names.values()) { const li = document.createElement('li'); li.textContent = name; $('#session-players').append(li); }
  }
  async function sync() {
    if (!repository || busy) return;
    busy = true;
    try { await repository.flush(); lastError = ''; }
    catch (error) { lastError = `Saved locally; sync pending. ${error.message}`; }
    finally { busy = false; render(); }
  }
  app.cloud = {
    queue(kind, payload) {
      if (!repository) return false;
      try { const queued = repository.enqueue(kind, payload); lastError = ''; void sync(); return queued; }
      catch { lastError = 'Saved locally, but could not queue sharing. Free device storage, then publish settings or publish the current drink.'; render(); }
    },
  };
  $('#session-open').addEventListener('click', () => { render(); $('#session-dialog').showModal(); });
  $('#session-close').addEventListener('click', () => $('#session-dialog').close());
  $('#presentation-link').addEventListener('click', event => event.target.select());
  async function action(task) {
    if (busy) return;
    busy = true;
    try { await task(); lastError = ''; }
    catch (error) { lastError = error.message; }
    finally { busy = false; render(); }
  }
  $('#session-create').addEventListener('submit', event => {
    event.preventDefault();
    void action(async () => {
      if (!repository) throw new Error('Add the project URL and publishable key to config.js first.');
      if (location.protocol !== 'https:' && location.hostname !== 'localhost') throw new Error('Open the hosted HTTPS controller to share a session. Offline file use still works.');
      await repository.create($('#session-name').value.trim(), app.controller.getConfig(), app.controller.getActive());
      await repository.flush();
    });
  });
  $('#session-restore').addEventListener('click', () => void action(async () => {
    const state = await repository.restore();
    if (state.pending.length) lastError = '';
    // Review remote state without replacing local ingredients or the active drink.
  }));
  $('#session-retry').addEventListener('click', () => void sync());
  $('#session-publish-config').addEventListener('click', () => app.cloud.queue('config', app.controller.getConfig()));
  $('#session-publish-drink').addEventListener('click', () => { const active = app.controller.getActive(); app.cloud.queue(active ? 'encounter' : 'clear', active || {}); });
  $('#session-use-config').addEventListener('click', () => void action(async () => {
    const state = repository.get();
    if (state.pending.some(item => item.kind === 'config')) throw new Error('Sync your pending ingredient changes before importing shared settings.');
    if (await confirmAction('Use shared ingredients?', 'Replace this device’s ingredient settings with the session settings? A local recovery copy will be kept.')) app.controller.useConfig(state.remote.config);
  }));
  $('#session-use-drink').addEventListener('click', () => void action(async () => {
    if (repository.get().pending.length) throw new Error('Sync pending changes before restoring a shared drink.');
    app.controller.useDrink(repository.get().remote.currentEncounter.snapshot);
    $('#session-dialog').close();
  }));
  // The session dialog itself is modal; native confirm keeps its focus scope intact.
  const confirmAction = async (title, message) => globalThis.confirm(`${title}\n\n${message}`);
  $('#player-register').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('#player-name').value.trim();
    if (!name) return;
    if (app.cloud.queue('player', {id:crypto.randomUUID(),name})) $('#player-name').value = '';
    render();
  });
  window.addEventListener('online', () => void sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync(); });
  setInterval(() => { if (!document.hidden) void sync(); }, 5000);
  render();
  void sync();
})();
