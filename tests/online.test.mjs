import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createGameServer} from '../server.mjs';
import {RemoteMatch} from '../src/net-state.js';

let game,base,wsUrl;const peers=[];
class Peer{
  constructor(){
    this.messages=[];this.waiters=[];
    this.ws=new WebSocket(wsUrl,{origin:base});peers.push(this);
    this.ws.on('error',()=>{});
    this.ws.on('message',data=>{const packet=JSON.parse(data);this.messages.push(packet);for(const wake of [...this.waiters])wake();});
  }
  async open(){await once(this.ws,'open');return this;}
  send(type,body={}){this.ws.send(JSON.stringify({type,...body}));}
  mark(){return this.messages.length;}
  async wait(type,predicate=()=>true,after=0){
    const find=()=>this.messages.slice(after).find(m=>m.type===type&&predicate(m));
    if(find())return find();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.waiters=this.waiters.filter(w=>w!==wake);reject(new Error('Timed out: '+type));},4000);
      const wake=()=>{const result=find();if(result){clearTimeout(timer);this.waiters=this.waiters.filter(w=>w!==wake);resolve(result);}};
      this.waiters.push(wake);wake();
    });
  }
}
async function pair(){
  const a=await new Peer().open();a.send('create',{rules:{time:30,wins:1}});
  const joined=await a.wait('joined');const b=await new Peer().open();b.send('join',{code:joined.room.code});
  const guest=await b.wait('joined');await a.wait('room',m=>m.room.phase==='characters');
  return {a,b,code:joined.room.code,token:guest.token,room:game.online.rooms.get(joined.room.code)};
}
async function begin(pairing){
  const {a,b,room}=pairing;a.send('ready');b.send('ready');await a.wait('room',m=>m.room.phase==='stage');
  a.send('start');await a.wait('room',m=>m.room.phase==='battle');room.engine.phaseFrames=1;
  await a.wait('frame',m=>m.frame.phase==='fighting');return pairing;
}
test.before(async()=>{
  game=createGameServer({graceMs:450,versusMs:20,matchWaitMs:1000});
  await new Promise(resolve=>game.server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+game.server.address().port;wsUrl=base.replace('http:','ws:')+'/online';
});
test.after(async()=>{for(const peer of peers)peer.ws.terminate();await game.close();});

test('room codes, invalid joins, full rooms and private resume credentials',async()=>{
  const {a,b,code}=await pair();assert.match(code,/^[A-Z2-9]{6}$/);
  assert.equal((await a.wait('joined')).seat,0);assert.equal((await b.wait('joined')).seat,1);
  const publicRoom=(await b.wait('joined')).room;
  assert.ok(!JSON.stringify(publicRoom).includes('token'));
  const third=await new Peer().open();third.send('join',{code});assert.equal((await third.wait('error')).code,'room_full');
  const missing=await new Peer().open();missing.send('join',{code:'ZZZZZZ'});assert.equal((await missing.wait('error')).code,'room_missing');
  a.send('leave');b.send('leave');
});
test('both players confirm their own characters and only host changes rules or stage',async()=>{
  const p=await pair(),{a,b,room}=p;
  a.send('choose',{fighter:'cross'});b.send('choose',{fighter:'emerald'});a.send('ready');
  b.send('rules',{rules:{time:99,wins:3}});b.send('start');b.send('ping',{sent:1});await b.wait('pong');
  assert.equal(room.phase,'characters');assert.deepEqual(room.rules,{time:30,wins:1});
  b.send('ready');await a.wait('room',m=>m.room.phase==='stage');
  b.send('stage',{stage:'computer'});b.send('ping',{sent:2});await b.wait('pong',m=>m.sent===2);assert.equal(room.stage,'fridge');
  a.send('stage',{stage:'paper'});a.send('ping',{sent:3});await a.wait('pong',m=>m.sent===3);assert.equal(room.stage,'paper');
  b.send('ready',{ready:false});await a.wait('room',m=>m.room.phase==='characters'&&m.room.players[1].ready===false);
  assert.deepEqual(room.slots.map(s=>s.fighter),['cross','emerald']);a.send('leave');b.send('leave');
});
test('server owns positions and damage; packets only control the sender seat and stale movement stops',async()=>{
  const p=await begin(await pair()),{a,b,room}=p;
  const before=room.engine.players.map(s=>s.x);
  a.send('input',{seq:1,input:{move:1,hp:0,player:1}});
  await new Promise(resolve=>setTimeout(resolve,160));
  assert.ok(room.engine.players[0].x>before[0]);assert.equal(room.engine.players[1].x,before[1]);assert.equal(room.engine.players[1].hp,930);
  a.send('input',{seq:1,input:{move:-1}});await new Promise(resolve=>setTimeout(resolve,500));
  const stopped=room.engine.players[0].x;await new Promise(resolve=>setTimeout(resolve,80));assert.equal(room.engine.players[0].x,stopped);
  a.send('leave');b.send('leave');
});
test('two sockets receive the same authoritative special hit and confirmed super combo',async()=>{
  const p=await begin(await pair()),{a,b,room}=p;
  room.engine.players[0].x=500;room.engine.players[1].x=710;room.engine.players[0].meter=100;
  const fromA=a.mark(),fromB=b.mark();a.send('input',{seq:1,input:{special:true}});
  const hit=await a.wait('frame',m=>m.events.some(e=>e.type==='hit'&&e.kind==='special'),fromA);
  const mirrored=await b.wait('frame',m=>m.number===hit.number,fromB);
  assert.equal(hit.frame.players[1].hp,mirrored.frame.players[1].hp);
  a.send('input',{seq:2,input:{super:true}});
  const combo=await a.wait('frame',m=>m.events.some(e=>e.type==='hit'&&e.kind==='super'),fromA);
  assert.equal(combo.events.find(e=>e.type==='hit'&&e.kind==='super').combo,2);
  const view=new RemoteMatch(combo.frame);assert.equal(view.snapshot().players[1].hp,combo.frame.players[1].hp);
  assert.equal(view.players[0].def.id,'tuna');assert.ok(view.players[0].action.move);
  a.send('leave');b.send('leave');
});
test('disconnect pauses the shared clock and valid token resumes the same slot and health',async()=>{
  const p=await begin(await pair()),{a,b,room,code,token}=p;
  room.engine.players[1].hp=741;
  const mark=a.mark();b.ws.terminate();await a.wait('room',m=>!m.room.players[1].connected,mark);
  const time=room.engine.remaining;await new Promise(resolve=>setTimeout(resolve,90));assert.equal(room.engine.remaining,time);
  const returning=await new Peer().open();returning.send('resume',{code,token});const joined=await returning.wait('joined');
  assert.equal(joined.seat,1);assert.equal(room.engine.players[1].hp,741);assert.equal(room.engine.paused,false);
  a.send('leave');returning.send('leave');
});
test('expired connections free the seat and remaining guest becomes host',async()=>{
  const p=await pair(),{a,b,room,code}=p;a.ws.terminate();
  await b.wait('room',m=>m.seat===0&&m.room.players[1]===null);
  assert.equal(room.slots[0].client.seat,0);assert.equal(room.phase,'waiting');assert.equal(room.code,code);
  const newcomer=await new Peer().open();newcomer.send('join',{code});assert.equal((await newcomer.wait('joined')).seat,1);
  b.send('leave');newcomer.send('leave');
});
test('rematch requires both votes and reselect returns both players to selection',async()=>{
  const p=await begin(await pair()),{a,b,room}=p;
  room.engine.players[1].hp=0;await a.wait('room',m=>m.room.phase==='result');
  a.send('rematch');a.send('ping',{sent:1});await a.wait('pong');assert.equal(room.phase,'result');
  b.send('rematch');await a.wait('room',m=>m.room.phase==='versus'&&m.room.epoch===2);
  assert.equal(room.engine.players[1].hp,930);await a.wait('room',m=>m.room.phase==='battle'&&m.room.epoch===2);
  room.engine.phaseFrames=1;await new Promise(resolve=>setTimeout(resolve,30));room.engine.players[1].hp=0;
  await a.wait('room',m=>m.room.phase==='result'&&m.room.epoch===2);a.send('reselect');
  await b.wait('room',m=>m.room.phase==='characters'&&m.room.epoch===2);
  assert.ok(room.slots.every(s=>!s.ready));a.send('leave');b.send('leave');
});
test('malformed messages and cross-origin sockets are rejected without affecting rooms',async()=>{
  const peer=await new Peer().open();peer.ws.send('{broken');assert.equal((await peer.wait('error')).code,'invalid');
  const wrong=new WebSocket(wsUrl,{origin:'https://unrelated.invalid'});wrong.on('error',()=>{});
  const response=await new Promise(resolve=>wrong.once('unexpected-response',(req,res)=>{resolve(res.statusCode);res.resume();wrong.terminate();}));
  assert.equal(response,403);
  const health=await fetch(base+'/health');assert.equal((await health.json()).online,true);
  const blocked=await fetch(base+'/assets/%2e%2e%2fserver/online-server.mjs');assert.equal(blocked.status,404);
});

test('random searches create one shared room and retain the normal selection flow',async()=>{
  const a=await new Peer().open(),b=await new Peer().open();
  a.send('find_match');const waiting=await a.wait('matchmaking',m=>m.state==='waiting');
  assert.ok(waiting.remainingMs>0&&waiting.remainingMs<=180000);
  b.send('find_match');const h=await a.wait('joined'),g=await b.wait('joined');
  assert.equal(h.room.code,g.room.code);assert.equal(h.room.kind,'random');assert.equal(h.room.phase,'characters');
  assert.equal(h.seat,0);assert.equal(g.seat,1);assert.deepEqual(h.room.rules,{time:60,wins:2});
  assert.equal(game.online.matchmaker.entries.size,0);
  a.send('ready');b.send('ready');await a.wait('room',m=>m.room.phase==='stage');
  a.send('leave');b.send('leave');
});
test('cancelled searches cannot consume a later opponent and may retry',async()=>{
  const a=await new Peer().open(),b=await new Peer().open();
  a.send('find_match');await a.wait('matchmaking',m=>m.state==='waiting');a.send('cancel_match');
  await a.wait('matchmaking',m=>m.state==='cancelled');b.send('find_match');await b.wait('matchmaking',m=>m.state==='waiting');
  assert.equal(a.messages.some(m=>m.type==='joined'),false);
  a.send('find_match');assert.equal((await a.wait('joined')).room.code,(await b.wait('joined')).room.code);
  a.send('leave');b.send('leave');
});
test('random timeout is delivered once and a new search is required afterward',async()=>{
  const a=await new Peer().open();a.send('find_match');await a.wait('matchmaking',m=>m.state==='waiting');
  a.send('find_match');await a.wait('matchmaking',m=>m.state==='timeout');
  assert.equal(game.online.matchmaker.entries.size,0);
  const b=await new Peer().open();b.send('find_match');await b.wait('matchmaking',m=>m.state==='waiting');
  assert.equal(a.messages.some(m=>m.type==='joined'),false);
  a.send('find_match');await a.wait('joined');await b.wait('joined');
  a.send('leave');b.send('leave');
});
test('disconnecting or creating a private room removes the queued search',async()=>{
  const a=await new Peer().open();a.send('find_match');await a.wait('matchmaking',m=>m.state==='waiting');a.ws.terminate();
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(game.online.matchmaker.entries.size,0);
  const b=await new Peer().open();b.send('find_match');await b.wait('matchmaking',m=>m.state==='waiting');
  b.send('create');const room=await b.wait('joined');assert.equal(room.room.kind,'private');assert.equal(game.online.matchmaker.entries.size,0);
  b.send('find_match');await b.wait('error');b.send('leave');
});
test('a cancel packet arriving after a match cannot remove either player',async()=>{
  const a=await new Peer().open(),b=await new Peer().open();a.send('find_match');b.send('find_match');
  const joined=await a.wait('joined');await b.wait('joined');const room=game.online.rooms.get(joined.room.code);
  a.send('cancel_match');a.send('ping',{sent:42});await a.wait('pong',m=>m.sent===42);
  assert.equal(room.phase,'characters');assert.ok(room.slots.every(s=>s?.client));
  a.send('leave');b.send('leave');
});

