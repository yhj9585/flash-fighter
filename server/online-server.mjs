import {WebSocketServer,WebSocket} from 'ws';
import {randomBytes,randomInt} from 'node:crypto';
import {FightEngine,STEP} from '../src/engine.js';
import {FIGHTERS,STAGES} from '../src/data.js';
import {encodeMatch} from '../src/net-state.js';
import {Matchmaker} from './matchmaking.mjs';
import {MATCH_WAIT_MS} from '../src/matchmaking.js';

const EDGES=['jump','dash','throw','light','heavy','special','super','command','burst'];
const ATTACKS=['throw','light','heavy','special','super','command','burst'];
const LETTERS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const validFighter=id=>FIGHTERS.some(f=>f.id===id);
const validStage=id=>STAGES.some(s=>s.id===id);
const rulesFor=value=>({time:[30,60,99].includes(value?.time)?value.time:60,wins:[1,2,3].includes(value?.wins)?value.wins:2});
const emptyInput=()=>({move:0,guard:false,down:false});
const resetSlot=slot=>{slot.held=emptyInput();slot.pending={};slot.lastInput=0;};
function newSlot(client,index){
  const slot={client,token:randomBytes(24).toString('base64url'),fighter:index?'hacker':'tuna',ready:false,rematch:false,seq:-1,disconnectedAt:0};
  resetSlot(slot);return slot;
}

export class OnlineService{
  constructor(server,{graceMs=15000,maxRooms=100,allowedOrigins=[],versusMs=1400,matchWaitMs=MATCH_WAIT_MS}={}){
    this.rooms=new Map();this.graceMs=graceMs;this.versusMs=versusMs;this.maxRooms=maxRooms;this.tick=0;
    this.matchmaker=new Matchmaker({
      notify:(client,packet)=>this.send(client,packet),
      pair:(first,second)=>this.pairRandom(first,second),
      available:client=>client.ws.readyState===WebSocket.OPEN&&!client.room,
      capacity:()=>this.rooms.size<this.maxRooms,waitMs:matchWaitMs,
    });
    this.wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
    this.upgrade=(request,socket,head)=>{
      let url,origin;
      try{url=new URL(request.url,'http://localhost');origin=request.headers.origin&&new URL(request.headers.origin);}
      catch{socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');return;}
      if(url.pathname!=='/online'||origin&&origin.host!==request.headers.host&&!allowedOrigins.includes(origin.origin)){
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;
      }
      this.wss.handleUpgrade(request,socket,head,ws=>this.wss.emit('connection',ws,request));
    };
    server.on('upgrade',this.upgrade);
    this.wss.on('connection',ws=>{
      const client={ws,room:null,seat:null,count:0,window:Date.now(),alive:true};
      ws.onlineClient=client;
      ws.on('error',()=>{});ws.on('pong',()=>client.alive=true);
      ws.on('message',bytes=>this.receive(client,bytes));
      ws.on('close',()=>this.disconnected(client));
      this.send(client,{type:'hello',protocol:1});
    });
    this.last=performance.now();this.accumulator=0;
    this.timer=setInterval(()=>{
      const now=performance.now();this.accumulator+=Math.min(.2,(now-this.last)/1000);this.last=now;
      let steps=0;while(this.accumulator>=STEP&&steps++<12){this.accumulator-=STEP;this.step();}
    },8);this.timer.unref();
    this.heartbeat=setInterval(()=>{
      for(const ws of this.wss.clients){
        const client=ws.onlineClient;
        if(client&&!client.alive){ws.terminate();continue;}
        if(client)client.alive=false;
        if(ws.readyState===WebSocket.OPEN)ws.ping();
      }
    },10000);this.heartbeat.unref();
  }
  send(client,message){
    if(client?.ws.readyState!==WebSocket.OPEN)return;
    if(client.ws.bufferedAmount>1048576){client.ws.terminate();return;}
    if(message.type==='frame'&&client.ws.bufferedAmount>262144)return;
    client.ws.send(JSON.stringify(message));
  }
  error(client,message,code='invalid'){this.send(client,{type:'error',code,message});}
  view(room){
    return {code:room.code,kind:room.kind||'private',phase:room.phase,stage:room.stage,rules:{...room.rules},epoch:room.epoch,notice:room.notice,
      players:room.slots.map(slot=>slot?{fighter:slot.fighter,ready:slot.ready,connected:Boolean(slot.client),rematch:slot.rematch}:null),
      reconnectMs:Math.max(0,...room.slots.filter(s=>s&&!s.client).map(s=>this.graceMs-(Date.now()-s.disconnectedAt)))};
  }
  broadcastRoom(room){
    room.slots.forEach((slot,seat)=>{if(slot?.client)this.send(slot.client,{type:'room',room:this.view(room),seat});});
  }
  frame(room,events=[]){
    if(!room.engine)return;
    const packet={type:'frame',epoch:room.epoch,number:++room.frameNumber,frame:encodeMatch(room.engine),events};
    for(const slot of room.slots)if(slot?.client)this.send(slot.client,packet);
  }
  joined(client,room,seat,broadcast=true){
    client.room=room;client.seat=seat;client.ws.onlineClient=client;
    const slot=room.slots[seat];slot.client=client;slot.disconnectedAt=0;slot.seq=-1;resetSlot(slot);
    if(room.engine)room.engine.paused=room.slots.some(s=>s&&!s.client);
    this.send(client,{type:'joined',seat,token:slot.token,room:this.view(room)});
    if(broadcast){this.broadcastRoom(room);if(room.engine)this.frame(room);}
  }
  createRoom(slots,rules,kind='private'){
    let code;do{code=Array.from({length:6},()=>LETTERS[randomInt(LETTERS.length)]).join('');}while(this.rooms.has(code));
    const room={code,kind,slots,phase:kind==='random'?'characters':'waiting',stage:'fridge',rules:rulesFor(rules),engine:null,
      epoch:0,frameNumber:0,events:[],notice:'',updated:Date.now(),versusAt:0};
    this.rooms.set(code,room);return room;
  }
  pairRandom(first,second){
    if(this.rooms.size>=this.maxRooms)return false;
    const room=this.createRoom([newSlot(first,0),newSlot(second,1)],{},'random');
    this.joined(first,room,0,false);this.joined(second,room,1,false);this.broadcastRoom(room);return true;
  }
  receive(client,bytes){
    const now=Date.now();
    if(now-client.window>=1000){client.window=now;client.count=0;}
    if(++client.count>180){client.ws.close(4008,'too many requests');return;}
    let message;try{message=JSON.parse(bytes.toString());}catch{this.error(client,'요청을 읽을 수 없습니다.');return;}
    if(!message||typeof message!=='object'||Array.isArray(message)){this.error(client,'잘못된 요청입니다.');return;}
    if(message.type==='ping'){this.send(client,{type:'pong',sent:message.sent});return;}
    if(message.type==='find_match'){
      if(client.room)return this.error(client,'이미 방에 참가했습니다.');
      if(this.rooms.size>=this.maxRooms)return this.error(client,'대전 방이 가득 찼습니다. 잠시 뒤 다시 시도해 주세요.','matching_unavailable');
      this.matchmaker.enqueue(client);return;
    }
    if(message.type==='cancel_match'){
      if(!client.room)this.matchmaker.cancel(client);
      return;
    }
    if(message.type==='create'){
      if(client.room)return this.error(client,'이미 방에 참가했습니다.');
      if(this.rooms.size>=this.maxRooms)return this.error(client,'방이 가득 찼습니다. 잠시 뒤 다시 시도해 주세요.');
      this.matchmaker.cancel(client,false);
      const room=this.createRoom([newSlot(client,0),null],message.rules);
      this.joined(client,room,0);return;
    }
    if(message.type==='join'||message.type==='resume'){
      if(client.room)return this.error(client,'이미 방에 참가했습니다.');
      const code=typeof message.code==='string'?message.code.trim().toUpperCase():'';
      const room=this.rooms.get(code);
      if(!room)return this.error(client,'방 코드를 확인해 주세요.','room_missing');
      if(message.type==='resume'){
        const seat=room.slots.findIndex(s=>s&&typeof message.token==='string'&&s.token===message.token);
        if(seat<0)return this.error(client,'재접속 시간이 만료되었습니다. 방 코드로 다시 참가해 주세요.','resume_expired');
        this.matchmaker.cancel(client,false);
        const old=room.slots[seat].client;
        if(old&&old!==client){old.room=null;old.ws.close(4001,'connection replaced');}
        this.joined(client,room,seat);return;
      }
      const seat=room.slots.findIndex(s=>!s);
      if(seat<0)return this.error(client,'이미 두 명이 참가한 방입니다.','room_full');
      this.matchmaker.cancel(client,false);
      room.slots[seat]=newSlot(client,seat);room.notice='';room.phase='characters';room.updated=now;
      room.slots.forEach(s=>{if(s){s.ready=false;s.rematch=false;}});
      this.joined(client,room,seat);return;
    }
    const room=client.room,slot=room?.slots[client.seat];
    if(!room||slot?.client!==client)return this.error(client,'먼저 방을 만들거나 참가해 주세요.','not_joined');
    room.updated=now;
    if(message.type==='leave'){this.remove(room,client.seat,'상대가 방을 나갔습니다.');this.send(client,{type:'left'});return;}
    if(message.type==='choose'){
      if(room.phase!=='characters'||!validFighter(message.fighter))return;
      slot.fighter=message.fighter;slot.ready=false;this.broadcastRoom(room);return;
    }
    if(message.type==='ready'){
      if(message.ready===false&&room.phase==='stage')room.phase='characters';
      if(room.phase!=='characters')return;
      slot.ready=message.ready!==false;
      if(room.slots.every(s=>s?.client&&s.ready))room.phase='stage';
      this.broadcastRoom(room);return;
    }
    if(message.type==='rules'){
      if(client.seat!==0||!['waiting','characters','stage'].includes(room.phase))return;
      room.rules=rulesFor(message.rules);this.broadcastRoom(room);return;
    }
    if(message.type==='stage'){
      if(client.seat===0&&room.phase==='stage'&&validStage(message.stage)){room.stage=message.stage;this.broadcastRoom(room);}
      return;
    }
    if(message.type==='start'){
      if(client.seat!==0||room.phase!=='stage'||!room.slots.every(s=>s?.client&&s.ready))return;
      this.start(room);return;
    }
    if(message.type==='rematch'){
      if(room.phase!=='result')return;
      slot.rematch=true;
      if(room.slots.every(s=>s?.client&&s.rematch))this.start(room);else this.broadcastRoom(room);
      return;
    }
    if(message.type==='reselect'){
      if(room.phase!=='result')return;
      room.phase='characters';room.engine=null;
      room.slots.forEach(s=>{if(s){s.ready=false;s.rematch=false;resetSlot(s);}});
      this.broadcastRoom(room);return;
    }
    if(message.type==='input'){
      if(room.phase!=='battle'||room.engine?.paused||!Number.isSafeInteger(message.seq)||message.seq<=slot.seq)return;
      slot.seq=message.seq;slot.lastInput=now;
      if(message.neutral){resetSlot(slot);return;}
      const input=message.input||{};
      slot.held={move:input.move===1?1:input.move===-1?-1:0,guard:input.guard===true,down:input.down===true};
      for(const action of EDGES)if(input[action]===true)slot.pending[action]=this.tick+12;
    }
  }
  start(room){
    room.epoch++;room.frameNumber=0;room.events=[];
    room.engine=new FightEngine({players:room.slots.map(s=>s.fighter),mode:'online',stage:room.stage,...room.rules});
    room.slots.forEach(s=>{s.rematch=false;resetSlot(s);});
    room.phase='versus';room.versusAt=Date.now()+this.versusMs;room.notice='';
    this.broadcastRoom(room);this.frame(room);
  }
  disconnected(client){
    this.matchmaker.cancel(client,false);
    const room=client.room,slot=room?.slots[client.seat];
    if(!room||slot?.client!==client)return;
    slot.client=null;slot.disconnectedAt=Date.now();resetSlot(slot);
    if(room.engine)room.engine.paused=true;
    this.broadcastRoom(room);this.frame(room);
  }
  remove(room,seat,notice){
    const removed=room.slots[seat];
    if(removed?.client){removed.client.room=null;removed.client.seat=null;}
    room.slots[seat]=null;room.engine=null;room.phase='waiting';room.events=[];room.notice=notice;room.updated=Date.now();
    if(!room.slots[0]&&room.slots[1]){
      room.slots[0]=room.slots[1];room.slots[1]=null;
      if(room.slots[0].client)room.slots[0].client.seat=0;
    }
    room.slots.forEach(s=>{if(s){s.ready=false;s.rematch=false;resetSlot(s);}});
    if(room.slots.every(s=>!s))this.rooms.delete(room.code);else this.broadcastRoom(room);
  }
  step(){
    this.tick++;const now=Date.now();this.matchmaker.tick();
    for(const room of [...this.rooms.values()]){
      for(const absent of [...room.slots].filter(s=>s&&!s.client)){
        if(now-absent.disconnectedAt>=this.graceMs){const seat=room.slots.indexOf(absent);if(seat>=0)this.remove(room,seat,'상대 연결이 종료되었습니다. 새 상대를 기다립니다.');}
      }
      if(!this.rooms.has(room.code))continue;
      if(now-room.updated>1800000&&!room.engine){
        for(const slot of room.slots)if(slot?.client){this.error(slot.client,'오래 사용하지 않은 방이 종료되었습니다.','room_expired');slot.client.room=null;}
        this.rooms.delete(room.code);continue;
      }
      if(!room.engine||room.engine.paused)continue;
      if(room.phase==='versus'&&now>=room.versusAt){room.phase='battle';room.engine.start();this.broadcastRoom(room);}
      if(room.phase!=='battle')continue;
      const inputs=room.slots.map(slot=>{
        if(!slot||now-slot.lastInput>400)return emptyInput();
        const input={...slot.held};for(const [action,until] of Object.entries(slot.pending))if(until>=this.tick)input[action]=true;else delete slot.pending[action];
        return input;
      });
      room.engine.step(inputs);
      const events=room.engine.drainEvents();
      for(const event of events){
        if(event.type==='roundStart')room.slots.forEach(resetSlot);
        const slot=room.slots[event.player];if(!slot)continue;
        if(event.type==='attack'||event.type==='denied')for(const name of ATTACKS)delete slot.pending[name];
        if(event.type==='jump'||event.type==='dash')delete slot.pending[event.type];
      }
      room.events.push(...events);
      if(this.tick%2===0){this.frame(room,room.events);room.events=[];}
      if(room.engine.phase==='matchOver'){room.phase='result';this.frame(room,room.events);room.events=[];this.broadcastRoom(room);}
    }
  }
  async close(){
    clearInterval(this.timer);clearInterval(this.heartbeat);this.matchmaker.close();
    for(const ws of this.wss.clients)ws.terminate();
    await new Promise(resolve=>this.wss.close(resolve));
  }
}
