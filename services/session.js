'use strict';
(() => {
  const app = globalThis.D20;
  const KEY = 'dungeons-daiquiris.session.v1';
  function createRepository(client, storage = app.storage, uuid = () => crypto.randomUUID()) {
    const read = () => {
      const state = storage.read(KEY, null);
      if (state !== null && (!state || typeof state.id !== 'string' || typeof state.viewToken !== 'string' || !Array.isArray(state.pending) || !Number.isFinite(state.revision))) throw new Error('Saved session metadata is unreadable. It has not been replaced.');
      return state;
    };
    const write = state => storage.write(KEY, state);
    let flushing = null;
    const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
    return {
      get: () => read(),
      async create(name, config, activeDrink = null) {
        if (read()) throw new Error('A session is already saved on this device. Restore it first.');
        const state = {id:uuid(), viewToken:token(), name, initialConfig:app.clone(config), pending:activeDrink ? [{id:uuid(),kind:"encounter",payload:app.clone(activeDrink)}] : [], revision:0, remote:null, creating:true};
        write(state); // Persist before sending so an interrupted create can be retried.
        return this.restore();
      },
      async restore(options = {}) {
        const state = read();
        if (!state) throw new Error('Create a session first.');
        const remote = state.creating ? await client.rpc('d20_create_session', {p_id:state.id, p_name:state.name, p_view_token:state.viewToken, p_config:state.initialConfig}, true, options) : await client.rpc('d20_host_state', {p_session:state.id}, true, options);
        const latest = read();
        latest.remote = remote; latest.revision = remote.revision; latest.creating = false;
        write(latest);
        return latest;
      },
      async connectPermanent(options = {}) {
        const saved = read();
        const remote = await client.rpc('d20_connect_game', {p_existing:saved?.id || null,p_view_token:saved?.viewToken || null}, true, options);
        if (saved && saved.id !== remote.id) throw new Error('The permanent game differs from this phone. Saved data has not been replaced.');
        if (remote.permanent !== true || !/^[0-9a-f]{64}$/.test(remote.viewToken || '')) throw new Error('The permanent game connection is incomplete.');
        const latest = read();
        const state = latest || {id:remote.id,pending:[],revision:remote.revision};
        state.viewToken = remote.viewToken; state.name = remote.name;
        state.permanent = true; state.creating = false; state.remote = remote;
        // Do not silently rebase a durable outbox onto someone else's revision.
        if (!state.pending.length) state.revision = remote.revision;
        write(state);
        return state;
      },
      async syncGameplay(game, options = {}) {
        let state=read();if(!state)return;
        if(state.remote?.gameplay)game.accept(state.remote.gameplay);
        else game.importLegacy(state.remote?.players);
        while(game.pending().length){
          options.signal?.throwIfAborted();
          const operation=game.pending()[0];
          const remote=await client.rpc('d20_gameplay_mutate',{p_session:state.id,p_operation:operation.id,p_revision:operation.state.version-1,p_state:operation.state},true,options);
          // Idempotent operation IDs survive a lost response. Never rebase conflicting scores.
          game.acknowledge(operation.id);
          state=read();state.remote=remote;write(state);
        }
        if(state.remote?.gameplay)game.accept(state.remote.gameplay);
      },
      enqueue(kind, payload) {
        const state = read();
        if (!state) return false;
        state.pending.push({id:uuid(), kind, payload:app.clone(payload)});
        write(state);
        return true;
      },
      async flush(options = {}) {
        if (flushing) return flushing;
        const run = async () => {
          if (!read()) return;
          if (read().creating) await this.restore(options);
          while (read().pending.length) {
            options.signal?.throwIfAborted();
            const state = read(); const operation = state.pending[0];
            const remote = await client.rpc('d20_mutate', {p_session:state.id, p_operation:operation.id, p_revision:state.revision, p_kind:operation.kind, p_payload:operation.payload}, true, options);
            const latest = read(); // New actions may have queued during the request.
            latest.pending = latest.pending.filter(item => item.id !== operation.id);
            latest.revision = remote.revision; latest.remote = remote;
            write(latest);
          }
          // Refresh session metadata even when there was no queued work.
          // Shared settings remain a separate, explicit import on the controller.
          options.signal?.throwIfAborted();
          return this.restore(options);
        };
        flushing = globalThis.navigator?.locks ? navigator.locks.request('d20-session-sync', run) : run();
        try { return await flushing; } finally { flushing = null; }
      },
    };
  }
  function presentationLink(state, base = globalThis.location.href) {
    const url = new URL('presentation.html', base);
    url.searchParams.set('release','9'); // Bypass a previous worker's cached presentation document.
    url.hash = new URLSearchParams({session:state.id, view:state.viewToken}).toString();
    return url.href;
  }
  app.sessions = {key:KEY, createRepository, presentationLink};
})();
