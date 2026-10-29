import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require(process.env.PLAYWRIGHT_PATH||'playwright');}catch{playwright=require(os.homedir()+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir('artifacts',{recursive:true});
function processFor(args,env={}){return spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});}
const server=processFor(['server.mjs'],{PORT:'5184',HOST:'127.0.0.1'});
// A separate test-only server shortens expiry; production's 180s cap is tested
// with a monotonic fake clock in tests/matchmaking.test.mjs.
const timeoutServer=processFor(['--input-type=module','-e',"import {createGameServer} from './server.mjs';const game=createGameServer({matchWaitMs:1400});game.server.listen(5185,'127.0.0.1',()=>console.log('Timeout test server ready'));process.once('SIGTERM',()=>game.close().finally(()=>process.exit()));"]);
const checks=[],errors=[];let browser,a,b,timeoutPage;
const check=(condition,label)=>{if(!condition)throw new Error(label);checks.push(label);};
const state=page=>page.evaluate(()=>window.flashVersus.getState());
const active=page=>page.waitForFunction(()=>window.flashVersus.getState().online.matchmaking?.state==='waiting');
async function ready(page,port=5184){
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.goto('http://127.0.0.1:'+port,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>!document.querySelector('#loading-state').checkVisibility());
}
async function connectPage(page){
 await page.locator('[data-mode="multiplayer"]').click();await page.locator('[data-multiplayer="online"]').click();
}
async function fits(page,label){
 const info=await page.evaluate(()=>{
  const shell=document.querySelector('#game-shell').getBoundingClientRect(),screen=document.querySelector('.game-screen:not(.hidden)'),bounds=screen.getBoundingClientRect();
  const clipped=[...screen.querySelectorAll('button,h1,h2,input,.matching-time,.matching-pair,#matching-note,.online-message')].filter(el=>{
   if(!el.checkVisibility())return false;const r=el.getBoundingClientRect();return r.left<bounds.left-4||r.right>bounds.right+4||r.top<bounds.top-4||r.bottom>bounds.bottom+4;
  }).map(el=>el.id||el.textContent.trim());
  return {fits:shell.left>=0&&shell.top>=0&&shell.right<=innerWidth+1&&shell.bottom<=innerHeight+1,scroll:document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth,clipped};
 });
 check(info.fits&&!info.scroll&&!info.clipped.length,label+': '+JSON.stringify(info));
}
const shot=(page,name)=>page.screenshot({path:'artifacts/matching-'+name+'.png'});
function listening(child){return new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error('Test server exited '+code)));});}
try{
 await Promise.all([listening(server),listening(timeoutServer)]);
 browser=await playwright.chromium.launch({headless:true,channel:'msedge'});
 const ca=await browser.newContext({viewport:{width:1440,height:900}});
 const cb=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 a=await ca.newPage();b=await cb.newPage();await ready(a);await ready(b);
 await a.bringToFront();await connectPage(a);await fits(a,'desktop three online choices fit');await shot(a,'online-choices');
 await a.locator('#find-random-match').focus();await a.keyboard.press('Enter');await active(a);
 check((await state(a)).online.code===null,'search does not create a private room');
 const remaining=(await state(a)).online.matchmaking.remainingMs;
 check(remaining>170000&&remaining<=180000,'production search starts with at most three minutes');
 check(['3:00','2:59'].includes(await a.locator('#matching-time').innerText()),'visible countdown starts at three minutes');
 await fits(a,'desktop search stays inside game');await shot(a,'search-desktop');await a.waitForTimeout(350);
 check((await state(a)).online.matchmaking.remainingMs<remaining,'countdown actually decreases');
 await a.locator('#cancel-random-match').click();await a.waitForFunction(()=>document.querySelector('#online-connect').checkVisibility());
 check((await state(a)).online.matchmaking.state==='cancelled','cancel returns to online choices');
 await b.bringToFront();await connectPage(b);await b.locator('#find-random-match').click();await active(b);
 await b.waitForTimeout(180);check((await state(a)).online.code===null&&(await state(b)).online.code===null,'cancelled player cannot consume a later opponent');
 await fits(b,'mobile search fits');await shot(b,'search-mobile');
 await a.bringToFront();await a.locator('#find-random-match').click();
 await Promise.all([a.waitForFunction(()=>window.flashVersus.getState().menu.screen==='characters'),b.waitForFunction(()=>window.flashVersus.getState().menu.screen==='characters')]);
 const sa=await state(a),sb=await state(b);
 check(sa.online.code===sb.online.code&&sa.online.kind==='random','two searches create the same random room');
 check(sa.online.seat!==sb.online.seat,'matched players receive different seats');
 check(sa.online.matchmaking===null&&sb.online.matchmaking===null,'matched players leave the queue');
 await a.locator('[data-fighter="cross"]').click();await b.bringToFront();await b.locator('[data-fighter="emerald"]').click();
 await Promise.all([a.waitForFunction(()=>window.flashVersus.getState().menu.screen==='stage'),b.waitForFunction(()=>window.flashVersus.getState().menu.screen==='stage')]);
 const host=sa.online.seat===0?a:b,guest=sa.online.seat===0?b:a;
 await host.bringToFront();check((await host.locator('#rule-summary').innerText())==='60초 · 2선승','random pairing uses default shared match rules');
 await host.locator('[data-stage="paper"]').click();
 await Promise.all([a.waitForFunction(()=>window.flashVersus.getState().phase==='fighting'),b.waitForFunction(()=>window.flashVersus.getState().phase==='fighting')]);
 check(JSON.stringify((await state(a)).players.map(p=>p.id))===JSON.stringify((await state(b)).players.map(p=>p.id)),'random room uses the existing shared battle flow');
 await host.bringToFront();await shot(host,'battle');await guest.bringToFront();await guest.locator('#pause-button').click();await guest.locator('#home-button').click();
 await host.waitForFunction(()=>window.flashVersus.getState().online.phase==='waiting');
 check(await host.locator('#find-next-match').isVisible(),'remaining player can look for a new random opponent');
 await host.bringToFront();await host.locator('#find-next-match').click();await active(host);
 check((await state(host)).online.code===null,'find-next leaves the old room before requeueing');
 await connectPage(guest);await guest.locator('#find-random-match').click();
 await Promise.all([host.waitForFunction(()=>window.flashVersus.getState().menu.screen==='characters'),guest.waitForFunction(()=>window.flashVersus.getState().menu.screen==='characters')]);
 check((await state(host)).online.code===(await state(guest)).online.code,'explicit requeue can find another opponent');
 await a.bringToFront();await a.locator('#brand-button').click();await b.bringToFront();await b.locator('#brand-button').click();
 await connectPage(b);await b.locator('#create-room').click();await b.waitForFunction(()=>window.flashVersus.getState().online.phase==='waiting');
 await connectPage(a);await a.locator('#find-random-match').click();await active(a);await a.waitForTimeout(200);
 check((await state(a)).online.code===null&&(await state(b)).online.kind==='private','private room occupants never enter random matching');
 await a.locator('#cancel-random-match').click();await a.waitForFunction(()=>document.querySelector('#online-connect').checkVisibility());
 await b.locator('#brand-button').click();await ca.close();await cb.close();a=null;b=null;
 console.log('Three-minute countdown, cancellation, automatic pairing, battle and explicit requeue passed.');

 const timeoutContext=await browser.newContext({viewport:{width:360,height:640},isMobile:true,hasTouch:true});
 timeoutPage=await timeoutContext.newPage();await ready(timeoutPage,5185);await connectPage(timeoutPage);
 await timeoutPage.locator('#find-random-match').click();await active(timeoutPage);await fits(timeoutPage,'timeout-test waiting screen fits');
 await timeoutPage.waitForFunction(()=>window.flashVersus.getState().online.matchmaking?.state==='timeout');
 check(await timeoutPage.locator('#matching-time').innerText()==='0:00','expired search displays zero');
 check(await timeoutPage.locator('#retry-random-match').isVisible(),'timeout offers an explicit retry');
 await fits(timeoutPage,'timeout result fits');await shot(timeoutPage,'timeout-mobile');
 await timeoutPage.waitForTimeout(450);check((await state(timeoutPage)).online.matchmaking.state==='timeout','timeout never automatically starts another search');
 await timeoutPage.locator('#retry-random-match').focus();await timeoutPage.keyboard.press('Enter');await active(timeoutPage);
 check((await state(timeoutPage)).online.matchmaking.remainingMs>0,'retry creates a fresh search');
 await timeoutPage.keyboard.press('Escape');await timeoutPage.waitForFunction(()=>document.querySelector('#online-connect').checkVisibility());
 check((await state(timeoutPage)).online.matchmaking.state==='cancelled','Escape cancels matching inside the same game screen');
 await timeoutContext.close();timeoutPage=null;
 for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:360,height:640},{width:844,height:390}]){
  const context=await browser.newContext({viewport,isMobile:viewport.width<1000,hasTouch:viewport.width<1000});
  const page=await context.newPage();await ready(page);await connectPage(page);
  const label=viewport.width+'x'+viewport.height;
  await fits(page,label+' online choices fit');await shot(page,label+'-choices');
  await page.locator('#find-random-match').click();await active(page);
  await fits(page,label+' random waiting fits');await shot(page,label+'-search');
  await page.locator('#cancel-random-match').click();await page.waitForFunction(()=>document.querySelector('#online-connect').checkVisibility());
  await fits(page,label+' cancelled screen fits');
  await context.close();
 }
 check(errors.length===0,'no browser runtime errors: '+errors.join('; '));
 await writeFile('artifacts/matching-results.json',JSON.stringify({passed:true,checks,errors},null,2));
 console.log('Random matching browser checks passed: '+checks.length+'. Countdown, cancel, timeout, retry and responsive layouts.');
}catch(error){
 for(const [page,name]of [[a,'a'],[b,'b'],[timeoutPage,'timeout']])if(page){
  await page.screenshot({path:'artifacts/matching-failure-'+name+'.png'}).catch(()=>{});
  await writeFile('artifacts/matching-failure-'+name+'.json',JSON.stringify({error:error.message,state:await state(page).catch(()=>null),checks,errors},null,2));
 }
 throw error;
}finally{if(browser)await browser.close();server.kill();timeoutServer.kill();}
