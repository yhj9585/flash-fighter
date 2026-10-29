import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require(process.env.PLAYWRIGHT_PATH||'playwright');}catch{playwright=require(os.homedir()+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const {chromium}=playwright;
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir('artifacts',{recursive:true});
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'5183',HOST:'127.0.0.1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
const checks=[],errors=[];let browser,h,g;
function check(value,label){if(!value)throw new Error(label);checks.push(label);}
const state=page=>page.evaluate(()=>window.flashVersus.getState());
async function ready(page){
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.goto('http://127.0.0.1:5183',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>!document.querySelector('#loading-state').checkVisibility());
}
async function fits(page,label){
 const info=await page.evaluate(()=>{
  const shell=document.querySelector('#game-shell').getBoundingClientRect(),screen=document.querySelector('.game-screen:not(.hidden)'),bounds=screen.getBoundingClientRect();
  const clipped=[...screen.querySelectorAll('button,h1,h2,input,.room-wait-note,.online-message')].filter(el=>{
   if(!el.checkVisibility())return false;const r=el.getBoundingClientRect();
   return r.left<bounds.left-3||r.right>bounds.right+3||r.top<bounds.top-3||r.bottom>bounds.bottom+3;
  }).map(el=>el.id||el.textContent.trim());
  return {fits:shell.left>=0&&shell.top>=0&&shell.right<=innerWidth+1&&shell.bottom<=innerHeight+1,scroll:document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth,clipped};
 });
 check(info.fits&&!info.scroll&&!info.clipped.length,label+': '+JSON.stringify(info));
}
async function multiplayer(page){await page.locator('[data-mode="multiplayer"]').click();check((await state(page)).menu.screen==='multiplayer','multiplayer opens inside the game');}
async function connectPage(page){await multiplayer(page);await page.locator('[data-multiplayer="online"]').click();await fits(page,'connection screen fits');}
async function shot(page,name){await page.screenshot({path:'artifacts/online-'+name+'.png'});}
async function pairKey(page,a,b){await page.keyboard.down(a);await page.keyboard.down(b);await page.keyboard.up(b);await page.keyboard.up(a);}
try{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error('Online QA server exited '+code)));});
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const hostContext=await browser.newContext({viewport:{width:1440,height:900}});
 const guestContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 h=await hostContext.newPage();g=await guestContext.newPage();await ready(h);await ready(g);
 await h.bringToFront();await h.locator('[data-open="settings-dialog"]').first().click();
 await h.selectOption('select[name="time"]','30');await h.selectOption('select[name="wins"]','1');await h.locator('input[name="musicOn"]').uncheck();
 await h.locator('#settings-form button[type="submit"]').click();
 await multiplayer(h);await fits(h,'desktop multiplayer choices fit');await shot(h,'choices');
 await h.locator('[data-multiplayer="online"]').click();await fits(h,'desktop create/join fits');await shot(h,'connect');
 await h.locator('#create-room').click();await h.waitForFunction(()=>Boolean(window.flashVersus.getState().online.code));
 const code=(await state(h)).online.code;check(/^[A-Z2-9]{6}$/.test(code),'six-character room code');
 await fits(h,'desktop waiting room fits');await shot(h,'waiting');
 await g.bringToFront();await connectPage(g);await g.locator('#room-code-input').fill(code);await g.locator('#join-room').click();
 await Promise.all([h.waitForFunction(()=>window.flashVersus.getState().menu.screen==='characters'),g.waitForFunction(()=>window.flashVersus.getState().menu.screen==='characters')]);
 check((await state(h)).online.seat===0&&(await state(g)).online.seat===1,'each browser owns a different seat');
 check(await g.locator('#preview-1').evaluate(el=>el.classList.contains('choosing')),'guest selects its own character');
 await fits(g,'guest character selection fits');
 await h.bringToFront();await h.locator('[data-fighter="cross"]').click();
 await h.waitForFunction(()=>window.flashVersus.getState().online.ready[0]);
 check(await h.locator('#next-button').isDisabled(),'one ready player waits for opponent');
 await g.bringToFront();await g.locator('[data-fighter="emerald"]').click();
 await Promise.all([h.waitForFunction(()=>window.flashVersus.getState().menu.screen==='stage'),g.waitForFunction(()=>window.flashVersus.getState().menu.screen==='stage')]);
 check(await g.locator('[data-stage="paper"]').isDisabled(),'guest cannot change the host stage');
 check((await g.locator('#rule-summary').innerText())==='30초 · 1선승','host match rules are shared');
 await h.bringToFront();await h.locator('[data-stage="computer"]').click();
 await Promise.all([h.waitForFunction(()=>window.flashVersus.getState().phase==='fighting'),g.waitForFunction(()=>window.flashVersus.getState().phase==='fighting')]);
 check((await state(h)).players[0].id==='cross'&&(await state(g)).players[1].id==='emerald','shared roster enters online fight');
 await fits(h,'desktop online fight fits');await fits(g,'mobile online fight fits');
 const before=(await state(h)).players.map(p=>p.x);
 await h.keyboard.down('d');await h.waitForTimeout(270);await h.keyboard.up('d');
 await h.waitForTimeout(130);check((await state(h)).players[0].x>before[0],'host keyboard moves player 1');
 await g.bringToFront();await g.keyboard.down('a');await g.waitForTimeout(270);await g.keyboard.up('a');
 await g.waitForTimeout(130);check((await state(h)).players[1].x<before[1],'guest uses its own WASD controls for player 2');
 await pairKey(g,'k','l');await g.waitForFunction(()=>window.flashVersus.getState().players[1].action==='command');
 check((await state(h)).players[1].state==='command','guest extra move reaches both browsers');
 await h.bringToFront();await pairKey(h,'j','l');await h.waitForFunction(()=>window.flashVersus.getState().players[0].action==='burst');
 await shot(h,'fight-desktop');await g.bringToFront();await shot(g,'fight-mobile');
 console.log('Room, separate seats, shared stage and two-way controls passed.');
 await h.bringToFront();await h.keyboard.down('d');
 await h.waitForFunction(()=>{const p=window.flashVersus.getState().players;return Math.abs(p[1].x-p[0].x)<110;});
 await h.keyboard.up('d');await h.waitForFunction(()=>window.flashVersus.getState().players[0].action===null);
 const hp=(await state(h)).players[1].hp;await h.keyboard.press('j');
 await h.waitForFunction(hp=>window.flashVersus.getState().players[1].hp<hp,hp);
 await h.waitForTimeout(170);
 check((await state(h)).players[1].hp===(await state(g)).players[1].hp,'damage is identical on both clients');
 const health=(await state(g)).players[1].hp;
 await g.route('**/src/main.js',async route=>{await new Promise(resolve=>setTimeout(resolve,700));await route.continue();});
 const reloaded=g.reload({waitUntil:'domcontentloaded'});
 await h.waitForFunction(()=>window.flashVersus.getState().paused);
 const remaining=(await state(h)).remaining;await h.waitForTimeout(140);
 check((await state(h)).remaining===remaining,'disconnect freezes the shared match clock');
 await shot(h,'reconnecting');await reloaded;await g.unroute('**/src/main.js');
 await g.waitForFunction(()=>window.flashVersus?.getState().online.status==='connected'&&window.flashVersus.getState().online.phase==='battle');
 await h.waitForFunction(()=>!window.flashVersus.getState().paused);
 check((await state(g)).online.code===code&&(await state(g)).online.seat===1,'reload resumes the same room and slot');
 check((await state(g)).players[1].hp===health,'reconnect preserves health');
 console.log('Identical damage, disconnect pause and reload recovery passed.');
 await Promise.all([h.waitForFunction(()=>window.flashVersus.getState().phase==='matchOver',{},{timeout:45000}),g.waitForFunction(()=>window.flashVersus.getState().phase==='matchOver',{},{timeout:45000})]);
 check(JSON.stringify((await state(h)).wins)===JSON.stringify((await state(g)).wins),'shared final score');
 await h.bringToFront();await h.locator('#rematch-button').click();await h.waitForFunction(()=>document.querySelector('#rematch-button').disabled);
 check((await state(h)).phase==='matchOver','one rematch vote does not restart alone');
 await g.bringToFront();await g.locator('#rematch-button').click();
 await Promise.all([h.waitForFunction(()=>window.flashVersus.getState().phase==='fighting'),g.waitForFunction(()=>window.flashVersus.getState().phase==='fighting')]);
 check((await state(g)).players[1].hp===960,'both votes reset the online match');
 await g.locator('#pause-button').click();await g.locator('#home-button').click();
 await h.waitForFunction(()=>window.flashVersus.getState().online.phase==='waiting');
 check((await state(h)).online.code===code,'leaving opponent returns host to the same room');
 await shot(h,'opponent-left');
 for(const viewport of [{width:390,height:844},{width:360,height:640},{width:844,height:390}]){
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});
  const p=await context.newPage();await ready(p);await multiplayer(p);
  const label=viewport.width+'x'+viewport.height;
  await fits(p,label+' multiplayer choices fit');await shot(p,label+'-choices');
  await p.locator('[data-multiplayer="online"]').click();await fits(p,label+' connect form fits');await shot(p,label+'-connect');
  await p.locator('#room-code-input').fill('ZZZZZZ');await p.locator('#join-room').click();
  await p.waitForFunction(()=>document.querySelector('#online-message').textContent.includes('방 코드'));
  check((await state(p)).menu.screen==='multiplayer',label+' join error stays inside game');
  await p.locator('#create-room').click();await p.waitForFunction(()=>Boolean(window.flashVersus.getState().online.code));
  await fits(p,label+' waiting room fits');await shot(p,label+'-waiting');
  await context.close();
 }
 check(errors.length===0,'no browser runtime errors: '+errors.join('; '));
 await writeFile('artifacts/online-results.json',JSON.stringify({passed:true,checks,errors},null,2));
 console.log('Online browser checks passed: '+checks.length+'. Two clients, reconnect and responsive room screens.');
}catch(error){
 for(const [page,name] of [[h,'host'],[g,'guest']])if(page){await page.screenshot({path:'artifacts/online-failure-'+name+'.png'}).catch(()=>{});await writeFile('artifacts/online-failure-'+name+'.json',JSON.stringify({error:error.message,state:await state(page).catch(()=>null),checks,errors},null,2));}
 throw error;
}finally{if(browser)await browser.close();server.kill();}
