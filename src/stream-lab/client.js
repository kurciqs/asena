import {PCMPlayer,Lines} from './playback.js';
import {createViewer} from './viewer.js';
const $=id=>document.getElementById(id),zero=[0,0,0,0,0,0];
let viewer,run=null,report=null,drawId=null;
const controls=['policy','profile','startup','length'];
function state(running){controls.forEach(id=>$(id).disabled=running);$('start').disabled=running||!viewer;$('stop').disabled=!running;$('download').disabled=!report;}
function metrics(current) {
  const s=current.player?.sample();if(!s)return;
  $('first').textContent=s.firstPlaybackSeconds===null?'—':s.firstPlaybackSeconds.toFixed(2)+'s';
  $('buffer').textContent=s.bufferSeconds.toFixed(2)+'s';$('gaps').textContent=`${s.gapCount} · ${s.gapSeconds.toFixed(3)}s`;
  $('compute').textContent=current.compute.toFixed(2)+'s';$('memory').textContent=(current.peak/1024**2).toFixed(0)+' MiB';
  $('position').textContent=s.playedSeconds.toFixed(2)+'s';
  const actual=viewer.draw(current.player.weights());
  $('motion-status').textContent=`Applied mouth: ${actual.peakAppliedMorph.toFixed(2)}`;
  current.actualPeak=Math.max(current.actualPeak,actual.peakAppliedMorph);
  $('inspection').textContent=JSON.stringify({source:'saved Kokoro audio',...current.config,...s,
    regionCount:current.regions,aligningRegion:current.analyzing??null,computeSeconds:current.compute,peakRssBytes:current.peak,
    ...actual,peakObservedMorph:current.actualPeak,sourceSha256:current.sourceSha256},null,2);
  return s;
}
function tick(){drawId=null;if(!run)return;metrics(run);drawId=requestAnimationFrame(tick);}
async function progress(current) {
  if(run!==current||!current.token||!current.player)return;
  const s=metrics(current);
  const response=await fetch('/probe/progress',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:current.token,playedFrames:s.playedFrames}),signal:current.controller.signal});
  if(!response.ok)throw new Error('Playback acknowledgement failed');
  if(run===current)current.timer=setTimeout(()=>progress(current).catch(error=>{if(run===current)stop(error.message);}),200);
}
async function start() {
  if(run)return;
  const current={controller:new AbortController(),context:new AudioContext(),player:null,token:null,
    compute:0,peak:0,regions:0,actualPeak:0,events:[],config:{policy:$('policy').value,profile:$('profile').value,
    startupSeconds:Number($('startup').value),repeats:Number($('length').value)}};
  run=current;report=null;state(true);$('status').textContent='Delivering saved audio; waiting for the first aligned regions…';
  try {
    await current.context.resume();
    current.player=new PCMPlayer(current.context,{startupSeconds:current.config.startupSeconds});
    drawId=requestAnimationFrame(tick);
    const response=await fetch('/probe/run',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(current.config),signal:current.controller.signal});
    if(!response.ok)throw new Error((await response.json()).error);
    const reader=response.body.getReader(),lines=new Lines();
    while(run===current) {
      const {value,done}=await reader.read();
      for(const event of lines.push(value??new Uint8Array(),done)) {
        current.token=event.token;
        current.events.push(Object.fromEntries(Object.entries(event).filter(([key])=>key!=='pcm'&&key!=='report')));
        if(event.type==='begin') {
          current.sourceSha256=event.sha256;
          progress(current).catch(error=>{if(run===current)stop(error.message);});
        } else if(event.type==='analysis')current.analyzing=event.index;
        else if(event.type==='segment') {
          current.analyzing=null;
          current.player.add(event);current.compute+=event.seconds;current.peak=Math.max(current.peak,event.peakRssBytes);current.regions++;
          $('status').textContent=current.player.firstPlaybackSeconds===null?'Preparing the startup buffer…':'Playing while later regions are being aligned.';
        } else if(event.type==='eos')current.player.finish();
        else if(event.type==='error')throw new Error(event.error);
        else if(event.type==='cancelled')throw new Error('Test cancelled');
        else if(event.type==='result') {
          const s=metrics(current);
          report={...event.report,browser:{...s,receiver:'Web Audio sample clock',gaps:current.player.gaps,
            bufferPeakSeconds:current.player.bufferPeak,bufferMinimumSeconds:current.player.bufferMinimum,
            peakObservedMorph:current.actualPeak,audioContextRate:current.context.sampleRate,
            baseLatency:current.context.baseLatency,outputLatency:current.context.outputLatency??null}};
          $('status').textContent=`Finished. ${s.gapCount} playback gaps; ${s.gapSeconds.toFixed(3)}s total.`;
        }
      }
      if(done)break;
    }
    if(!report)throw new Error('Test stream ended without a completion report');
    await cleanup(current);state(false);
  } catch(error) {if(run===current)await stop(error.name==='AbortError'?'Stopped.':error.message);}
}
async function cleanup(current) {
  clearTimeout(current.timer);if(drawId!==null)cancelAnimationFrame(drawId);drawId=null;
  current.player?.stop();await current.context.close();if(run===current)run=null;viewer.draw(zero);
}
async function stop(message='Stopped. Outstanding Rhubarb work was cancelled.') {
  const current=run;if(!current)return;
  run=null;clearTimeout(current.timer);current.player?.stop();viewer.draw(zero);
  $('buffer').textContent='0.00s';$('motion-status').textContent='Applied mouth: 0.00';
  $('inspection').textContent=JSON.stringify({...current.config,stopped:true,
    playedFrames:current.player?.played??0,queuedAudioSeconds:0,peakObservedMorph:current.actualPeak},null,2);
  // Send cancellation independently before aborting the receiving request.
  if(current.token)try{await fetch('/probe/cancel',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:current.token}),signal:AbortSignal.timeout(2000),keepalive:true});}catch{}
  current.controller.abort();await cleanup(current);state(false);$('status').textContent=message;
}
$('start').addEventListener('click',start);$('stop').addEventListener('click',()=>stop());
$('download').addEventListener('click',()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='rhubarb-saved-stream-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&run)stop('Stopped because the test page was hidden.');});
window.addEventListener('pagehide',()=>{if(run){const current=run;if(current.token)fetch('/probe/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:current.token}),keepalive:true}).catch(()=>{});current.controller.abort();current.player?.stop();current.context.close();}viewer?.dispose();});
try {viewer=await createViewer($('stage'));viewer.draw(zero);$('active-method').textContent='Native Rhubarb · corrected mouth mapping';
  $('status').textContent='Ready. Press Start to run real analysis on saved recordings.';state(false);
}catch(error){$('status').textContent=`Test unavailable: ${error.message}`;}
