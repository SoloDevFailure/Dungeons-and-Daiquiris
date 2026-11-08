'use strict';
const {chromium}=require(process.env.D20_PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext({serviceWorkers:'block'});
    const root=path.resolve(__dirname,'..');
    const config="globalThis.D20_CONFIG={supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test'};";
    let remote=null,offline=false;const seen=new Set();const errors=[];
    await context.route('https://game.test/**',async route=>{
      const file=new URL(route.request().url()).pathname.slice(1)||'index.html';
      if(file==='config.js')return route.fulfill({contentType:'text/javascript',body:config});
      const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream';
      try {await route.fulfill({contentType:type,body:await fs.readFile(path.join(root,file))});}catch{await route.fulfill({status:404,body:'missing'});}
    });
    await context.route('https://example.supabase.co/**',async route=>{
      if(offline)return route.abort('internetdisconnected');
      const req=route.request(),url=new URL(req.url()),p=req.postDataJSON();let result;
      if(url.pathname.includes('/auth/'))result={access_token:'host',refresh_token:'refresh',expires_in:3600};
      else if(url.pathname.endsWith('d20_create_session'))remote=result={id:p.p_id,name:p.p_name,revision:0,config:p.p_config,players:[],currentEncounter:null};
      else if(url.pathname.endsWith('d20_host_state'))result=remote;
      else if(url.pathname.endsWith('d20_presentation')){
        assert.equal(req.headers().authorization,undefined);
        result={id:remote.id,name:remote.name,revision:remote.revision,currentEncounter:remote.currentEncounter};
      } else {
        if(!seen.has(p.p_operation)){
          seen.add(p.p_operation);remote.revision++;
          if(p.p_kind==='encounter')remote.currentEncounter={id:p.p_payload.id,snapshot:p.p_payload,servings:2};
          if(p.p_kind==='clear')remote.currentEncounter=null;
          if(p.p_kind==='player')remote.players.push(p.p_payload);
          if(p.p_kind==='config')remote.config=p.p_payload;
        }
        result=remote;
      }
      await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
    });
    const phone=await context.newPage();phone.on('pageerror',e=>errors.push(e.message));
    await phone.goto('https://game.test/index.html');
    await phone.locator('#session-open').click();await phone.locator('#session-create button').click();
    await phone.waitForFunction(()=>D20.storage.read(D20.sessions.key,null)?.remote);
    await phone.locator('#player-name').fill('Ryan');await phone.locator('#player-register button').click();
    await phone.waitForFunction(()=>D20.storage.read(D20.sessions.key).remote.players.length===1);
    const link=await phone.locator('#presentation-link').inputValue();
    const tv=await context.newPage();tv.on('pageerror',e=>errors.push(e.message));await tv.goto(link);
    await phone.locator('#session-close').click();
    for(const n of [1,8,12])await phone.locator(`.number[data-number="${n}"]`).click();
    await phone.locator('#confirm').click();
    await tv.locator('#encounter').waitFor({state:'visible'});
    assert.match(await tv.locator('#display-ingredients').textContent(),/Bombay Sapphire/);
    assert.match(await tv.locator('#display-stats').textContent(),/2 servings/);
    offline=true;await tv.reload();await tv.locator('#encounter').waitFor({state:'visible'});
    await phone.locator('#pour-next').click();await phone.locator('#dialog-confirm').click();
    for(const n of [7,8,12])await phone.locator(`.number[data-number="${n}"]`).click();
    await phone.locator('#confirm').click();await phone.reload();
    assert.equal(await phone.locator('#result-screen').isVisible(),true);
    offline=false;
    await phone.evaluate(()=>window.dispatchEvent(new Event('online')));
    await tv.waitForFunction(()=>document.querySelector('#display-stats').textContent.includes('120 mL'));
    assert.equal(seen.size,4); // register, encounter, clear, encounter.
    await phone.locator('#result-back').click();await phone.locator('#options').click();
    await phone.locator('.ingredient-abv').nth(6).fill('10');await phone.locator('#ingredient-form button[type="submit"]').click();
    await phone.waitForFunction(()=>D20.storage.read(D20.sessions.key).remote.config[6].abv===10);
    assert.deepEqual(errors,[]);
    console.log('PASS: mocked phone/session/player/display flow, offline reload/replay and shared ABV.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
