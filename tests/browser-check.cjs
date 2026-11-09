'use strict';
const { chromium } = require(process.env.D20_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext({offline:true});
    const page=await context.newPage();
    const errors=[], external=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(/^https?:/.test(request.url())) external.push(request.url())});
    await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    const num=n=>page.locator(`.number[data-number="${n}"]`);
    const visible=async selector=>page.locator(selector).waitFor({state:'visible'});
    const click=async selector=>page.locator(selector).click();
    const button=label=>page.getByRole('button',{name:label,exact:true});
    await visible('#welcome-screen');await click('#start-game');
    async function checkBounds(selector,width,height) {
      const boxes=await page.locator(selector).evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}));
      assert.ok(boxes.every(r=>r.x>=0 && r.y>=0 && r.right<=width+.1 && r.bottom<=height+.1 && r.height>=44),`Button bounds ${width}x${height}: ${JSON.stringify(boxes)}`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight || document.documentElement.scrollWidth>innerWidth),false);
    }
    for(const [width,height] of [[320,568],[360,640],[375,667],[390,844],[430,932],[844,390],[1280,800]]) {
      await page.setViewportSize({width,height});
      await checkBounds('.number, #confirm, #options, #history',width,height);
    }
    await page.setViewportSize({width:390,height:844});
    const screenshots=process.env.D20_SCREENSHOTS;
    if(screenshots) {await fs.mkdir(screenshots,{recursive:true}); await page.screenshot({path:path.join(screenshots,'selection.png')});}
    await num(8).click(); await num(8).click();
    assert.equal(await page.locator('.number.selected').count(),0);
    for(const n of [8,16,20]) await num(n).click();
    assert.equal(await num(1).isDisabled(),true);
    assert.equal(await num(8).isDisabled(),false);
    await num(8).click(); assert.equal(await page.locator('#confirm').isDisabled(),true); await num(8).click();
    await page.evaluate(()=>{window.apiCalls=0;const original=D20.aiService.promptAPI;D20.aiService.promptAPI=async r=>{window.apiCalls++;return original(r)}});
    await click('#confirm'); await visible('#result-screen');
    assert.equal(await page.evaluate(()=>window.apiCalls),1);
    assert.equal(await page.locator('.recipe-row').count(),3);
    assert.match(await page.locator('#result-content').textContent(),/Bombay Sapphire/);
    assert.match(await page.locator('#result-content').textContent(),/never shake carbonated/);
    if(screenshots) await page.screenshot({path:path.join(screenshots,'result.png')});
    for(const [width,height] of [[320,568],[390,844],[844,390],[1280,800]]) {
      await page.setViewportSize({width,height}); await checkBounds('#result-back, #pour-next',width,height);
      assert.ok(await page.locator('#result-content').evaluate(e=>e.scrollHeight>e.clientHeight));
    }
    await page.setViewportSize({width:390,height:844});
    await click('#result-back'); await visible('#main-screen');
    assert.equal(await page.locator('.number:disabled').count(),20);
    await click('#history'); await visible('#history-screen');
    assert.equal(await page.locator('.history-entry').count(),1);
    await page.locator('.history-entry').first().click(); await visible('#result-screen');
    assert.equal(await page.locator('#pour-next').isVisible(),false);
    await click('#result-back'); await visible('#history-screen');
    await click('#history-back'); await visible('#main-screen');
    await click('#options');
    await page.locator('.ingredient-name').nth(7).fill('Green Goblin Gin');
    await page.locator('.ingredient-amount').nth(7).fill('45');
    await button('SAVE').click(); await visible('#main-screen');
    assert.match(await num(8).getAttribute('aria-label'),/Bombay Sapphire/); // Sealed result retains its snapshot.
    await click('#confirm'); await visible('#result-screen');
    await click('#pour-next');await visible('#winners-screen');
    assert.equal(await page.locator('#winners-next').isDisabled(),true);
    for(const n of [0,1,2])await page.locator('#winner-list input').nth(n).check();
    await click('#winners-next');await visible('#award-dialog');
    await page.locator('#award-winners button').nth(1).click();
    const agreed=Number(await page.locator('#agreed-points').inputValue());
    await page.reload();await visible('#winners-screen');await click('#winners-next');
    assert.equal(Number(await page.locator('#agreed-points').inputValue()),agreed);
    assert.equal(await page.locator('#award-winners button').nth(1).getAttribute('aria-pressed'),'true');
    await click('#complete-round');await visible('#main-screen');
    const award=await page.evaluate(()=>D20.gameRepository.get().awards[0]);
    assert.equal(award.winners.length,3);assert.equal(award.winners[1].points,agreed/2);
    assert.equal(await page.locator('.number.selected').count(),0);
    assert.match(await num(8).getAttribute('aria-label'),/Green Goblin Gin — 45 mL/);
    for(const n of [7,8,12]) await num(n).click();
    await click('#confirm'); await visible('#result-screen');
    assert.match(await page.locator('#result-content').textContent(),/Chilled Water — 30 mL/);
    assert.match(await page.locator('#result-content').textContent(),/30 mL total/);
    const activeId=await page.evaluate(()=>D20.drinkHistory.createRepository().getActive().id);
    await page.reload(); await visible('#result-screen');
    assert.equal(await page.evaluate(()=>D20.drinkHistory.createRepository().getActive().id),activeId);
    assert.equal(await page.evaluate(()=>D20.drinkHistory.createRepository().list().length),2);
    await click('#result-back'); await visible('#main-screen');
    await click('#history');
    const entries=await page.locator('.history-entry').allTextContents();
    assert.match(entries[0],/Green Goblin Gin/); assert.match(entries[1],/Bombay Sapphire/);
    if(screenshots) await page.screenshot({path:path.join(screenshots,'history.png')});
    await click('#clear-history'); await click('#dialog-cancel');
    assert.equal(await page.locator('.history-entry').count(),2);
    await click('#clear-history'); await click('#dialog-confirm');
    await page.waitForFunction(() => document.querySelectorAll('.history-entry').length === 0);
    assert.equal(await page.evaluate(()=>D20.drinkHistory.createRepository().getActive().id),activeId);
    await click('#history-back'); await visible('#main-screen');
    await click('#confirm'); await click('#skip-drink'); await click('#dialog-confirm'); await visible('#main-screen');
    assert.equal(await page.evaluate(()=>D20.drinkHistory.createRepository().list().length),1);
    await click('#options');
    await page.locator('.ingredient-name').first().fill('Unsaved Coke');
    await page.goBack(); await visible('#confirmation-dialog');
    await click('#dialog-cancel'); assert.equal(await page.locator('.ingredient-name').first().inputValue(),'Unsaved Coke');
    await page.goBack(); await visible('#confirmation-dialog'); await click('#dialog-confirm'); await visible('#main-screen');
    await click('#options'); assert.equal(await page.locator('.ingredient-name').first().inputValue(),'Coca-Cola');
    if(screenshots) await page.screenshot({path:path.join(screenshots,'editor.png')});
    for(const [width,height] of [[320,568],[390,844],[844,390],[1280,800]]) {
      await page.setViewportSize({width,height}); await checkBounds('#back, #ingredient-form button[type="submit"]',width,height);
      await page.locator('.ingredient-amount').last().scrollIntoViewIfNeeded();
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('.ingredient-name').first().fill('   '); await button('SAVE').click();
    assert.equal(await page.locator('#editor-screen').isVisible(),true);
    await page.locator('.ingredient-name').first().fill('Unsavable');
    await page.evaluate(()=>{window.savedSetItem=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new Error('Quota')}});
    await button('SAVE').click(); assert.match(await page.locator('#editor-status').textContent(),/Unable to save/);
    await click('#back'); await click('#dialog-confirm'); await visible('#main-screen');
    for(const n of [1,2,3]) await num(n).click(); await click('#confirm');
    assert.equal(await page.locator('#main-screen').isVisible(),true);
    assert.match(await page.locator('#status').textContent(),/Could not save/);
    assert.equal(await page.locator('.number.selected').count(),3);
    await page.evaluate(()=>{Storage.prototype.setItem=window.savedSetItem});
    await click('#confirm'); await visible('#result-screen');
    await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Quota')}});
    await click('#skip-drink'); await click('#dialog-confirm');
    assert.match(await page.locator('#result-status').textContent(),/Quota/);
    assert.equal(await page.locator('#result-screen').isVisible(),true);
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    console.log('PASS: offline browser flow, phone/desktop bounds, toggle/lock, API hook, results, history snapshots, reload, editor navigation, confirmed clear/reset, and storage failure recovery.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1)});

