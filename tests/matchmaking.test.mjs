import test from 'node:test';
import assert from 'node:assert/strict';
import {Matchmaker} from '../server/matchmaking.mjs';
import {MATCH_WAIT_MS,formatMatchTime} from '../src/matchmaking.js';

function setup(options={}){
  const clock={now:0},messages=[],pairs=[],capacity={open:true};
  const queue=new Matchmaker({now:()=>clock.now,notify:(client,packet)=>messages.push({client,...packet}),
    available:client=>client.connected&&!client.room,capacity:()=>capacity.open,
    pair:(a,b)=>{pairs.push([a,b]);a.room=b.room={};return true;},...options});
  return {clock,messages,pairs,capacity,queue};
}
const player=name=>({name,connected:true,room:null});

test('production search limit is exactly 180 seconds and overrides cannot exceed it',()=>{
  assert.equal(MATCH_WAIT_MS,180000);
  const {queue,clock,messages}=setup({waitMs:900000}),a=player('a');queue.enqueue(a);
  assert.equal(queue.entries.get(a).deadline,180000);assert.equal(messages[0].remainingMs,180000);
  clock.now=179999;queue.tick();assert.equal(queue.entries.size,1);
  clock.now=180000;queue.tick();assert.equal(queue.entries.size,0);
  assert.equal(messages.at(-1).state,'timeout');assert.equal(messages.at(-1).remainingMs,0);
});
test('repeated requests neither duplicate a player nor reset the deadline',()=>{
  const {queue,clock,messages}=setup(),a=player('a');queue.enqueue(a);clock.now=95000;
  queue.enqueue(a);queue.enqueue(a);assert.equal(queue.entries.size,1);
  assert.equal(queue.entries.get(a).deadline,180000);assert.equal(messages.at(-1).remainingMs,85000);
});
test('oldest waiting players are paired once and receive no later timeout',()=>{
  const {queue,clock,pairs,capacity,messages}=setup();capacity.open=false;
  const [a,b,c]=['a','b','c'].map(player);queue.enqueue(a);clock.now=1;queue.enqueue(b);clock.now=2;queue.enqueue(c);
  capacity.open=true;queue.tick();assert.deepEqual(pairs,[[a,b]]);assert.deepEqual([...queue.entries.keys()],[c]);
  clock.now=180002;queue.tick();assert.equal(pairs.length,1);
  assert.deepEqual(messages.filter(m=>m.state==='timeout').map(m=>m.client),[c]);
});
test('cancellation is idempotent and a cancelled player cannot be matched',()=>{
  const {queue,pairs,messages}=setup(),a=player('a'),b=player('b');queue.enqueue(a);
  assert.equal(queue.cancel(a),true);assert.equal(queue.cancel(a),false);queue.enqueue(b);
  assert.equal(pairs.length,0);assert.deepEqual([...queue.entries.keys()],[b]);
  assert.equal(messages.filter(m=>m.client===a).at(-1).state,'cancelled');
});
test('disconnected users and people already in rooms are removed from matching',()=>{
  const {queue,pairs}=setup(),a=player('a'),b=player('b'),c=player('c');
  queue.enqueue(a);a.connected=false;queue.enqueue(b);assert.equal(pairs.length,0);
  b.room={};queue.tick();assert.equal(queue.entries.size,0);
  assert.equal(queue.enqueue(b),false);queue.enqueue(c);assert.equal(queue.entries.size,1);
});
test('a partner arriving at the deadline cannot revive an expired search',()=>{
  const {queue,clock,pairs,messages}=setup(),a=player('a'),b=player('b');queue.enqueue(a);
  clock.now=180000;queue.enqueue(b);assert.equal(pairs.length,0);
  assert.ok(messages.some(m=>m.client===a&&m.state==='timeout'));assert.deepEqual([...queue.entries.keys()],[b]);
});
test('timeout stays finished until an explicit new request',()=>{
  const {queue,clock,messages}=setup(),a=player('a');queue.enqueue(a);clock.now=180001;queue.tick();
  clock.now=720000;queue.tick();assert.equal(queue.entries.size,0);assert.equal(messages.filter(m=>m.state==='timeout').length,1);
  queue.enqueue(a);assert.equal(queue.entries.get(a).deadline,900000);
});
test('closing the matcher discards every waiting entry',()=>{
  const {queue}=setup(),a=player('a');queue.enqueue(a);queue.close();assert.equal(queue.entries.size,0);
});
test('countdown formatting never exceeds 3:00 and reaches 0:00',()=>{
  assert.deepEqual([180000,179000,61000,60000,1,0,-5,999999,NaN].map(formatMatchTime),['3:00','2:59','1:01','1:00','0:01','0:00','0:00','3:00','0:00']);
});
