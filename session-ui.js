'use strict';
(() => {
  const app=globalThis.D20,$=selector=>document.querySelector(selector);
  let repository=null,lastError='',status='connecting',connected=false,linkRendered='';
  try{if(globalThis.D20_CONFIG?.supabaseUrl)repository=app.sessions.createRepository(app.supabase.createClient(D20_CONFIG));}
  catch(error){lastError=error.message;}
  function render(){
    let state;try{state=repository?.get();}catch(error){lastError=error.message;}
    const labels={connected:'Connected',connecting:'Connecting',offline:'Offline',paused:'Paused'};
    const button=$('#session-open');button.dataset.connection=status;
    button.textContent=status==='connected'?'\u2713':status==='offline'?'!':'\u2022';
    button.setAttribute('aria-label',`${labels[status]} — pair iPad`);button.title=`${labels[status]} — pair iPad`;
    $('#cloud-status').textContent=lastError || `${labels[status]}.${state?.pending.length?` ${state.pending.length} changes waiting to upload.`:''}`;
    const link=state?.permanent?app.sessions.presentationLink(state):'';
    $('#presentation-link').value=link;$('#copy-presentation-link').disabled=!link;
    if(link!==linkRendered){
      $('#presentation-qr').replaceChildren();
      if(link){try{$('#presentation-qr').append(app.qr.svg(link));}catch(error){lastError=error.message;$('#cloud-status').textContent=lastError;}}
      linkRendered=link;
    }
    $('#pairing-help').textContent=link?'Scan with the iPad camera. It remembers this read-only pairing.':'Connecting to the existing game. No new game will be created.';
    $('#session-tools').hidden=!state?.permanent;
    $('#session-players').replaceChildren();
    const names=new Map((state?.remote?.players||[]).map(player=>[player.id,player.name]));
    for(const operation of state?.pending||[])if(operation.kind==='player')names.set(operation.payload.id,`${operation.payload.name} (pending)`);
    for(const name of names.values()){const li=document.createElement('li');li.textContent=name;$('#session-players').append(li);}
  }
  const loop=app.connection.createLoop({
    interval:30000,retry:5000,
    async run(options){
      if(!repository)throw new Error(lastError || 'Supabase is not configured. Offline drinks still work.');
      if(!connected){await repository.connectPermanent(options);connected=true;}
      await repository.flush(options);
    },
    onState(next,error){status=next;if(error)lastError=error.message;else if(next==='connected')lastError='';render();},
  });
  app.cloud={queue(kind,payload){
    if(!repository)return false;
    try{
      const queued=repository.enqueue(kind,payload);
      if(!queued){lastError='Game is not connected yet. Your drink/settings are saved locally; connect, then publish them below.';render();return false;}
      loop.wake();render();return true;
    }catch{lastError='Saved locally, but sharing could not be queued. Free device storage, then publish the current drink or settings below.';render();return false;}
  }};
  $('#session-open').addEventListener('click',()=>{render();$('#session-dialog').showModal();});
  $('#session-close').addEventListener('click',()=>$('#session-dialog').close());
  $('#presentation-link').addEventListener('click',event=>event.target.select());
  $('#copy-presentation-link').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText($('#presentation-link').value);$('#copy-status').textContent='Link copied.';}
    catch{$('#presentation-link').focus();$('#presentation-link').select();$('#copy-status').textContent='Select and copy the link above.';}
  });
  $('#session-retry').addEventListener('click',()=>loop.wake());
  $('#session-publish-config').addEventListener('click',()=>app.cloud.queue('config',app.controller.getConfig()));
  $('#session-publish-drink').addEventListener('click',()=>{const drink=app.controller.getActive();app.cloud.queue(drink?'encounter':'clear',drink||{});});
  $('#session-use-config').addEventListener('click',()=>{
    try{
      const state=repository.get();
      if(state.pending.some(item=>item.kind==='config'))throw new Error('Upload pending ingredient changes before importing shared settings.');
      if(confirm('Use the shared ingredient settings on this phone? A recovery copy of current settings will be kept.'))app.controller.useConfig(state.remote.config);
    }catch(error){lastError=error.message;}render();
  });
  $('#session-use-drink').addEventListener('click',()=>{
    try{
      const state=repository.get();if(state.pending.length)throw new Error('Upload pending changes before restoring the shared drink.');
      if(!state.remote?.currentEncounter)throw new Error('There is no shared drink currently selected.');
      app.controller.useDrink(state.remote.currentEncounter.snapshot);$('#session-dialog').close();
    }catch(error){lastError=error.message;}render();
  });
  $('#player-register').addEventListener('submit',event=>{
    event.preventDefault();const name=$('#player-name').value.trim();
    if(name&&app.cloud.queue('player',{id:crypto.randomUUID(),name}))$('#player-name').value='';render();
  });
  render();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>loop.start(),{once:true});else loop.start();
})();
