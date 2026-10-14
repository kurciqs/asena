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
test('starvation displays waiting, keeps the mouth neutral, and clears when audio resumes',()=>{
  const context=fakeContext();let now=0;
  const player=new PCMPlayer(context,{rate:100,startupSeconds:2,now:()=>now});
  player.add(segment(0,200,100));assert.equal(player.sample().buffering,false);
  context.currentTime=1;now=1000;assert.ok(player.weights()[0]>0);
  context.currentTime=3;now=3000;
  assert.equal(player.sample().buffering,true);assert.deepEqual(player.weights(),[0,0,0,0,0,0]);
  now=4500;assert.equal(player.sample().waitingSeconds,1.5);
  player.add(segment(200,400,100));
  // Receiving a region does not open the mouth ahead of its scheduled output.
  assert.equal(player.sample().buffering,true);assert.deepEqual(player.weights(),[0,0,0,0,0,0]);
  context.currentTime=3.1;now=4600;
  assert.equal(player.sample().buffering,false);assert.equal(player.sample().waitingSeconds,0);
  assert.ok(player.weights()[0]>0);assert.equal(player.gaps.length,1);
  player.finish();context.currentTime=6;assert.equal(player.sample().finished,true);assert.equal(player.sample().buffering,false);
});
test('mouth and completion follow output timestamps rather than the ahead-of-output rendering clock',()=>{
  const context=fakeContext();let now=1000;
  context.getOutputTimestamp=()=>({contextTime:.1,performanceTime:1000});
  const player=new PCMPlayer(context,{rate:100,startupSeconds:2,now:()=>now});
  player.add(segment(0,200,100));context.currentTime=2.5;player.finish();
  assert.equal(player.sample().finished,false);assert.equal(player.sample().playedFrames,2);
  now=3000;assert.equal(player.sample().finished,true);
});
test('a long underrun is resumable and never marks the player stopped or complete',()=>{
  const context=fakeContext();let now=0;
  const player=new PCMPlayer(context,{rate:100,startupSeconds:2,now:()=>now});
  player.add(segment(0,200,100));
  context.currentTime=3;now=3000;player.sample();
  context.currentTime=23;now=23000;
  const waiting=player.sample();
  assert.equal(waiting.buffering,true);assert.equal(waiting.waitingSeconds,20);
  assert.equal(waiting.finished,false);assert.equal(player.stopped,false);
  player.add(segment(200,400,100));context.currentTime=23.1;now=23100;
  assert.equal(player.sample().buffering,false);assert.ok(player.weights()[0]>0);
  player.finish();context.currentTime=26;
  assert.equal(player.sample().finished,true);
});
test('mouth sampling blends across region boundaries on the global audio clock',()=>{
  const cues=[{start:0,end:2,value:'A'},{start:2,end:4,value:'D'}];
  assert.ok(weightsAt(cues,1)[5]>0);assert.equal(weightsAt(cues,2)[0],0);
  assert.ok(weightsAt(cues,2.02)[0]>0);assert.ok(weightsAt(cues,2.02)[5]>0);
  assert.deepEqual(weightsAt(cues,4),[0,0,0,0,0,0]);
});
test('user pause suspends the sample clock without being reported as starvation',async()=>{
  const context=fakeContext();context.suspend=async()=>{context.suspended=true;};context.resume=async()=>{context.suspended=false;};
  const player=new PCMPlayer(context,{rate:10,startupSeconds:2});player.add(segment(0,20));context.currentTime=1;
  const before=player.sample().playedFrames;await player.pause();
  assert.equal(player.sample().paused,true);assert.equal(player.sample().playedFrames,before);assert.equal(player.sample().buffering,false);
  await player.resume();assert.equal(player.sample().paused,false);assert.equal(context.suspended,false);
});
test('aggressive startup waits for a complete aligned half-second and keeps starvation neutral',()=>{
  const context=fakeContext(),player=new PCMPlayer(context,{rate:100,startupSeconds:.5,now:()=>0});
  player.add(segment(0,25,100));assert.equal(context.nodes.length,0);
  player.add(segment(25,50,100));assert.equal(context.nodes.length,2);
  context.currentTime=.7;
  assert.equal(player.sample().buffering,true);assert.deepEqual(player.weights(),[0,0,0,0,0,0]);
  player.add(segment(50,100,100));assert.equal(player.gaps.length,1);
  context.currentTime=.8;assert.equal(player.sample().buffering,false);
});
test('first output timing can include browser preparation before player construction',()=>{
  const context=fakeContext(),player=new PCMPlayer(context,{rate:10,startupSeconds:.5,createdAt:1000,now:()=>1500});
  player.add(segment(0,5));assert.ok(Math.abs(player.firstPlaybackSeconds-.58)<1e-9);
});

test('fifty completed/cancelled turns release nodes, buffers and cues without retained growth',()=>{
  for(let turn=0;turn<50;turn++){
    const context=fakeContext(),player=new PCMPlayer(context,{rate:100,startupSeconds:2});
    player.add(segment(0,100,100));player.add(segment(100,300,100));
    assert.equal(context.nodes.length,2);
    if(turn%2===0){
      player.finish();context.currentTime=4;
      context.nodes.forEach(node=>node.onended());
      assert.equal(player.sample().finished,true);
    }
    player.stop();
    assert.deepEqual(player.resources(),{blocks:0,buffers:0,nodes:0,cues:0});
    assert.ok(context.nodes.every(node=>node.buffer===null&&node.onended===null));
  }
});
