import test from 'node:test';
import assert from 'node:assert/strict';
import {OnlineClient} from '../src/online.js';
import {MATCH_WAIT_MS} from '../src/matchmaking.js';

function client(){
  const messages=[],states=[],c=new OnlineClient({onMatchmaking:state=>states.push(state)});
  c.send=message=>{messages.push(message);return true;};
  return {c,messages,states};
}
test('cancelling while connecting cannot enqueue after the connection opens',async()=>{
  const {c,messages}=client();let open;c.connect=()=>new Promise(resolve=>open=resolve);
  const search=c.findMatch();assert.equal(c.matchmaking.state,'connecting');c.cancelMatch();open();
  assert.equal(await search,false);assert.equal(c.matchmaking.state,'cancelled');
  assert.equal(messages.some(m=>m.type==='find_match'),false);
});
test('a duplicate client request does not send two searches',async()=>{
  const {c,messages}=client();let open;c.connect=()=>new Promise(resolve=>open=resolve);
  const first=c.findMatch();assert.equal(await c.findMatch(),false);open();await first;
  assert.equal(messages.filter(m=>m.type==='find_match').length,1);
});
test('timeout does not automatically enqueue again, but retry is explicit',async()=>{
  const {c,messages}=client();c.connect=async()=>{};
  await c.findMatch();c.setMatchmaking({state:'waiting',remainingMs:50});c.setMatchmaking({state:'timeout',remainingMs:0});
  assert.equal(messages.filter(m=>m.type==='find_match').length,1);
  await c.findMatch();assert.equal(messages.filter(m=>m.type==='find_match').length,2);
});
test('waiting updates cannot increase the local countdown deadline',()=>{
  const {c}=client();c.setMatchmaking({state:'waiting',remainingMs:MATCH_WAIT_MS});const deadline=c.matchDeadline;
  c.setMatchmaking({state:'waiting',remainingMs:MATCH_WAIT_MS});assert.equal(c.matchDeadline,deadline);
  c.setMatchmaking({state:'waiting',remainingMs:3000});const shorter=c.matchDeadline;
  c.setMatchmaking({state:'waiting',remainingMs:999999});assert.equal(c.matchDeadline,shorter);
  assert.ok(c.matchState().remainingMs<=3000);
});
test('clearing an in-flight request invalidates its delayed result',async()=>{
  const {c,messages}=client();let open;c.connect=()=>new Promise(resolve=>open=resolve);
  const search=c.findMatch();c.clearMatchmaking();open();await search;
  assert.equal(c.matchmaking,null);assert.equal(messages.some(m=>m.type==='find_match'),false);
});
