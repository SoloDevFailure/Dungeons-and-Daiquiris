'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('../services/storage.js');require('../services/session.js');require('../services/qr.js');
function worker(){
 const handlers={},cached=new Map();let online=true,fetches=0,installed=[];
 const cache={put:async(url,response)=>cached.set(url,response),addAll:async paths=>{installed=paths;},match:async url=>cached.get(url)?.clone?cached.get(url).clone():cached.get(url)};
 const context={URL,URLSearchParams,Response,Set,Promise,Error,self:{registration:{scope:'https://game.test/event/'},clients:{claim:async()=>{}},addEventListener:(name,fn)=>handlers[name]=fn},caches:{open:async()=>cache,keys:async()=>[],delete:async()=>{}},fetch:async()=>{fetches++;if(!online)throw Error('offline');return {ok:true,body:'fresh HTML'};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),context);
 return {handlers,cached,offline:()=>online=false,get fetches(){return fetches},get installed(){return installed}};
}
async function request(w,url){let response;w.handlers.fetch({request:{method:'GET',url},respondWith:p=>response=p});return response&&await response;}
test('release cache includes every versioned page script/style; QR uses the same release',async()=>{
 const w=worker();let install;w.handlers.install({waitUntil:p=>install=p});await install;
 for(const page of ['index.html','presentation.html'])for(const match of fs.readFileSync(require.resolve('../'+page),'utf8').matchAll(/(?:src|href)="([^\"]+\.(?:js|css)\?v=\d+)"/g))assert.ok(w.installed.includes('./'+match[1]),`${page}: uncached ${match[1]}`);
 const link=globalThis.D20.sessions.presentationLink({id:'game',viewToken:'a'.repeat(64)},'https://game.test/event/index.html');const release=new URL(link).searchParams.get('release');assert.equal(release,'11');assert.ok(w.installed.includes('./presentation.js?v='+release));assert.equal(globalThis.D20.qr.matrix(link).length,57);
});
test('online presentation navigation requests current HTML instead of stale cached HTML',async()=>{
 const w=worker();w.cached.set('https://game.test/event/presentation.html',{body:'old HTML'});
 assert.equal((await request(w,'https://game.test/event/presentation.html')).body,'fresh HTML');assert.equal(w.fetches,1);
});
test('offline QR and tracking-query links reuse the cached document and versioned assets',async()=>{
 const w=worker();w.offline();w.cached.set('https://game.test/event/presentation.html',{body:'offline HTML'});w.cached.set('https://game.test/event/presentation.js?v=11',{body:'offline script'});
 for(const query of ['?release=11','?utm_source=chatgpt.com',''])assert.equal((await request(w,'https://game.test/event/presentation.html'+query)).body,'offline HTML');
 assert.equal((await request(w,'https://game.test/event/presentation.js?v=11')).body,'offline script');
 assert.equal(await request(w,'https://example.supabase.co/rest/v1/rpc/d20_presentation'),undefined);
});

test('same-origin install manifest embeds only the verified display capability in its launch fragment',async()=>{
 const w=worker();w.cached.set('https://game.test/event/presentation.webmanifest',new Response(fs.readFileSync(require.resolve('../presentation.webmanifest'),'utf8')));
 const start=`https://game.test/event/presentation.html?release=11#session=10000000-0000-4000-8000-000000000001&view=${'a'.repeat(64)}`;
 let done,message;w.handlers.message({data:{type:'D20_DISPLAY_INSTALL',startUrl:start},source:{url:'https://game.test/event/presentation.html'},ports:[{postMessage:data=>message=data}],waitUntil:p=>done=p});await done;
 assert.equal(message.url,'https://game.test/event/presentation-install.webmanifest');const result=await request(w,message.url),manifest=await result.json();assert.equal(manifest.start_url,start);assert.equal(manifest.id,'./presentation.html');assert.equal(manifest.display,'standalone');
 const invalid=[['https://evil.test/presentation.html',start],['https://game.test/event/index.html',start],['https://game.test/event/presentation.html',start+'&refresh_token=secret']];
 for(const [source,url]of invalid){let reply,pending;w.handlers.message({data:{type:'D20_DISPLAY_INSTALL',startUrl:url},source:{url:source},ports:[{postMessage:data=>reply=data}],waitUntil:p=>pending=p});await pending;assert.ok(reply.error);}
});
