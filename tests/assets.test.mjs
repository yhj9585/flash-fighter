import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FIGHTERS,ORIGINALS} from '../src/data.js';
import {TECHNIQUES} from '../src/combat.js';

const asset=path=>new URL('../assets/'+path,import.meta.url);
const manifest=JSON.parse(await readFile(asset('manifest.json'),'utf8'));
const originals=JSON.parse((await readFile(asset('originals/sources.json'),'utf8')).replace(/^\uFEFF/,''));

test('all five archived SWFs match recorded source hashes and timeline metadata',async()=>{
  assert.equal(ORIGINALS.length,5);assert.equal(FIGHTERS.length,7);
  for(const source of ORIGINALS){
    const record=originals.find(item=>item.id===source.id);
    const bytes=await readFile(asset('originals/'+source.id+'.swf'));
    assert.equal(bytes.length,record.bytes,source.id+' SWF length');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,source.id+' source hash');
    assert.equal(manifest.sourceFiles[source.id].frameCount,source.frames,source.id+' frames');
    assert.equal(manifest.sourceFiles[source.id].frameRate,source.fps,source.id+' frame rate');
  }
});

test('every roster pose, prop and audio clip is present and traced to its original',async()=>{
  for(const fighter of FIGHTERS){
    for(const art of new Set(Object.values(fighter.art))){
      const entry=manifest.vectors['characters/'+art];
      assert.ok(entry,art+' source record');
      const svg=await readFile(asset('characters/'+art+'.svg'),'utf8');
      assert.match(svg,/<svg\b/);assert.match(svg,/viewBox=/);
      if(['fries','cross','emerald'].includes(fighter.id))assert.equal(entry.source,fighter.source);
    }
    for(const prop of new Set([fighter.special.prop,fighter.super.prop])){
      assert.ok(manifest.vectors['props/'+prop]);
      assert.match(await readFile(asset('props/'+prop+'.svg'),'utf8'),/<svg\b/);
    }
    for(const voice of new Set(Object.values(fighter.voice))){
      const entry=manifest.audio[voice],bytes=await readFile(asset(entry.file));
      assert.ok(entry,voice+' source interval');assert.ok(bytes.length>1000,voice+' encoded audio');
      assert.equal(bytes.toString('ascii',0,4),'RIFF',voice+' PCM container');
      assert.equal(bytes.toString('ascii',8,12),'WAVE',voice+' PCM format');
      assert.ok(entry.sceneFrame<=manifest.sourceFiles[entry.source].frameCount);
      if(['fries','cross','emerald'].includes(fighter.id))assert.equal(entry.source,fighter.source);
    }
  }
  assert.equal(manifest.sourceFiles.emerald.audioSpriteId,9);
  assert.equal(manifest.sourceFiles.emerald.audioStartRootFrame,31);
});

test('every audio file contains complete audible PCM matching its recorded source interval',async()=>{
  for(const [name,entry] of Object.entries(manifest.audio)){
    assert.ok(manifest.sourceFiles[entry.source],name+' original source');
    assert.ok(Number.isFinite(entry.start)&&entry.start>=0,name+' source start');
    assert.ok(Number.isFinite(entry.duration)&&entry.duration>0,name+' source duration');
    const bytes=await readFile(asset(entry.file));
    assert.equal(bytes.toString('ascii',0,4),'RIFF',name+' PCM container');
    assert.equal(bytes.toString('ascii',8,12),'WAVE',name+' PCM format');
    assert.equal(bytes.readUInt32LE(4)+8,bytes.length,name+' complete WAV container');
    let format,data;
    for(let offset=12;offset+8<=bytes.length;){
      const kind=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);
      const start=offset+8,end=start+size;
      assert.ok(end<=bytes.length,name+' complete '+kind+' chunk');
      if(kind==='fmt ')format=bytes.subarray(start,end);
      if(kind==='data')data=bytes.subarray(start,end);
      offset=end+(size%2);
    }
    assert.ok(format?.length>=16,name+' WAV format metadata');
    assert.ok(data?.length,name+' PCM samples');
    assert.equal(format.readUInt16LE(0),1,name+' uncompressed PCM');
    const channels=format.readUInt16LE(2),sampleRate=format.readUInt32LE(4);
    const byteRate=format.readUInt32LE(8),blockAlign=format.readUInt16LE(12),bits=format.readUInt16LE(14);
    assert.equal(bits,16,name+' supported sample format');
    assert.ok(channels>0&&sampleRate>0,name+' valid PCM stream');
    assert.equal(blockAlign,channels*bits/8,name+' sample alignment');
    assert.equal(byteRate,sampleRate*blockAlign,name+' byte rate');
    assert.equal(data.length%blockAlign,0,name+' complete samples');
    const duration=data.length/byteRate;
    // Resampling the 11.025 kHz originals may round a cut by several output samples.
    assert.ok(Math.abs(duration-entry.duration)<.001,name+' duration matches manifest: '+duration);
    let energy=0,peak=0;
    for(let offset=0;offset<data.length;offset+=2){const sample=data.readInt16LE(offset)/32768;energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
    assert.ok(Math.sqrt(energy/(data.length/2))>.001,name+' audible source samples');
    assert.ok(20*Math.log10(peak)<=-2.7,name+' PCM peaks leave headroom for the mixer');
    const normalization=entry.normalization,target=name.endsWith('-loop')?-20:-18;
    assert.equal(normalization?.method,'ebu-r128',name+' loudness normalization');
    assert.equal(normalization.targetLufs,target,name+' voice/music loudness target');
    for(const key of ['integratedLufs','truePeakDbtp','loudnessRangeLu','originalIntegratedLufs'])assert.ok(Number.isFinite(normalization[key]),name+' finite '+key);
    assert.ok(Math.abs(normalization.integratedLufs-target)<=.6,name+' measured loudness matches target');
    assert.ok(normalization.truePeakDbtp<=-2.7,name+' measured true peaks leave headroom');
    assert.ok(normalization.loudnessRangeLu>=0,name+' valid loudness range');
  }
});

test('all 14 added techniques use original drawings and audio from their own movie',async()=>{
  let count=0;
  for(const fighter of FIGHTERS)for(const move of Object.values(TECHNIQUES[fighter.id])){
    count++;
    for(const art of new Set([move.art,...(move.poses||[]).map(p=>p.art)])){
      assert.equal(manifest.vectors['characters/'+art].source,fighter.source,art);
      assert.match(await readFile(asset('characters/'+art+'.svg'),'utf8'),/<svg\b/);
    }
    for(const prop of [move.prop,move.effectProp].filter(Boolean))assert.equal(manifest.vectors['props/'+prop].source,fighter.source,prop);
    assert.equal(manifest.audio[move.voice].source,fighter.source,move.voice);
    assert.ok((await readFile(asset(manifest.audio[move.voice].file))).length>1000);
  }
  assert.equal(count,14);
});

