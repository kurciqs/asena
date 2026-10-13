import test from 'node:test';
import assert from 'node:assert/strict';
import {playSpeechStream} from '../src/speech_stream.js';
import {getPartialPerformance} from '../src/emotion_classifier.js';

const context=()=>({currentTime:0,nodes:[],resume:async()=>{},close:async function(){this.closed=true;},
  createBuffer:(_,n)=>({getChannelData:()=>new Float32Array(n)}),createBufferSource(){const n={connect(){},disconnect(){},start(){},stop(){this.stopped=true;}};this.nodes.push(n);return n;}});
const enc=new TextEncoder();
test('partial word anchors never fire a tag whose words have not arrived',()=>{
  const parsed={text:'Hello there friend.',actions:[{value:'wave',position:0},{value:'head_nod',position:12}],emotions:[{value:'happy',position:6}]};
  let cues=getPartialPerformance([{word:'Hello',start_time:0,end_time:1}],parsed,new Set(['wave','head_nod']));
  assert.deepEqual(cues.actions,[{value:'wave',start:0}]);assert.deepEqual(cues.emotions,[]);
  cues=getPartialPerformance([{word:'Hello',start_time:0,end_time:1},{word:'there',start_time:1,end_time:2}],parsed,new Set(['wave','head_nod']));
  assert.deepEqual(cues.actions,[{value:'wave',start:0}]);assert.equal(cues.emotions[0].start,1);
  assert.throws(()=>getPartialPerformance([{word:'Different',start_time:0,end_time:1}],parsed),/do not match/);
});
test('stream consumer uses 24 kHz PCM, forwards timings, completes and releases audio ownership',async()=>{
  const audio=context(),calls=[];let words=null,player=null,index=0;
  const events=[{type:'begin',token:'test',rate:24000,startupSeconds:2},
    {type:'words',token:'test',timestamps:[{word:'Hi',start_time:0,end_time:2}]},
    {type:'segment',token:'test',startFrame:0,endFrame:48000,cues:[{start:0,end:2,value:'D'}],pcm:btoa('\0\0'.repeat(48000))},
    {type:'eos',token:'test'},{type:'result',token:'test',report:{complete:true}}];
  const fetcher=async(url,options)=>{calls.push([url,JSON.parse(options.body)]);
    if(url!=='/api/speech/stream')return {ok:true};
    return {ok:true,body:{getReader:()=>({read:async()=>{
      if(index===events.length)return {done:true};
      if(index===4)audio.currentTime=3;
      return {value:enc.encode(JSON.stringify(events[index++])+'\n'),done:false};
    }})}};
  };
  const result=await playSpeechStream({text:'Hi',voice:'af_heart',speechProfile:{policy:'2s',openingSeconds:1,startupSeconds:2,strategy:'sentences'},fetcher,createContext:()=>audio,
    requestFrame:()=>1,cancelFrame:()=>{},onPlayer:p=>player=p,onWords:w=>words=w});
  assert.equal(player.rate,24000);assert.equal(words[0].word,'Hi');assert.equal(result.browser.finished,true);
  assert.equal(audio.closed,true);assert.ok(calls.some(([url])=>url==='/api/speech/cancel'));
  assert.deepEqual(result.cleanup,{blocks:0,buffers:0,nodes:0,cues:0,contextClosed:true});
  assert.ok(result.startupTiming.complete);
  assert.deepEqual(calls[0][1],{input:'Hi',voice:'af_heart',strategy:'sentences',policy:'2s',openingSeconds:1,startupSeconds:2});
});
test('abort while waiting closes the audio context and cancels the provider token',async()=>{
  const audio=context(),owner=new AbortController(),calls=[];let reads=0;
  const fetcher=async(url,options)=>{
    calls.push(url);if(url!=='/api/speech/stream')return {ok:true};
    return {ok:true,body:{getReader:()=>({read:async()=>{
      if(reads++===0)return {value:enc.encode('{"type":"begin","token":"owner","rate":24000,"startupSeconds":2}\n'),done:false};
      owner.abort();throw new DOMException('Stopped','AbortError');
    }})}};
  };
  await assert.rejects(playSpeechStream({text:'Hi',voice:'af_heart',signal:owner.signal,fetcher,createContext:()=>audio,
    requestFrame:()=>1,cancelFrame:()=>{}}),/Stopped/);
  assert.equal(audio.closed,true);assert.ok(calls.includes('/api/speech/cancel'));
});

test('failure after partial playback preserves diagnostics and never starts a batch retry',async()=>{
  const audio=context(),calls=[];let report,index=0;
  const events=[{type:'begin',token:'owner',rate:24000,startupSeconds:2},
    {type:'segment',token:'owner',startFrame:0,endFrame:48000,cues:[],pcm:btoa('\0\0'.repeat(48000))},
    {type:'error',token:'owner',error:'Provider disconnected',report:{complete:false,duration:2}}];
  const fetcher=async (url)=>{calls.push(url);if(url!=='/api/speech/stream')return {ok:true};
    return {ok:true,body:{getReader:()=>({read:async()=>{
      if(index===2)audio.currentTime=1;
      return {value:enc.encode(JSON.stringify(events[index++])+'\n'),done:false};
    }})}};};
  await assert.rejects(playSpeechStream({text:'Hello',voice:'af_heart',fetcher,createContext:()=>audio,
    requestFrame:()=>1,cancelFrame:()=>{},onReport:value=>report=value}),/disconnected/);
  assert.equal(report.complete,false);assert.ok(report.browser.playedSeconds>0);
  assert.equal(audio.closed,true);assert.ok(audio.nodes.every(node=>node.stopped));
  assert.ok(!calls.includes('/tts'));
});

test('stop during a blocked browser audio resume releases the context without requesting speech',async()=>{
  const audio=context(),owner=new AbortController();let called=false;
  audio.resume=()=>new Promise(()=>{});
  const run=playSpeechStream({text:'Hello',voice:'af_heart',signal:owner.signal,
    fetcher:async()=>{called=true;throw new Error('Must not request speech');},createContext:()=>audio,
    requestFrame:()=>1,cancelFrame:()=>{}});
  owner.abort();await assert.rejects(run,/abort/i);
  assert.equal(audio.closed,true);assert.equal(called,false);
});
