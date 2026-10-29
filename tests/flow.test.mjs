import test from 'node:test';
import assert from 'node:assert/strict';
import {GameFlow} from '../src/flow.js';

test('setup proceeds through mode, both fighters, stage, versus and battle',()=>{
  const f=new GameFlow();assert.equal(f.screen,'mode');
  f.chooseMode('multiplayer');f.next();assert.equal(f.screen,'multiplayer');f.chooseMultiplayer('local');assert.equal(f.screen,'characters');assert.equal(f.seat,0);
  f.chooseFighter('thief');f.next();assert.equal(f.seat,1);assert.deepEqual(f.confirmed,[true,false]);
  f.chooseFighter('angry');f.next();assert.equal(f.screen,'stage');
  f.chooseStage('computer');f.next();assert.equal(f.screen,'versus');f.next();assert.equal(f.screen,'battle');
  assert.deepEqual(f.fighters,['thief','angry']);assert.equal(f.stage,'computer');assert.equal(f.mode,'local');
});
test('back navigation preserves choices and unlocks the player being edited',()=>{
  const f=new GameFlow();f.next();f.chooseFighter('angry');f.next();f.chooseFighter('thief');f.next();f.chooseStage('paper');f.next();
  f.back();assert.equal(f.screen,'stage');assert.equal(f.stage,'paper');
  f.back();assert.equal(f.seat,1);assert.deepEqual(f.confirmed,[true,false]);assert.deepEqual(f.fighters,['angry','thief']);
  f.back();assert.equal(f.seat,0);assert.deepEqual(f.confirmed,[false,false]);
  f.back();assert.equal(f.screen,'mode');
});
test('invalid and out-of-order choices cannot change confirmed match setup',()=>{
  const f=new GameFlow();f.chooseFighter('thief');f.chooseStage('paper');f.chooseMode('online');
  assert.deepEqual(f.fighters,['tuna','hacker']);assert.equal(f.stage,'fridge');assert.equal(f.mode,'cpu');
  f.next();f.chooseMode('local');f.chooseFighter('missing');assert.equal(f.mode,'cpu');assert.equal(f.fighters[0],'tuna');
});
test('reselection and rematches retain mode, characters, and stage',()=>{
  const f=new GameFlow();f.chooseMode('training');f.next();f.chooseFighter('thief');f.next();f.next();f.chooseStage('paper');f.next();f.next();
  f.characters();assert.equal(f.screen,'characters');assert.equal(f.mode,'training');assert.equal(f.fighters[0],'thief');assert.equal(f.stage,'paper');
  f.rematch();assert.equal(f.screen,'versus');assert.deepEqual(f.confirmed,[true,true]);f.next();assert.equal(f.screen,'battle');
  f.home();assert.equal(f.screen,'mode');assert.equal(f.opponentLabel,'연습 상대');
});
