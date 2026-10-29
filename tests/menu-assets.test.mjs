import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MENU_MUSIC} from '../src/audio.js';

const manifest=JSON.parse(await readFile(new URL('../assets/menu-music.json',import.meta.url),'utf8'));
const expected=[
  ['menu-tuna-mr','audio/menu/tuna-mr.mp3',102.461],
  ['menu-shiho','audio/menu/shiho.mp3',77.101],
  ['menu-blue-sky','audio/menu/blue-sky.mp3',221.361],
];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('all three supplied menu songs are preserved in full and traced to their source files',async()=>{
  assert.equal(manifest.tracks.length,expected.length);
  for(const [index,track] of manifest.tracks.entries()){
    const [name,file,duration]=expected[index];
    assert.equal(track.name,name);assert.equal(track.file,file);
    assert.ok(track.title.length>0,name+' playlist title');
    assert.ok(track.sourceFile.startsWith('ost-1/'),name+' local source');
    const original=await readFile(new URL('../'+track.sourceFile,import.meta.url));
    assert.equal(sha256(original),track.sourceSha256,name+' unchanged input');
    const encoded=await readFile(new URL('../assets/'+file,import.meta.url));
    assert.equal(encoded.length,track.bytes,name+' complete encoded file');
    assert.ok(encoded.length>50000,name+' contains music');
    assert.equal(sha256(encoded),track.sha256,name+' encoded file matches verification record');
    assert.ok(encoded.toString('ascii',0,3)==='ID3'||encoded[0]===0xff,name+' MP3 container');
    assert.equal(track.sourceDuration,duration,name+' original full song duration');
    // WebM decoder delay and MP3 padding may differ by a few milliseconds.
    assert.ok(Math.abs(track.duration-duration)<.05,name+' full duration retained');
    assert.equal(track.sampleRate,44100,name+' browser-friendly sample rate');
    assert.equal(track.channels,2,name+' stereo preserved');
  }
});

test('menu songs use the same measured music loudness target with peak headroom',()=>{
  const levels=[];
  for(const track of manifest.tracks){
    const profile=track.normalization;
    assert.equal(profile.method,'ebu-r128',track.name+' measured normalization');
    assert.equal(profile.targetLufs,-20,track.name+' music target');
    for(const key of ['integratedLufs','truePeakDbtp','loudnessRangeLu','originalIntegratedLufs']){
      assert.ok(Number.isFinite(profile[key]),track.name+' finite '+key);
    }
    assert.ok(Math.abs(profile.integratedLufs+20)<=.6,track.name+' final loudness');
    assert.ok(profile.truePeakDbtp<=-2.7,track.name+' final encoded peak headroom');
    assert.ok(profile.loudnessRangeLu>=0,track.name+' valid loudness range');
    levels.push(profile.integratedLufs);
  }
  assert.ok(Math.max(...levels)-Math.min(...levels)<=1,'playlist volume remains consistent');
});

test('the runtime playlist references each generated menu song in order',()=>{
  assert.deepEqual(MENU_MUSIC,manifest.tracks.map(track=>({name:track.name,file:'./assets/'+track.file})));
});
