import test from 'node:test';
import assert from 'node:assert/strict';
import {CombatInput,CHORD_WINDOW_MS,INPUT_BUFFER_MS} from '../src/commands.js';

test('single buttons wait briefly for a chord, then remain buffered until consumed',()=>{
  const b=new CombatInput();assert.equal(b.sample({light:true},10).light,undefined);
  assert.equal(b.sample({},10+CHORD_WINDOW_MS).light,true);
  assert.equal(b.sample({},10+INPUT_BUFFER_MS-1).light,true);
  b.consume();assert.equal(b.sample({},200).light,undefined);
});
for(const [a,b,kind] of [['light','heavy','throw'],['light','special','burst'],['heavy','special','command']]){
  test(a+' + '+b+' resolves in either press order without a stray normal',()=>{
    for(const [first,second] of [[a,b],[b,a]]){
      const buffer=new CombatInput();assert.equal(buffer.sample({[first]:true},0)[first],undefined);
      const result=buffer.sample({[second]:true},35);
      assert.equal(result[kind],true);
      assert.equal(result.light,undefined);assert.equal(result.heavy,undefined);assert.equal(result.special,undefined);
    }
  });
}
test('buttons outside the chord window remain separate inputs',()=>{
  const b=new CombatInput();b.sample({light:true},0);assert.equal(b.sample({},55).light,true);b.consume();
  assert.equal(b.sample({special:true},90).burst,undefined);assert.equal(b.sample({},145).special,true);
});
test('down + heavy overrides the guard direction',()=>{
  const b=new CombatInput(),result=b.sample({down:true,guard:true,heavy:true},0);
  assert.equal(result.command,true);assert.equal(result.guard,true);
});
for(const facing of [1,-1]){
  test('quarter circle forward is relative to facing '+facing,()=>{
    const b=new CombatInput();b.sample({down:true},0,facing);b.sample({down:true,move:facing},60,facing);
    b.sample({move:facing},120,facing);assert.equal(b.sample({move:facing,light:true},150,facing).burst,true);
    b.consume();assert.equal(b.sample({light:true},170,facing).burst,undefined);
  });
}
test('old and backward motions do not trigger a forward command',()=>{
  const b=new CombatInput();b.sample({down:true},0);b.sample({down:true,move:1},30);b.sample({move:1},60);
  assert.equal(b.sample({light:true},450).burst,undefined);
  b.reset();b.sample({down:true},0);b.sample({down:true,move:-1},30);b.sample({move:-1},60);
  assert.equal(b.sample({light:true,move:-1},80).burst,undefined);
});
test('changing sides clears the old direction history',()=>{
  const b=new CombatInput();b.sample({down:true},0,1);b.sample({down:true,move:1},30,1);b.sample({move:1},60,1);
  assert.equal(b.sample({light:true},90,-1).burst,undefined);
});
test('jump and dash survive hitstop buffering and consume independently',()=>{
  const b=new CombatInput();b.sample({jump:true,dash:true},0);
  assert.equal(b.sample({},100).jump,true);b.consume('jump');
  assert.equal(b.sample({},110).jump,false);assert.equal(b.sample({},110).dash,true);
  assert.equal(b.sample({},200).dash,false);
});

test('a newer quarter circle is recognized after an older unused motion expires',()=>{
  const b=new CombatInput();
  for(const [at,down,move] of [[0,true,0],[30,true,1],[60,false,1],[150,true,0],[180,true,1],[210,false,1]])b.sample({down,move},at);
  assert.equal(b.sample({move:1,light:true},230).burst,true);
});
test('three attack buttons prioritize the strong chord instead of accidental throw',()=>{
  const b=new CombatInput(),result=b.sample({light:true,heavy:true,special:true},0);
  assert.equal(result.command,true);assert.equal(result.throw,undefined);
});

