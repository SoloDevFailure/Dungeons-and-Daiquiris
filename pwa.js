'use strict';
(() => {
 const app=globalThis.D20=globalThis.D20||{};
 let pairing=null,published='',attempted='',publishing=false;
 async function publish(){
  if(!pairing||document.hidden||publishing||!navigator.serviceWorker?.controller||typeof MessageChannel==='undefined')return;
  const startUrl=app.displayPairing.startURL(pairing,location.href);if(startUrl===published||startUrl===attempted)return;attempted=startUrl;
  publishing=true;
  try{
   const manifestURL=await new Promise((resolve,reject)=>{
    const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(new Error('Install manifest unavailable'));},2000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data?.url?resolve(event.data.url):reject(new Error('Install manifest unavailable'));};
    navigator.serviceWorker.controller.postMessage({type:'D20_DISPLAY_INSTALL',startUrl},[channel.port2]);
   });
   // A same-origin HTTP manifest, served locally by the worker, retains the fragment on install.
   const link=document.querySelector('link[rel="manifest"]');if(link)link.href=manifestURL;
   published=startUrl;const help=document.querySelector('#display-install-help');if(help)help.textContent='Paired. You can now use Add to Home Screen from this page.';
  }catch{/* Existing icons can pair once using the in-app link field. */}
  finally{publishing=false;}
 }
 app.pwa={setPresentationPairing(value){if(!app.displayPairing?.valid(value))return;pairing={session:value.session,view:value.view};void publish();}};
 if('serviceWorker' in navigator&&['https:','http:'].includes(location.protocol)){
  navigator.serviceWorker.addEventListener('controllerchange',()=>{published='';attempted='';void publish();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void publish();});
  const register=()=>navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(()=>publish()).catch(error=>console.warn('Offline cache unavailable:',error.message));
  if(document.readyState==='complete')void register();else window.addEventListener('load',()=>void register(),{once:true});
 }
})();
