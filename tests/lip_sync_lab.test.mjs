import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {RHUBARB,DICTIONARY,CHANNELS,arkitToMouth,sampleFrames,boundedWeights} from '../src/lip-sync-lab/mouth-adapters.js';

test('source alphabets distinguish Rhubarb closed A from dictionary open A',()=>{
  assert.equal(RHUBARB.A.slice(0,5).reduce((a,b)=>a+b,0),0);
  assert.ok(RHUBARB.A[5]>0);
  assert.ok(DICTIONARY.A[0]>0);
  assert.ok(RHUBARB.D[0]>RHUBARB.B[1]);
  assert.ok(RHUBARB.E[4]>0);
  assert.ok(RHUBARB.F[2]>0);
});

test('neural jaw coefficient uses official ordering, not the export config eye index',()=>{
  const {names}=JSON.parse(fs.readFileSync(new URL('../src/lip-sync-lab/lam-channel-order.json',import.meta.url)));
  assert.equal(names[24],'jawOpen');
  const values=Array(52).fill(0);values[24]=1;
  assert.ok(arkitToMouth(values,names)[0]>.4);
  values[24]=0;values[17]=1;
  assert.deepEqual(arkitToMouth(values,names),Array(6).fill(0));
});

test('closure competes with opening and seek sampling is independent of previous frames',()=>{
  const values=boundedWeights([1,1,1,1,1,.5]);
  assert.ok(values.slice(0,5).reduce((a,b)=>a+b,0)<=.500001);
  const frames=[[0,0,0,0,0,0],[1,0,0,0,0,0],[0,0,0,0,0,0]];
  assert.deepEqual(sampleFrames(frames,2,.25,1),[.5,0,0,0,0,0]);
  sampleFrames(frames,2,.8,1);
  assert.deepEqual(sampleFrames(frames,2,.25,1),[.5,0,0,0,0,0]);
  assert.deepEqual(sampleFrames(frames,2,1,1),Array(6).fill(0));
});

test('every prepared method uses identical original audio, complete finite data and visible mouth motion',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../src/lip-sync-lab/samples.json',import.meta.url)));
  for(const scene of manifest.cases) {
    const audio=fs.readFileSync(new URL('../src'+scene.audio,import.meta.url));
    assert.equal(crypto.createHash('sha256').update(audio).digest('hex'),scene.audioSha256);
    const data=JSON.parse(fs.readFileSync(new URL('../src'+scene.data,import.meta.url)));
    assert.deepEqual(data.channels,CHANNELS);
    for(const method of manifest.methods) {
      const frames=data.variants[method.id];
      assert.equal(frames.length,Math.ceil(data.duration*data.fps)+1);
      assert.ok(frames.every(frame=>frame.length===6 && frame.every(v=>Number.isFinite(v) && v>=0 && v<=1)));
      assert.ok(frames.some(frame=>frame.slice(0,5).some(v=>v>.1)),`${scene.id}/${method.id} has no meaningful opening`);
      assert.deepEqual(frames.at(-1),Array(6).fill(0));
    }
  }
});
