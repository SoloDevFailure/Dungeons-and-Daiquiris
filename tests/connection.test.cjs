'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../services/storage.js');require('../services/connection.js');
const D=globalThis.D20;
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
function harness(run){
  const document=new EventTarget();document.hidden=false;
  const window=new EventTarget(),navigator={onLine:true},timers=new Map(),states=[];let id=0;
  const loop=D.connection.createLoop({run,onState:(state,error)=>states.push({state,error}),document,window,navigator,setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});
  return {loop,document,window,navigator,timers,states,fire:()=>{const [id,item]=timers.entries().next().value;timers.delete(id);item.fn();}};
}
test('green is reached only after server verification; failure is red and retries',async()=>{
  let reject,resolve;const h=harness(()=>new Promise((yes,no)=>{resolve=yes;reject=no}));
  h.loop.start();assert.equal(h.states.at(-1).state,'connecting');assert.equal(h.timers.size,0);
  reject(Error('network'));await settle();assert.equal(h.states.at(-1).state,'offline');assert.equal([...h.timers.values()][0].delay,5000);
  h.fire();assert.equal(h.states.at(-1).state,'connecting');resolve();await settle();assert.equal(h.states.at(-1).state,'connected');assert.equal([...h.timers.values()][0].delay,30000);h.loop.stop();
});
test('hidden pages abort in-flight checks, clear timers, preserve queued work and resume once',async()=>{
  let calls=0;const signals=[];
  const h=harness(({signal})=>{calls++;signals.push(signal);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));});
  h.loop.start();h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(signals[0].aborted,true);await settle();assert.equal(h.timers.size,0);
  h.loop.wake();h.window.dispatchEvent(new Event('online'));await settle();assert.equal(calls,1);
  h.document.hidden=false;h.document.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(calls,2);
  h.loop.stop();await settle();assert.equal(h.timers.size,0);
});
test('pagehide, BFCache return and offline/online events pause and resume without overlapping',async()=>{
  let calls=0;const h=harness(async()=>{calls++});h.loop.start();await settle();assert.equal(calls,1);
  h.window.dispatchEvent(new Event('pagehide'));assert.equal(h.timers.size,0);h.loop.wake();await settle();assert.equal(calls,1);
  h.window.dispatchEvent(new Event('pageshow'));await settle();assert.equal(calls,2);
  h.navigator.onLine=false;h.window.dispatchEvent(new Event('offline'));assert.equal(h.states.at(-1).state,'offline');assert.equal(h.timers.size,0);
  h.loop.wake();await settle();assert.equal(calls,2);
  h.navigator.onLine=true;h.window.dispatchEvent(new Event('online'));await settle();assert.equal(calls,3);h.loop.stop();
});
test('one-second presentation interval and frozen-page suspension',async()=>{
  let calls=0;const document=new EventTarget();document.hidden=false;const window=new EventTarget();const timers=new Map();let id=0;
  const loop=D.connection.createLoop({run:async()=>{calls++},interval:1000,retry:1000,document,window,navigator:{onLine:true},setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id},clearTimer:id=>timers.delete(id)});
  loop.start();await settle();assert.equal([...timers.values()][0].delay,1000);
  document.dispatchEvent(new Event('freeze'));assert.equal(timers.size,0);loop.wake();await settle();assert.equal(calls,1);
  document.dispatchEvent(new Event('resume'));await settle();assert.equal(calls,2);loop.stop();
});
