import {MATCH_WAIT_MS} from '../src/matchmaking.js';

// Queue deadlines use a monotonic clock. Duplicate searches never extend them.
export class Matchmaker{
  constructor({notify,pair,available,capacity,now=()=>performance.now(),waitMs=MATCH_WAIT_MS}){
    this.notify=notify;this.pair=pair;this.available=available;this.capacity=capacity;this.now=now;
    this.waitMs=Math.min(MATCH_WAIT_MS,Math.max(1,Number(waitMs)||MATCH_WAIT_MS));this.entries=new Map();
  }
  status(client,entry,state='waiting'){
    const remainingMs=state==='waiting'?Math.max(0,entry.deadline-this.now()):0;
    this.notify(client,{type:'matchmaking',state,remainingMs,limitMs:MATCH_WAIT_MS});
    if(entry)entry.notifiedAt=this.now();
  }
  enqueue(client){
    this.tick();
    if(!this.available(client))return false;
    const existing=this.entries.get(client);
    if(existing){this.status(client,existing);return true;}
    const now=this.now(),entry={deadline:now+this.waitMs,notifiedAt:now};
    this.entries.set(client,entry);this.status(client,entry);this.match();return true;
  }
  cancel(client,notify=true){
    const removed=this.entries.delete(client);
    if(notify)this.status(client,null,'cancelled');
    return removed;
  }
  expire(){
    const now=this.now();
    for(const [client,entry] of this.entries){
      if(!this.available(client)){this.entries.delete(client);continue;}
      if(now>=entry.deadline){this.entries.delete(client);this.status(client,entry,'timeout');}
    }
  }
  match(){
    this.expire();
    while(this.entries.size>=2&&this.capacity()){
      const [[first,a],[second,b]]=[...this.entries];
      this.entries.delete(first);this.entries.delete(second);
      if(this.pair(first,second)===false){this.entries.set(first,a);this.entries.set(second,b);break;}
    }
  }
  tick(){
    this.expire();this.match();
    for(const [client,entry] of this.entries)if(this.now()-entry.notifiedAt>=1000)this.status(client,entry);
  }
  close(){this.entries.clear();}
}
