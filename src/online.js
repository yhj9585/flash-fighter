import {MATCH_WAIT_MS} from './matchmaking.js';
import {ONLINE_URL} from './deployment.js';

const EDGES=['jump','dash','throw','light','heavy','special','super','command','burst'];
const SAVE_KEY='flash-versus-online-seat-v1';

export class OnlineClient{
  constructor(callbacks={},endpoint=ONLINE_URL){
    Object.assign(this,callbacks);this.socket=null;this.room=null;this.seat=0;this.status='idle';this.ping=null;
    this.endpoint=endpoint;
    this.saved=null;try{this.saved=JSON.parse(sessionStorage.getItem(SAVE_KEY)||'null');}catch{}
    this.seq=0;this.number=-1;this.epoch=-1;this.manual=false;this.lastInputAt=0;this.lastHeld='';this.retry=0;this.matchmaking=null;this.matchDeadline=0;this.searchRequest=0;
  }
  get available(){return Boolean(this.endpoint);}
  setStatus(status){this.status=status;this.onStatus?.(status);}
  save(value){this.saved=value;try{if(value)sessionStorage.setItem(SAVE_KEY,JSON.stringify(value));else sessionStorage.removeItem(SAVE_KEY);}catch{}}
  send(message){if(this.socket?.readyState===WebSocket.OPEN){this.socket.send(JSON.stringify(message));return true;}return false;}
  connect(){
    if(!this.available)return Promise.reject(new Error('온라인 대전은 준비 중입니다. 같은 기기 2인은 바로 플레이할 수 있어요.'));
    if(this.socket?.readyState===WebSocket.OPEN)return Promise.resolve();
    if(this.connecting)return this.connecting;
    this.manual=false;this.setStatus(this.saved?'reconnecting':'connecting');
    this.connecting=new Promise((resolve,reject)=>{
      const url=new URL(this.endpoint,location.href);
      if(url.protocol==='https:')url.protocol='wss:';else if(url.protocol==='http:')url.protocol='ws:';
      const socket=new WebSocket(url);this.socket=socket;
      const timeout=setTimeout(()=>{socket.close();reject(new Error('서버 연결 시간이 초과되었습니다.'));},this.endpoint.startsWith('/')?10000:90000);
      socket.onopen=()=>{
        if(this.socket!==socket)return;
        clearTimeout(timeout);this.connecting=null;this.lastMessage=performance.now();this.setStatus('connected');
        clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>{
          if(performance.now()-this.lastMessage>8000){socket.close();return;}
          this.send({type:'ping',sent:performance.now()});
        },2000);
        if(this.saved)this.send({type:'resume',...this.saved});
        resolve();
      };
      socket.onmessage=event=>{
        if(this.socket!==socket)return;
        this.lastMessage=performance.now();let packet;
        try{packet=JSON.parse(event.data);}catch{return;}
        if(packet.type==='pong'){this.ping=Math.round(performance.now()-packet.sent);this.onStatus?.(this.status);return;}
        if(packet.type==='matchmaking'){if(!this.room)this.setMatchmaking(packet);return;}
        if(packet.type==='joined'){
          this.searchRequest++;this.matchmaking=null;this.matchDeadline=0;
          this.save({code:packet.room.code,token:packet.token});this.retry=0;this.seq=0;
          this.epoch=-1;this.number=-1;this.setStatus('connected');
        }
        if(packet.type==='room'||packet.type==='joined'){
          this.room=packet.room;this.seat=packet.seat;this.onRoom?.(this.room,this.seat);return;
        }
        if(packet.type==='frame'){
          if(!this.room)return;
          if(this.epoch!==packet.epoch){this.epoch=packet.epoch;this.number=-1;}
          if(packet.number<=this.number)return;
          this.number=packet.number;this.onFrame?.(packet.frame,packet.events,packet.epoch);return;
        }
        if(packet.type==='left'){this.room=null;this.save(null);this.onRoom?.(null,this.seat);return;}
        if(packet.type==='error'){
          if(['resume_expired','room_missing','room_expired'].includes(packet.code)&&this.saved){
            this.room=null;this.save(null);this.onRoom?.(null,this.seat);
          }
          if(this.matchmaking&&!this.room)this.setMatchmaking({state:'error'});
          this.onError?.(packet.message);return;
        }
      };
      socket.onerror=()=>{};
      socket.onclose=event=>{
        clearTimeout(timeout);
        if(this.socket!==socket)return;
        clearInterval(this.heartbeat);this.connecting=null;
        if(event.code===4001){this.room=null;this.save(null);this.setStatus('idle');this.onRoom?.(null,0);this.onError?.('다른 창에서 같은 자리로 접속했습니다.');return;}
        if(this.manual){this.setStatus('idle');return;}
        if(['connecting','waiting','cancelling'].includes(this.matchmaking?.state)&&!this.room)this.setMatchmaking({state:'disconnected'});
        if(this.saved){
          this.setStatus('reconnecting');clearTimeout(this.retryTimer);
          this.retryTimer=setTimeout(()=>this.connect().catch(()=>{}),Math.min(4000,600*2**Math.min(3,this.retry++)));
        }else{this.setStatus('disconnected');this.onError?.('서버에 연결할 수 없습니다. 서버 실행 상태를 확인해 주세요.');}
        reject(new Error('서버에 연결할 수 없습니다.'));
      };
    });
    return this.connecting;
  }
  matchState(){
    if(!this.matchmaking)return null;
    return {state:this.matchmaking.state,limitMs:MATCH_WAIT_MS,remainingMs:this.matchmaking.state==='waiting'?Math.max(0,this.matchDeadline-performance.now()):this.matchmaking.state==='connecting'?MATCH_WAIT_MS:0};
  }
  setMatchmaking(packet){
    const previous=this.matchmaking?.state;
    const remaining=Math.max(0,Math.min(MATCH_WAIT_MS,Number(packet.remainingMs)||0));
    const deadline=performance.now()+remaining;
    this.matchDeadline=previous==='waiting'&&packet.state==='waiting'?Math.min(this.matchDeadline,deadline):deadline;
    this.matchmaking={state:packet.state};this.onMatchmaking?.(this.matchState());
  }
  clearMatchmaking(){
    this.searchRequest++;
    if(['connecting','waiting','cancelling'].includes(this.matchmaking?.state))this.send({type:'cancel_match'});
    this.matchmaking=null;this.matchDeadline=0;
  }
  async findMatch(){
    if(this.room||['connecting','waiting','cancelling'].includes(this.matchmaking?.state))return false;
    const request=++this.searchRequest;this.save(null);this.setMatchmaking({state:'connecting'});
    try{
      await this.connect();
      if(request!==this.searchRequest||this.room)return false;
      if(!this.send({type:'find_match'}))throw new Error('서버에 연결할 수 없습니다.');
      return true;
    }catch(error){
      if(request!==this.searchRequest)return false;
      this.setMatchmaking({state:'error'});throw error;
    }
  }
  cancelMatch(){
    this.searchRequest++;
    if(this.room)return;
    const pending=this.matchmaking?.state==='waiting'||this.matchmaking?.state==='cancelling';
    if(pending&&this.socket?.readyState===WebSocket.OPEN){
      this.setMatchmaking({state:'cancelling'});this.send({type:'cancel_match'});
    }else{this.send({type:'cancel_match'});this.setMatchmaking({state:'cancelled'});}
  }
  async create(rules){this.clearMatchmaking();this.save(null);await this.connect();this.send({type:'create',rules});}
  async join(code){this.clearMatchmaking();this.save(null);await this.connect();this.send({type:'join',code});}
  resume(){if(this.saved)return this.connect();}
  leave(){
    this.clearMatchmaking();this.manual=true;clearTimeout(this.retryTimer);clearInterval(this.heartbeat);
    if(this.room)this.send({type:'leave'});this.save(null);this.room=null;this.socket?.close(1000);this.socket=null;this.connecting=null;this.setStatus('idle');
  }
  input(input,now){
    if(!this.room||this.status!=='connected'||this.room.phase!=='battle')return false;
    const held=JSON.stringify({move:input.move||0,guard:Boolean(input.guard),down:Boolean(input.down)});
    const intent=EDGES.some(key=>input[key]);
    if(!intent&&held===this.lastHeld&&now-this.lastInputAt<100)return false;
    if(!this.send({type:'input',seq:++this.seq,input}))return false;
    this.lastHeld=held;this.lastInputAt=now;return intent;
  }
  neutral(){this.lastHeld='';this.send({type:'input',seq:++this.seq,neutral:true});}
  state(){
    return {status:this.status,code:this.room?.code||null,kind:this.room?.kind||null,matchmaking:this.matchState(),seat:this.seat,ping:this.ping,phase:this.room?.phase||null,
      connected:this.room?.players.map(p=>Boolean(p?.connected))||[],ready:this.room?.players.map(p=>Boolean(p?.ready))||[]};
  }
}
