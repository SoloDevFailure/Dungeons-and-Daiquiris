'use strict';
(() => {
  const app=globalThis.D20,$=selector=>document.querySelector(selector);
  const PAIRING_KEY='dungeons-daiquiris.display-link.v1';
  function status(message){const element=$('#display-status');if(element.textContent!==message)element.textContent=message;}
  const view=app.presentationView.create({document,window});
  const valid=item=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item?.session||'')&&/^[0-9a-f]{64}$/.test(item?.view||'');
  let connection=null,generation=0,lastCached='';
  let client;
  try{if(!globalThis.D20_CONFIG?.supabaseUrl)throw new Error('Supabase is not configured yet.');app.supabase.validateConfig(D20_CONFIG);client=app.supabase.createClient(D20_CONFIG);}
  catch(error){status(error.message);return;}
  async function poll(options){
    if(!connection)return;
    const pairing=connection,current=generation;
    const state=await client.rpc('d20_presentation',{p_session:pairing.session,p_view_token:pairing.view},false,options);
    // A late response from a previous link or suspended page must not paint stale data.
    if(current!==generation||options.signal?.aborted)return;
    view.update(state);
    try{app.storage.write(PAIRING_KEY,pairing);}catch{/* URL pairing still works without storage. */}
    const serialized=JSON.stringify(state);
    if(serialized!==lastCached){try{app.storage.write(`dungeons-daiquiris.display.${pairing.session}`,state);lastCached=serialized;}catch{/* Keep live display with full/blocked storage. */}}
    status('Live · bartender connected · v9');
  }
  const loop=app.connection.createLoop({run:poll,interval:1000,retry:1000,onState(state,error){
    if(!connection)return;
    if(state==='offline')status(error?.status===403||error?.status===401?'Display link unavailable. Copy a fresh link from the host.':'Connection interrupted. Keeping the last display; retrying.');
    if(state==='paused')status('Display paused while this page is hidden.');
  }});
  function pair(){
    try{
      const params=new URLSearchParams(location.hash.slice(1));
      const explicit=params.has('session')||params.has('view');
      let next=explicit?{session:params.get('session'),view:params.get('view')}:null;
      if(!explicit){try{next=app.storage.read(PAIRING_KEY,null);}catch{/* Ask for a link. */}}
      if(!valid(next))throw new Error(explicit?'This display link is incomplete or invalid. Copy the full link from the phone.':"Open the read-only iPad link from the phone's pairing panel.");
      if(connection?.session===next.session&&connection?.view===next.view){loop.wake();return;}
      generation++;connection=next;lastCached='';
      // Hide a different game's cached scene until this pairing has been verified.
      view.update({currentEncounter:null},{immediate:true});
      try{const cached=app.storage.read(`dungeons-daiquiris.display.${next.session}`,null);if(cached)view.update(cached,{immediate:true});}catch{/* Live polling can recover. */}
      status('Connecting to the bartender.');
      loop.wake();
    }catch(error){generation++;connection=null;status(error.message);}
  }
  window.addEventListener('hashchange',pair);
  pair();loop.start();
})();
