import test from 'node:test';
import assert from 'node:assert/strict';
import {StartupTiming} from '../src/stream-lab/startup-timing.js';

const row=(s,id)=>s.rows.find(r=>r.id===id).seconds;
test('startup stages account for click-to-output without counting overlapping later synthesis',()=>{
  const timing=new StartupTiming();timing.prepared(.1);
  timing.observe({type:'begin',wallSeconds:0},.2);
  timing.observe({type:'request',index:0,wallSeconds:.05},.25);
  for(const [phase,wallSeconds] of [['connected',.06],['headers',.15],['first-byte',1.55]])
    timing.observe({type:'provider-stage',index:0,phase,wallSeconds},wallSeconds+.2);
  timing.observe({type:'provider',packet:{wallSeconds:1.6}},1.8);
  timing.observe({type:'analysis',index:0,wallSeconds:1.9},2.1);
  timing.observe({type:'segment',index:0,wallSeconds:2.6,analysisStartSeconds:1.9,analysisEndSeconds:2.5},2.8);
  // Later provider work overlaps alignment and must not add to the startup sum.
  timing.observe({type:'provider-stage',index:1,phase:'headers',wallSeconds:2.2},2.4);
  timing.observe({type:'analysis',index:1,wallSeconds:2.7},2.9);
  const cutoff={type:'segment',index:1,wallSeconds:3.2,analysisStartSeconds:2.7,analysisEndSeconds:3.1};
  timing.observe(cutoff,3.4);timing.playback(3.5,cutoff);
  const result=timing.snapshot(30);
  assert.equal(result.totalSeconds,3.5);assert.equal(result.complete,true);
  assert.ok(Math.abs(row(result,'rhubarb')-1)<1e-9);
  assert.ok(Math.abs(row(result,'buffer')-.6)<1e-9);
  assert.ok(Math.abs(row(result,'generation')-1.4)<1e-9);
  assert.ok(Math.abs(row(result,'browserDelivery')-.2)<1e-9);
  assert.ok(Math.abs(result.accountedSeconds-result.totalSeconds)<1e-9);
  assert.equal(row(result,'serviceBoot'),null);
  timing.observe({type:'segment',wallSeconds:20,analysisStartSeconds:4,analysisEndSeconds:20},20);
  assert.deepEqual(timing.snapshot(90),result);
});
test('waiting counters advance before payload and unfinished stages are explicit',()=>{
  const timing=new StartupTiming();timing.prepared(.1);
  timing.observe({type:'begin',wallSeconds:0},.2);
  timing.observe({type:'request',index:0,wallSeconds:.01},.21);
  timing.observe({type:'provider-stage',index:0,phase:'connected',wallSeconds:.02},.22);
  timing.observe({type:'provider-stage',index:0,phase:'headers',wallSeconds:.1},.3);
  assert.ok(row(timing.snapshot(3),'generation')>row(timing.snapshot(2),'generation'));
  assert.equal(timing.snapshot(3).complete,false);assert.equal(row(timing.snapshot(3),'rhubarb'),null);
  assert.equal(row(timing.snapshot(3),'browserDelivery'),null);
});
test('old captures without transport milestones retain an honest combined provider wait',()=>{
  const timing=new StartupTiming();timing.prepared(0);
  timing.observe({type:'begin',wallSeconds:0},0);
  timing.observe({type:'request',index:0,wallSeconds:0},0);
  timing.observe({type:'provider',packet:{wallSeconds:2}},2);
  timing.observe({type:'analysis',index:0,wallSeconds:2},2);
  const event={type:'segment',wallSeconds:3,analysisStartSeconds:2,analysisEndSeconds:3};
  timing.observe(event,3);timing.playback(3.1,event);
  const result=timing.snapshot(10);
  assert.equal(row(result,'generation'),null);assert.equal(row(result,'providerUnsplit'),2);
  assert.ok(Math.abs(result.accountedSeconds-3.1)<1e-9);
});
