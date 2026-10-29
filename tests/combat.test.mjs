import test from 'node:test';
import assert from 'node:assert/strict';
import {FightEngine} from '../src/engine.js';
import {FIGHTERS} from '../src/data.js';
import {TECHNIQUES} from '../src/combat.js';

const idle={move:0};
function run(e,frames,a=idle,b=idle){for(let i=0;i<frames;i++)e.step([a,b]);}
function fight(id='tuna',seat=0){
  const e=new FightEngine({players:seat?['tuna',id]:[id,'tuna'],mode:'local'});
  e.start();run(e,125);e.drainEvents();return e;
}
function position(e,distance=90){e.players[0].x=500;e.players[1].x=500+distance;}

for(const fighter of FIGHTERS){
  for(const kind of ['command','burst']){
    const move=TECHNIQUES[fighter.id][kind];
    test(fighter.id+' '+kind+': hits, shot count, meter, original voice and recovery',()=>{
      const e=fight(fighter.id);position(e,kind==='burst'&&move.projectile?290:move.range>200?180:110);e.players[0].meter=100;
      e.step([{[kind]:true},idle]);
      assert.equal(e.players[0].state,kind);
      assert.equal(e.players[0].meter,kind==='burst'?75:100);
      run(e,170);
      const events=e.drainEvents(),hits=events.filter(v=>v.type==='hit');
      assert.equal(hits.length,move.shots?.length||move.hitsAt?.length||1);
      assert.deepEqual(hits.map(v=>v.combo),hits.map((_,i)=>i+1));
      assert.equal(events.filter(v=>v.type==='projectile').length,move.shots?.length||0);
      assert.equal(events.find(v=>v.type==='attack').voice,move.voice);
      assert.equal(e.players[1].def.health-e.players[1].hp,hits.reduce((sum,v)=>sum+v.damage,0));
      assert.equal(e.players[0].action,null);assert.equal(e.players[0].combo,0);
      assert.ok(e.players.every(p=>p.x>=80&&p.x<=1120));
    });
  }
  test(fighter.id+': light → followup → heavy → special remains a true combo',()=>{
    const e=fight(fighter.id);position(e);e.step([{light:true},idle]);
    const used=new Set(),hits=[];let defending=false;
    for(let frame=0;frame<200;frame++){
      const p=e.players[0],input={};
      if(!e.hitstop&&p.action?.hits.size&&!used.has(p.action.type)){
        const next={light:'light',followup:'heavy',heavy:'special'}[p.action.type];
        if(next){input[next]=true;used.add(p.action.type);}
      }
      e.step([input,{guard:defending}]);
      for(const event of e.drainEvents()){
        if(event.type==='hit'){hits.push(event);defending=true;}
        assert.notEqual(event.type,'guard','defender must stay in hitstun between these strikes');
      }
    }
    assert.deepEqual(hits.map(v=>v.kind),['light','followup','heavy','special']);
    assert.deepEqual(hits.map(v=>v.combo),[1,2,3,4]);
  });
  test(fighter.id+': confirmed projectile can cancel into super without a guard gap',()=>{
    const e=fight(fighter.id);position(e,210);e.players[0].meter=100;
    e.step([{special:true},idle]);let confirmed=false;const hits=[];
    for(let frame=0;frame<180;frame++){
      const input={};
      if(confirmed&&!e.hitstop&&e.players[0].action?.type==='special'){input.super=true;confirmed=false;}
      e.step([input,{guard:hits.length>0}]);
      for(const event of e.drainEvents()){
        if(event.type==='hit'){hits.push(event);if(event.kind==='special')confirmed=true;}
        assert.notEqual(event.type,'guard','super cancel must connect before recovery');
      }
    }
    assert.deepEqual(hits.map(v=>v.kind),['special','super']);
    assert.deepEqual(hits.map(v=>v.combo),[1,2]);
  });
}

test('a recovered target starts a fresh combo with full damage',()=>{
  const e=fight();position(e);e.step([{light:true},idle]);run(e,50);
  assert.equal(e.players[1].stun,0);assert.equal(e.players[0].combo,0);
  position(e);e.step([{light:true},idle]);run(e,12);
  const hits=e.drainEvents().filter(v=>v.type==='hit');
  assert.deepEqual(hits.map(v=>v.combo),[1,1]);assert.deepEqual(hits.map(v=>v.damage),[52,52]);
});
test('guarded projectiles cannot grant a hit-confirm super cancel',()=>{
  const e=fight('emerald');position(e,210);e.players[0].meter=100;e.step([{special:true},{guard:true}]);
  for(let i=0;i<60;i++){
    e.step([idle,{guard:true}]);
    if(e.drainEvents().some(v=>v.type==='guard')){
      assert.equal(e.players[0].action.hits.size,0);
      e.hitstop=0;e.step([{super:true},{guard:true}]);
      assert.equal(e.players[0].action.type,'special');assert.equal(e.players[0].meter,100);return;
    }
  }
  assert.fail('expected a guarded projectile');
});
test('an old projectile cannot confirm a different action',()=>{
  const e=fight();position(e,500);e.step([{special:true},idle]);
  while(e.players[0].action)run(e,1);
  e.step([{light:true},idle]);
  for(let i=0;i<20;i++){
    e.step([idle,idle]);
    if(e.drainEvents().some(v=>v.type==='hit')){
      assert.equal(e.players[0].action.type,'light');
      assert.equal(e.players[0].action.hits.size,0);return;
    }
  }
  assert.fail('old projectile must reach target');
});
test('meter cost and cooldown prevent free repeated burst attacks',()=>{
  const e=fight('hacker');position(e,700);e.players[0].meter=24;
  e.step([{burst:true},idle]);assert.equal(e.players[0].action,null);assert.equal(e.players[0].meter,24);
  assert.ok(e.drainEvents().some(v=>v.type==='denied'));
  e.players[0].meter=25;e.step([{burst:true},idle]);assert.equal(e.players[0].meter,0);
  while(e.players[0].action)run(e,1);
  e.players[0].meter=100;assert.ok(e.players[0].cooldowns.burst>0);
  e.step([{burst:true},idle]);assert.equal(e.players[0].action,null);assert.equal(e.players[0].meter,100);
});
test('followup cannot cancel into another followup indefinitely',()=>{
  const e=fight();position(e);e.step([{light:true},idle]);run(e,5);e.hitstop=0;
  e.step([{light:true},idle]);assert.equal(e.players[0].action.type,'followup');run(e,4);e.hitstop=0;
  const id=e.players[0].action.id;e.step([{light:true},idle]);assert.equal(e.players[0].action.id,id);
  e.step([{heavy:true},idle]);assert.equal(e.players[0].action.type,'heavy');
});
test('pursuit throw beats guard but misses airborne opponents',()=>{
  const e=fight('thief');position(e,110);e.step([{command:true},{guard:true}]);run(e,50,idle,{guard:true});
  assert.ok(e.players[1].hp<900);
  const air=fight('thief');position(air,110);air.players[1].y=150;air.step([{command:true},idle]);run(air,20);
  assert.equal(air.players[1].hp,1000);
});

for(const fighter of FIGHTERS)for(const kind of ['command','burst']){
  const move=TECHNIQUES[fighter.id][kind];
  if(move.unblockable)continue;
  test(fighter.id+' '+kind+': guard blocks every hit and never creates a combo',()=>{
    const e=fight(fighter.id);position(e,kind==='burst'&&move.projectile?290:110);e.players[0].meter=100;
    e.step([{[kind]:true},{guard:true}]);run(e,170,idle,{guard:true});
    const events=e.drainEvents();
    assert.equal(events.filter(event=>event.type==='hit').length,0);
    assert.ok(events.some(event=>event.type==='guard'));
    assert.equal(e.players[0].combo,0);
  });
}
test('rising flame reaches an airborne target that a level projectile misses',()=>{
  for(const [id,kind,expected] of [['angry','command',true],['hacker','special',false]]){
    const e=fight(id);position(e,180);e.players[1].y=240;e.players[1].vy=300;
    e.step([{[kind]:true},idle]);run(e,70);
    assert.equal(e.players[1].hp<1000,expected,id);
  }
});

test('extra moves also work for player 2 facing left',()=>{
  const e=fight('cross',1);position(e,140);e.players[1].meter=100;e.step([idle,{burst:true}]);run(e,100);
  assert.ok(e.players[0].hp<1000);assert.equal(e.players[1].hp,950);
});
