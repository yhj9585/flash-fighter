import { FIGHTERS, STAGES } from './data.js';
export const MODES = [
  {id:'cpu',name:'혼자서 플레이',icon:'1P',note:'CPU 대전'},
  {id:'multiplayer',name:'멀티플레이',icon:'2P',note:'온라인 / 같은 기기'},
  {id:'training',name:'연습장',icon:'∞',note:'자유 연습'},
];
export class GameFlow {
  constructor(){
    this.screen='mode';this.mode='cpu';this.fighters=['tuna','hacker'];this.stage='fridge';this.seat=0;this.confirmed=[false,false];
  }
  get step(){return {mode:0,multiplayer:0,characters:1,stage:2,versus:3,battle:3}[this.screen];}
  get opponentLabel(){return this.mode==='cpu'?'CPU':this.mode==='training'?'연습 상대':'2P';}
  chooseMode(id){if(this.screen==='mode'&&MODES.some(m=>m.id===id))this.mode=id;}
  chooseMultiplayer(id){
    if(this.screen!=='multiplayer'||!['local','online'].includes(id))return;
    this.mode=id;this.seat=0;this.confirmed=[false,false];
    if(id==='local')this.screen='characters';
  }
  chooseFighter(id){if(this.screen==='characters'&&FIGHTERS.some(f=>f.id===id))this.fighters[this.seat]=id;}
  chooseStage(id){if(this.screen==='stage'&&STAGES.some(s=>s.id===id))this.stage=id;}
  next(){
    if(this.screen==='mode'){
      if(this.mode==='multiplayer')this.screen='multiplayer';
      else{this.screen='characters';this.seat=0;this.confirmed=[false,false];}
    }else if(this.screen==='characters'){
      this.confirmed[this.seat]=true;
      if(this.seat===0)this.seat=1;else this.screen='stage';
    }else if(this.screen==='stage'&&this.confirmed.every(Boolean))this.screen='versus';
    else if(this.screen==='versus')this.screen='battle';
    return this.screen;
  }
  back(){
    if(this.screen==='characters'){
      if(this.seat===1){this.seat=0;this.confirmed=[false,false];}
      else if(this.mode==='local'){this.screen='multiplayer';this.mode='multiplayer';}
      else this.screen='mode';
    }else if(this.screen==='multiplayer')this.home();
    else if(this.screen==='stage'){this.screen='characters';this.seat=1;this.confirmed[1]=false;}
    else if(this.screen==='versus')this.screen='stage';
    return this.screen;
  }
  characters(){this.screen='characters';this.seat=0;this.confirmed=[false,false];}
  home(){this.screen='mode';this.seat=0;this.confirmed=[false,false];if(['local','online'].includes(this.mode))this.mode='multiplayer';}
  rematch(){this.screen='versus';this.confirmed=[true,true];}
  snapshot(){return {screen:this.screen,step:this.step,mode:this.mode,fighters:[...this.fighters],stage:this.stage,seat:this.seat,confirmed:[...this.confirmed]};}
}