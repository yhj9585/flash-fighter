import { WORLD, FIGHTERS } from './data.js';
import {TECHNIQUES,moveArt} from './combat.js';

export class Renderer {
  constructor(canvas,settings) {
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d');
    this.settings=settings;
    this.images=new Map();
    this.effects=[];
    this.particles=[];
    this.shake=0;
    this.clock=0;
    this.resize();
  }

  async load() {
    const extra=Object.values(TECHNIQUES).flatMap(Object.values);
    const characters=[...new Set([...FIGHTERS.flatMap(f=>Object.values(f.art)),...extra.flatMap(m=>[m.art,...(m.poses||[]).map(p=>p.art)])])];
    const props=[...new Set(['note','window',...FIGHTERS.flatMap(f=>[f.special.prop,f.super.prop]),...extra.flatMap(m=>[m.prop,m.effectProp])].filter(Boolean))];
    const paths=[...characters.map(p=>`characters/${p}`),...props.map(p=>`props/${p}`),'stages/fridge','stages/computer'];
    await Promise.all(paths.map(async path=>{
      const img=new Image(); img.src=`./assets/${path}.svg`;
      await img.decode(); this.images.set(path,img);
    }));
  }

  resize() {
    const ratio=Math.min(window.devicePixelRatio || 1,2);
    this.canvas.width=WORLD.width*ratio;
    this.canvas.height=WORLD.height*ratio;
    this.ctx.setTransform(ratio,0,0,ratio,0,0);
    this.ratio=ratio;
  }

  image(key,x,y,width,height,alpha=1) {
    const img=this.images.get(key); if (!img) return;
    this.ctx.save(); this.ctx.globalAlpha=alpha;
    this.ctx.drawImage(img,x,y,width,height); this.ctx.restore();
  }

  original(key,x,y,height,alpha=1) {
    const img=this.images.get(key); if (!img) return;
    this.image(key,x,y,height*img.width/img.height,height,alpha);
  }

  onEvent(event) {
    if (event.type==='hit' || event.type==='guard') {
      const blocked=event.type==='guard';
      const strong=event.kind==='super';
      const x=event.x, y=WORLD.floor-event.y;
      this.shake=this.settings.motion && !blocked?(strong?13:5):0;
      for(let i=0;i<(blocked?4:11);i++) {
        const angle=Math.PI*2*i/11;
        this.particles.push({x,y,vx:Math.cos(angle)*(90+Math.random()*120),vy:Math.sin(angle)*(100+Math.random()*90),life:25,max:25,color:blocked?'#98bdb7':i%2?'#efc94c':'#333'});
      }
    } else if (event.type==='denied') {
      this.effects.push({x:event.player?890:310,y:120,life:75,max:75,text:event.message,color:'#777'});
    }
  }

  render(engine,dt=1/60) {
    this.clock+=dt;
    const aspect=this.canvas.clientWidth/this.canvas.clientHeight;
    this.xScale=aspect<2.6?Math.min(1,(WORLD.height*aspect-125)/(WORLD.width-160)):1;
    const c=this.ctx;
    c.setTransform(this.ratio,0,0,this.ratio,0,0);
    c.clearRect(0,0,WORLD.width,WORLD.height);
    c.save();
    if(this.shake>0) { c.translate(Math.sin(this.clock*150)*this.shake,Math.cos(this.clock*112)*this.shake*.35); this.shake=Math.max(0,this.shake-dt*38); }
    this.drawStage(engine.options.stage);
    for(const p of engine.players) this.drawPlayer(p,engine);
    for(const p of engine.projectiles) this.drawProjectile(p);
    if(this.settings.hitboxes) this.drawHitboxes(engine);
    c.restore();
    if(!engine.paused) this.updateEffects(dt);
    this.drawEffects();
    if(engine.phase==='fighting') this.drawCombo(engine);
  }

  mapX(x) { return WORLD.width/2+(x-WORLD.width/2)*(this.xScale || 1); }

  drawStage(stage) {
    const c=this.ctx;
    if(stage==='fridge') {
      this.original('stages/fridge',97,127,222,.19);
      this.original('props/tuna-can',113,243,31,.26);
      this.original('props/pepper',1030,286,40,.13);
    } else if(stage==='computer') {
      this.original('stages/computer',886,137,218,.21);
      this.original('props/window',106,168,50,.13);
      this.original('props/file',148,268,37,.2);
    }
    c.strokeStyle='#aaa89d'; c.lineWidth=1.5;
    c.beginPath(); c.moveTo(47,358);
    for(let x=47;x<1155;x+=25) c.lineTo(x,357+Math.sin(x*.036)*1.3);
    c.stroke();
    c.strokeStyle='#dedbd1'; c.lineWidth=1;
    c.beginPath(); c.moveTo(65,361); c.lineTo(1135,360); c.stroke();
    for(const x of [100,222,391,537,699,832,1044]) {
      c.beginPath();c.moveTo(x,367);c.lineTo(x+17,364);c.stroke();
    }
  }

  drawPlayer(player,engine) {
    const c=this.ctx, def=player.def;
    const idle=engine.phase==='ready' || engine.phase==='intro';
    const state=idle?'idle':player.state==='dash'?'walk':player.state;
    const art=idle?def.art.idle:moveArt(def,player.action,state);
    const img=this.images.get(`characters/${art}`); if(!img) return;
    let height=def.height, width=height*img.width/img.height;
    const anchor=def.artAnchor?.[art] ?? def.anchorX ?? .5;
    const animated=this.settings.motion && !engine.paused;
    const bob=animated && ['idle','walk','win'].includes(state)?Math.sin(this.clock*(state==='walk'?16:3.8)+player.index)*2.2:0;
    const squash=state==='guard'?.84:1;
    const actionProgress=player.action?player.action.frame/(player.action.move.startup+player.action.move.active):0;
    let lean=state==='walk'?Math.sin(player.walk)*.065:state==='hurt'?-player.facing*.15:state==='guard'?-player.facing*.1:0;
    if(player.action) lean=Math.sin(Math.min(1,actionProgress)*Math.PI)*player.facing*.1;
    let x=this.mapX(player.x), y=WORLD.floor-player.y-bob;
    // Original kick art looks left; other hacking-song poses look right.
    const artFacing=def.artFacing?.[art] ?? (art==='hacker-kick'?-1:def.facing);
    const flip=player.facing/artFacing;
    if(state==='ko') { lean=player.facing*1.48; y=WORLD.floor-5; }
    c.save();
    c.fillStyle='rgba(40,35,25,.06)';
    c.beginPath();c.ellipse(x,WORLD.floor+1,54*(1-player.y/650),6,0,0,Math.PI*2);c.fill();
    if(player.dash>0 && animated) {
      c.save(); c.globalAlpha=.12;
      c.translate(x-player.dashDirection*46,y);c.scale(flip,1);
      c.drawImage(img,-width*anchor,-height,width,height);c.restore();
      c.strokeStyle='#bbb6a7';c.lineWidth=1.6;
      for(let j=0;j<3;j++){c.beginPath();c.moveTo(x-player.dashDirection*(68+j*12),y-height*.45+j*13);c.lineTo(x-player.dashDirection*(110+j*12),y-height*.45+j*13);c.stroke();}
    }
    c.translate(x,y);c.rotate(lean);c.scale(flip,squash);
    if(player.invulnerable>0 && animated) c.globalAlpha=.65+Math.sin(this.clock*30)*.3;
    c.drawImage(img,-width*anchor,-height,width,height);
    c.restore();
    const move=player.action?.move;
    if(move?.effectProp&&player.action.frame>=move.startup&&player.action.frame<move.startup+move.active){
      const effect=this.images.get('props/'+move.effectProp),size=180;
      if(effect)this.image('props/'+move.effectProp,x+player.facing*90-size/2,y-210,size,size*effect.height/effect.width,.9);
    }
    if(player.guard) {
      c.strokeStyle='#80aaa5';c.lineWidth=3;
      c.beginPath();c.ellipse(x+player.facing*48,y-88,17,64,player.facing*.1,-Math.PI/2,Math.PI/2);c.stroke();
    }
  }

  drawProjectile(projectile) {
    const c=this.ctx, img=this.images.get(`props/${projectile.prop}`);if(!img)return;
    const size=projectile.type==='super'?140:projectile.prop==='rice'?64:projectile.prop==='fire'?70:55;
    const w=size, h=size*img.height/img.width;
    c.save();c.translate(this.mapX(projectile.x),WORLD.floor-projectile.y);
    if(['tuna-can','rice','file','fries','beans','fishcake'].includes(projectile.prop)) c.rotate(this.clock*(projectile.speed>0?6:-6));
    if(projectile.prop==='phoenix') c.scale(projectile.speed>0?-1:1,1);
    c.drawImage(img,-w/2,-h/2,w,h);
    c.restore();
  }

  updateEffects(dt) {
    for(const e of this.effects) e.life-=dt*60;
    for(const p of this.particles) {p.life-=dt*60;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=430*dt;}
    this.effects=this.effects.filter(e=>e.life>0);
    this.particles=this.particles.filter(p=>p.life>0);
  }

  drawEffects() {
    const c=this.ctx;
    for(const p of this.particles) {
      c.save();c.globalAlpha=p.life/p.max;c.strokeStyle=p.color;c.lineWidth=2.5;
      c.beginPath();c.moveTo(this.mapX(p.x),p.y);c.lineTo(this.mapX(p.x-p.vx*.04),p.y-p.vy*.04);c.stroke();c.restore();
    }
    for(const e of this.effects) {
      c.save();c.globalAlpha=Math.min(1,e.life/12);c.translate(this.mapX(e.x),e.y-(e.max-e.life)*.6);
      c.rotate(-.09);
      c.font=`bold ${e.strong?47:e.text.length>8?22:36}px Gaegu, sans-serif`;
      c.textAlign='center';c.lineWidth=6;c.strokeStyle='#fff';c.strokeText(e.text,0,0);
      c.fillStyle=e.color;c.fillText(e.text,0,0);c.restore();
    }
  }

  drawCombo(engine) {
    const c=this.ctx;
    for(const player of engine.players) if(player.comboDisplay>=2 && player.comboTimer>0) {
      c.save();c.textAlign=player.index?'right':'left';c.fillStyle='#38362c';
      c.font='bold 36px Gaegu, sans-serif';c.fillText(`${player.comboDisplay} HIT`,this.mapX(player.index?1132:68),150);c.restore();
    }
  }

  drawHitboxes(engine) {
    const c=this.ctx;c.save();c.lineWidth=1;
    for(const p of engine.players) {
      c.strokeStyle='#3676d5';c.strokeRect(this.mapX(p.x)-34,WORLD.floor-p.y-p.def.height,68,p.def.height);
      if(p.action){const m=p.action.move;c.strokeStyle='#ef3535';c.strokeRect(this.mapX(p.x)+(p.facing<0?-m.range:0),WORLD.floor-p.y-145,m.range,115);}
    }
    c.restore();
  }
}
