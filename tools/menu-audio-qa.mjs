import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';

const require=createRequire(import.meta.url);
let playwright;
try{playwright=require(process.env.PLAYWRIGHT_PATH||'playwright');}
catch{playwright=require(os.homedir()+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const {chromium}=playwright;
const root=fileURLToPath(new URL('../',import.meta.url)),url='http://127.0.0.1:5185';
const checks=[],errors=[],decoded=[],mediaRequests=[];
const check=(condition,label)=>{if(!condition)throw new Error(label);checks.push(label);};
await mkdir('artifacts',{recursive:true});
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'5185'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,page;

async function instrument(target){
  target.on('pageerror',error=>errors.push(error.message));
  target.on('request',request=>{if(request.url().includes('/assets/audio/'))mediaRequests.push(request.url());});
  // Forward actual server bytes through the browser route. This avoids the
  // empty media responses sometimes supplied by headless browser environments.
  await target.route('**/assets/audio/**',async route=>{
    const response=await target.request.get(route.request().url());
    await route.fulfill({response,body:await response.body()});
  });
  await target.goto(url,{waitUntil:'networkidle'});
  await target.waitForFunction(()=>!document.querySelector('#next-button').disabled);
  await target.evaluate(async()=>{
    const {GameAudio}=await import('./src/audio.js');
    for(const method of ['unlock','menuMusic','music']){
      const original=GameAudio.prototype[method];
      GameAudio.prototype[method]=function(...args){window.qaAudio=this;return original.apply(this,args);};
    }
    window.qaTones=[];
    const originalTone=GameAudio.prototype.tone;
    GameAudio.prototype.tone=function(...args){window.qaTones.push(args[0]);return originalTone.apply(this,args);};
    window.qaStopped=new WeakSet();
    const originalStop=AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop=function(...args){window.qaStopped.add(this);return originalStop.apply(this,args);};
  });
}

async function menuPlaying(target){
  await target.waitForFunction(()=>window.qaAudio?.musicMode==='menu'&&window.qaAudio.musicNode);
}

async function sameMenu(target,label){
  check(await target.evaluate(()=>window.qaAudio.musicMode==='menu'&&window.qaAudio.musicNode===window.qaMenuNode&&!window.qaStopped.has(window.qaMenuNode)),label);
}

async function battleHasNoMusic(target,label){
  check(await target.evaluate(()=>{
    const audio=window.qaAudio;
    return audio.musicNode===null&&audio.musicRequest===null&&audio.musicMode===null&&audio.musicName===null;
  }),label);
}

async function settings(target,{musicOn=true,music=.24,volume=.45}={}){
  await target.locator('[data-open="settings-dialog"]').first().click();
  await target.locator('#settings-form [name="musicOn"]').setChecked(musicOn);
  await target.locator('#settings-form').evaluate((form,values)=>{
    form.elements.music.value=values.music;form.elements.volume.value=values.volume;
  },{music,volume});
  await target.locator('#settings-form [type="submit"]').click();
  await target.waitForFunction(()=>!document.querySelector('#settings-dialog').open);
  await target.waitForTimeout(650);
}

try{
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Menu QA server did not start')),10000);
    server.stdout.once('data',()=>{clearTimeout(timeout);resolve();});
    server.once('error',error=>{clearTimeout(timeout);reject(error);});
    server.once('exit',code=>{clearTimeout(timeout);reject(new Error('Menu QA server exited '+code));});
  });
  browser=await chromium.launch({headless:true,channel:'msedge'});
  page=await browser.newPage({viewport:{width:1440,height:900}});
  await instrument(page);
  const response=await page.request.get(url+'/assets/menu-music.json');
  check(response.status()===200,'menu playlist metadata is served');
  const playlist=await response.json(),files=[];
  check(playlist.tracks.length===3,'all three supplied OST tracks are in the playlist');
  for(const track of playlist.tracks){
    const media=await page.request.get(url+'/assets/'+track.file);
    check(media.status()===200,'actual menu MP3 response: '+track.name);
    const bytes=await media.body();
    check(bytes.length===track.bytes,'complete menu MP3 bytes: '+track.name);
    files.push({name:track.name,duration:track.duration,base64:bytes.toString('base64')});
  }
  decoded.push(...await page.evaluate(async files=>{
    const context=new AudioContext(),results=[];
    for(const file of files){
      const bytes=Uint8Array.from(atob(file.base64),character=>character.charCodeAt(0));
      const buffer=await context.decodeAudioData(bytes.buffer);let energy=0,peak=0,count=0;
      for(let channel=0;channel<buffer.numberOfChannels;channel++)for(const sample of buffer.getChannelData(channel)){
        energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));count++;
      }
      results.push({name:file.name,duration:buffer.duration,recordedDuration:file.duration,channels:buffer.numberOfChannels,rms:Math.sqrt(energy/count),peakDbfs:20*Math.log10(peak)});
    }
    await context.close();return results;
  },files));
  for(const track of decoded){
    check(Math.abs(track.duration-track.recordedDuration)<.05&&track.rms>.001&&track.peakDbfs<=-2.5&&track.channels===2,'full stereo menu MP3 decodes with audible normalized samples: '+track.name+' '+JSON.stringify(track));
  }
  check(await page.evaluate(()=>!window.qaAudio?.musicNode),'initial page does not force audio before a user gesture');
  await page.locator('#game-shell').click({position:{x:2,y:2}});
  await menuPlaying(page);
  await page.evaluate(()=>{window.qaMenuNode=window.qaAudio.musicNode;});
  check(await page.evaluate(()=>window.flashVersus.getState().menu.screen==='mode'&&window.qaAudio.musicName==='menu-tuna-mr'),'first pointer gesture starts the menu playlist on the first screen');
  await page.locator('[data-mode="training"]').click();
  await sameMenu(page,'mode to character selection preserves the playing menu track');
  await page.locator('[data-fighter="tuna"]').click();
  await sameMenu(page,'player 1 selection preserves the playing menu track');
  await page.locator('[data-fighter="hacker"]').click();
  await sameMenu(page,'player 2 selection and stage selection preserve the playing menu track');
  await page.locator('[data-stage="fridge"]').click();
  check(await page.evaluate(()=>window.flashVersus.getState().menu.screen==='versus'),'stage confirmation enters the pre-battle VS screen');
  await sameMenu(page,'VS screen still uses the menu track before battle starts');
  const beforeBattleFiles=mediaRequests.length;
  await page.evaluate(()=>{window.qaBattleToneCount=window.qaTones.length;});
  await page.locator('#skip-versus').click();
  await page.waitForFunction(()=>window.flashVersus.getState().menu.screen==='battle'&&window.flashVersus.getState().phase==='fighting');
  check(await page.evaluate(()=>window.qaStopped.has(window.qaMenuNode)),'battle stops the pre-battle menu BGM');
  await battleHasNoMusic(page,'battle starts with no active or pending background music');
  await page.keyboard.press('l');
  await page.waitForFunction(()=>{
    const audio=window.qaAudio,voice=audio.voices.get('voice-0');
    return voice&&voice.buffer===audio.buffers.get('tuna-special');
  });
  check(await page.evaluate(()=>window.qaAudio.voices.has('voice-0')),'character special voice still plays during battle');
  await page.waitForTimeout(1000);
  await battleHasNoMusic(page,'gameplay input and character voice playback do not restart background music');
  await page.locator('#pause-button').click();
  await battleHasNoMusic(page,'pausing battle keeps background music stopped');
  await page.locator('#resume-button').click();
  await page.keyboard.down('d');await page.waitForTimeout(180);await page.keyboard.up('d');
  await page.keyboard.press('j');
  await battleHasNoMusic(page,'resuming and further gameplay input keep background music stopped');
  check(await page.evaluate(()=>window.qaTones.length===window.qaBattleToneCount),'battle produces no synthesized fight, hit, or guard tones');
  check(mediaRequests.slice(beforeBattleFiles).every(file=>!file.endsWith('-loop.wav')&&!file.endsWith('.mp3')),'battle fetches no stage loops or menu music files');
  await page.locator('#pause-button').click();
  await page.locator('#leave-button').click();
  await menuPlaying(page);
  check(await page.evaluate(()=>window.flashVersus.getState().menu.screen==='characters'&&!window.qaAudio.paused),'reselection restores menu music and clears battle pause attenuation');
  await page.evaluate(()=>{window.qaMenuNode=window.qaAudio.musicNode;});
  await settings(page,{musicOn:false});
  check(await page.evaluate(()=>!window.qaAudio.settings.musicOn&&window.qaAudio.musicGain.gain.value<.002),'music checkbox mutes menu BGM');
  await settings(page,{musicOn:true});
  check(await page.evaluate(()=>Math.abs(window.qaAudio.musicGain.gain.value-.24)<.002&&Math.abs(window.qaAudio.sfx.gain.value-.45)<.002),'music and effects sliders retain independent gains');
  await sameMenu(page,'music settings preserve the same menu playback source');
  await page.locator('#sound-button').click();await page.waitForTimeout(220);
  check(await page.evaluate(()=>window.qaAudio.settings.muted&&window.qaAudio.master.gain.value<.002),'master mute silences menu audio');
  await page.locator('#sound-button').click();await page.waitForTimeout(220);
  check(await page.evaluate(()=>!window.qaAudio.settings.muted&&window.qaAudio.master.gain.value>.998),'master unmute restores menu audio');

  const keyboard=await browser.newPage({viewport:{width:1440,height:900}});
  await instrument(keyboard);
  await keyboard.keyboard.press('ArrowRight');
  await menuPlaying(keyboard);
  check(await keyboard.evaluate(()=>window.qaAudio.musicName==='menu-tuna-mr'&&window.flashVersus.getState().menu.screen==='mode'),'keyboard-only first gesture starts menu BGM without a mouse click');
  await keyboard.close();
  check(errors.length===0,'no menu audio browser runtime errors: '+errors.join('; '));
  await writeFile('artifacts/menu-audio-results.json',JSON.stringify({passed:true,checks,decoded,errors},null,2)+'\n');
  console.log('Menu audio browser checks passed: '+checks.length+'. Three full MP3s decoded; pre-battle continuity, voice-only battle, reselection and volume controls verified.');
}catch(error){
  await writeFile('artifacts/menu-audio-results.json',JSON.stringify({passed:false,error:error.message,checks,decoded,errors},null,2)+'\n');
  throw error;
}finally{
  if(browser)await browser.close();
  server.kill();
}
