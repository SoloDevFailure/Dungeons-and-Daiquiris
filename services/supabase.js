'use strict';
(() => {
  const app = globalThis.D20;
  function validateConfig(config) {
    const url = new URL(config.supabaseUrl);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.pathname !== '/') throw new Error('Use your HTTPS Supabase project URL.');
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) throw new Error('Use a Supabase publishable key (sb_publishable_...).');
    return {url:url.origin, key:config.publishableKey};
  }
  function createClient(config, storage = app.storage, fetcher = globalThis.fetch.bind(globalThis)) {
    const {url, key} = validateConfig(config);
    const authKey = `dungeons-daiquiris.auth.${new URL(url).hostname}`;
    async function request(path, body, token, options = {}) {
      options.signal?.throwIfAborted();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      options.signal?.addEventListener('abort', cancel, {once:true});
      const timer = setTimeout(cancel, 10000);
      try {
        const response = await fetcher(url + path, {method:'POST', cache:'no-store', referrerPolicy:'no-referrer',
          headers:{apikey:key, 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})},
          body:JSON.stringify(body), signal:controller.signal});
        const result = await response.json();
        if (!response.ok) {
          const error = new Error(result.message || result.msg || result.error_description || 'Supabase request failed.');
          error.status = response.status; error.code = result.code;
          throw error;
        }
        return result;
      } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
    }
    let authenticating;
    async function authenticate(options = {}) {
      options.signal?.throwIfAborted();
      if (authenticating) return authenticating;
      authenticating = (async () => {
        const saved = storage.read(authKey, null);
        if (saved?.access_token && saved.expires_at > Date.now() / 1000 + 60) return saved.access_token;
        // Never silently replace a host identity after a failed refresh.
        // Let an already-started token refresh finish and persist rotated tokens,
        // even if the page hides. No following RPC starts after cancellation.
        const result = saved ? await request('/auth/v1/token?grant_type=refresh_token', {refresh_token:saved.refresh_token}) : await request('/auth/v1/signup', {data:{app:'dungeons-and-daiquiris'}});
        if (!result.access_token || !result.refresh_token) throw new Error('Anonymous sign-in did not return a session.');
        storage.write(authKey, {access_token:result.access_token, refresh_token:result.refresh_token, expires_at:result.expires_at || Date.now()/1000 + result.expires_in});
        return result.access_token;
      })();
      try { return await authenticating; } finally { authenticating = null; }
    }
    const withAuthLock = task => globalThis.navigator?.locks ? navigator.locks.request(`d20-auth-${url}`, task) : task();
    return {url, rpc: async (name, params, host = true, options = {}) => request(`/rest/v1/rpc/${name}`, params, host ? await withAuthLock(() => authenticate(options)) : undefined, options)};
  }
  app.supabase = {validateConfig, createClient};
})();
