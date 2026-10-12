import test from 'node:test';
import assert from 'node:assert/strict';
import {Lines,validateSegment,PCMPlayer,weightsAt} from '../src/stream-lab/playback.js';
const enc=new TextEncoder();
const segment=(a,b,rate=10)=>({startFrame:a,endFrame:b,cues:[{start:a/rate,end:b/rate,value:'D'}],pcm:btoa('\0\0'.repeat(b-a))});
const fakeContext=()=>({currentTime:0,createBuffer:(_,n)=>({getChannelData:()=>new Float32Array(n)}),
  nodes:[],createBufferSource(){const node={connect(){},disconnect(){},start(at){this.at=at;},stop(){this.stopped=true;}};this.nodes.push(node);return node;}});

test('NDJSON survives every byte split including UTF8; truncated and oversized frames fail',()=>{
  const bytes=enc.encode('{"word":"héllo"}\n{"n":2}\n');
  for(let i=0;i<=bytes.length;i++){const parser=new Lines();assert.deepEqual([...parser.push(bytes.slice(0,i)),...parser.push(bytes.slice(i),true)],[{word:'héllo'},{n:2}]);}
  assert.throws(()=>new Lines().push(enc.encode('{"n":1}'),true),/Incomplete/);
  assert.throws(()=>new Lines().push(enc.encode('x'.repeat(2_000_001))),/Oversized/);
});
test('segment validation prevents doubled overlap, invalid offsets and malformed cues',()=>{
  validateSegment(segment(0,20),0,10);
  assert.throws(()=>validateSegment(segment(15,40),20,10),/Non-contiguous/);
  assert.throws(()=>validateSegment({...segment(20,40),cues:[{start:0,end:4,value:'A'}]},20,10),/Invalid/);
});
test('sample-clock scheduling is continuous, accounts for starvation and flushes final short tail',()=>{
  const context=fakeContext(),player=new PCMPlayer(context,{rate:10,startupSeconds:4,now:()=>0});
  player.add(segment(0,20));assert.equal(context.nodes.length,0);
  player.add(segment(20,40));assert.equal(context.nodes[0].at,.08);assert.equal(context.nodes[1].at,2.08);
  context.currentTime=3;player.add(segment(40,60));assert.equal(context.nodes[2].at,4.08);assert.equal(player.gaps.length,0);
  context.currentTime=7;player.add(segment(60,65));player.finish();
  assert.equal(player.gaps.length,1);assert.ok(player.gaps[0].seconds>.9);
  context.currentTime=8;assert.equal(player.sample().playedFrames,65);assert.equal(player.sample().finished,true);
});
test('stop silences all scheduled nodes and refuses stale new segments',()=>{
  const context=fakeContext(),player=new PCMPlayer(context,{rate:10,startupSeconds:2});
  player.add(segment(0,20));player.stop();assert.ok(context.nodes.every(node=>node.stopped));
  assert.deepEqual(player.weights(),[0,0,0,0,0,0]);assert.throws(()=>player.add(segment(20,40)),/stopped/);
});
test('mouth and completion follow output timestamps rather than the ahead-of-output rendering clock',()=>{
  const context=fakeContext();let now=1000;
  context.getOutputTimestamp=()=>({contextTime:.1,performanceTime:1000});
  const player=new PCMPlayer(context,{rate:100,startupSeconds:2,now:()=>now});
  player.add(segment(0,200,100));context.currentTime=2.5;player.finish();
  assert.equal(player.sample().finished,false);assert.equal(player.sample().playedFrames,2);
  now=3000;assert.equal(player.sample().finished,true);
});
test('mouth sampling blends across region boundaries on the global audio clock',()=>{
  const cues=[{start:0,end:2,value:'A'},{start:2,end:4,value:'D'}];
  assert.ok(weightsAt(cues,1)[5]>0);assert.equal(weightsAt(cues,2)[0],0);
  assert.ok(weightsAt(cues,2.02)[0]>0);assert.ok(weightsAt(cues,2.02)[5]>0);
  assert.deepEqual(weightsAt(cues,4),[0,0,0,0,0,0]);
});
