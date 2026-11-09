'use strict';
(() => {
 const app=globalThis.D20=globalThis.D20||{};
 const valid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value?.session||'')&&/^[0-9a-f]{64}$/.test(value?.view||'');
 function fromLink(text,base){
  const url=new URL(text.trim(),base),expected=new URL('presentation.html',base);
  if(url.origin!==expected.origin||url.pathname!==expected.pathname)throw new Error('Paste the presentation link copied from this game’s phone controller.');
  const params=new URLSearchParams(url.hash.slice(1)),pairing={session:params.get('session'),view:params.get('view')};
  if(!valid(pairing))throw new Error('The link is incomplete. Copy the full presentation link from the phone.');return pairing;
 }
 function startURL(pairing,base){
  if(!valid(pairing))throw new Error('Invalid display pairing.');
  const url=new URL('presentation.html',base);url.searchParams.set('release','11');url.hash=new URLSearchParams({session:pairing.session,view:pairing.view}).toString();return url.href;
 }
 app.displayPairing={valid,fromLink,startURL};
})();
