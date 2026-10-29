import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio,MENU_MUSIC} from '../src/audio.js';

function audioFixture(){
  const audio=new GameAudio({}),nodes=[];
  audio.unlock=async()=>{};
  audio.context={createBufferSource(){
    const node={connect(){},start(){},stop(){this.stopped=true;}};
    nodes.push(node);return node;
  }};
  audio.buffer=async name=>({name});
  return {audio,nodes};
}

test('routine voices finish before another battle line can start',async()=>{
  const {audio,nodes}=audioFixture();
  await audio.play('tuna-special','voice-0',{interrupt:false});
  await audio.play('tuna-special','voice-0',{interrupt:false});
  await audio.play('tuna-hurt','voice-0',{interrupt:false});
  assert.equal(nodes.length,1);assert.equal(nodes[0].stopped,undefined);
  nodes[0].onended();
  await audio.play('tuna-hurt','voice-0',{interrupt:false});
  assert.equal(nodes.length,2);assert.equal(nodes[1].buffer.name,'tuna-hurt');
});

test('explicit replacement still switches selection, super, and victory voices',async()=>{
  const {audio,nodes}=audioFixture();
  await audio.play('tuna-select','selection');
  await audio.play('hacker-select','selection');
  assert.equal(nodes[0].stopped,true);
  nodes[0].onended();assert.equal(audio.voices.get('selection'),nodes[1]);
  await audio.play('tuna-special','voice-0',{interrupt:false});
  await audio.play('tuna-super','voice-0',{interrupt:true});
  assert.equal(nodes[2].stopped,true);
  await audio.play('tuna-win','voice-0');
  assert.equal(nodes[3].stopped,true);assert.equal(nodes[4].buffer.name,'tuna-win');
});

test('a late loading routine voice cannot replace a newer super',async()=>{
  const {audio,nodes}=audioFixture();
  let finishRoutine;
  audio.buffer=name=>name==='tuna-special'?new Promise(resolve=>{finishRoutine=resolve;}):Promise.resolve({name});
  const routine=audio.play('tuna-special','voice-0',{interrupt:false});
  await Promise.resolve();
  await audio.play('tuna-hurt','voice-0',{interrupt:false});
  await audio.play('tuna-super','voice-0',{interrupt:true});
  finishRoutine({name:'tuna-special'});await routine;
  assert.equal(nodes.length,1);assert.equal(nodes[0].buffer.name,'tuna-super');
  assert.equal(audio.voiceRequests.size,0);
});

test('each player can finish a voice independently',async()=>{
  const {audio,nodes}=audioFixture();
  await Promise.all([
    audio.play('tuna-special','voice-0',{interrupt:false}),
    audio.play('hacker-special','voice-1',{interrupt:false}),
  ]);
  assert.equal(nodes.length,2);assert.equal(audio.voices.size,2);
  assert.ok(nodes.every(node=>!node.stopped));
});

test('only super and victory events interrupt a player voice',()=>{
  const audio=new GameAudio({}),calls=[];
  audio.play=(...args)=>calls.push(args);audio.tone=()=>{};
  const engine={players:[{def:{voice:{hurt:'tuna-hurt',win:'tuna-win'}}}]};
  audio.onEvent({type:'attack',player:0,kind:'special',voice:'tuna-special'},engine);
  audio.onEvent({type:'hit',target:0,tick:100,kind:'light'},engine);
  audio.onEvent({type:'hit',target:0,tick:110,kind:'light'},engine);
  audio.onEvent({type:'attack',player:0,kind:'super',voice:'tuna-super'},engine);
  audio.onEvent({type:'roundEnd',winner:0},engine);
  assert.deepEqual(calls,[
    ['tuna-special','voice-0',{interrupt:false}],
    ['tuna-hurt','voice-0',{interrupt:false}],
    ['tuna-super','voice-0',{interrupt:true}],
    ['tuna-win','voice-0'],
  ]);
});

test('battle events play character voices without generated tones or background music',()=>{
  const audio=new GameAudio({}),voices=[];let tones=0,music=0;
  audio.play=(name,channel)=>voices.push({name,channel});
  audio.tone=()=>tones++;audio.music=()=>music++;audio.menuMusic=()=>music++;
  const engine={players:[{def:{voice:{hurt:'tuna-hurt',win:'tuna-win'}}}]};
  for(const event of [
    {type:'fight'},
    {type:'attack',player:0,kind:'special',voice:'tuna-special'},
    {type:'hit',target:0,tick:100,kind:'heavy'},
    {type:'guard'},
    {type:'attack',player:0,kind:'super',voice:'tuna-super'},
    {type:'roundEnd',winner:0},
  ])audio.onEvent(event,engine);
  assert.deepEqual(voices,[
    {name:'tuna-special',channel:'voice-0'},
    {name:'tuna-hurt',channel:'voice-0'},
    {name:'tuna-super',channel:'voice-0'},
    {name:'tuna-win',channel:'voice-0'},
  ]);
  assert.equal(tones,0);assert.equal(music,0);
});

test('selection and battle share player slots while a preview plays exclusively',async()=>{
  const {audio,nodes}=audioFixture();
  await audio.select('tuna-select',0);
  await audio.select('hacker-select',1);
  await audio.play('tuna-special','voice-0',{interrupt:false});
  assert.equal(nodes.length,2);assert.ok(nodes.every(node=>!node.stopped));
  await audio.select('thief-select',0);
  assert.equal(nodes[0].stopped,true);assert.equal(nodes[1].stopped,undefined);
  await audio.preview('cross-select');
  assert.equal(nodes[1].stopped,true);assert.equal(nodes[2].stopped,true);
  assert.deepEqual([...audio.voices.keys()],['preview']);
  await audio.select('tuna-select',0);
  assert.equal(nodes[3].stopped,true);
  assert.deepEqual([...audio.voices.keys()],['voice-0']);
});

test('players with the same original voice clip retain independent slots',async()=>{
  const {audio,nodes}=audioFixture();
  await Promise.all([0,1].map(player=>audio.play('tuna-hurt',`voice-${player}`,{interrupt:false})));
  await audio.play('tuna-win','voice-0');
  assert.equal(nodes[0].stopped,true);assert.equal(nodes[1].stopped,undefined);
  assert.equal(audio.voices.size,2);
});

test('pending and playing previews exclude later battle voices, including priority lines',async()=>{
  const {audio,nodes}=audioFixture();let decode;
  audio.tone=()=>{};
  const engine={players:[{def:{voice:{hurt:'tuna-hurt',win:'tuna-win'}}}]};
  audio.buffer=name=>name==='cross-select'?new Promise(resolve=>{decode=()=>resolve({name});}):Promise.resolve({name});
  const preview=audio.preview('cross-select');await Promise.resolve();
  audio.onEvent({type:'attack',player:0,kind:'super',voice:'tuna-super'},engine);
  audio.onEvent({type:'roundEnd',winner:0},engine);
  audio.onEvent({type:'roundStart'},engine);
  assert.deepEqual([...audio.voiceRequests.keys()],['preview']);
  decode();await preview;
  audio.onEvent({type:'attack',player:0,kind:'special',voice:'tuna-special'},engine);
  audio.onEvent({type:'hit',target:0,tick:100,kind:'light'},engine);
  audio.onEvent({type:'attack',player:0,kind:'super',voice:'tuna-super'},engine);
  audio.onEvent({type:'roundEnd',winner:0},engine);
  audio.onEvent({type:'roundStart'},engine);
  await Promise.resolve();
  assert.equal(nodes.length,1);assert.equal(nodes[0].stopped,undefined);
  assert.deepEqual([...audio.voices.keys()],['preview']);
  await audio.select('tuna-select',0);
  assert.equal(nodes[0].stopped,true);assert.equal(nodes[1].buffer.name,'tuna-select');
});

test('stopping voices cancels requests still waiting for audio unlock',async()=>{
  const {audio,nodes}=audioFixture();
  let resume,loads=0;
  audio.unlock=()=>new Promise(resolve=>{resume=resolve;});
  audio.buffer=async()=>{loads++;return {};};
  const pending=audio.play('tuna-select','voice-0');
  audio.stopVoices();resume();await pending;
  assert.equal(loads,0);assert.equal(nodes.length,0);assert.equal(audio.voiceRequests.size,0);
});

test('stopping one slot cancels its pending decode without disturbing another player',async()=>{
  const {audio,nodes}=audioFixture();
  await audio.play('hacker-special','voice-1');
  let decode;
  audio.buffer=()=>new Promise(resolve=>{decode=resolve;});
  const pending=audio.play('tuna-select','voice-0');
  await Promise.resolve();audio.stopVoice('voice-0');decode({name:'tuna-select'});await pending;
  assert.equal(nodes.length,1);assert.equal(nodes[0].stopped,undefined);
  assert.deepEqual([...audio.voices.keys()],['voice-1']);
});

test('a new round clears the previous lines and resets hurt throttling',async()=>{
  const {audio,nodes}=audioFixture();
  await audio.play('tuna-win','voice-0');audio.lastHurt=[900,850];
  audio.onEvent({type:'roundStart'},{});
  assert.equal(nodes[0].stopped,true);assert.equal(audio.voices.size,0);
  assert.deepEqual(audio.lastHurt,[-100,-100]);
});

test('repeated music requests share one pending loop and stopping cancels old loads',async()=>{
  const {audio,nodes}=audioFixture();
  let decode,loads=0;
  audio.buffer=name=>{loads++;return new Promise(resolve=>{decode=()=>resolve({name});});};
  const first=audio.music('tuna');await Promise.resolve();
  await audio.music('tuna');assert.equal(loads,1);
  decode();await first;
  await audio.music('tuna');assert.equal(nodes.length,1);
  audio.stopMusic();assert.equal(nodes[0].stopped,true);
  const old=audio.music('tuna');await Promise.resolve();const decodeOld=decode;
  const newer=audio.music('hacker');await Promise.resolve();
  decode();await newer;decodeOld();await old;
  assert.equal(nodes.length,2);assert.equal(nodes[1].buffer.name,'hacker-loop');
  assert.equal(audio.musicName,'hacker-loop');
});

test('stopping music during unlock prevents it from restarting after navigation',async()=>{
  const {audio,nodes}=audioFixture();
  let resume;
  audio.unlock=()=>new Promise(resolve=>{resume=resolve;});
  const pending=audio.music('tuna');audio.stopMusic();resume();await pending;
  assert.equal(nodes.length,0);assert.equal(audio.musicName,null);
});

test('menu music loads one track at a time, advances in order, and wraps without restarting on navigation',async()=>{
  const {audio,nodes}=audioFixture(),loads=[];
  audio.buffer=async(name,file)=>{loads.push({name,file});return {name};};
  await audio.menuMusic();await audio.menuMusic();
  assert.equal(nodes.length,1);assert.equal(loads.length,1);
  assert.equal(audio.musicMode,'menu');assert.equal(audio.musicName,MENU_MUSIC[0].name);
  assert.equal(nodes[0].loop,false);
  for(let index=0;index<MENU_MUSIC.length;index++){
    await nodes[index].onended();
    const track=MENU_MUSIC[(index+1)%MENU_MUSIC.length];
    assert.equal(audio.musicName,track.name);assert.equal(nodes[index+1].buffer.name,track.name);
    await audio.menuMusic();assert.equal(nodes.length,index+2);
  }
  assert.deepEqual(loads.slice(0,3),MENU_MUSIC);
});

test('pending menu requests deduplicate and cannot replace battle music after a late decode',async()=>{
  const {audio,nodes}=audioFixture();let decode,loads=0;
  audio.buffer=name=>{
    loads++;
    return name===MENU_MUSIC[0].name?new Promise(resolve=>{decode=()=>resolve({name});}):Promise.resolve({name});
  };
  const pending=audio.menuMusic();await Promise.resolve();
  await audio.menuMusic();assert.equal(loads,1);
  await audio.music('hacker');decode();await pending;
  assert.equal(nodes.length,1);assert.equal(nodes[0].buffer.name,'hacker-loop');
  assert.equal(audio.musicMode,'stage');assert.equal(audio.musicName,'hacker-loop');
});

test('switching to battle cancels the menu continuation and returning starts only one menu track',async()=>{
  const {audio,nodes}=audioFixture();
  await audio.menuMusic();const ended=nodes[0].onended;
  await audio.music('tuna');
  assert.equal(nodes[0].stopped,true);assert.equal(nodes[0].onended,null);
  ended();await Promise.resolve();assert.equal(nodes.length,2);
  assert.equal(audio.musicName,'tuna-loop');
  await audio.menuMusic();assert.equal(nodes[1].stopped,true);
  await audio.menuMusic();assert.equal(nodes.length,3);assert.equal(audio.musicMode,'menu');
  const menuEnded=nodes[2].onended;audio.stopMusic();menuEnded();await Promise.resolve();
  assert.equal(nodes.length,3);assert.equal(audio.musicName,null);assert.equal(audio.musicMode,null);
});

test('stopping the menu during unlock or a following-track decode cannot resurrect its playlist',async()=>{
  const {audio,nodes}=audioFixture();let resume;
  audio.unlock=()=>new Promise(resolve=>{resume=resolve;});
  const unlocking=audio.menuMusic();audio.stopMusic();resume();await unlocking;
  assert.equal(nodes.length,0);
  audio.unlock=async()=>{};await audio.menuMusic();
  let decode;audio.buffer=name=>new Promise(resolve=>{decode=()=>resolve({name});});
  const following=nodes[0].onended();await Promise.resolve();
  audio.stopMusic();decode();await following;
  assert.equal(nodes.length,1);assert.equal(audio.musicName,null);assert.equal(audio.musicRequest,null);
});

test('unavailable menu tracks are skipped with bounded retries and the next request may retry',async()=>{
  const {audio,nodes}=audioFixture(),previousWarn=console.warn,loads=[];
  console.warn=()=>{};
  try{
    audio.buffer=async name=>{loads.push(name);throw new Error('Unavailable');};
    await audio.menuMusic();
    assert.deepEqual(loads,MENU_MUSIC.map(track=>track.name));assert.equal(nodes.length,0);
    assert.equal(audio.musicMode,null);assert.equal(audio.musicName,null);assert.equal(audio.musicRequest,null);
    audio.buffer=async name=>({name});await audio.menuMusic();
    assert.equal(nodes.length,1);assert.equal(audio.musicMode,'menu');
    audio.stopMusic();
    audio.buffer=async name=>{if(name===MENU_MUSIC[0].name)throw new Error('Unavailable');return {name};};
    await audio.menuMusic();assert.equal(audio.musicName,MENU_MUSIC[1].name);
  }finally{console.warn=previousWarn;}
});

test('menu buffers use explicit MP3 paths and failed decodes do not permanently poison the cache',async()=>{
  const previousFetch=globalThis.fetch,audio=new GameAudio({}),files=[];
  let attempts=0;
  globalThis.fetch=async file=>{files.push(file);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};};
  audio.context={decodeAudioData:async()=>{attempts++;if(attempts===1)throw new Error('Decode failed');return {name:'decoded'};}};
  try{
    const track=MENU_MUSIC[0];
    await assert.rejects(audio.buffer(track.name,track.file),/Decode failed/);
    assert.equal(audio.pending.size,0);
    const buffer=await audio.buffer(track.name,track.file);
    assert.equal(await audio.buffer(track.name,track.file),buffer);
    assert.deepEqual(files,[track.file,track.file]);assert.equal(audio.pending.size,0);
  }finally{globalThis.fetch=previousFetch;}
});

test('voice and music sliders feed a final limiter before the destination',async()=>{
  const previousWindow=globalThis.window;
  const gains=[],values={};let limiter;
  class AudioContext {
    constructor(){this.state='running';this.currentTime=0;this.destination={};}
    createGain(){
      const node={gain:{setTargetAtTime(value){node.value=value;}},connect(target){this.target=target;}};
      gains.push(node);return node;
    }
    createDynamicsCompressor(){
      limiter={connect(target){this.target=target;}};
      for(const key of ['threshold','knee','ratio','attack','release'])Object.defineProperty(limiter,key,{value:{set value(value){values[key]=value;}}});
      return limiter;
    }
  }
  globalThis.window={AudioContext};
  try{
    const audio=new GameAudio({muted:false,volume:.6,musicOn:true,music:.2});await audio.unlock();
    assert.equal(gains[1].target,gains[0]);assert.equal(gains[2].target,gains[0]);
    assert.equal(gains[0].target,limiter);assert.equal(limiter.target,audio.context.destination);
    assert.deepEqual(gains.map(node=>node.value),[1,.6,.2]);
    assert.deepEqual(values,{threshold:-3,knee:0,ratio:20,attack:.003,release:.1});
  }finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});
