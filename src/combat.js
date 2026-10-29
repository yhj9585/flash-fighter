import {MOVES} from './data.js';

// Every extra move names an original pose, prop and source-audio clip.
export const TECHNIQUES = {
  tuna:{
    command:{name:'대공 커터',art:'tuna-kick',voice:'tuna-super',startup:7,active:9,recovery:26,damage:106,range:146,stun:28,push:25,vertical:205,selfLift:560,launch:470},
    burst:{name:'참치캔 연속 투척',art:'tuna-walk',voice:'tuna-special',prop:'tuna-can',startup:12,active:15,recovery:23,damage:39,stun:21,push:8,speed:660,projectile:true,shots:[{at:12},{at:19},{at:26}]},
  },
  hacker:{
    command:{name:'돌진 킥',art:'hacker-kick',voice:'hacker-super',startup:10,active:6,recovery:24,damage:108,range:154,stun:26,push:43,motion:'rush',rushSpeed:650},
    burst:{name:'파일 다중 발사',art:'hacker-attack',voice:'hacker-special',prop:'file',startup:13,active:15,recovery:24,damage:38,stun:20,push:8,speed:740,projectile:true,shots:[{at:13},{at:20},{at:27}]},
  },
  thief:{
    command:{name:'추격 잡기',art:'thief-idle',voice:'thief-super',startup:12,active:3,recovery:30,damage:115,range:105,stun:29,push:66,unblockable:true,groundOnly:true,motion:'rush',rushSpeed:700},
    burst:{name:'밥그릇 연계',art:'thief-idle',voice:'thief-special',prop:'rice',startup:11,active:10,recovery:24,damage:49,stun:23,push:9,speed:790,projectile:true,shots:[{at:11},{at:20}]},
  },
  angry:{
    command:{name:'대공 불꽃',art:'angry-fire',voice:'angry-special',prop:'fire',startup:9,active:1,recovery:28,damage:103,range:0,stun:28,push:27,projectile:true,shots:[{at:9,speed:310,vy:520,gravity:400,y:65}],radius:34,launch:410},
    burst:{name:'근거리 폭발',art:'angry-fire',voice:'angry-super',startup:18,active:6,recovery:32,damage:145,range:225,stun:31,push:63,effectProp:'blast',vertical:190},
  },
  fries:{
    command:{name:'감자 돌진 후속타',art:'fries-dash',voice:'fries-super',startup:9,active:12,recovery:24,damage:45,range:145,stun:21,push:12,hitsAt:[9,18],motion:'rush',rushSpeed:560,poses:[{at:0,art:'fries-dash'},{at:17,art:'fries-hold'}]},
    burst:{name:'감자튀김 확산 투척',art:'fries-hold',voice:'fries-special',prop:'fries',startup:14,active:1,recovery:31,damage:36,stun:21,push:9,speed:665,projectile:true,shots:[{at:14,y:-28,vy:-80},{at:14},{at:14,y:28,vy:80}],radius:22},
  },
  cross:{
    command:{name:'기타 연타',art:'cross-strum',voice:'cross-super',startup:6,active:11,recovery:24,damage:42,range:174,stun:21,push:10,hitsAt:[6,14],poses:[{at:0,art:'cross-idle'},{at:6,art:'cross-strum'},{at:11,art:'cross-idle'},{at:14,art:'cross-jump'}]},
    burst:{name:'무지개 마술',art:'cross-magic',voice:'cross-magic',prop:'magic',startup:15,active:9,recovery:25,damage:57,stun:24,push:12,speed:590,projectile:true,shots:[{at:15,y:-12},{at:23,y:12}]},
  },
  emerald:{
    command:{name:'김밥 연속 타격',art:'emerald-strike',voice:'emerald-special',startup:8,active:11,recovery:24,damage:47,range:160,stun:22,push:10,hitsAt:[8,16],poses:[{at:0,art:'emerald-windup'},{at:8,art:'emerald-strike'},{at:13,art:'emerald-windup'},{at:16,art:'emerald-strike'}]},
    burst:{name:'어묵 연사',art:'emerald-strike',voice:'emerald-special',prop:'fishcake',startup:13,active:15,recovery:24,damage:41,stun:21,push:8,speed:750,projectile:true,shots:[{at:13},{at:20},{at:27}]},
  },
};

export function moveFor(fighter,type){
  if(type==='followup')return {...MOVES.light,name:'연속 약공격',startup:4,active:3,recovery:16,damage:37,range:140,stun:18,push:10,rank:1.5,key:type,art:fighter.art.light};
  const extra=TECHNIQUES[fighter.id]?.[type];
  if(extra)return {startup:10,active:5,recovery:25,range:150,stun:23,push:25,rank:3,cost:type==='burst'?25:0,cooldown:type==='burst'?125:90,key:type,...extra};
  const spec=type==='special'||type==='super'?fighter[type]:{};
  return {...MOVES[type],...spec,key:type,rank:{light:1,heavy:2,special:3,super:4}[type]||0,
    projectile:type==='special'||type==='super'&&spec.type==='projectile',motion:spec.type,
    art:fighter.art[type]||fighter.art.idle,voice:fighter.voice[type],groundOnly:type==='throw',rushSpeed:720};
}

export function moveArt(fighter,action,state){
  if(!action)return fighter.art[state]||fighter.art.idle;
  const move=moveFor(fighter,action.type);
  return [...(move.poses||[])].reverse().find(p=>p.at<=action.frame)?.art||move.art;
}

export const COMMAND_HELP = [
  {kind:'command',keys:['S + K / K + L','↓ + 2 / 2 + 3'],short:'↓ + 강 또는 강 + 필살'},
  {kind:'burst',keys:['J + L','1 + 3'],short:'약 + 필살 · 기력 25'},
];
