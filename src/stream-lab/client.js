import {PCMPlayer,Lines} from './playback.js';
import {createViewer} from './viewer.js';
import {StartupTiming} from './startup-timing.js';
const $=id=>document.getElementById(id),zero=[0,0,0,0,0,0];
let viewer,run=null,report=null,drawId=null,trialTexts={};
const controls=['source','policy','profile','startup','length','strategy','opening'];
function displayText(text){$('trial-text').textContent=text;$('trial-size').textContent=`${text.trim().split(/\s+/).length} words · ${text.length} characters`;}
function trialTextChanged(){if($('source').value==='live')displayText(trialTexts[$('length').value==='1'?'short':'sustained']??'');}
function state(running){controls.forEach(id=>$(id).disabled=running);$('profile').disabled=running||$('source').value==='live';$('start').disabled=running||!viewer;$('stop').disabled=!running;$('download').disabled=!report;}
function sourceChanged(){
  const live=$('source').value==='live';
  document.title=live?'Asena · Live speech streaming test':'Asena · Saved-audio streaming test';
  $('live-options').hidden=!live;$('trial-text-section').hidden=!live;
  $('startup-breakdown').hidden=!live;
  for(const option of $('startup').options)option.disabled=!live&&Number(option.value)<2;
  $('startup').value='2';trialTextChanged();
  document.querySelector('aside > .eyebrow').textContent=live?'Stage 2 / live speech':'Stage 1 / saved audio only';
  document.querySelector('.viewer-label .eyebrow').textContent=live?'Live voice · real Rhubarb analysis':'Saved voice · real Rhubarb analysis';
  $('policy').options[3].disabled=live;if(live&&$('policy').value==='sentences')$('policy').value='2s';
  $('analysis-note').textContent=live?'The first region can be shorter than later regions. Up to 250 ms context on each side; completed phrases flush immediately. Audio stays at Kokoro’s 24 kHz. One recognizer at a time. A smaller reserve can cause pauses; it does not change speech speed.':'250 ms analysis context on each side; audio overlap is never played twice. One native Rhubarb process at a time, no alignment cache. These delivery patterns are synthetic and exclude Kokoro startup delay and competing inference.';
  document.querySelector('.intro').textContent=live?'Kokoro generates the fixed trial text now. Rhubarb aligns arriving audio while prepared regions play. No language model is called.':'Saved Kokoro recordings arrive gradually. Rhubarb prepares each region while the previous audio plays. Kokoro and the language model stay off.';
  $('length').options[0].textContent=live?'Short · introduction':'Short · 26 seconds';
  $('length').options[1].textContent=live?'Sustained · conversational passage':'Sustained · 77 seconds';
  $('provider-timing').textContent=live?'Provider arrival time will be measured during this run.':'Saved delivery excludes speech generation time.';
  $('start').textContent=live?'Start live speech test':'Start saved-audio test';
  $('delivery-note').hidden=live;state(false);
}
function metrics(current) {
  const s=current.player?.sample();if(!s)return;
  const elapsed=(performance.now()-current.started)/1000;
  const startupTiming=current.timing.snapshot(elapsed);
  if(current.live){
    $('startup-total').textContent=`${startupTiming.complete?'First playback':'Waiting'} · ${startupTiming.totalSeconds.toFixed(2)}s`;
    for(const row of startupTiming.rows){
      let line=document.getElementById(`timing-${row.id}`);
      if(!line){line=document.createElement('div');line.id=`timing-${row.id}`;
        const label=document.createElement('dt'),value=document.createElement('dd');label.textContent=row.label;line.append(label,value);$('startup-stages').append(line);}
      line.title=row.details;
      line.querySelector('dd').textContent=row.seconds===null?(row.id==='serviceBoot'?'Not in this test':'—'):`${row.seconds.toFixed(3)}s${row.ongoing?' …':''}`;
    }
  }
  $('first').textContent=s.firstPlaybackSeconds===null?'—':s.firstPlaybackSeconds.toFixed(2)+'s';
  $('buffer').textContent=s.bufferSeconds.toFixed(2)+'s';$('gaps').textContent=`${s.gapCount} · ${s.gapSeconds.toFixed(3)}s`;
  $('compute').textContent=current.compute.toFixed(2)+'s';$('memory').textContent=(current.peak/1024**2).toFixed(0)+' MiB';
  $('position').textContent=s.playedSeconds.toFixed(2)+'s';
  const phase=s.finished?'finished':s.buffering?'buffering':s.playedFrames>0?'playing':
    current.live&&current.firstProvider===null?'generating':'preparing';
  $('playback-state').dataset.state=phase;
  $('playback-state').textContent=s.buffering?`Buffering · waiting ${s.waitingSeconds.toFixed(1)}s`:
    s.finished?'Playback complete':phase==='playing'?'Playing':phase==='generating'?`Generating first voice packet · ${elapsed.toFixed(1)}s elapsed`:
      `Preparing mouth timing · ${elapsed.toFixed(1)}s elapsed · ${s.bufferSeconds.toFixed(1)} / ${current.config.startupSeconds}s ready`;
  if(phase==='generating')$('provider-timing').textContent=`Waiting for first Kokoro audio · ${elapsed.toFixed(1)}s elapsed`;
  if(phase!==current.phase){
    current.phase=phase;
    if(phase==='buffering')$('status').textContent='Prepared audio ran out. Waiting for the next aligned region…';
    else if(phase==='playing')$('status').textContent='Playing while later regions are being aligned.';
    else if(phase==='generating')$('status').textContent='Text is ready. Kokoro is generating the opening audio…';
    else if(phase==='preparing')$('status').textContent='Audio has arrived. Rhubarb is preparing matching mouth timing…';
  }
  const actual=viewer.draw(current.player.weights());
  $('motion-status').textContent=s.buffering?`Buffering · waiting ${s.waitingSeconds.toFixed(1)}s`:`Applied mouth: ${actual.peakAppliedMorph.toFixed(2)}`;
  current.actualPeak=Math.max(current.actualPeak,actual.peakAppliedMorph);
  $('inspection').textContent=JSON.stringify({source:current.live?'live Kokoro':'saved Kokoro audio',...current.config,...s,
    regionCount:current.regions,aligningRegion:current.analyzing??null,computeSeconds:current.compute,peakRssBytes:current.peak,
    elapsedSeconds:elapsed,firstProviderAudioSeconds:current.firstProvider,providerRequestIndex:current.requestIndex,
    startupTiming:current.live?startupTiming:null,
    ...actual,peakObservedMorph:current.actualPeak,sourceSha256:current.sourceSha256},null,2);
  return s;
}
function tick(){drawId=null;if(!run)return;metrics(run);drawId=requestAnimationFrame(tick);}
async function progress(current) {
  if(run!==current||!current.token||!current.player)return;
  const s=metrics(current);
  const response=await fetch(current.live?'/probe/live/progress':'/probe/progress',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:current.token,playedFrames:s.playedFrames}),signal:current.controller.signal});
  if(!response.ok)throw new Error('Playback acknowledgement failed');
  if(run===current)current.timer=setTimeout(()=>progress(current).catch(error=>{if(run===current)stop(error.message);}),200);
}
async function start() {
  if(run)return;
  const started=performance.now();
  const live=$('source').value==='live';
  const current={live,controller:new AbortController(),context:new AudioContext(),player:null,token:null,
    compute:0,peak:0,regions:0,actualPeak:0,events:[],config:{policy:$('policy').value,...(live?{}:{profile:$('profile').value}),
    startupSeconds:Number($('startup').value),repeats:Number($('length').value),
    ...(live?{strategy:$('strategy').value,openingSeconds:Number($('opening').value)}:{})},
    started,firstProvider:null,requestIndex:null,timing:new StartupTiming()};
  $('startup-stages').replaceChildren();
  run=current;report=null;state(true);$('status').textContent=live?'Requesting real Kokoro speech…':'Delivering saved audio; waiting for the first aligned regions…';
  $('provider-timing').textContent=live?'Measuring provider arrival during this run…':'Saved delivery excludes speech generation time.';
  try {
    await current.context.resume();
    current.timing.prepared((performance.now()-current.started)/1000);
    current.player=new PCMPlayer(current.context,{startupSeconds:current.config.startupSeconds,createdAt:current.started});
    drawId=requestAnimationFrame(tick);
    const response=await fetch(live?'/probe/live':'/probe/run',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(current.config),signal:current.controller.signal});
    if(!response.ok)throw new Error((await response.json()).error);
    const reader=response.body.getReader(),lines=new Lines();
    while(run===current) {
      const {value,done}=await reader.read();
      for(const event of lines.push(value??new Uint8Array(),done)) {
        current.timing.observe(event,(performance.now()-current.started)/1000);
        current.token=event.token;
        current.events.push(Object.fromEntries(Object.entries(event).filter(([key])=>key!=='pcm'&&key!=='report')));
        if(event.type==='begin') {
          current.player.rate=event.rate;
          current.sourceSha256=event.sha256;
          if(live)displayText(event.text);
          progress(current).catch(error=>{if(run===current)stop(error.message);});
        } else if(event.type==='request')current.requestIndex=event.index;
        else if(event.type==='provider'){
          if(current.firstProvider===null)current.firstProvider=event.packet.wallSeconds;
          $('provider-timing').textContent=`First Kokoro audio: ${current.firstProvider.toFixed(2)}s · packet ${event.packet.index+1}: ${(event.packet.frames/current.player.rate).toFixed(2)}s of speech`;
        } else if(event.type==='analysis')current.analyzing=event.index;
        else if(event.type==='segment') {
          current.analyzing=null;
          current.player.add(event);current.compute+=event.seconds;current.peak=Math.max(current.peak,event.peakRssBytes);current.regions++;
          current.timing.playback(current.player.firstPlaybackSeconds,event);
          if(current.player.firstPlaybackSeconds===null)$('status').textContent='Preparing the startup buffer…';
        } else if(event.type==='eos'){current.player.finish();current.timing.playback(current.player.firstPlaybackSeconds,event);}
        else if(event.type==='error')throw new Error(event.error);
        else if(event.type==='cancelled')throw new Error('Test cancelled');
        else if(event.type==='result') {
          const s=metrics(current);
          report={...event.report,startupTiming:live?current.timing.snapshot((performance.now()-current.started)/1000):null,browser:{...s,receiver:'Web Audio sample clock',gaps:current.player.gaps,
            bufferPeakSeconds:current.player.bufferPeak,bufferMinimumSeconds:current.player.bufferMinimum,
            peakObservedMorph:current.actualPeak,audioContextRate:current.context.sampleRate,
            baseLatency:current.context.baseLatency,outputLatency:current.context.outputLatency??null}};
          if(live)$('provider-timing').textContent=`First Kokoro audio: ${report.firstProviderAudioSeconds?.toFixed(2)}s · provider finished: ${report.providerFinishedSeconds?.toFixed(2)}s · ${report.providerPackets.length} packets · ${(report.rate/1000).toFixed(0)} kHz`;
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
  $('playback-state').dataset.state='ready';$('playback-state').textContent='Stopped';
  $('inspection').textContent=JSON.stringify({...current.config,stopped:true,
    playedFrames:current.player?.played??0,queuedAudioSeconds:0,peakObservedMorph:current.actualPeak},null,2);
  // Send cancellation independently before aborting the receiving request.
  if(current.token)try{await fetch(current.live?'/probe/live/cancel':'/probe/cancel',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:current.token}),signal:AbortSignal.timeout(2000),keepalive:true});}catch{}
  current.controller.abort();await cleanup(current);state(false);$('status').textContent=message;
}
$('start').addEventListener('click',start);$('stop').addEventListener('click',()=>stop());
$('source').addEventListener('change',sourceChanged);
$('length').addEventListener('change',trialTextChanged);
$('download').addEventListener('click',()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=report.fixtureOnly===false?'kokoro-live-stream-report.json':'rhubarb-saved-stream-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&run)stop('Stopped because the test page was hidden.');});
window.addEventListener('pagehide',()=>{if(run){const current=run;if(current.token)fetch(current.live?'/probe/live/cancel':'/probe/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:current.token}),keepalive:true}).catch(()=>{});current.controller.abort();current.player?.stop();current.context.close();}viewer?.dispose();});
try {viewer=await createViewer($('stage'));viewer.draw(zero);$('active-method').textContent='Native Rhubarb · corrected mouth mapping';
  const health=await (await fetch('/probe/health')).json();$('source').options[1].disabled=!health.liveEnabled;trialTexts=health.trialTexts??{};
  if(health.liveEnabled&&new URLSearchParams(location.search).get('source')==='live')$('source').value='live';
  sourceChanged();$('status').textContent='Ready. Press Start to run the selected test.';state(false);
}catch(error){$('status').textContent=`Test unavailable: ${error.message}`;}
