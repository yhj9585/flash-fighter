import {FightEngine} from './engine.js';
import {fighterById} from './data.js';
import {moveFor} from './combat.js';

export function encodeMatch(engine){
  return {
    tick:engine.tick,phase:engine.phase,paused:engine.paused,round:engine.round,wins:[...engine.wins],remaining:engine.remaining,
    phaseFrames:engine.phaseFrames,roundWinner:engine.roundWinner,matchWinner:engine.matchWinner,options:{...engine.options,random:undefined},
    players:engine.players.map(p=>({
      index:p.index,id:p.def.id,x:p.x,y:p.y,vy:p.vy,facing:p.facing,hp:p.hp,meter:p.meter,state:p.state,
      guard:p.guard,walk:p.walk,dash:p.dash,dashDirection:p.dashDirection,invulnerable:p.invulnerable,stun:p.stun,
      combo:p.combo,comboDisplay:p.comboDisplay,comboTimer:p.comboTimer,damageDealt:p.damageDealt,
      cooldowns:{...p.cooldowns},specialCooldown:p.specialCooldown,
      action:p.action?{type:p.action.type,frame:p.action.frame,startup:p.action.move.startup,cancelledFrom:p.action.cancelledFrom}:null
    })),
    projectiles:engine.projectiles.map(p=>({owner:p.owner,type:p.type,prop:p.prop,x:p.x,y:p.y,speed:p.speed,vy:p.vy,radius:p.radius,life:p.life}))
  };
}

// Drawing only: online damage, clocks, collisions and rounds run on the server.
export class RemoteMatch extends FightEngine{
  constructor(frame){super(frame.options);this.targets=[];this.applyFrame(frame,true);}
  applyFrame(frame,immediate=false){
    for(const key of ['tick','phase','paused','round','remaining','phaseFrames','roundWinner','matchWinner'])this[key]=frame[key];
    this.wins=[...frame.wins];this.options={...frame.options};
    this.players=frame.players.map((p,i)=>{
      const previous=this.players[i],def=fighterById(p.id);
      const position=immediate||!previous||previous.def.id!==p.id?{x:p.x,y:p.y}:{x:previous.x,y:previous.y};
      this.targets[i]={x:p.x,y:p.y};
      return {...p,...position,def,action:p.action?{...p.action,move:{...moveFor(def,p.action.type),startup:p.action.startup}}:null};
    });
    this.projectiles=frame.projectiles.map(p=>({...p}));
  }
  animate(dt){
    const amount=Math.min(1,dt*35);
    this.players.forEach((p,i)=>{p.x+=(this.targets[i].x-p.x)*amount;p.y+=(this.targets[i].y-p.y)*amount;});
  }
  step(){}
}
