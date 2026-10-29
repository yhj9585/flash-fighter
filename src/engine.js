import { WORLD, fighterById } from './data.js';
import {moveFor} from './combat.js';

const STEP = 1/60;
const blankInput = () => ({move:0,guard:false});
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));

export class FightEngine {
  constructor(options = {}) {
    this.options = {players:['tuna','hacker'],mode:'cpu',stage:'fridge',time:60,wins:2,difficulty:'normal',...options};
    this.random = options.random || Math.random;
    this.events = [];
    this.tick = 0;
    this.actionSerial = 0;
    this.round = 1;
    this.wins = [0,0];
    this.phase = 'ready';
    this.phaseFrames = 0;
    this.paused = false;
    this.hitstop = 0;
    this.projectiles = [];
    this.players = this.options.players.map((id,i) => this.createPlayer(id,i));
    this.remaining = this.options.time;
    this.roundWinner = null;
    this.matchWinner = null;
    this.aiInput = blankInput();
    this.aiFrames = 0;
    this.trainingClock = 0;
  }

  createPlayer(id,index) {
    const def = fighterById(id);
    return {index,def,x:index ? 890:310,y:0,vy:0,facing:index ? -1:1,hp:def.health,meter:this.options.mode==='training'?100:30,
      state:'idle',action:null,stun:0,guard:false,dash:0,dashCooldown:0,specialCooldown:0,combo:0,comboTimer:0,
      hitsTaken:0,damageDealt:0,invulnerable:0,walk:0,throwInvuln:0,hitBy:null,comboDisplay:0,cooldowns:{command:0,burst:0}};
  }

  emit(type,data={}) { this.events.push({type,tick:this.tick,...data}); }
  drainEvents() { return this.events.splice(0); }

  start() {
    if (this.phase !== 'ready') return false;
    this.phase='intro'; this.phaseFrames=125;
    this.emit('roundStart',{round:this.round});
    return true;
  }

  togglePause() {
    if (this.phase === 'ready' || this.phase === 'matchOver') return false;
    this.paused = !this.paused;
    this.emit('pause',{paused:this.paused});
    return this.paused;
  }

  resetRound() {
    this.players = this.options.players.map((id,i)=>this.createPlayer(id,i));
    this.projectiles=[]; this.hitstop=0; this.remaining=this.options.time;
    this.roundWinner=null; this.phase='intro'; this.phaseFrames=125;
    this.aiInput=blankInput(); this.aiFrames=0;
    this.emit('roundStart',{round:this.round});
  }

  step(inputs=[blankInput(),blankInput()]) {
    if (this.paused || this.phase==='ready' || this.phase==='matchOver') return;
    this.tick++;
    if (this.phase==='intro') {
      this.phaseFrames--;
      if (this.phaseFrames===35) this.emit('fight');
      if (this.phaseFrames<=0) { this.phase='fighting'; this.emit('live'); }
      return;
    }
    if (this.phase==='roundOver') {
      this.phaseFrames--;
      if (this.phaseFrames<=0) { this.round++; this.resetRound(); }
      return;
    }
    if (this.hitstop>0) { this.hitstop--; return; }
    if (this.options.mode!=='training') this.remaining=Math.max(0,this.remaining-STEP);
    if (this.options.mode==='cpu') inputs=[inputs[0] || blankInput(),this.computeAI()];
    if (this.options.mode==='training') inputs=[inputs[0] || blankInput(),inputs[1] || blankInput()];

    for (let i=0;i<2;i++) this.updatePlayer(this.players[i],this.players[1-i],inputs[i] || blankInput());
    this.separatePlayers();
    for(const defender of this.players)if(defender.hitBy!==null&&defender.stun===0){
      this.players[defender.hitBy].combo=0;defender.hitBy=null;
    }
    const hits=[];
    for(const attacker of this.players){
      const defender=this.players[1-attacker.index],action=attacker.action;
      if(!action)continue;
      const move=action.move;
      if(move.projectile){
        const shots=move.shots||[{at:move.startup}];
        shots.forEach((shot,index)=>{
          if(action.frame===shot.at&&!action.firedShots.has(index)){
            action.firedShots.add(index);this.spawnProjectile(attacker,action.type,shot,action);
          }
        });
      }
      if(move.projectile)continue;
      const windows=move.hitsAt||[move.startup];
      const window=windows.findIndex(at=>action.frame>=at&&action.frame<at+(move.hitsAt?3:move.active));
      if(window<0||action.contacts.has(window+':'+defender.index))continue;
      const delta=defender.x-attacker.x,vertical=Math.abs(attacker.y-defender.y);
      if(Math.abs(delta)<move.range&&delta*attacker.facing>-35&&vertical<(move.vertical||(action.type==='super'?180:125))&&!defender.invulnerable&&
        !(move.unblockable&&(defender.y>5||defender.throwInvuln))){
        action.contacts.add(window+':'+defender.index);
        hits.push({attacker,defender,move,type:action.type,action});
      }
    }
    for(const projectile of this.projectiles){
      projectile.x+=projectile.speed*STEP;projectile.y+=projectile.vy*STEP;projectile.vy-=projectile.gravity*STEP;projectile.life--;
      const defender=this.players[1-projectile.owner];
      if(projectile.life>0&&!defender.invulnerable&&Math.abs(projectile.x-defender.x)<projectile.radius+32&&Math.abs(projectile.y-(defender.y+90))<projectile.radius+67){
        hits.push({attacker:this.players[projectile.owner],defender,move:projectile.move,type:projectile.type,damage:projectile.damage,projectile:true,action:projectile.action});
        projectile.life=0;
      }
    }
    this.projectiles=this.projectiles.filter(p=>p.life>0&&p.x>-100&&p.x<WORLD.width+100&&p.y>-100&&p.y<750);
    // Resolve collected strikes together so active attacks can trade.
    for(const hit of hits)this.applyHit(hit);

    if (this.options.mode==='training') {
      this.trainingClock++;
      for (const player of this.players) {
        player.meter=100;
        if (player.hp<=0 || this.trainingClock%240===0 && player.stun===0) player.hp=player.def.health;
      }
    } else if (this.players.some(p=>p.hp<=0) || this.remaining<=0) {
      this.finishRound();
    }
  }

  requestedAction(player,input){
    if(input.super)return 'super';
    if(input.command||input.heavy&&input.special||input.heavy&&(input.down??input.guard))return 'command';
    if(input.burst||input.light&&input.special)return 'burst';
    if(input.throw||input.light&&input.heavy)return 'throw';
    if(input.special)return 'special';
    if(input.heavy)return 'heavy';
    if(input.light)return player.action?.type==='light'?'followup':'light';
    return null;
  }

  updatePlayer(player,enemy,input){
    for(const key of ['stun','dashCooldown','specialCooldown','invulnerable','throwInvuln'])player[key]=Math.max(0,player[key]-1);
    for(const key of Object.keys(player.cooldowns))player.cooldowns[key]=Math.max(0,player.cooldowns[key]-1);
    player.comboTimer=Math.max(0,player.comboTimer-1);
    if(player.y>0||player.vy>0){player.y=Math.max(0,player.y+player.vy*STEP);player.vy-=2100*STEP;if(player.y===0)player.vy=0;}
    if(player.action){
      const action=player.action,move=action.move;action.frame++;
      if(move.motion==='rush'&&action.frame>=move.startup-4&&action.frame<move.startup+move.active)player.x+=player.facing*(move.rushSpeed||650)*STEP;
      if(action.frame>=move.startup+move.active+move.recovery){player.action=null;player.state='idle';}
    }
    if(player.stun>0){player.state=player.guard?'guard':'hurt';player.x=clamp(player.x,WORLD.left,WORLD.right);return;}
    if(player.dash>0){player.dash--;player.x+=player.dashDirection*11;player.x=clamp(player.x,WORLD.left,WORLD.right);return;}
    let type=this.requestedAction(player,input);
    if(player.action){
      const current=player.action,next=type&&moveFor(player.def,type);
      if(next&&current.hits.size&&enemy.stun>0&&enemy.hitBy===player.index&&current.frame-current.lastHitFrame<=12&&
        next.rank>current.move.rank&&!next.unblockable)this.tryAction(player,type,current.type);
      player.x=clamp(player.x,WORLD.left,WORLD.right);return;
    }
    player.facing=enemy.x>=player.x?1:-1;
    if(type==='command'||type==='burst'){
      if(this.tryAction(player,type))return;
      type=null;
    }
    const away=input.move===-player.facing;
    player.guard=player.y===0&&(Boolean(input.guard)||away&&(enemy.action||this.projectiles.some(p=>p.owner!==player.index&&Math.abs(p.x-player.x)<260)));
    if(player.guard){player.state='guard';return;}
    if(input.jump&&player.y===0){player.vy=790;player.y=1;this.emit('jump',{player:player.index});}
    if(input.dash&&!player.dashCooldown&&player.y===0){
      player.dash=11;player.dashDirection=input.move||player.facing;player.dashCooldown=50;player.state='dash';this.emit('dash',{player:player.index});return;
    }
    if(type&&this.tryAction(player,type))return;
    const movement=clamp(input.move||0,-1,1);
    player.x=clamp(player.x+movement*player.def.speed*STEP,WORLD.left,WORLD.right);
    player.walk+=Math.abs(movement)*.16;player.state=player.y>0?'jump':movement?'walk':'idle';
  }

  tryAction(player,type,cancelledFrom=null){
    const move=moveFor(player.def,type);
    if(move.groundOnly&&player.y>0)return false;
    if((move.cost||0)>player.meter){this.emit('denied',{player:player.index,message:'기력 '+move.cost+' 필요'});return false;}
    if(type==='special'&&player.specialCooldown||player.cooldowns[type]>0)return false;
    this.beginAction(player,type,cancelledFrom);return true;
  }

  beginAction(player,type,cancelledFrom=null){
    const move={...moveFor(player.def,type)};
    if(type==='super'&&cancelledFrom)move.startup=10;
    if(move.groundOnly&&player.y>0)return false;
    player.action={id:++this.actionSerial,type,move,cancelledFrom,frame:0,hits:new Set(),contacts:new Set(),firedShots:new Set(),lastHitFrame:-100};
    player.state=type;player.guard=false;
    if(type==='special')player.specialCooldown=70;
    if(move.cooldown)player.cooldowns[type]=move.cooldown;
    player.meter=Math.max(0,player.meter-(move.cost||0));
    if(type==='super')player.invulnerable=23;
    if(move.selfLift){player.vy=move.selfLift;player.y=Math.max(1,player.y);}
    this.emit('attack',{player:player.index,kind:type,voice:move.voice});
    return true;
  }

  spawnProjectile(player,type,shot={},action=player.action){
    const move=action.move,ultimate=type==='super';
    this.projectiles.push({owner:player.index,type,prop:move.prop,x:player.x+player.facing*65,y:player.y+95+(shot.y||0),
      speed:(shot.speed||move.speed||650)*player.facing,vy:shot.vy||0,gravity:shot.gravity||0,
      damage:move.damage,life:150,radius:move.radius||(ultimate?68:29),move,action,rotation:0});
    this.emit('projectile',{player:player.index,kind:type});
  }

  separatePlayers() {
    const [a,b]=this.players;
    if (Math.abs(a.y-b.y)>145) return;
    const delta=b.x-a.x, distance=Math.abs(delta), minimum=78;
    if (distance>=minimum) return;
    const sign=delta>=0?1:-1, push=(minimum-distance)/2;
    a.x=clamp(a.x-push*sign,WORLD.left,WORLD.right);
    b.x=clamp(b.x+push*sign,WORLD.left,WORLD.right);
    // At the wall the free fighter absorbs the remaining separation.
    if (Math.abs(a.x-b.x)<minimum) {
      if (a.x===WORLD.left) b.x=a.x+minimum;
      if (b.x===WORLD.right) a.x=b.x-minimum;
      if (b.x===WORLD.left) a.x=b.x+minimum;
      if (a.x===WORLD.right) b.x=a.x-minimum;
    }
  }

  applyHit({attacker,defender,move,type,damage,projectile,action}){
    if(defender.hp<=0)return;
    const blocked=defender.guard&&!move.unblockable&&defender.y===0;
    const continuing=defender.hitBy===attacker.index&&defender.stun>0&&!defender.guard;
    if(!continuing)attacker.combo=0;
    const base=damage??move.damage,scaling=Math.max(.5,Math.pow(.9,attacker.combo));
    const finalDamage=Math.round(base*attacker.def.power*scaling*(blocked?.12:1));
    defender.hp=blocked?Math.max(1,defender.hp-finalDamage):Math.max(0,defender.hp-finalDamage);
    defender.stun=blocked?12:move.stun;defender.guard=blocked;defender.action=null;defender.dash=0;
    defender.state=blocked?'guard':'hurt';
    const direction=defender.x>=attacker.x?1:-1;
    defender.x=clamp(defender.x+direction*move.push*(blocked?.55:1),WORLD.left,WORLD.right);defender.throwInvuln=45;
    if(!blocked&&(move.launch||type==='super')){defender.vy=move.launch||390;defender.y=Math.max(1,defender.y);}
    if(!blocked){
      attacker.combo++;attacker.comboDisplay=attacker.combo;attacker.comboTimer=100;
      defender.hitBy=attacker.index;defender.combo=0;defender.hitsTaken++;attacker.damageDealt+=finalDamage;
      if(action){action.hits.add(defender.index);action.lastHitFrame=action.frame;}
    }else{attacker.combo=0;defender.hitBy=null;}
    if(type!=='super')attacker.meter=clamp(attacker.meter+(blocked?5:13),0,100);
    defender.meter=clamp(defender.meter+(blocked?3:7),0,100);
    this.hitstop=Math.max(this.hitstop,blocked?3:type==='super'?13:type==='heavy'?8:5);
    this.emit(blocked?'guard':'hit',{player:attacker.index,target:defender.index,kind:type,damage:finalDamage,
      x:defender.x,y:defender.y+105,combo:attacker.combo,projectile:Boolean(projectile)});
  }

  finishRound() {
    const [a,b]=this.players;
    const aRatio=a.hp/a.def.health, bRatio=b.hp/b.def.health;
    let winner=null;
    if (aRatio!==bRatio) winner=aRatio>bRatio?0:1;
    this.roundWinner=winner;
    if (winner!==null) this.wins[winner]++;
    this.projectiles=[];
    for (const player of this.players) { player.action=null; player.guard=false; player.state=player.index===winner?'win':player.hp<=0?'ko':'idle'; }
    this.emit('roundEnd',{winner,timeout:this.remaining<=0,round:this.round});
    if (winner!==null && this.wins[winner]>=this.options.wins) {
      this.phase='matchOver'; this.matchWinner=winner;
      this.emit('matchEnd',{winner,wins:[...this.wins]});
    } else { this.phase='roundOver'; this.phaseFrames=160; }
  }

  computeAI() {
    const player=this.players[1], enemy=this.players[0];
    const difficulty=this.options.difficulty;
    const interval=difficulty==='hard'?9:difficulty==='easy'?27:17;
    if(player.action?.hits.size&&enemy.stun>0&&this.random()<(difficulty==='hard'?.7:difficulty==='easy'?.12:.4)){
      if(player.meter>=100&&player.action.move.rank<4)return {super:true};
      if(player.action.move.rank<2)return {heavy:true};
      if(player.action.move.rank<3)return {special:true};
    }
    this.aiFrames--;
    if (this.aiFrames>0) return {move:this.aiInput.move,guard:this.aiInput.guard};
    this.aiFrames=interval;
    const distance=Math.abs(enemy.x-player.x), toward=enemy.x>player.x?1:-1;
    const rand=this.random;
    const input={move:distance>125?toward:0,guard:false};
    const danger=(enemy.action && enemy.action.frame<enemy.action.move.startup+4 && distance<220) || this.projectiles.some(p=>p.owner===0 && Math.abs(p.x-player.x)<250);
    if (danger && rand()<(difficulty==='hard'?.77:difficulty==='easy'?.14:.44)) {
      input.guard=true; input.move=0;
    } else if (distance<102 && enemy.guard && rand()<.65) { input.throw=true; }
    else if (player.meter>=100 && distance<450 && rand()<.36) { input.super=true; }
    else if(player.meter>=25&&!player.cooldowns.burst&&distance<620&&rand()<.18){input.burst=true;}
    else if(distance<200&&!player.cooldowns.command&&rand()<.22){input.command=true;}
    else if (distance<155) {
      const pick=rand();
      if (pick<.5) input.light=true;
      else if (pick<.83) input.heavy=true;
      else if (pick<.93) input.special=true;
      else input.jump=true;
    } else if (distance<650 && !player.specialCooldown && rand()<.38) input.special=true;
    else if (distance>370 && rand()<.2) input.dash=true;
    else if (distance<280 && rand()<.12) input.jump=true;
    this.aiInput={move:input.move,guard:input.guard};
    return input;
  }

  snapshot() {
    return {phase:this.phase,paused:this.paused,round:this.round,wins:[...this.wins],remaining:this.remaining,mode:this.options.mode,
      winner:this.matchWinner,players:this.players.map(p=>({id:p.def.id,hp:p.hp,meter:p.meter,x:p.x,y:p.y,state:p.state,combo:p.combo,lastCombo:p.comboDisplay,stun:p.stun,guard:p.guard,action:p.action?.type||null,actionFrame:p.action?.frame||0,cooldowns:{...p.cooldowns,special:p.specialCooldown}})),projectiles:this.projectiles.length};
  }
}

export { STEP };