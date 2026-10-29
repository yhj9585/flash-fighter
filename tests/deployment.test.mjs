import test from 'node:test';
import assert from 'node:assert/strict';
import {OnlineClient} from '../src/online.js';

function replaceGlobal(t,name,value){
  const previous=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  t.after(()=>{
    if(previous)Object.defineProperty(globalThis,name,previous);
    else delete globalThis[name];
  });
}

async function connectAt(t,pageUrl,endpoint){
  const sockets=[];
  class FakeWebSocket{
    static OPEN=1;
    constructor(url){this.url=String(url);this.readyState=0;sockets.push(this);}
    send(){}
    close(code=1000){this.readyState=3;this.onclose?.({code});}
  }
  replaceGlobal(t,'location',{href:pageUrl});
  replaceGlobal(t,'WebSocket',FakeWebSocket);
  const client=endpoint===undefined?new OnlineClient():new OnlineClient({},endpoint);
  // Register cleanup after global restoration hooks: leave uses the fake socket
  // directly and clears both connection and heartbeat timers.
  t.after(()=>client.leave());
  const pending=client.connect();
  assert.equal(sockets.length,1);
  const socket=sockets[0];
  socket.readyState=FakeWebSocket.OPEN;
  socket.onopen();
  await pending;
  assert.equal(client.status,'connected');
  return {client,socket};
}

test('a static deployment without an online endpoint rejects without opening a socket',async t=>{
  let attempts=0;
  replaceGlobal(t,'WebSocket',class{
    constructor(){attempts++;throw new Error('Unexpected WebSocket connection');}
  });
  const client=new OnlineClient({},null);
  assert.equal(client.available,false);
  await assert.rejects(client.connect(),/온라인 대전은 준비 중/);
  assert.equal(attempts,0);
  assert.equal(client.socket,null);
  assert.equal(client.status,'idle');
});

for(const [pageUrl,expected] of [
  ['http://localhost:5173/?room=ABC234','ws://localhost:5173/online'],
  ['https://game.example/play?room=ABC234','wss://game.example/online'],
]){
  test(`the default online endpoint follows the page protocol at ${pageUrl}`,async t=>{
    const {client,socket}=await connectAt(t,pageUrl);
    assert.equal(client.available,true);
    assert.equal(socket.url,expected);
  });
}

for(const [endpoint,expected] of [
  ['ws://127.0.0.1:9000/online','ws://127.0.0.1:9000/online'],
  ['wss://match.example/online?region=tokyo','wss://match.example/online?region=tokyo'],
  ['http://127.0.0.1:9000/online','ws://127.0.0.1:9000/online'],
  ['https://match.example/online','wss://match.example/online'],
]){
  test(`an external endpoint retains its host and path: ${endpoint}`,async t=>{
    const {socket}=await connectAt(t,'https://game.example/',endpoint);
    assert.equal(socket.url,expected);
  });
}
