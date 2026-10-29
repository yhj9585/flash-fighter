import test from 'node:test';
import assert from 'node:assert/strict';
import { FightEngine } from '../src/engine.js';
import { WORLD, MOVES, fighterById } from '../src/data.js';

const idle={move:0,guard:false};
function run(engine,frames,a=idle,b=idle){for(let i=0;i<frames;i++)engine.step([a,b]);}
function fight(options={}){const e=new FightEngine({mode:'local',...options});e.start();run(e,125);e.drainEvents();return e;}
function nearby(e,distance=110){e.players[0].x=500;e.players[1].x=500+distance;}
function settle(e,frames=100){run(e,frames);}

test('ready → countdown → fighting, timer only counts fighting frames',()=>{
  const e=new FightEngine({mode:'local'});run(e,100);assert.equal(e.phase,'ready');assert.equal(e.remaining,60);
  e.start();run(e,124);assert.equal(e.phase,'intro');assert.equal(e.remaining,60);
  run(e,1);assert.equal(e.phase,'fighting');run(e,60);assert.ok(Math.abs(e.remaining-59)<.001);
});
test('movement stays on the stage, jumping lands, fighters cannot overlap at walls',()=>{
  const e=fight();run(e,300,{move:-1});assert.equal(e.players[0].x,WORLD.left);
  e.step([{jump:true},idle]);assert.ok(e.players[0].y>0);run(e,80);assert.equal(e.players[0].y,0);
  e.players[0].x=WORLD.left;e.players[1].x=WORLD.left+1;e.step([idle,idle]);assert.ok(Math.abs(e.players[0].x-e.players[1].x)>=78);
});
test('one light attack damages once during its active frames',()=>{
  const e=fight();nearby(e);e.step([{light:true},idle]);run(e,50);
  assert.equal(e.players[1].hp,e.players[1].def.health-Math.round(MOVES.light.damage));
  assert.equal(e.drainEvents().filter(v=>v.type==='hit').length,1);
});
test('out of range and airborne targets avoid ground attacks',()=>{
  const e=fight();e.step([{heavy:true},idle]);run(e,50);assert.equal(e.players[1].hp,e.players[1].def.health);
  nearby(e);e.players[1].y=260;e.players[1].vy=0;e.step([{light:true},idle]);run(e,9);assert.equal(e.players[1].hp,e.players[1].def.health);
});
test('guard reduces damage and cannot be held through a throw',()=>{
  const e=fight();nearby(e,95);e.step([{light:true},{guard:true}]);run(e,35,idle,{guard:true});
  const loss=e.players[1].def.health-e.players[1].hp;assert.ok(loss>0 && loss<10);
  nearby(e,95);e.players[1].throwInvuln=0;e.step([{throw:true},{guard:true}]);run(e,8,idle,{guard:true});
  assert.ok(e.players[1].def.health-e.players[1].hp>100);assert.equal(e.players[1].guard,false);assert.equal(e.players[1].state,'hurt');
});
test('hit confirmed light can cancel into heavy then special',()=>{
  const e=fight();nearby(e,90);e.step([{light:true},idle]);run(e,5);
  assert.equal(e.players[0].action.type,'light');assert.equal(e.players[0].action.hits.size,1);
  e.hitstop=0;e.step([{heavy:true},idle]);assert.equal(e.players[0].action.type,'heavy');
  run(e,11);e.hitstop=0;e.step([{special:true},idle]);assert.equal(e.players[0].action.type,'special');
});
test('projectiles hit their opponent once and use their character damage',()=>{
  const e=fight({players:['hacker','tuna']});nearby(e,370);e.step([{special:true},idle]);run(e,90);
  assert.equal(e.players[1].hp,e.players[1].def.health-Math.round(85*.96));
  assert.equal(e.players[0].hp,e.players[0].def.health);assert.equal(e.projectiles.length,0);
});
test('super needs 100 meter, spends it, and rush super connects',()=>{
  const e=fight();nearby(e,200);e.step([{super:true},idle]);assert.equal(e.players[0].action,null);assert.equal(e.players[0].meter,30);
  assert.ok(e.drainEvents().some(v=>v.type==='denied'));
  e.players[0].meter=100;e.step([{super:true},idle]);assert.equal(e.players[0].meter,0);run(e,50);
  assert.ok(e.players[1].hp<e.players[1].def.health-200);
});
test('pause freezes timer, positions, and tick',()=>{
  const e=fight();e.togglePause();const before=e.snapshot();run(e,300,{move:1,heavy:true});assert.deepEqual(e.snapshot(),before);e.togglePause();run(e,1);assert.ok(e.remaining<before.remaining);
});
test('two won rounds finish a match and the next round resets health',()=>{
  const e=fight();e.players[1].hp=0;e.step([idle,idle]);assert.equal(e.phase,'roundOver');assert.deepEqual(e.wins,[1,0]);
  run(e,160);assert.equal(e.round,2);assert.equal(e.players[1].hp,e.players[1].def.health);run(e,125);
  e.players[1].hp=0;e.step([idle,idle]);assert.equal(e.phase,'matchOver');assert.equal(e.matchWinner,0);assert.deepEqual(e.wins,[2,0]);
});
test('timeout compares health percentages and ties award no wins',()=>{
  const e=fight({players:['angry','thief']});e.players[0].hp=550;e.players[1].hp=500;e.remaining=.001;e.step([idle,idle]);assert.equal(e.roundWinner,1);
  const tie=fight();tie.remaining=.001;tie.step([idle,idle]);assert.equal(tie.roundWinner,null);assert.deepEqual(tie.wins,[0,0]);
});
test('training has no timeout or knockout, restores health, keeps full meter',()=>{
  const e=fight({mode:'training'});e.players[1].hp=0;run(e,4000);assert.equal(e.phase,'fighting');assert.equal(e.remaining,60);assert.equal(e.players[0].meter,100);assert.equal(e.players[1].hp,e.players[1].def.health);
});
test('CPU can approach, attack, and complete a match without player input',()=>{
  let seed=27;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const e=fight({mode:'cpu',time:30,wins:1,random});
  for(let i=0;i<9000 && e.phase!=='matchOver';i++)e.step([idle,idle]);
  assert.equal(e.phase,'matchOver');assert.equal(e.matchWinner,1);assert.ok(e.players[0].hp<1000);
});

for(const id of ['fries','cross','emerald']){
  test(id+': original prop special and character super connect with their own damage',()=>{
    const def=fighterById(id),e=fight({players:[id,'tuna']});nearby(e,370);
    e.step([{special:true},idle]);run(e,15);
    assert.equal(e.projectiles[0].prop,def.special.prop);
    run(e,90);
    assert.equal(e.players[1].hp,e.players[1].def.health-Math.round(def.special.damage*def.power));
    const ultimate=fight({players:[id,'tuna']});nearby(ultimate,def.super.type==='rush'?170:370);
    ultimate.players[0].meter=100;ultimate.step([{super:true},idle]);
    assert.equal(ultimate.players[0].meter,0);run(ultimate,100);
    assert.equal(ultimate.players[1].hp,ultimate.players[1].def.health-Math.round(def.super.damage*def.power));
    assert.equal(ultimate.drainEvents().filter(event=>event.type==='hit').length,1);
  });
}
