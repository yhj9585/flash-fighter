export const CHORD_WINDOW_MS=50;
export const INPUT_BUFFER_MS=180;
export const MOTION_WINDOW_MS=350;

// One logical sampler serves keyboard, multitouch and both gamepads.
export class CombatInput {
  constructor(){this.reset();}
  reset(){this.pending=null;this.intent=null;this.history=[];this.facing=null;this.direction=5;this.aux={};}
  consume(kind){if(kind){delete this.aux[kind];return;}this.pending=null;this.intent=null;this.history=[];}
  hasQuarterCircle(now){
    const recent=this.history.filter(h=>now-h.at<=MOTION_WINDOW_MS);
    let phase=0,last=0;
    for(const entry of recent){
      if(entry.direction===4||entry.direction===1){phase=0;continue;}
      if(entry.direction===[2,3,6][phase]){phase++;last=entry.at;}
      if(phase===3){if(now-last<=140)return true;phase=0;}
    }
    return false;
  }
  sample(raw,now,facing=1){
    if(this.facing!==null&&this.facing!==facing){this.history=[];this.direction=5;}
    this.facing=facing;
    for(const kind of ['jump','dash'])if(raw[kind])this.aux[kind]=now+INPUT_BUFFER_MS;
    const down=Boolean(raw.down),forward=(raw.move||0)*facing;
    const direction=down?(forward>0?3:forward<0?1:2):forward>0?6:forward<0?4:5;
    if(direction!==this.direction){this.history.push({direction,at:now});this.direction=direction;}
    this.history=this.history.filter(h=>now-h.at<=MOTION_WINDOW_MS);
    if(this.intent&&this.intent.expires<now)this.intent=null;
    const setIntent=kind=>{this.intent={kind,expires:now+INPUT_BUFFER_MS};this.pending=null;};
    const buttons=['light','heavy','special'].filter(key=>raw[key]);
    if(raw.super)setIntent('super');
    else if(raw.throw)setIntent('throw');
    else if(raw.command)setIntent('command');
    else if(raw.burst)setIntent('burst');
    else if(buttons.length){
      const paired=new Set(buttons);
      if(this.pending&&now-this.pending.at<=CHORD_WINDOW_MS)paired.add(this.pending.button);
      if(paired.has('heavy')&&paired.has('special'))setIntent('command');
      else if(paired.has('light')&&paired.has('special'))setIntent('burst');
      else if(paired.has('light')&&paired.has('heavy'))setIntent('throw');
      else if(raw.heavy&&down)setIntent('command');
      else if(raw.light&&this.hasQuarterCircle(now))setIntent('burst');
      else this.pending={button:buttons.at(-1),at:now};
    }
    if(this.pending&&now-this.pending.at>=CHORD_WINDOW_MS){
      const pending=this.pending;this.pending=null;
      this.intent={kind:pending.button,expires:pending.at+INPUT_BUFFER_MS};
    }
    const result={move:raw.move||0,guard:Boolean(raw.guard),down,jump:(this.aux.jump||0)>now,dash:(this.aux.dash||0)>now};
    if(this.intent&&this.intent.expires>=now)result[this.intent.kind]=true;
    return result;
  }
}
