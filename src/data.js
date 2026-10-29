export const WORLD = { width: 1200, height: 430, floor: 356, left: 80, right: 1120 };

export const FIGHTERS = [
  {
    id:'tuna', name:'참치맨', series:'고추참치쏭', source:'tuna', role:'균형형', color:'#efc94c',
    health:1000, speed:285, power:1, height:178, facing:-1,
    art:{idle:'tuna-idle',walk:'tuna-walk',jump:'tuna-jump',light:'tuna-idle',heavy:'tuna-kick',special:'tuna-walk',super:'tuna-kick',hurt:'tuna-hurt',win:'tuna-jump'},
    special:{name:'참치캔 투척',prop:'tuna-can',damage:92,speed:620},
    super:{name:'제노사이드 커터',prop:'pepper',damage:255,type:'rush'},
    voice:{select:'tuna-select',special:'tuna-special',super:'tuna-super',hurt:'tuna-hurt',win:'tuna-win'},
  },
  {
    id:'hacker', name:'해킹범', series:'해킹쏭', source:'hacker', role:'견제형', color:'#9cc7c2',
    health:930, speed:300, power:.96, height:185, facing:1,
    art:{idle:'hacker-idle',walk:'hacker-attack',jump:'hacker-attack',light:'hacker-attack',heavy:'hacker-kick',special:'hacker-attack',super:'hacker-kick',hurt:'hacker-hurt',win:'angry-idle'},
    special:{name:'파일 날리기',prop:'file',damage:85,speed:730},
    super:{name:'필살 해킹',prop:'fire',damage:235,type:'projectile'},
    voice:{select:'hacker-select',special:'hacker-special',super:'hacker-super',hurt:'hacker-hurt',win:'hacker-win'},
  },
  {
    id:'thief', name:'밥도둑', series:'고추참치쏭', source:'tuna', role:'속도형', color:'#c2b3d2',
    health:900, speed:335, power:.91, height:167, facing:1,
    art:{idle:'thief-idle',walk:'thief-idle',jump:'thief-idle',light:'thief-idle',heavy:'thief-idle',special:'thief-idle',super:'thief-idle',hurt:'thief-idle',win:'thief-idle'},
    special:{name:'밥그릇 투척',prop:'rice',damage:82,speed:790},
    super:{name:'밥도둑의 습격',prop:'rice',damage:225,type:'rush'},
    voice:{select:'thief-select',special:'thief-special',super:'thief-super',hurt:'tuna-hurt',win:'tuna-win'},
  },
  {
    id:'angry', name:'격노맨', series:'해킹쏭', source:'hacker', role:'파워형', color:'#eca38b',
    health:1100, speed:252, power:1.11, height:183, facing:1,
    art:{idle:'angry-idle',walk:'hacker-attack',jump:'hacker-attack',light:'hacker-attack',heavy:'hacker-kick',special:'angry-fire',super:'angry-fire',hurt:'hacker-hurt',win:'angry-idle'},
    special:{name:'분노의 불꽃',prop:'fire',damage:106,speed:525},
    super:{name:'컴퓨터 대폭발',prop:'blast',damage:280,type:'projectile'},
    voice:{select:'angry-select',special:'angry-special',super:'angry-super',hurt:'hacker-hurt',win:'hacker-win'},
  },
  {
    id:'fries', name:'감자맨', series:'감자튀김송', source:'fries', role:'돌진형', color:'#f2b75b',
    health:1020, speed:310, power:.97, height:174, facing:1,
    art:{idle:'fries-idle',walk:'fries-dash',jump:'fries-dash',light:'fries-dash',heavy:'fries-hold',special:'fries-hold',super:'fries-dash',hurt:'fries-hurt',win:'fries-hold'},
    special:{name:'감자튀김 투척',prop:'fries',damage:88,speed:690},
    super:{name:'감자 돌진',prop:'fries',damage:245,type:'rush'},
    voice:{select:'fries-select',special:'fries-special',super:'fries-super',hurt:'fries-hurt',win:'fries-win'},
  },
  {
    id:'cross', name:'썩던콩', series:'썩던콩', source:'cross', role:'연주형', color:'#aab7db',
    health:950, speed:278, power:1.02, height:180, facing:1, anchorX:.28,
    artFacing:{'cross-hurt':-1,'cross-magic':-1},artAnchor:{'cross-hurt':.8,'cross-magic':.8},
    art:{idle:'cross-idle',walk:'cross-strum',jump:'cross-jump',light:'cross-strum',heavy:'cross-jump',special:'cross-strum',super:'cross-jump',hurt:'cross-hurt',win:'cross-strum'},
    special:{name:'콩알 투척',prop:'beans',damage:96,speed:610},
    super:{name:'기타 러시',prop:'beans',damage:260,type:'rush'},
    voice:{select:'cross-select',special:'cross-special',super:'cross-super',hurt:'cross-hurt',win:'cross-win'},
  },
  {
    id:'emerald', name:'에메랄드', series:'에메랄드 소드', source:'emerald', role:'소환형', color:'#91c766',
    health:960, speed:282, power:.99, height:185, facing:1,
    art:{idle:'emerald-idle',walk:'emerald-cast',jump:'emerald-cast',light:'emerald-cast',heavy:'emerald-strike',special:'emerald-strike',super:'emerald-cast',hurt:'emerald-hurt',win:'emerald-sing'},
    special:{name:'어묵 투척',prop:'fishcake',damage:91,speed:750},
    super:{name:'불새 소환',prop:'phoenix',damage:255,type:'projectile',speed:580},
    voice:{select:'emerald-select',special:'emerald-special',super:'emerald-super',hurt:'emerald-hurt',win:'emerald-win'},
  },
];
export const fighterById = id => FIGHTERS.find(f => f.id === id) || FIGHTERS[0];
export const ORIGINALS = [
  {id:'tuna',title:'고추참치송',page:'https://vidkidz.tistory.com/9936',animation:'사스케야',music:'돌카스 / 상혁군',version:8,fps:14,frames:1416,art:'tuna-walk',prop:'tuna-can'},
  {id:'hacker',title:'해킹송1',page:'https://vidkidz.tistory.com/5113',animation:'황산맛콜라',music:'돌카스',version:8,fps:10,frames:1461,art:'angry-idle',prop:'file'},
  {id:'fries',title:'감자튀김송',page:'https://vidkidz.tistory.com/5832',animation:'みやざわ',music:'돌카스',version:8,fps:12,frames:1504,art:'fries-idle',prop:'fries'},
  {id:'cross',title:'썩던콩',page:'https://vidkidz.tistory.com/6780',animation:'넬피엘',music:'403 Forbidden / Southern Cross',version:7,fps:12,frames:2645,art:'cross-idle',prop:'beans'},
  {id:'emerald',title:'에메랄드 소드',page:'https://vidkidz.tistory.com/5198',animation:'로아 (보관소 소개 기준)',music:'Rhapsody / Emerald Sword',version:8,fps:24,frames:6350,art:'emerald-idle',prop:'fishcake'},
];
export const STAGES = [
  {id:'fridge',name:'냉장고 앞',prop:'fridge',source:'tuna'},
  {id:'computer',name:'컴퓨터 방',prop:'computer',source:'hacker'},
  {id:'paper',name:'흰 종이',prop:null,source:'tuna'},
];
export const DEFAULT_SETTINGS = {time:60,wins:2,difficulty:'normal',volume:.7,music:.16,musicOn:true,muted:false,hitboxes:false,motion:true};

export const MOVES = {
  light:{name:'약공격',startup:5,active:4,recovery:13,damage:52,range:124,stun:18,push:21},
  heavy:{name:'강공격',startup:11,active:7,recovery:22,damage:93,range:158,stun:26,push:38},
  throw:{name:'잡기',startup:5,active:3,recovery:26,damage:115,range:104,stun:29,push:62,unblockable:true},
  special:{name:'필살기',startup:15,active:1,recovery:30,damage:90,range:0,stun:24,push:36,projectile:true},
  super:{name:'초필살기',startup:18,active:13,recovery:32,damage:250,range:205,stun:40,push:95,cost:100},
};
