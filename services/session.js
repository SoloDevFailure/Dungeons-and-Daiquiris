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
      async restore() {
        const state = read();
        if (!state) throw new Error('Create a session first.');
        const remote = state.creating ? await client.rpc('d20_create_session', {p_id:state.id, p_name:state.name, p_view_token:state.viewToken, p_config:state.initialConfig}) : await client.rpc('d20_host_state', {p_session:state.id});
        const latest = read();
        latest.remote = remote; latest.revision = remote.revision; latest.creating = false;
        write(latest);
        return latest;
      },
      enqueue(kind, payload) {
        const state = read();
        if (!state) return false;
        state.pending.push({id:uuid(), kind, payload:app.clone(payload)});
        write(state);
        return true;
      },
      async flush() {
        if (flushing) return flushing;
        const run = async () => {
          if (!read()) return;
          if (read().creating) await this.restore();
          while (read().pending.length) {
            const state = read(); const operation = state.pending[0];
            const remote = await client.rpc('d20_mutate', {p_session:state.id, p_operation:operation.id, p_revision:state.revision, p_kind:operation.kind, p_payload:operation.payload});
            const latest = read(); // New actions may have queued during the request.
            latest.pending = latest.pending.filter(item => item.id !== operation.id);
            latest.revision = remote.revision; latest.remote = remote;
            write(latest);
          }
          return read();
        };
        flushing = globalThis.navigator?.locks ? navigator.locks.request('d20-session-sync', run) : run();
        try { return await flushing; } finally { flushing = null; }
      },
    };
  }
  function presentationLink(state, base = globalThis.location.href) {
    const url = new URL('presentation.html', base);
    url.hash = new URLSearchParams({session:state.id, view:state.viewToken}).toString();
    return url.href;
  }
  app.sessions = {key:KEY, createRepository, presentationLink};
})();
