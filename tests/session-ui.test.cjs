'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('../services/storage.js');require('../services/session.js');require('../services/connection.js');
const D=globalThis.D20;
class Element extends EventTarget{
  constructor(){super();this.dataset={};this.attributes={};this.value='';this.children=[];}
  setAttribute(name,value){this.attributes[name]=value}replaceChildren(...items){this.children=items}append(item){this.children.push(item)}
  showModal(){this.open=true}close(){this.open=false}select(){}focus(){}
}
test('controller verifies the permanent game before showing green; QR/copy contain only the read capability',async()=>{
  const elements=new Map(),document=new EventTarget(),window=new EventTarget(),timers=new Map();let timer=0,loop,release,copied='';
  document.hidden=false;document.readyState='complete';
  document.querySelector=s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s)};document.createElement=()=>new Element();
  let current={id:'legacy-game',viewToken:'a'.repeat(64),pending:[],revision:1,remote:{players:[]}};let connects=0,flushes=0;
  const navigator={onLine:true,clipboard:{writeText:async value=>copied=value}};
  const repository={get:()=>current,connectPermanent:async()=>{connects++;await new Promise(resolve=>release=resolve);current.permanent=true;return current},flush:async()=>{flushes++;return current},enqueue:(kind,payload)=>{current.pending.push({kind,payload});return true}};
  const sandbox={D20:{supabase:{createClient:()=>({})},sessions:{createRepository:()=>repository,presentationLink:s=>D.sessions.presentationLink(s,'https://game.test/index.html')},qr:{svg:link=>({encodedLink:link})},connection:{createLoop:options=>{loop=D.connection.createLoop({...options,document,window,navigator,setTimer:(fn,delay)=>{timers.set(++timer,{fn,delay});return timer},clearTimer:id=>timers.delete(id)});return loop}}},D20_CONFIG:{supabaseUrl:'https://example.supabase.co'},document,window,navigator,crypto,confirm:()=>false};
  vm.runInNewContext(fs.readFileSync(require.resolve('../session-ui.js'),'utf8'),sandbox);
  const settle=async()=>{for(let i=0;i<25;i++)await Promise.resolve()};
  assert.equal(elements.get('#session-open').dataset.connection,'connecting');assert.equal(flushes,0);
  release();await settle();assert.equal(elements.get('#session-open').dataset.connection,'connected');
  assert.equal(connects,1);assert.equal(flushes,1);
  const link=elements.get('#presentation-link').value;assert.match(link,/#session=legacy-game&view=a{64}$/);
  assert.equal(elements.get('#presentation-qr').children[0].encodedLink,link);
  elements.get('#copy-presentation-link').dispatchEvent(new Event('click'));await settle();assert.equal(copied,link);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));
  sandbox.D20.cloud.queue('clear',{});await settle();assert.equal(flushes,1);assert.equal(current.pending.length,1);assert.equal(timers.size,0);
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(flushes,2);
  loop.stop();
});
