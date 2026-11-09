'use strict';
(() => {
  const app = globalThis.D20;
  // One cancellable request loop, with no timers or new work while suspended.
  function createLoop({run,onState=()=>{},interval=30000,retry=5000,document:doc=globalThis.document,window:win=globalThis.window,navigator:nav=globalThis.navigator,setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout}) {
    let timer=null,active=null,started=false,pageHidden=false,frozen=false,rerun=false;
    const paused=()=>doc.hidden || pageHidden || frozen;
    const cancelTimer=()=>{if(timer!==null)clearTimer(timer);timer=null;};
    function pause(){cancelTimer();rerun=false;active?.abort();onState('paused');}
    async function tick(){
      cancelTimer();
      if(!started || paused())return;
      if(nav?.onLine===false){onState('offline');return;}
      if(active){rerun=true;return;}
      const request=new AbortController();active=request;onState('connecting');let delay=interval;
      try{await run({signal:request.signal});if(!request.signal.aborted)onState('connected');}
      catch(error){delay=retry;if(!request.signal.aborted)onState('offline',error);}
      finally{
        active=null;
        if(started && !paused() && nav?.onLine!==false){
          const next=rerun?0:delay;rerun=false;timer=setTimer(()=>void tick(),next);
        }
      }
    }
    function wake(){if(paused()){pause();return;}void tick();}
    const visibility=()=>{
      // A visible page is running again even if the OS omitted pageshow/resume.
      if(!doc.hidden){pageHidden=false;frozen=false;}
      paused()?pause():wake();
    };
    const offline=()=>{cancelTimer();active?.abort();onState('offline');};
    const pagehide=()=>{pageHidden=true;pause();};
    const pageshow=()=>{const returning=pageHidden;pageHidden=false;if(returning)visibility();};
    const freeze=()=>{frozen=true;pause();};
    const resume=()=>{frozen=false;visibility();};
    return {
      wake,
      start(){
        if(started)return;started=true;
        doc.addEventListener('visibilitychange',visibility);doc.addEventListener('freeze',freeze);doc.addEventListener('resume',resume);
        win.addEventListener('pagehide',pagehide);win.addEventListener('pageshow',pageshow);win.addEventListener('online',wake);win.addEventListener('offline',offline);
        visibility();
      },
      stop(){
        started=false;pause();
        doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('freeze',freeze);doc.removeEventListener('resume',resume);
        win.removeEventListener('pagehide',pagehide);win.removeEventListener('pageshow',pageshow);win.removeEventListener('online',wake);win.removeEventListener('offline',offline);
      },
    };
  }
  app.connection={createLoop};
})();
