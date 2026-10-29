import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {FIGHTERS} from '../src/data.js';
import {TECHNIQUES} from '../src/combat.js';
const require=createRequire(import.meta.url);
let playwright;
try{playwright=require(process.env.PLAYWRIGHT_PATH || 'playwright');}
catch{playwright=require(os.homedir()+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const {chromium}=playwright;
await mkdir('artifacts',{recursive:true});
const root=fileURLToPath(new URL('../',import.meta.url));
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'5180'},windowsHide:true,stdio:['ignore','pipe','pipe']});
const errors=[],checks=[];
const check=(condition,label)=>{if(!condition)throw new Error(label);checks.push(label);};
const state=p=>p.evaluate(()=>window.flashVersus.getState());
async function ready(page){
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5180',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!document.querySelector('#next-button').disabled);
}
async function fits(page,label){
  const result=await page.evaluate(()=>{
    const shell=document.querySelector('#game-shell').getBoundingClientRect();
    const screen=document.querySelector('.game-screen:not(.hidden)'),bounds=screen.getBoundingClientRect();
    const clipped=[...screen.querySelectorAll('button,h1,.preview-label,.preview-info,.fighter-description,.mode-bottom-note,.match-strip,.stage-rule')].filter(el=>{
      if(!el.checkVisibility())return false;
      const r=el.getBoundingClientRect();
      return r.left<bounds.left-5||r.right>bounds.right+5||r.top<bounds.top-5||r.bottom>bounds.bottom+5;
    }).map(el=>({tag:el.tagName,id:el.id,text:el.textContent.trim().slice(0,35)}));
    return {fits:shell.left>=0&&shell.top>=0&&shell.right<=innerWidth+1&&shell.bottom<=innerHeight+1,
      scroll:document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth,clipped};
  });
  check(result.fits&&!result.scroll&&!result.clipped.length,label+': '+JSON.stringify(result));
}
async function screenshot(page,name){await page.waitForTimeout(220);await page.screenshot({path:'artifacts/'+name+'.png'});}
let browser,page;
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error('QA server exited '+code)));});
  browser=await chromium.launch({headless:true,channel:'msedge'});
  page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await ready(page);
  // The headless browser may replace media fetches with empty 204 responses.
  // Verify real server responses through Playwright's HTTP client, then decode
  // those same bytes in Web Audio rather than accepting a mocked media result.
  const manifest=await (await page.request.get('http://127.0.0.1:5180/assets/manifest.json')).json();
  const audioFiles=[];
  for(const [name,clip] of Object.entries(manifest.audio)){
    const response=await page.request.get('http://127.0.0.1:5180/assets/'+clip.file);
    check(response.status()===200,'audio server response: '+name);
    const bytes=await response.body();
    audioFiles.push({name,base64:bytes.toString('base64')});
  }
  const decoded=await page.evaluate(async files=>{
    const context=new AudioContext(),results=[];
    for(const {name,base64} of files){
        const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0)).buffer;
        let buffer;
        try{buffer=await context.decodeAudioData(bytes);}
        catch(error){results.push({name,error:error.message});continue;}
        const samples=buffer.getChannelData(0);
        let energy=0,peak=0;
        for(const sample of samples){energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
        const rms=Math.sqrt(energy/samples.length);
        results.push({name,duration:buffer.duration,rms,peakDbfs:20*Math.log10(peak)});
    }
    await context.close();return results;
  },audioFiles);
  await writeFile('artifacts/audio-results.json',JSON.stringify(decoded,null,2));
  const invalidAudio=decoded.filter(clip=>!(clip.duration>0&&Math.abs(clip.duration-manifest.audio[clip.name].duration)<.01&&clip.rms>.001&&clip.peakDbfs<=-2.7));
  check(decoded.length===Object.keys(manifest.audio).length&&!invalidAudio.length,'all original audio clips decode for their full recorded duration, contain audible samples and retain normalization headroom: '+JSON.stringify(invalidAudio));
  check((await state(page)).menu.screen==='mode','initial mode selection');
  await fits(page,'desktop mode viewport');await screenshot(page,'desktop-mode');
  await page.locator('[data-mode="training"]').click();await page.locator('[data-fighter="cross"]').click();await page.locator('[data-fighter="tuna"]').click();
  await page.locator('[data-stage="paper"]').click();await page.locator('#skip-versus').click();await page.waitForFunction(()=>window.flashVersus.getState().phase==='fighting');
  await page.keyboard.down('s');await page.waitForTimeout(55);await page.keyboard.down('d');await page.waitForTimeout(55);await page.keyboard.up('s');
  await page.waitForTimeout(55);await page.keyboard.press('j');await page.keyboard.up('d');
  await page.waitForFunction(()=>window.flashVersus.getState().players[0].action==='burst');
  check((await state(page)).players[0].action==='burst','quarter-circle forward + light command');
  await page.waitForFunction(()=>{const p=window.flashVersus.getState().players[0];return p.action===null&&p.cooldowns.burst===0;});
  await page.evaluate(()=>{
    window.qaPads=[{index:0,axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}];
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.qaPads});
  });
  await page.waitForTimeout(40);
  await page.evaluate(()=>{window.qaPads[0].buttons[0].pressed=true;window.qaPads[0].buttons[2].pressed=true;});
  await page.waitForFunction(()=>window.flashVersus.getState().players[0].action==='burst');
  check((await state(page)).players[0].action==='burst','gamepad A + X executes burst');
  await page.evaluate(()=>{window.qaPads[0].buttons.forEach(button=>button.pressed=false);});
  await page.waitForFunction(()=>window.flashVersus.getState().players[0].action===null);
  await page.evaluate(()=>{window.qaPads[0].buttons[1].pressed=true;window.qaPads[0].buttons[2].pressed=true;});
  await page.waitForFunction(()=>window.flashVersus.getState().players[0].action==='command');
  check((await state(page)).players[0].action==='command','gamepad B + X executes command');
  await page.evaluate(()=>window.qaPads=[]);await page.keyboard.press('Escape');await page.locator('#home-button').click();
  await page.locator('[data-mode="training"]').click();await page.locator('[data-fighter="tuna"]').click();await page.locator('[data-fighter="hacker"]').click();
  await page.locator('[data-stage="paper"]').click();await page.locator('#skip-versus').click();await page.waitForFunction(()=>window.flashVersus.getState().phase==='fighting');
  await page.keyboard.down('d');
  await page.waitForFunction(()=>{const p=window.flashVersus.getState().players;return Math.abs(p[1].x-p[0].x)<94;});
  await page.keyboard.up('d');await page.keyboard.press('j');
  for(const [count,key] of [[1,'j'],[2,'k'],[3,'l'],[4,'i']]){
    await page.waitForFunction(count=>{const p=window.flashVersus.getState().players;return p[0].lastCombo===count&&p[1].stun>0;},count);
    await page.keyboard.press(key);
  }
  await page.waitForFunction(()=>window.flashVersus.getState().players[0].lastCombo===5);
  check((await state(page)).players[0].lastCombo===5,'real keyboard light → light → heavy → special → super five-hit combo');
  await page.screenshot({path:'artifacts/keyboard-five-hit-combo.png'});
  await page.keyboard.press('Escape');await page.locator('#home-button').click();
  console.log('Keyboard motion, gamepad chords and a real five-hit combo passed.');
  await page.locator('[data-open="settings-dialog"]').first().click();
  await page.selectOption('select[name="time"]','30');await page.selectOption('select[name="wins"]','1');
  await page.locator('input[name="musicOn"]').uncheck();await page.locator('input[name="volume"]').focus();await page.keyboard.press('Home');
  await page.locator('#settings-form button[type="submit"]').click();
  await page.locator('[data-mode="cpu"]').click();
  check((await state(page)).menu.screen==='characters'&&(await state(page)).menu.seat===0,'CPU mode enters 1P selection');
  await page.locator('[data-fighter="thief"]').hover();
  await fits(page,'desktop character viewport');await screenshot(page,'desktop-characters');
  await page.locator('[data-fighter="thief"]').click();
  check((await state(page)).menu.seat===1&&(await state(page)).menu.confirmed[0],'1P confirmation moves to opponent selection');
  await page.locator('#fighter-moves-button').click();await page.locator('[data-move-fighter="angry"]').click();
  check((await page.locator('#move-details').innerText()).includes('컴퓨터 대폭발'),'move table inside game menu');
  await page.locator('#moves-dialog .dialog-close').click();
  check(await page.locator('#back-label').innerText()==='이전으로','menu help preserves back navigation label');
  await page.locator('[data-fighter="angry"]').click();
  check((await state(page)).menu.screen==='stage','both fighters confirmed before stage');
  check(await page.locator('#rule-summary').innerText()==='30초 · 1선승','saved rules on stage screen');
  await page.locator('[data-stage="computer"]').hover();
  await fits(page,'desktop stage viewport');await screenshot(page,'desktop-stages');
  await page.locator('#back-button').click();
  check((await state(page)).menu.screen==='characters'&&(await state(page)).menu.seat===1,'stage back edits opponent');
  check((await state(page)).menu.fighters[0]==='thief','back preserves 1P choice');
  await page.locator('[data-fighter="angry"]').click();await page.locator('[data-stage="computer"]').click();
  check((await state(page)).menu.screen==='versus','stage confirmation opens versus screen');
  check(await page.locator('#back-label').innerText()==='이전으로','versus allows return to stage selection');
  await screenshot(page,'desktop-versus');await page.locator('#skip-versus').click();
  await page.waitForFunction(()=>window.flashVersus.getState().phase==='fighting');
  const before=await state(page);
  check(before.players[0].id==='thief'&&before.players[1].id==='angry'&&before.mode==='cpu','confirmed selections reach the match');
  await fits(page,'desktop battle viewport');
  await page.keyboard.down('d');await page.waitForTimeout(350);await page.keyboard.up('d');await page.keyboard.press('l');await page.waitForTimeout(750);
  check((await state(page)).players[0].x>before.players[0].x,'1P keyboard movement');
  await page.keyboard.press('Escape');const paused=await state(page);await page.waitForTimeout(200);
  check((await state(page)).remaining===paused.remaining&&paused.paused,'pause freezes battle');
  await page.locator('[data-open="moves-dialog"]').click();await page.locator('#moves-dialog .dialog-close').click();
  check((await state(page)).paused,'closing help preserves a manual pause');
  await screenshot(page,'desktop-pause');await page.locator('#resume-button').click();
  await page.waitForTimeout(350);await screenshot(page,'desktop-fight');
  await page.waitForFunction(()=>window.flashVersus.getState().phase==='matchOver',{},{timeout:45000});
  check(await page.locator('#result-overlay').isVisible(),'complete match victory screen');
  await screenshot(page,'desktop-result');await page.locator('#rematch-button').click();
  check((await state(page)).menu.screen==='versus','rematch skips setup and returns to versus');
  await page.locator('#skip-versus').click();await page.keyboard.press('Escape');await page.locator('#home-button').click();
  await page.locator('[data-mode="multiplayer"]').click();await page.locator('[data-multiplayer="local"]').click();await page.locator('[data-fighter="hacker"]').click();await page.locator('[data-fighter="thief"]').click();await page.locator('[data-stage="paper"]').click();
  await page.locator('#skip-versus').click();await page.waitForFunction(()=>window.flashVersus.getState().phase==='fighting');
  const x=(await state(page)).players[1].x;await page.keyboard.down('ArrowLeft');await page.waitForTimeout(350);await page.keyboard.up('ArrowLeft');
  check((await state(page)).players[1].x<x,'local multiplayer independent 2P controls');
  await page.keyboard.down('1');await page.keyboard.down('3');await page.keyboard.up('3');await page.keyboard.up('1');
  await page.waitForFunction(()=>window.flashVersus.getState().players[1].action==='burst');
  check((await state(page)).players[1].action==='burst','local multiplayer 2P button chord');
  await page.locator('#brand-button').click();check((await state(page)).paused,'brand pauses an active match');
  await page.locator('#leave-button').click();check((await state(page)).menu.screen==='characters'&&(await state(page)).menu.mode==='local','reselection keeps multiplayer mode');
  await page.locator('#back-button').click();await page.locator('#back-button').click();
  await page.locator('#game-shell').focus();
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  check((await state(page)).menu.mode==='training'&&(await state(page)).menu.screen==='characters','keyboard mode navigation');
  await page.keyboard.press('d');await page.keyboard.press('Enter');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.flashVersus.getState().phase==='fighting');
  check((await state(page)).mode==='training'&&(await state(page)).players[0].meter===100,'all setup stages work with keyboard only');
  await page.keyboard.press('i');await page.waitForTimeout(250);await screenshot(page,'training-super');
  await page.keyboard.press('Escape');await page.locator('#home-button').click();
  await page.locator('[data-open="archive-dialog"]').click();
  check(await page.locator('.archive-card a[download]').count()===5,'all five original sources available in archive');
  await page.locator('#archive-dialog .dialog-close').click();

  const additions=FIGHTERS.map(f=>f.id);
  for(const [index,id] of additions.entries()){
    await page.locator('[data-mode="training"]').click();
    check(await page.locator('.fighter-card').count()===7,'seven selectable characters: '+id);
    await page.locator('[data-fighter="'+id+'"]').click();
    await page.locator('[data-fighter="'+additions[(index+1)%3]+'"]').click();
    await page.locator('[data-stage="paper"]').click();await page.locator('#skip-versus').click();
    await page.waitForFunction(()=>window.flashVersus.getState().phase==='fighting');
    check((await state(page)).players[0].id===id,'new character enters battle: '+id);
    await page.keyboard.press('l');
    await page.waitForFunction(()=>window.flashVersus.getState().projectiles>0);
    await screenshot(page,'new-'+id+'-special');await page.waitForTimeout(650);
    await page.keyboard.press('i');await page.waitForTimeout(330);
    await screenshot(page,'new-'+id+'-super');await fits(page,'new character battle fits: '+id);
    check((await state(page)).players[0].state==='super','new character super executes: '+id);
    await page.waitForFunction(()=>window.flashVersus.getState().players[0].action===null);
    await page.keyboard.down('k');await page.keyboard.down('l');await page.keyboard.up('l');await page.keyboard.up('k');
    await page.waitForFunction(()=>window.flashVersus.getState().players[0].action==='command');
    check((await state(page)).players[0].action==='command','keyboard heavy + special executes original extra move: '+id);
    await page.waitForTimeout(150);await page.screenshot({path:'artifacts/technique-'+id+'-command.png'});
    await page.waitForFunction(()=>window.flashVersus.getState().players[0].action===null);
    await page.keyboard.down('j');await page.keyboard.down('l');await page.keyboard.up('l');await page.keyboard.up('j');
    await page.waitForFunction(()=>window.flashVersus.getState().players[0].action==='burst');
    await page.waitForFunction(start=>{const p=window.flashVersus.getState().players[0];return p.action==='burst'&&p.actionFrame>=start;},TECHNIQUES[id].burst.startup);
    check((await state(page)).players[0].action==='burst','keyboard light + special executes original extra move: '+id);
    await page.screenshot({path:'artifacts/technique-'+id+'-burst.png'});
    await page.locator('[data-open="moves-dialog"]').click();
    await page.locator('[data-move-fighter="'+id+'"]').click();
    for(const move of Object.values(TECHNIQUES[id]))check((await page.locator('#move-details').innerText()).includes(move.name),'in-game move table contains '+id+' '+move.name);
    await page.locator('#moves-dialog .dialog-close').click();
    await page.waitForFunction(()=>!window.flashVersus.getState().paused);
    await page.locator('#pause-button').click();await page.locator('#home-button').click();
  }
  for(const size of [{width:1280,height:720},{width:390,height:844},{width:360,height:640},{width:844,height:390}]){
    const mobile=size.width<1000;
    const context=await browser.newContext({viewport:size,hasTouch:mobile,isMobile:mobile,storageState:await page.context().storageState()});
    const p=await context.newPage();await ready(p);
    const prefix=size.width+'x'+size.height;
    await fits(p,prefix+' mode fits without scrolling');await screenshot(p,prefix+'-mode');
    await p.locator('[data-mode="multiplayer"]').click();await p.locator('[data-multiplayer="local"]').click();await p.locator('[data-fighter="emerald"]').hover({force:true}).catch(()=>{});
    await fits(p,prefix+' characters fit without scrolling');await screenshot(p,prefix+'-characters');
    await p.locator('[data-fighter="emerald"]').click();await p.locator('[data-fighter="cross"]').click();
    await fits(p,prefix+' stages fit without scrolling');await screenshot(p,prefix+'-stages');
    check(await p.locator('#rule-summary').innerText()==='30초 · 1선승',prefix+' settings persist');
    await p.locator('[data-stage="paper"]').click();await p.locator('#skip-versus').click();await p.waitForFunction(()=>window.flashVersus.getState().phase==='fighting');
    await fits(p,prefix+' battle fits without scrolling');
    if(mobile){
      await p.locator('[data-touch="special"]').tap();await p.waitForTimeout(100);
      check((await state(p)).players[0].state==='special',prefix+' real touch special');
      await p.waitForFunction(()=>window.flashVersus.getState().players[0].action===null);
      const client=await context.newCDPSession(p);
      for(const [actions,kind] of [[['light','special'],'burst'],[['heavy','special'],'command']]){
        const boxes=await Promise.all(actions.map(action=>p.locator('[data-touch="'+action+'"]').boundingBox()));
        await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:boxes.map((box,id)=>({x:box.x+box.width/2,y:box.y+box.height/2,id:id+1}))});
        await p.waitForFunction(kind=>window.flashVersus.getState().players[0].action===kind,kind);
        check((await state(p)).players[0].action===kind,prefix+' real multitouch '+kind);
        await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await p.waitForFunction(()=>window.flashVersus.getState().players[0].action===null);
      }
      await client.detach();
      await p.locator('[data-open="moves-dialog"]').click();
      await p.locator('[data-move-fighter="fries"]').click();
      const dialogFits=await p.locator('#moves-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+2);
      check(dialogFits,prefix+' expanded move table fits dialog width');
      await p.screenshot({path:'artifacts/'+prefix+'-moves.png'});
      await p.locator('#moves-dialog .dialog-close').click();
    }
    await screenshot(p,prefix+'-fight');
    await context.close();
  }
  check(errors.length===0,'no browser runtime or asset errors: '+errors.join('; '));
  await writeFile('artifacts/browser-results.json',JSON.stringify({passed:true,errors,checks},null,2));
  console.log('Browser checks passed: '+checks.length+'. Fixed-screen desktop, portrait and landscape screenshots in artifacts/.');
}catch(error){
  if(page){await page.screenshot({path:'artifacts/browser-failure.png'}).catch(()=>{});await writeFile('artifacts/browser-failure.json',JSON.stringify({error:error.message,state:await state(page).catch(()=>null),checks},null,2));}
  throw error;
}finally{if(browser)await browser.close();server.kill();}
