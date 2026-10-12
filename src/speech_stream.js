import {PCMPlayer,Lines} from './pcm_stream_playback.js';

// One ownership scope for streamed audio, acknowledgements and provider cancellation.
export async function playSpeechStream({text,voice,signal,speechProfile=null,onPlayer=()=>{},onClock=()=>{},onWords=()=>{},
  onEvent=()=>{},onWarning=()=>{},onReport=()=>{},
  fetcher=fetch,createContext=()=>new AudioContext(),requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame}) {
  const controller=new AbortController(),context=createContext();
  let token=null,player=null,timer=null,frame=null,result=null,reader=null;
  const send=(path,data,options={})=>fetcher(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),...options});
  const cancel=()=>{player?.stop();controller.abort();
    if(token)send('/api/speech/cancel',{token},{keepalive:true,signal:AbortSignal.timeout(2000)}).catch(()=>{});};
  const aborted=()=>cancel();signal?.addEventListener('abort',aborted,{once:true});
  const deadline=setTimeout(()=>controller.abort(new Error('Streaming speech exceeded its deadline')),185000);
  try {
    if(signal?.aborted)throw new DOMException('Turn stopped','AbortError');
    await context.resume();
    const response=await send('/api/speech/stream',{input:text,voice,...(speechProfile?{strategy:speechProfile.strategy,policy:speechProfile.policy,openingSeconds:speechProfile.openingSeconds,startupSeconds:speechProfile.startupSeconds}:{})},{signal:controller.signal});
    if(!response.ok)throw new Error((await response.json()).error??'Speech streaming unavailable');
    const tick=()=>{if(player){onClock(player.sample());frame=requestFrame(tick);}};
    const ack=async()=>{
      if(controller.signal.aborted||!player||!token)return;
      try {
        const r=await send('/api/speech/progress',{token,playedFrames:player.sample().playedFrames},{signal:controller.signal});
        if(!r.ok)throw new Error('Speech playback acknowledgement failed');
        timer=setTimeout(ack,200);
      } catch(error){if(!controller.signal.aborted)controller.abort(error);}
    };
    reader=response.body.getReader();const parser=new Lines();
    while(true){
      const {value,done}=await reader.read();
      for(const event of parser.push(value??new Uint8Array(),done)){
        if(controller.signal.aborted)throw new DOMException('Turn stopped','AbortError');
        token=event.token;
        onEvent(event);
        if(event.type==='begin'){
          if((event.rate!==24000&&!(event.fixtureOnly===true&&event.rate===44100))||player)throw new Error('Unsupported or repeated speech format');
          player=new PCMPlayer(context,{rate:event.rate,startupSeconds:event.startupSeconds});
          onPlayer(player);frame=requestFrame(tick);ack();
        }else if(event.type==='words')onWords(event.timestamps);
        else if(event.type==='segment'){
          if(!player)throw new Error('Speech audio arrived before format metadata');player.add(event);
        }else if(event.type==='eos')player?.finish();
        else if(event.type==='warning')onWarning(event.message);
        else if(event.type==='error'){
          const error=new Error(event.error);error.report={...event.report,browser:player?.sample()??null};throw error;
        }
        else if(event.type==='result')result={...event.report,browser:player.sample()};
      }
      if(done)break;
    }
    if(!result?.complete||!player?.sample().finished)throw new Error('Speech stream ended before playback completed');
    onReport(result);return result;
  } catch(error) {
    error.report ??= {complete:false,browser:player?.sample()??null};
    onReport(error.report);throw error;
  } finally {
    clearTimeout(timer);clearTimeout(deadline);if(frame!==null)cancelFrame(frame);
    signal?.removeEventListener('abort',aborted);cancel();
    reader?.releaseLock?.();await context.close().catch(()=>{});
  }
}
