export const MENU_MUSIC = [
  {name:'menu-tuna-mr',file:'./assets/audio/menu/tuna-mr.mp3'},
  {name:'menu-shiho',file:'./assets/audio/menu/shiho.mp3'},
  {name:'menu-blue-sky',file:'./assets/audio/menu/blue-sky.mp3'},
];

export class GameAudio {
  constructor(settings) {
    this.settings=settings;
    this.buffers=new Map();this.pending=new Map();this.voices=new Map();this.voiceRequests=new Map();this.lastHurt=[-100,-100];
    this.context=null;this.musicNode=null;this.musicName=null;this.musicRequest=null;this.musicMode=null;
    this.menuSession=null;this.menuIndex=0;this.paused=false;
  }
  async unlock() {
    if(!this.context) {
      const Context=window.AudioContext || window.webkitAudioContext;
      if(!Context)return;
      this.context=new Context();
      this.master=this.context.createGain();
      this.limiter=this.context.createDynamicsCompressor();
      for(const [key,value] of Object.entries({threshold:-3,knee:0,ratio:20,attack:.003,release:.1}))this.limiter[key].value=value;
      this.master.connect(this.limiter);this.limiter.connect(this.context.destination);
      this.sfx=this.context.createGain();this.sfx.connect(this.master);
      this.musicGain=this.context.createGain();this.musicGain.connect(this.master);
      this.update();
    }
    if(this.context.state==='suspended') await this.context.resume();
  }
  update() {
    if(!this.context)return;
    const now=this.context.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted?0:1,now,.025);
    this.sfx.gain.setTargetAtTime(this.settings.volume,now,.025);
    this.musicGain.gain.setTargetAtTime(!this.paused&&this.settings.musicOn?this.settings.music:0,now,.1);
  }
  async buffer(name,file=`./assets/audio/${name}.wav`) {
    if(this.buffers.has(name))return this.buffers.get(name);
    if(!this.pending.has(name)) this.pending.set(name,(async()=>{
      const response=await fetch(file);
      if(!response.ok)throw new Error(`Audio unavailable: ${name}`);
      const buffer=await this.context.decodeAudioData(await response.arrayBuffer());
      this.buffers.set(name,buffer);return buffer;
    })());
    const request=this.pending.get(name);
    try{return await request;}
    finally{if(this.pending.get(name)===request)this.pending.delete(name);}
  }
  async play(name,channel='preview',{interrupt=true}={}) {
    // A dialog preview owns the voice bus until it ends or selection closes it.
    if(channel!=='preview'&&(this.voices.has('preview')||this.voiceRequests.has('preview')))return;
    // Let routine battle lines finish; keep at most one line per player.
    if(!interrupt && (this.voices.has(channel)||this.voiceRequests.has(channel)))return;
    const request={};this.voiceRequests.set(channel,request);
    try {
      await this.unlock();if(!this.context||this.voiceRequests.get(channel)!==request)return;
      const buffer=await this.buffer(name);
      if(this.voiceRequests.get(channel)!==request)return;
      const old=this.voices.get(channel);if(old)try{old.stop();}catch{}
      const node=this.context.createBufferSource();node.buffer=buffer;node.connect(this.sfx);node.start();
      this.voices.set(channel,node);node.onended=()=>{if(this.voices.get(channel)===node)this.voices.delete(channel);};
    } catch(error) {console.warn(error.message);}
    finally {if(this.voiceRequests.get(channel)===request)this.voiceRequests.delete(channel);}
  }
  stopVoice(channel) {
    this.voiceRequests.delete(channel);
    const node=this.voices.get(channel);this.voices.delete(channel);
    if(node)try{node.stop();}catch{}
  }
  stopVoices() {
    this.voiceRequests.clear();
    for(const channel of this.voices.keys())this.stopVoice(channel);
  }
  select(name,player) {this.stopVoice('preview');return this.play(name,`voice-${player}`);}
  preview(name) {this.stopVoices();return this.play(name,'preview');}
  async music(source) {
    const name=`${source}-loop`;
    if(this.musicMode==='stage'&&this.musicName===name && (this.musicNode||this.musicRequest))return;
    this.stopMusic();this.musicMode='stage';this.musicName=name;
    const request={};this.musicRequest=request;
    try {
      await this.unlock();if(!this.context||this.musicRequest!==request)return;
      const buffer=await this.buffer(name);if(this.musicRequest!==request)return;
      const node=this.context.createBufferSource();node.buffer=buffer;node.loop=true;node.connect(this.musicGain);node.start();this.musicNode=node;
    } catch(error) {console.warn(error.message);}
    finally {if(this.musicRequest===request){this.musicRequest=null;if(!this.musicNode){this.musicName=null;this.musicMode=null;}}}
  }
  async menuMusic() {
    if(this.musicMode==='menu'&&(this.musicNode||this.musicRequest))return;
    this.stopMusic();this.musicMode='menu';
    const session={};this.menuSession=session;
    await this.startMenuTrack(session);
  }
  async startMenuTrack(session) {
    // Skip unavailable tracks once per request, then wait for a later retry.
    for(let attempt=0;attempt<MENU_MUSIC.length;attempt++) {
      if(this.menuSession!==session)return;
      const track=MENU_MUSIC[this.menuIndex],request={};
      this.musicName=track.name;this.musicRequest=request;
      try {
        await this.unlock();if(!this.context||this.menuSession!==session)return;
        const buffer=await this.buffer(track.name,track.file);
        if(this.menuSession!==session||this.musicRequest!==request)return;
        const node=this.context.createBufferSource();node.buffer=buffer;node.loop=false;node.connect(this.musicGain);
        node.onended=()=>{
          if(this.menuSession!==session||this.musicNode!==node)return;
          this.musicNode=null;this.menuIndex=(this.menuIndex+1)%MENU_MUSIC.length;
          return this.startMenuTrack(session);
        };
        node.start();this.musicNode=node;return;
      } catch(error) {console.warn(error.message);}
      finally {if(this.musicRequest===request)this.musicRequest=null;}
      if(this.menuSession!==session)return;
      this.menuIndex=(this.menuIndex+1)%MENU_MUSIC.length;
    }
    if(this.menuSession===session){this.menuSession=null;this.musicMode=null;this.musicName=null;}
  }
  stopMusic() {
    this.menuSession=null;this.musicRequest=null;
    if(this.musicNode){this.musicNode.onended=null;try{this.musicNode.stop();}catch{}}
    this.musicNode=null;this.musicName=null;this.musicMode=null;
  }
  pause(paused) {if(paused&&!this.paused)this.stopVoices();this.paused=paused;if(this.context)this.musicGain.gain.setTargetAtTime(paused?0:this.settings.musicOn?this.settings.music:0,this.context.currentTime,.1);}
  tone(kind='light') {
    if(!this.context || this.settings.muted)return;
    const c=this.context, osc=c.createOscillator(),gain=c.createGain(),now=c.currentTime;
    const freq=kind==='guard'?330:kind==='heavy'?95:kind==='super'?65:kind==='ui'?540:155;
    osc.type=kind==='guard'?'triangle':'sine';osc.frequency.setValueAtTime(freq,now);osc.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.25),now+.12);
    gain.gain.setValueAtTime(kind==='ui'?.08:.3,now);gain.gain.exponentialRampToValueAtTime(.001,now+.15);
    osc.connect(gain);gain.connect(this.sfx);osc.start(now);osc.stop(now+.16);
  }
  onEvent(event,engine) {
    if(event.type==='roundStart'){this.stopVoice('voice-0');this.stopVoice('voice-1');this.lastHurt=[-100,-100];}
    if(event.type==='attack' && event.voice)this.play(event.voice,`voice-${event.player}`,{interrupt:event.kind==='super'});
    if(event.type==='hit') {
      this.tone(event.kind);
      if(event.tick-this.lastHurt[event.target]>85){this.lastHurt[event.target]=event.tick;this.play(engine.players[event.target].def.voice.hurt,`voice-${event.target}`,{interrupt:false});}
    }
    if(event.type==='guard')this.tone('guard');
    if(event.type==='fight')this.tone('ui');
    if(event.type==='roundEnd' && event.winner!==null)this.play(engine.players[event.winner].def.voice.win,`voice-${event.winner}`);
    if(event.type==='pause')this.pause(event.paused);
    if(event.type==='matchEnd')this.stopMusic();
  }
}
