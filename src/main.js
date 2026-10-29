import { FIGHTERS, ORIGINALS, STAGES, DEFAULT_SETTINGS, fighterById, MOVES } from './data.js';
import { FightEngine, STEP } from './engine.js';
import { GameFlow, MODES } from './flow.js';
import { Renderer } from './renderer.js';
import { GameAudio } from './audio.js';
import {TECHNIQUES,COMMAND_HELP} from './combat.js';
import {CombatInput} from './commands.js';
import {RemoteMatch} from './net-state.js';
import {OnlineUI} from './online-ui.js';

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const storageKey='flash-versus-settings-v1';
function loadSettings() {
  let value={};try{value=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{}
  const settings={...DEFAULT_SETTINGS,...value};
  if(![30,60,99].includes(settings.time))settings.time=60;
  if(![1,2,3].includes(settings.wins))settings.wins=2;
  if(!['easy','normal','hard'].includes(settings.difficulty))settings.difficulty='normal';
  for(const key of ['volume','music'])settings[key]=Number.isFinite(settings[key])?Math.max(0,Math.min(1,settings[key])):DEFAULT_SETTINGS[key];
  if(!Object.hasOwn(value,'motion') && matchMedia('(prefers-reduced-motion: reduce)').matches)settings.motion=false;
  return settings;
}
const settings=loadSettings();
const flow=new GameFlow();
const renderer=new Renderer($('#arena'),settings);
const audio=new GameAudio(settings);
let engine,loaded=false,modalOpen=false,resumeAfterDialog=false,toastTimer,lastPhase='',roundKey='',moveFighter='tuna';
let previousTime=0,accumulator=0,versusRemaining=0;
const held=new Set(),pressed=new Map(),touchHeld=new Set(),touchPressed=new Map(),padPrevious=new Map();
const combatInputs=[new CombatInput(),new CombatInput()];
const bindings=[
  {left:['KeyA'],right:['KeyD'],jump:['KeyW'],guard:['KeyS'],light:['KeyJ'],heavy:['KeyK'],special:['KeyL'],super:['KeyI'],dash:['Space'],throw:['KeyU']},
  {left:['ArrowLeft'],right:['ArrowRight'],jump:['ArrowUp'],guard:['ArrowDown'],light:['Digit1','Numpad1'],heavy:['Digit2','Numpad2'],special:['Digit3','Numpad3'],super:['Digit0','Numpad0'],dash:['ShiftRight'],throw:['Digit4','Numpad4']},
];
const gameKeys=new Set(bindings.flatMap(binding=>Object.values(binding).flat()));
const difficultyName={easy:'쉬움',normal:'보통',hard:'어려움'};
let onlineEpoch='',audioScreen=flow.screen;
const online=new OnlineUI(flow,settings,{
  navigate:focus=>renderNavigation(focus),clear:()=>clearInput(),home:()=>home(),unlock:()=>unlockAudio(),
  frame:receiveOnlineFrame,select:id=>audio.select(fighterById(id).voice.select,online.seat),
  status:()=>{if(online.active){if(online.client.status==='reconnecting'){engine.paused=true;clearInput();audio.pause(true);}renderNavigation();}}
});
function receiveOnlineFrame(state,events,epoch){
  const key=online.room?.code+':'+epoch;
  if(!(engine instanceof RemoteMatch)||onlineEpoch!==key){
    audio.stopVoices();
    engine=new RemoteMatch(state);onlineEpoch=key;lastPhase='';roundKey='';renderer.effects=[];renderer.particles=[];clearInput();
  }else engine.applyFrame(state);
  for(let i=0;i<2;i++){
    $('#p'+(i+1)+'-name').textContent=engine.players[i].def.name;
    $('#p'+(i+1)+'-series').textContent=engine.players[i].def.series;
    $('.p'+(i+1)+'-hud').classList.toggle('you',i===online.seat);
  }
  $('.p1-hud .player-tag').textContent=online.seat===0?'나 1P':'1P';
  $('#p2-tag').textContent=online.seat===1?'나 2P':'2P';
  $('#board-stage-label').textContent=STAGES.find(s=>s.id===state.options.stage).name;
  for(const event of events)handleEvent(event);
  audio.pause(Boolean(state.paused));syncMusic();refreshHUD();updateBattle();
}

function syncMusic(){
  if(audio.context?.state!=='running')return;
  if(flow.screen==='battle'){
    if(engine.phase==='matchOver')audio.stopMusic();
    else audio.music(STAGES.find(stage=>stage.id===flow.stage).source).catch(()=>{});
  }else{
    audio.pause(false);audio.menuMusic().catch(()=>{});
  }
}
function unlockAudio(){return audio.unlock().then(()=>syncMusic()).catch(()=>{});}
// Browsers allow music after the first pointer or keyboard interaction.
document.addEventListener('pointerdown',unlockAudio,{capture:true});
document.addEventListener('keydown',event=>{if(!event.repeat)unlockAudio();},{capture:true});
function saveSettings(){try{localStorage.setItem(storageKey,JSON.stringify(settings));}catch{}audio.update();syncMusic();updateSoundButton();}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2200);}
function clearInput(){if(online.active)online.client.neutral();held.clear();pressed.clear();touchHeld.clear();touchPressed.clear();combatInputs.forEach(input=>input.reset());$$('[data-touch]').forEach(el=>el.classList.remove('pressed'));}
function menuSound(){unlockAudio().then(()=>audio.tone('ui'));}

function buildEngine(){
  if(online.active)return;
  $('.p1-hud .player-tag').textContent='1P';$$('.player-hud').forEach(p=>p.classList.remove('you'));
  clearInput();audio.stopVoices();audio.pause(false);renderer.effects=[];renderer.particles=[];renderer.shake=0;
  engine=new FightEngine({players:[...flow.fighters],mode:flow.mode,stage:flow.stage,time:settings.time,wins:settings.wins,difficulty:settings.difficulty});
  lastPhase='';roundKey='';accumulator=0;
  for(let i=0;i<2;i++){
    $('#p'+(i+1)+'-name').textContent=engine.players[i].def.name;
    $('#p'+(i+1)+'-series').textContent=engine.players[i].def.series;
  }
  $('#p2-tag').textContent=flow.mode==='cpu'?'CPU':flow.mode==='training'?'DUMMY':'2P';
  $('#board-stage-label').textContent=STAGES.find(s=>s.id===flow.stage).name;
  refreshHUD();
}

function renderNavigation(focus=false){
  if(audioScreen!==flow.screen){
    if(['mode','multiplayer','versus','battle'].includes(flow.screen)||['versus','battle'].includes(audioScreen))audio.stopVoices();
    audioScreen=flow.screen;
  }
  const view=['versus','battle'].includes(flow.screen)?'battle':flow.screen;
  $('#game-shell').dataset.screen=flow.screen;$('#game-shell').dataset.online=String(online.active);
  for(const screen of $$('.game-screen')){
    const active=screen.id===view+'-screen';
    screen.classList.toggle('hidden',!active);screen.inert=!active;
  }
  for(const step of $$('[data-step]')){
    const index=Number(step.dataset.step);
    step.classList.toggle('current',index===flow.step);step.classList.toggle('done',index<flow.step);
    if(index===flow.step)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');
  }
  const inBattle=flow.screen==='battle';
  $('#next-button').classList.toggle('hidden',inBattle);
  $('#next-button').disabled=!loaded;
  $('#back-button').disabled=flow.screen==='mode';
  $('#back-label').textContent=inBattle?(engine.phase==='matchOver'?'캐릭터 선택':engine.paused?'이어서':'일시정지'):'이전으로';
  $('#next-label').textContent=flow.screen==='mode'?(flow.mode==='multiplayer'?'플레이 방식 선택':'캐릭터 선택'):flow.screen==='characters'?(flow.seat===0?'1P 선택 완료':flow.opponentLabel+' 선택 완료'):flow.screen==='stage'?'대전 시작':'시작';
  $('#navigation-hint').classList.toggle('hidden',inBattle);
  $('#battle-footer-note').classList.toggle('hidden',!inBattle);
  $('#pause-button').classList.toggle('hidden',!inBattle);
  $('#pause-button').disabled=engine.phase==='matchOver';
  $('#versus-overlay').classList.toggle('hidden',flow.screen!=='versus');
  $('#versus-stage').textContent=STAGES.find(s=>s.id===flow.stage).name+' · '+(flow.mode==='training'?'자유 연습':settings.time+'초 / '+settings.wins+'선승');
  renderMenuSelections();
  if(view==='battle'){renderer.resize();updateBattle();}
  if(flow.screen==='multiplayer'){
    online.render();$('#navigation-hint').classList.add('hidden');
    $('#next-button').disabled=online.panel!=='options';$('#next-label').textContent=online.panel==='options'?'방식 선택':online.panel==='matching'?'랜덤 매칭':online.room?'상대 입장 대기':'방 만들기 / 코드 참가';
    if(online.panel==='matching')$('#back-label').textContent=['connecting','waiting','cancelling'].includes(online.client.matchmaking?.state)?'매칭 취소':'이전으로';
  }
  if(online.active){
    $('#next-button').disabled=!online.connected||flow.screen==='characters'&&flow.confirmed[online.seat]||flow.screen==='stage'&&online.seat!==0||flow.screen==='multiplayer';
    if(flow.screen==='characters')$('#next-label').textContent=flow.confirmed[online.seat]?'상대 선택 대기':'내 캐릭터 선택 완료';
    if(flow.screen==='stage')$('#next-label').textContent=online.seat===0?'대전 시작':'방장 무대 선택 대기';
    if(flow.screen==='versus'){$('#next-button').disabled=true;$('#next-label').textContent='동시 시작 준비';}
    if(flow.screen!=='battle')$('#back-label').textContent=flow.screen==='stage'||flow.confirmed[online.seat]?'선택 다시 하기':'방 나가기';
    $('#rematch-button').disabled=Boolean(online.room.players[online.seat]?.rematch);
    $('#rematch-button').textContent=online.room.players[online.seat]?.rematch?'상대 재대전 대기':'재대전 ↻';
  }else{$('#rematch-button').disabled=false;$('#rematch-button').textContent='재대전 ↻';}
  $('#pause-overlay h2').textContent=online.active?'대전 메뉴':'일시정지';
  $('#leave-button').textContent=online.active?'방 나가기':'캐릭터 다시 선택';
  syncMusic();
  if(focus)$('#game-shell').focus({preventScroll:true});
}

function renderMenuSelections(){
  const defs=flow.fighters.map(fighterById);
  for(const button of $$('[data-mode]')){
    const active=button.dataset.mode===flow.mode;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',active);
  }
  for(let i=0;i<2;i++){
    const def=defs[i],active=flow.screen==='characters'&&flow.seat===i;
    $('#preview-'+i).classList.toggle('choosing',active);
    $('#preview-'+i).classList.toggle('confirmed',flow.confirmed[i]);
    $('#preview-'+i).classList.toggle('waiting',!active&&!flow.confirmed[i]);
    $('#selection-status-'+i).textContent=flow.confirmed[i]?'선택 완료 ✓':active?'선택 중':online.active?'상대 선택 중':'선택 대기';
    const art=$('#preview-art-'+i);
    art.src='./assets/characters/'+def.art.idle+'.svg';art.alt=def.name;
    art.style.transform='scaleX('+((i===0?1:-1)/def.facing)+')';
    $('#preview-name-'+i).textContent=def.name;$('#preview-role-'+i).textContent=def.role;
    $('#preview-series-'+i).textContent=def.series;$('#preview-skill-'+i).textContent=def.special.name+' / '+def.super.name;
  }
  $('#opponent-label').textContent=flow.opponentLabel;
  $('#mode-name').textContent=MODES.find(m=>m.id===flow.mode)?.name||(flow.mode==='online'?'온라인 대전':'같은 기기 2인');
  for(const card of $$('.fighter-card')){
    const id=card.dataset.fighter,on=flow.fighters[flow.seat]===id;
    card.classList.toggle('selected',on);card.classList.toggle('selecting-p2',flow.seat===1);card.setAttribute('aria-pressed',on);
    card.querySelector('.selection-badges').innerHTML=flow.fighters.map((chosen,i)=>chosen===id?'<span class="selection-badge '+(i?'p2':'')+'">'+(i?flow.opponentLabel:'1P')+(flow.confirmed[i]?' ✓':'')+'</span>':'').join('');
  }
  for(const button of $$('[data-stage]')){
    button.disabled=online.active&&online.seat!==0;
    const on=button.dataset.stage===flow.stage;button.classList.toggle('selected',on);button.setAttribute('aria-pressed',on);
  }
  $('#match-p1').textContent=defs[0].name;$('#match-p2').textContent=defs[1].name;$('#match-opponent').textContent=flow.opponentLabel;
  $('#rule-summary').textContent=flow.mode==='training'?'시간 · 기력 무제한':settings.time+'초 · '+settings.wins+'선승';
  $('#difficulty-summary').textContent=online.active?'방장 설정':flow.mode==='local'?'로컬 2인 대전':flow.mode==='training'?'자유 연습':difficultyName[settings.difficulty]+' 난이도';
  if(online.active)$('#rule-summary').textContent=online.room.rules.time+'초 · '+online.room.rules.wins+'선승';
}

function choose(kind,id){
  if(online.active&&kind!=='mode'){online.choose(kind,id);renderMenuSelections();return;}
  if(kind==='mode')flow.chooseMode(id);
  else if(kind==='fighter')flow.chooseFighter(id);
  else flow.chooseStage(id);
  renderMenuSelections();
}
function buildMenus(){
  $('#archive-grid').innerHTML=ORIGINALS.map((s,i)=>'<article class="archive-card"><div class="archive-art"><img src="./assets/characters/'+s.art+'.svg" alt="'+s.title+' 원본 캐릭터"><img class="archive-prop" src="./assets/props/'+s.prop+'.svg" alt="원본 소품"></div><span class="archive-number">ORIGINAL 0'+(i+1)+'</span><h3>'+s.title+'</h3><p>플래시 제작 · '+s.animation+'<br>음악 · '+s.music+'</p><small>SWF '+s.version+' · '+s.fps+'fps · '+s.frames.toLocaleString('ko-KR')+'프레임</small><div><a href="'+s.page+'" target="_blank" rel="noopener noreferrer">보관소에서 보기 ↗</a><a href="./assets/originals/'+s.id+'.swf" download="'+s.title+'.swf">원본 SWF ↓</a></div></article>').join('');
  $('#mode-options').innerHTML=MODES.map((m,i)=>'<button class="mode-card" data-mode="'+m.id+'" aria-pressed="false"><span class="mode-card-number">0'+(i+1)+'</span><span class="mode-symbol">'+m.icon+'</span><span class="mode-card-title">'+m.name+'</span><span class="mode-card-note">'+m.note+' <b>→</b></span></button>').join('');
  $('#roster').innerHTML=FIGHTERS.map(f=>'<button class="fighter-card" data-fighter="'+f.id+'" aria-label="'+f.name+', '+f.series+', '+f.role+' 선택" aria-pressed="false"><span class="selection-badges"></span><span class="portrait"><img src="./assets/characters/'+f.art.idle+'.svg" alt=""></span><span class="fighter-name">'+f.name+'</span><small class="fighter-series">'+f.series+'</small></button>').join('');
  $('#stage-options').innerHTML=STAGES.map((s,i)=>'<button class="stage-card" data-stage="'+s.id+'" aria-pressed="false"><span class="stage-card-number">STAGE 0'+(i+1)+'</span><span class="stage-art stage-art-'+s.id+'">'+(s.prop?'<img src="./assets/stages/'+s.prop+'.svg" alt="">':'<span class="paper-star">✳</span>')+'<i class="stage-floor"></i></span><strong>'+s.name+'</strong><span class="stage-choose">선택 <b>→</b></span></button>').join('');
  for(const [kind,selector] of [['mode','[data-mode]'],['fighter','[data-fighter]'],['stage','[data-stage]']]){
    for(const button of $$(selector)){
      const id=button.dataset[kind];
      button.addEventListener('pointerenter',()=>{if(!modalOpen)choose(kind,id);});
      button.addEventListener('focus',()=>{if(!modalOpen)choose(kind,id);});
      button.addEventListener('click',()=>{if(!loaded||modalOpen)return;choose(kind,id);advance();});
    }
  }
}
function cycleSelection(delta){
  if(flow.screen==='multiplayer'){online.cycle(delta);return;}
  const items=flow.screen==='mode'?MODES:flow.screen==='characters'?FIGHTERS:flow.screen==='stage'?STAGES:null;if(!items)return;
  const selected=flow.screen==='mode'?flow.mode:flow.screen==='characters'?flow.fighters[flow.seat]:flow.stage;
  const index=items.findIndex(item=>item.id===selected);
  choose(flow.screen==='mode'?'mode':flow.screen==='characters'?'fighter':'stage',items[(index+delta+items.length)%items.length].id);menuSound();
}
function advance(){
  if(!loaded||modalOpen||flow.screen==='battle')return;
  if(flow.screen==='multiplayer'||online.active){online.advance();return;}
  if(flow.screen==='versus'){startBattle();return;}
  if(flow.screen==='characters')audio.select(fighterById(flow.fighters[flow.seat]).voice.select,flow.seat);else menuSound();
  flow.next();
  if(flow.screen==='multiplayer')online.enter();
  if(flow.screen==='versus'){buildEngine();versusRemaining=settings.motion?1400:600;}
  clearInput();renderNavigation(true);
}
function goBack(){
  if(modalOpen)return;
  if(flow.screen==='multiplayer'||online.active&&flow.screen!=='battle'){online.back();return;}
  if(flow.screen==='battle'){
    if(engine.phase==='matchOver')return reselect();
    return pauseGame();
  }
  flow.back();versusRemaining=0;clearInput();renderNavigation(true);menuSound();
}
function reselect(){if(online.active){online.reselect();return;}flow.characters();versusRemaining=0;buildEngine();renderNavigation(true);}
function home(){if(online.client.socket||flow.mode==='online')online.leave();flow.home();versusRemaining=0;buildEngine();renderNavigation(true);}
function rematch(){if(online.active){online.rematch();return;}flow.rematch();buildEngine();versusRemaining=settings.motion?1400:600;renderNavigation(true);}
function startBattle(){
  if(online.active||flow.screen!=='versus'||modalOpen)return;
  versusRemaining=0;flow.next();clearInput();engine.start();renderNavigation(true);
}
function pauseGame(){
  if(flow.screen!=='battle')return;
  if(online.active){online.menuOpen=!online.menuOpen;clearInput();updateBattle();renderNavigation();return;}
  clearInput();engine.togglePause();for(const event of engine.drainEvents())handleEvent(event);
  updateBattle();renderNavigation();
  if(engine.paused)$('#resume-button').focus({preventScroll:true});else $('#game-shell').focus({preventScroll:true});
}

function refreshHUD(){
  for(let i=0;i<2;i++){
    const p=engine.players[i],hp=Math.max(0,p.hp/p.def.health*100),meter=Math.round(p.meter),track=$('#p'+(i+1)+'-health');
    track.querySelector('.health-fill').style.width='calc('+hp+'% - '+(hp>0?4:0)+'px)';
    track.querySelector('.health-ghost').style.width='calc('+hp+'% - '+(hp>0?4:0)+'px)';
    track.setAttribute('aria-valuenow',Math.round(hp));
    $('#p'+(i+1)+'-meter').style.width=meter+'%';$('#p'+(i+1)+'-meter').classList.toggle('full',meter>=100);
    $('#p'+(i+1)+'-meter-label').textContent=meter>=100?'MAX!':meter;
  }
  $('#timer').textContent=flow.mode==='training'?'∞':String(Math.ceil(engine.remaining)).padStart(2,'0');
  $('.timer-hud').classList.toggle('urgent',flow.mode!=='training'&&engine.remaining<=10);
  $('#round-label').textContent=flow.mode==='training'?'FREE TRAINING':'ROUND '+String(engine.round).padStart(2,'0');
  const key=engine.wins+'-'+engine.options.wins;
  if(roundKey!==key){roundKey=key;for(let i=0;i<2;i++)$('#p'+(i+1)+'-rounds').innerHTML=Array.from({length:engine.options.wins},(_,n)=>'<i class="'+(n<engine.wins[i]?'won':'')+'"></i>').join('');}
}
function updateBattle(){
  const phase=engine.phase,paused=engine.paused,menuPaused=online.active?online.menuOpen:paused;
  $('#pause-overlay').classList.toggle('hidden',!menuPaused||modalOpen||flow.screen!=='battle');
  $('#result-overlay').classList.toggle('hidden',phase!=='matchOver'||flow.screen!=='battle');
  $('#round-overlay').classList.toggle('hidden',!['intro','roundOver'].includes(phase)||paused||flow.screen!=='battle');
  if(phase==='intro'){
    $('#round-announcement').textContent=flow.mode==='training'?'TRAINING':'ROUND '+String(engine.round).padStart(2,'0');
    $('#round-message').textContent='';
  }else if(phase==='roundOver'){
    $('#round-announcement').textContent=engine.remaining<=0?'TIME OVER!':'K.O.!';
    $('#round-message').textContent=engine.roundWinner===null?'무승부':engine.players[engine.roundWinner].def.name+' 승';
  }
  $('#pause-button').disabled=phase==='matchOver';
  $('#back-label').textContent=flow.screen==='battle'?(phase==='matchOver'?'캐릭터 선택':online.active?'대전 메뉴':paused?'이어서':'일시정지'):'이전으로';
  if(lastPhase!==phase){
    lastPhase=phase;
    $('#game-status').textContent=phase==='intro'?'대전 준비':phase==='roundOver'?'라운드 종료':phase==='matchOver'?'경기 종료':online.active?'온라인 대전 · 내 자리 '+(online.seat+1)+'P':flow.mode==='local'?'로컬 2인 대전':'CPU 대전';
    if(phase==='matchOver'){
      $('#result-title').textContent=engine.players[engine.matchWinner].def.name+' 승';
      $('#result-score').textContent=engine.wins[0]+' : '+engine.wins[1];
    }
  }
  if(phase==='fighting'&&online.active)$('#game-status').textContent='온라인 · 내 자리 '+(online.seat+1)+'P'+(online.client.ping===null?'':' · '+online.client.ping+'ms');
  if(phase==='fighting'&&flow.mode==='training')$('#game-status').textContent='연습 중 · 누적 피해 '+engine.players[0].damageDealt;
}
function handleEvent(event){
  renderer.onEvent(event);
  const audioLifecycle=['pause','roundStart','matchEnd'].includes(event.type);
  if(audioLifecycle||!modalOpen&&(!online.active||audio.context?.state==='running'))audio.onEvent(event,engine);
  if(event.type==='roundStart')clearInput();
  const index=online.active?(event.player===online.seat?0:null):event.player;
  if(index===null)return;
  if(['attack','denied'].includes(event.type))combatInputs[index]?.consume();
  else if(['jump','dash'].includes(event.type))combatInputs[index]?.consume(event.type);
  if(['attack','dash','jump','denied'].includes(event.type)){
    const group=event.type==='attack'?['light','heavy','special','super','throw']:event.type==='denied'?['super']:[event.type];
    for(const action of group)for(const key of bindings[index]?.[action]||[])pressed.delete(key);
    if(index===0)for(const action of group)touchPressed.delete(action);
  }
}

$('#next-button').addEventListener('click',advance);$('#back-button').addEventListener('click',goBack);
$('#skip-versus').addEventListener('click',startBattle);$('#pause-button').addEventListener('click',pauseGame);
$('#resume-button').addEventListener('click',pauseGame);$('#leave-button').addEventListener('click',reselect);
$('#home-button').addEventListener('click',home);$('#reselect-button').addEventListener('click',reselect);
$('#rematch-button').addEventListener('click',rematch);$('#result-home-button')?.addEventListener('click',home);
$('#brand-button').addEventListener('click',()=>flow.screen==='battle'&&engine.phase!=='matchOver'?pauseGame():home());
$('#fullscreen-button').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#game-shell').requestFullscreen();}catch{toast('이 브라우저에서는 전체화면을 사용할 수 없어요.');}});
const resizeObserver=new ResizeObserver(entries=>{
  const {width,height}=entries[0].contentRect;
  document.documentElement.style.setProperty('--game-width',width+'px');document.documentElement.style.setProperty('--game-height',height+'px');
  renderer.resize();
});
resizeObserver.observe($('#game-shell'));
function updateSoundButton(){$('#sound-button').classList.toggle('muted',settings.muted);$('#sound-button').setAttribute('aria-label',settings.muted?'소리 켜기':'소리 끄기');}
$('#sound-button').addEventListener('click',async()=>{settings.muted=!settings.muted;saveSettings();await unlockAudio();if(!settings.muted)audio.tone('ui');});

function openDialog(id){
  if(modalOpen)return;
  audio.stopVoices();
  clearInput();modalOpen=true;resumeAfterDialog=!online.active&&flow.screen==='battle'&&!engine.paused&&engine.phase!=='matchOver';
  if(resumeAfterDialog){engine.paused=true;audio.pause(true);}
  if(id==='moves-dialog'){
    if(flow.screen==='characters')moveFighter=flow.fighters[flow.seat];
    else if(flow.screen==='battle')moveFighter=engine.players[online.active?online.seat:0].def.id;
    renderMoveDetails();
  }
  if(id==='settings-dialog')for(const [key,value] of Object.entries(settings)){
    const input=$('#settings-form').elements.namedItem(key);if(!input)continue;
    if(input.type==='checkbox')input.checked=value;else input.value=value;
  }
  for(const name of ['time','wins','difficulty']){
    const field=$('#settings-form').elements.namedItem(name);
    field.disabled=online.active&&(name==='difficulty'||online.seat!==0||!['waiting','characters','stage'].includes(online.room.phase));
    if(online.active&&name!=='difficulty')field.value=online.room.rules[name];
  }
  $('#'+id).showModal();updateBattle();
}
for(const button of $$('[data-open]'))button.addEventListener('click',()=>openDialog(button.dataset.open));
for(const dialog of $$('dialog')){
  dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{
    audio.stopVoice('preview');
    modalOpen=false;clearInput();if(resumeAfterDialog){engine.paused=false;audio.pause(false);}resumeAfterDialog=false;
    if(flow.screen==='battle')updateBattle();
  });
}
$('#settings-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  for(const key of ['time','wins','volume','music'])settings[key]=Number(form.elements.namedItem(key).value);
  settings.difficulty=form.elements.difficulty.value;
  for(const key of ['musicOn','motion','hitboxes'])settings[key]=form.elements.namedItem(key).checked;
  saveSettings();renderMenuSelections();
  if(online.active&&online.seat===0)online.client.send({type:'rules',rules:{time:settings.time,wins:settings.wins}});
  if(flow.screen==='versus')buildEngine();
  $('#settings-dialog').close();toast('설정 저장');
});
function renderMoveDetails(){
  const f=fighterById(moveFighter),power=f.power;
  $('#move-fighter-tabs').innerHTML=FIGHTERS.map(d=>'<button data-move-fighter="'+d.id+'" class="'+(d.id===f.id?'selected':'')+'" aria-pressed="'+(d.id===f.id)+'">'+d.name+'</button>').join('');
  for(const button of $$('[data-move-fighter]'))button.addEventListener('click',()=>{moveFighter=button.dataset.moveFighter;renderMoveDetails();});
  const extras=COMMAND_HELP.map(help=>{
    const move=TECHNIQUES[f.id][help.kind],hits=move.hitsAt?.length||move.shots?.length||1;
    const damage=Array.from({length:hits},(_,i)=>Math.round(move.damage*power*Math.max(.5,Math.pow(.9,i)))).reduce((sum,value)=>sum+value,0);
    return '<tr><td>'+move.name+'</td><td><span class="command-keys">1P '+help.keys[0]+'<br>2P '+help.keys[1]+'</span></td><td>최대 '+damage+(help.kind==='burst'?'<small> · 기력 25</small>':'')+'</td></tr>';
  }).join('');
  $('#move-details').innerHTML='<img class="move-portrait" src="./assets/characters/'+f.art.idle+'.svg" alt="'+f.name+'"><div><h3>'+f.name+'<span class="move-role">'+f.role+' · 체력 '+f.health+'</span></h3><table><thead><tr><th>기술</th><th>1P / 2P</th><th>피해*</th></tr></thead><tbody><tr><td>약공격 / 강공격</td><td><kbd>J</kbd> <kbd>K</kbd> / <kbd>1</kbd> <kbd>2</kbd></td><td>'+Math.round(MOVES.light.damage*power)+' / '+Math.round(MOVES.heavy.damage*power)+'</td></tr><tr><td>'+f.special.name+'</td><td><kbd>L</kbd> / <kbd>3</kbd></td><td>'+Math.round(f.special.damage*power)+'</td></tr><tr><td>'+f.super.name+'</td><td><kbd>I</kbd> / <kbd>0</kbd></td><td>'+Math.round(f.super.damage*power)+' <small>· 기력 100</small></td></tr>'+extras+'<tr><td>가드 깨는 잡기</td><td><kbd>U</kbd> / <kbd>4</kbd></td><td>'+Math.round(MOVES.throw.damage*power)+'</td></tr></tbody></table><p class="command-guide">약 → 약 → 강 → 필살 · 필살 명중 → 초필살<br>↓↘→ + 약: 약+필살 기술 · 방향은 상대 기준<br>* 연속 타격은 콤보 보정에 따라 피해가 줄어듭니다.</p><button class="voice-preview" id="voice-preview">▷ 원본 음원 듣기</button></div>';
  $('#voice-preview').addEventListener('click',()=>audio.preview(f.voice.select));
}
$('#fighter-moves-button').addEventListener('click',()=>{moveFighter=flow.fighters[flow.seat];openDialog('moves-dialog');});

window.addEventListener('keydown',event=>{
  if(modalOpen||event.target.matches('input,select,textarea')||event.ctrlKey||event.metaKey||event.altKey)return;
  if(flow.screen==='multiplayer'&&event.code==='Enter'&&event.target.closest('button')){event.preventDefault();if(!event.repeat)event.target.closest('button').click();return;}
  if(flow.screen!=='battle'){
    const left=['ArrowLeft','ArrowUp','KeyA','KeyW'].includes(event.code),right=['ArrowRight','ArrowDown','KeyD','KeyS'].includes(event.code);
    if(left||right){event.preventDefault();if(!event.repeat)cycleSelection(left?-1:1);return;}
    if(['Escape','Backspace','KeyK','Digit2','Numpad2'].includes(event.code)){event.preventDefault();if(!event.repeat)goBack();return;}
    if(['Enter','Space','KeyJ','Digit1','Numpad1'].includes(event.code)){
      if(event.target.closest('button')&&!event.target.closest('[data-mode],[data-fighter],[data-stage]')&&['Enter','Space'].includes(event.code))return;
      event.preventDefault();if(!event.repeat)advance();return;
    }
    return;
  }
  if(event.code==='Escape'){event.preventDefault();if(!event.repeat&&engine.phase!=='matchOver')pauseGame();return;}
  if(engine.phase==='matchOver'){
    if(event.code==='Enter'&&!event.target.closest('button')){event.preventDefault();rematch();}return;
  }
  if(gameKeys.has(event.code)&&!engine.paused&&!online.menuOpen){event.preventDefault();held.add(event.code);if(!event.repeat)pressed.set(event.code,performance.now()+180);}
});
window.addEventListener('keyup',event=>held.delete(event.code));
function pauseOnBlur(){clearInput();if(online.active)return;if(flow.screen==='battle'&&!engine.paused&&!modalOpen&&engine.phase!=='matchOver')pauseGame();}
window.addEventListener('blur',pauseOnBlur);document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseOnBlur();});
for(const button of $$('[data-touch]')){
  button.addEventListener('pointerdown',event=>{
    event.preventDefault();if(flow.screen!=='battle'||engine.phase!=='fighting'||engine.paused)return;
    button.setPointerCapture(event.pointerId);const action=button.dataset.touch;touchHeld.add(action);touchPressed.set(action,performance.now()+180);button.classList.add('pressed');
  });
  const release=()=>{touchHeld.delete(button.dataset.touch);button.classList.remove('pressed');};
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
}
function readKeyboard(index,now){
  const binding=bindings[index],input={};
  const down=action=>binding[action].some(k=>held.has(k)),edge=action=>binding[action].some(k=>(pressed.get(k)||0)>now);
  input.move=(down('right')?1:0)-(down('left')?1:0);input.guard=down('guard');input.down=down('guard');
  for(const action of ['jump','light','heavy','special','super','dash','throw'])input[action]=edge(action);
  if(index===0){
    input.move=Math.sign(input.move+(touchHeld.has('right')?1:0)-(touchHeld.has('left')?1:0));input.guard||=touchHeld.has('guard');input.down||=touchHeld.has('guard');
    for(const action of ['jump','light','heavy','special','super','dash','throw'])input[action]||=(touchPressed.get(action)||0)>now;
  }
  return input;
}
function readGamepad(index,input){
  const pad=navigator.getGamepads?.()[index];if(!pad)return input;
  const previous=padPrevious.get(pad.index)||[],down=n=>Boolean(pad.buttons[n]?.pressed),edge=n=>down(n)&&!previous[n];
  const axis=pad.axes[0]||0,left=down(14)||axis<-.4,right=down(15)||axis>.4;
  const buttons=pad.buttons.map(b=>b.pressed);buttons.left=left;buttons.right=right;buttons.axisJump=(pad.axes[1]||0)<-.55;padPrevious.set(pad.index,buttons);
  if(modalOpen)return input;
  if(flow.screen!=='battle'){
    if(index===0||flow.mode==='local'&&flow.seat===1){
      if(left&&!previous.left)cycleSelection(-1);else if(right&&!previous.right)cycleSelection(1);
      if(edge(1))goBack();else if(edge(0)||edge(9))advance();
    }
    return input;
  }
  if(engine.phase==='matchOver'){if(edge(0)||edge(9))rematch();return input;}
  if(left)input.move=-1;if(right)input.move=1;
  input.guard||=down(6)||down(7)||down(13);input.down||=down(13);
  for(const [action,button] of Object.entries({light:0,heavy:1,special:2,super:3,throw:4,dash:5,jump:12}))input[action]||=edge(button);
  if(buttons.axisJump&&!previous.axisJump)input.jump=true;
  if(edge(9))pauseGame();
  return input;
}
window.addEventListener('gamepadconnected',()=>toast('패드 연결 · 방향키 선택 · A 결정 · B 이전'));

function frame(now){
  const dt=previousTime?Math.min((now-previousTime)/1000,.1):STEP;previousTime=now;
  if(loaded){
    if(!online.active&&flow.screen==='versus'&&!modalOpen&&!document.hidden){versusRemaining-=dt*1000;if(versusRemaining<=0)startBattle();}
    if(flow.screen==='battle'&&online.active){
      if(!modalOpen&&!online.menuOpen&&!engine.paused){
        const raw=readGamepad(0,readKeyboard(0,now));
        const input=combatInputs[0].sample(raw,now,engine.players[online.seat].facing);
        if(online.client.input(input,now))combatInputs[0].consume();
      }
      pressed.clear();touchPressed.clear();engine.animate?.(dt);refreshHUD();updateBattle();
    }else if(flow.screen==='battle'){
      accumulator+=dt;
      while(accumulator>=STEP){
        const inputs=[0,1].map(i=>combatInputs[i].sample(readGamepad(i,readKeyboard(i,now)),now,engine.players[i].facing));
        pressed.clear();touchPressed.clear();
        engine.step(inputs);for(const event of engine.drainEvents())handleEvent(event);accumulator-=STEP;
      }
      refreshHUD();updateBattle();
    }else{
      accumulator=0;readGamepad(0,{});readGamepad(1,{});
    }
    online.clock();
    for(const [key,expiry] of pressed)if(expiry<now)pressed.delete(key);
    for(const [key,expiry] of touchPressed)if(expiry<now)touchPressed.delete(key);
    if(['versus','battle'].includes(flow.screen))renderer.render(engine,dt);
  }
  requestAnimationFrame(frame);
}

buildMenus();buildEngine();renderNavigation();updateSoundButton();
window.flashVersus=Object.freeze({getState:()=>({...engine.snapshot(),menu:flow.snapshot(),online:online.client.state()})});
try{
  await Promise.all([renderer.load(),document.fonts.load('18px Gaegu')]);
  loaded=true;$('#loading-state').classList.add('hidden');renderNavigation();online.bootstrap();
}catch(error){$('#loading-state').textContent='에셋 로딩 실패. 서버 실행 상태를 확인하세요.';console.error(error);}
requestAnimationFrame(frame);
