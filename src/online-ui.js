import {OnlineClient} from './online.js';
import {fighterById} from './data.js';
import {formatMatchTime} from './matchmaking.js';

const $=s=>document.querySelector(s);
export class OnlineUI{
  constructor(flow,settings,hooks){
    this.flow=flow;this.settings=settings;this.hooks=hooks;this.panel='options';this.option=0;this.menuOpen=false;this.message='';
    this.client=new OnlineClient({
      onRoom:(room,seat)=>this.sync(room,seat),
      onFrame:(frame,events,epoch)=>hooks.frame(frame,events,epoch),
      onMatchmaking:status=>this.matching(status),
      onStatus:status=>{if(status==='reconnecting'&&this.previousStatus!==status)this.reconnectUntil=performance.now()+15000;this.previousStatus=status;this.render();hooks.status?.();},
      onError:message=>{this.message=message;this.busy=false;this.render();},
    });
    if(!this.client.available)this.option=1;
    for(const button of document.querySelectorAll('[data-multiplayer]'))button.addEventListener('click',()=>this.pick(button.dataset.multiplayer));
    $('#find-random-match').addEventListener('click',()=>this.search());
    $('#cancel-random-match').addEventListener('click',()=>this.client.cancelMatch());
    $('#retry-random-match').addEventListener('click',()=>this.search());
    $('#match-back-button').addEventListener('click',()=>this.back());
    $('#find-next-match').addEventListener('click',()=>{this.client.leave();this.search();});
    $('#create-room').addEventListener('click',()=>this.create());
    $('#join-room-form').addEventListener('submit',event=>{event.preventDefault();this.join();});
    $('#room-code-input').addEventListener('input',event=>event.target.value=event.target.value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6));
    $('#copy-room-code').addEventListener('click',()=>this.copy(false));
    $('#copy-room-link').addEventListener('click',()=>this.copy(true));
    $('#online-leave-button').addEventListener('click',()=>this.back());
    $('#network-leave-button').addEventListener('click',()=>hooks.home());
  }
  get room(){return this.client.room;}
  get seat(){return this.client.seat;}
  get active(){return Boolean(this.room)&&this.flow.mode==='online';}
  get connected(){return this.client.status==='connected';}
  enter(){this.panel='options';this.flow.screen='multiplayer';this.flow.mode='multiplayer';this.message='';this.render();}
  pick(kind){
    if(kind==='local'){if(this.client.socket)this.client.leave();this.flow.chooseMultiplayer('local');this.hooks.navigate(true);return;}
    if(!this.client.available)return;
    this.flow.chooseMultiplayer('online');this.panel='connect';this.message='';this.render();this.hooks.navigate(true);
  }
  async search(){
    if(this.room||['connecting','waiting','cancelling'].includes(this.client.matchmaking?.state))return;
    this.message='';this.panel='matching';this.flow.mode='online';this.flow.screen='multiplayer';
    this.hooks.unlock();this.render();this.hooks.navigate(true);
    try{await this.client.findMatch();}catch(error){this.message=error.message;this.busy=false;this.render();}
  }
  matching(status){
    this.busy=false;
    if(this.room)return;
    this.flow.mode='online';this.flow.screen='multiplayer';
    if(status.state==='cancelled'){this.panel='connect';this.message='매칭을 취소했습니다.';}
    else{this.panel='matching';if(status.state!=='error')this.message='';}
    this.render();this.hooks.navigate();
  }
  async create(){
    if(this.busy||this.room)return;
    this.message='';this.busy=true;this.hooks.unlock();this.render();
    try{await this.client.create({time:this.settings.time,wins:this.settings.wins});}catch(error){this.message=error.message;this.busy=false;this.render();}
  }
  async join(){
    const code=$('#room-code-input').value.trim().toUpperCase();
    if(!/^[A-Z2-9]{6}$/.test(code)){this.message='방 코드 6자리를 입력해 주세요.';this.render();return;}
    if(this.busy||this.room)return;
    this.message='';this.busy=true;this.hooks.unlock();this.render();
    try{await this.client.join(code);}catch(error){this.message=error.message;this.busy=false;this.render();}
  }
  sync(room,seat){
    this.busy=false;
    if(!room){this.panel='connect';this.flow.screen='multiplayer';this.render();this.hooks.navigate();return;}
    this.message='';this.flow.mode='online';this.flow.seat=seat;
    this.flow.fighters=room.players.map((p,i)=>p?.fighter||(i?'hacker':'tuna'));
    this.flow.confirmed=room.players.map(p=>Boolean(p?.ready));this.flow.stage=room.stage;
    const waiting=room.phase==='waiting'||room.players.some(p=>p&&!p.connected)&&!['battle','versus','result'].includes(room.phase);
    this.flow.screen=waiting?'multiplayer':room.phase==='result'?'battle':room.phase;
    this.panel='waiting';this.menuOpen=false;
    this.reconnectUntil=performance.now()+room.reconnectMs;
    this.render();this.hooks.navigate();
  }
  choose(kind,id){
    if(!this.active||!this.connected)return;
    if(kind==='fighter'&&this.room.phase==='characters'&&!this.room.players[this.seat].ready){
      this.flow.fighters[this.seat]=id;this.client.send({type:'choose',fighter:id});
    }
    if(kind==='stage'&&this.room.phase==='stage'&&this.seat===0){this.flow.stage=id;this.client.send({type:'stage',stage:id});}
  }
  advance(){
    if(!this.active){
      if(this.panel==='options')this.pick(this.option?'local':'online');
      else if(this.panel==='connect'){if(document.activeElement?.id==='join-room')this.join();else if(document.activeElement?.id==='create-room')this.create();else this.search();}
      else if(this.panel==='matching'){if(['connecting','waiting','cancelling'].includes(this.client.matchmaking?.state))this.client.cancelMatch();else this.search();}
      return;
    }
    if(!this.connected)return;
    if(this.room.phase==='characters'&&!this.room.players[this.seat].ready){this.hooks.select?.(this.flow.fighters[this.seat]);this.client.send({type:'ready'});}
    if(this.room.phase==='stage'&&this.seat===0)this.client.send({type:'start'});
  }
  back(){
    if(this.panel==='matching'&&!this.active){
      if(['connecting','waiting','cancelling'].includes(this.client.matchmaking?.state))this.client.cancelMatch();
      else{this.client.clearMatchmaking();this.panel='connect';this.message='';this.render();this.hooks.navigate(true);}
      return;
    }
    if(this.active){
      if(this.room.phase==='stage'){this.client.send({type:'ready',ready:false});return;}
      if(this.room.phase==='characters'&&this.room.players[this.seat].ready){this.client.send({type:'ready',ready:false});return;}
      this.client.leave();this.panel='connect';this.flow.screen='multiplayer';this.flow.mode='online';this.hooks.clear();this.hooks.navigate(true);this.render();return;
    }
    if(this.panel==='waiting'){this.client.leave();this.panel='connect';this.flow.mode='online';this.flow.screen='multiplayer';this.render();this.hooks.navigate(true);return;}
    if(this.panel==='connect'){this.client.leave();this.panel='options';this.flow.mode='multiplayer';this.render();this.hooks.navigate(true);return;}
    this.flow.home();this.hooks.navigate(true);
  }
  leave(){this.client.leave();this.panel='options';this.menuOpen=false;this.message='';}
  rematch(){if(this.active)this.client.send({type:'rematch'});}
  reselect(){if(this.room?.phase==='result')this.client.send({type:'reselect'});else this.back();}
  cycle(delta){
    if(this.panel==='options'){this.option=this.client.available?(this.option+delta+2)%2:1;this.render();}
  }
  render(){
    if(!$('#multiplayer-screen'))return;
    $('#multiplayer-options').classList.toggle('hidden',this.panel!=='options');
    $('#online-connect').classList.toggle('hidden',this.panel!=='connect');
    $('#online-waiting').classList.toggle('hidden',this.panel!=='waiting');
    $('#online-search').classList.toggle('hidden',this.panel!=='matching');
    $('#multiplayer-title .marker').textContent=this.panel==='options'?'멀티플레이':this.panel==='connect'?'온라인 대전':this.panel==='matching'?'랜덤 매칭':'대기실';
    for(const button of document.querySelectorAll('[data-multiplayer]')){
      button.classList.toggle('selected',button.dataset.multiplayer===(this.option?'local':'online'));
      if(button.dataset.multiplayer==='online'){
        button.disabled=!this.client.available;
        button.querySelector('span:last-of-type').textContent=this.client.available?'랜덤 매칭 / 방 코드':'준비 중';
      }
    }
    $('#online-message').textContent=this.message||this.room?.notice||'';
    const connecting=['connecting','reconnecting'].includes(this.client.status);
    $('#create-room').disabled=Boolean(this.busy)||connecting;
    $('#join-room').disabled=Boolean(this.busy)||connecting;
    $('#find-random-match').disabled=Boolean(this.busy)||connecting;
    const match=this.client.matchState(),searching=['connecting','waiting','cancelling'].includes(match?.state);
    $('#online-search').classList.toggle('searching',searching);
    $('#matching-state').textContent=match?.state==='timeout'?'상대를 찾지 못했습니다.':match?.state==='disconnected'?'서버 연결이 끊겼습니다.':match?.state==='error'?'매칭을 시작할 수 없습니다.':match?.state==='cancelling'?'매칭을 취소하는 중':match?.state==='connecting'?'대기열에 연결하는 중':'상대를 찾는 중';
    $('#matching-time').textContent=formatMatchTime(match?.remainingMs||0);
    $('#matching-note').textContent=searching?'최대 3분 동안 기다립니다.':'다시 찾거나 다른 온라인 방식으로 참가할 수 있습니다.';
    $('#cancel-random-match').classList.toggle('hidden',!searching);$('#cancel-random-match').disabled=match?.state==='cancelling';
    $('#retry-random-match').classList.toggle('hidden',searching);$('#match-back-button').classList.toggle('hidden',searching);
    $('#find-next-match').classList.toggle('hidden',!(this.room?.kind==='random'&&this.room.phase==='waiting'&&this.room.players.filter(Boolean).length===1));
    $('#create-room').textContent=this.busy?'연결 중…':'방 만들기 →';
    $('#online-status').textContent=connecting?(this.client.status==='reconnecting'?'연결 복구 중…':'서버에 연결하는 중…'):this.connected?'서버 연결됨':this.panel==='options'?'':'방 코드로 함께 접속';
    if(this.room){
      $('#room-code-value').value=this.room.code;
      $('#room-player-list').innerHTML=this.room.players.map((player,i)=>{
        const def=player&&fighterById(player.fighter);
        return '<article class="room-player '+(i===this.seat?'you':'')+'"><span class="player-tag '+(i?'opponent':'')+'">'+(i===this.seat?'나 · ':'')+(i?'2P':'1P · 방장')+'</span><div class="room-player-art">'+(def?'<img src="./assets/characters/'+def.art.idle+'.svg" alt="">':'<span>?</span>')+'</div><strong>'+(def?def.name:'참가 대기')+'</strong><small>'+(player?player.connected?'접속됨':'재접속 대기':'방 코드를 공유하세요')+'</small></article>';
      }).join('');
      $('#room-wait-note').textContent=this.room.players.some(p=>p&&!p.connected)?'연결이 돌아오기를 기다립니다.':'상대가 입장하면 캐릭터 선택으로 이동합니다.';
    }
    const inBattle=this.active&&['battle','versus','result'].includes(this.room.phase);
    const interrupted=inBattle&&(this.client.status==='reconnecting'||this.room.players.some(p=>p&&!p.connected));
    $('#network-overlay').classList.toggle('hidden',!interrupted);
    $('#network-message').textContent=this.client.status==='reconnecting'?'서버에 다시 연결하는 중':'상대가 다시 연결하기를 기다리는 중';
    $('#network-seconds').textContent=Math.max(0,Math.ceil((this.reconnectUntil-performance.now())/1000))+'초';
  }
  clock(){
    if(this.panel==='matching'){
      const text=formatMatchTime(this.client.matchState()?.remainingMs||0);
      if($('#matching-time').textContent!==text)$('#matching-time').textContent=text;
    }
    if($('#network-overlay').classList.contains('hidden'))return;
    const text=Math.max(0,Math.ceil((this.reconnectUntil-performance.now())/1000))+'초';
    if($('#network-seconds').textContent!==text)$('#network-seconds').textContent=text;
  }
  async copy(link){
    if(!this.room)return;
    const url=new URL(location.href);url.searchParams.set('room',this.room.code);
    try{await navigator.clipboard.writeText(link?url.href:this.room.code);this.message=link?'초대 링크를 복사했습니다.':'방 코드를 복사했습니다.';}
    catch{$('#room-code-value').select();this.message='선택된 방 코드를 복사해 주세요.';}
    this.render();
  }
  bootstrap(){
    if(!this.client.available)return;
    const code=new URL(location.href).searchParams.get('room');
    if(this.client.saved){
      this.flow.mode='online';this.flow.screen='multiplayer';this.panel='waiting';this.reconnectUntil=performance.now()+15000;
      this.client.resume()?.catch(()=>{});this.hooks.navigate();this.render();
    }else if(code&&/^[A-Z2-9]{6}$/i.test(code)){
      this.flow.mode='online';this.flow.screen='multiplayer';this.panel='connect';$('#room-code-input').value=code.toUpperCase();this.hooks.navigate();this.render();
    }
  }
}
