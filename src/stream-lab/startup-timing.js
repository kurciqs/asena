// Server durations use one monotonic clock; only the browser remainder mixes
// endpoints, by subtraction from click-to-output time. No clocks are subtracted
// directly across processes. These are startup-path stages, not total TTS work.
export class StartupTiming {
  constructor() {
    this.setup=null;this.offset=null;this.request=null;this.connected=null;this.headers=null;
    this.firstByte=null;this.packet=null;this.intervals=[];this.active=null;this.frozen=null;
  }
  prepared(seconds){this.setup=seconds;}
  observe(event,elapsed) {
    if(this.frozen)return;
    if(event.type==='begin')this.offset=elapsed-event.wallSeconds;
    if(event.type==='request'&&event.index===0)this.request=event.wallSeconds;
    if(event.type==='provider-stage'&&event.index===0){
      if(event.phase==='connected')this.connected=event.wallSeconds;
      if(event.phase==='headers')this.headers=event.wallSeconds;
      if(event.phase==='first-byte')this.firstByte=event.wallSeconds;
    }
    if(event.type==='provider'&&this.packet===null)this.packet=event.packet.wallSeconds;
    if(event.type==='analysis')this.active={index:event.index,start:event.wallSeconds};
    if(event.type==='segment'){
      const start=event.analysisStartSeconds??this.active?.start;
      const end=event.analysisEndSeconds??event.wallSeconds;
      if(Number.isFinite(start)&&Number.isFinite(end)&&end>=start)this.intervals.push([start,end]);
      this.active=null;
    }
  }
  playback(seconds,event){
    if(!this.frozen&&Number.isFinite(seconds))this.frozen={total:seconds,backendEnd:event.wallSeconds};
  }
  snapshot(elapsed) {
    const total=this.frozen?.total??elapsed;
    const backendEnd=this.frozen?.backendEnd??(this.offset===null?null:Math.max(0,elapsed-this.offset));
    const rows=[];
    const add=(id,label,seconds,details,ongoing=false)=>rows.push({id,label,seconds,details,ongoing});
    const span=(a,b)=>a===null?null:Math.max(0,(b??backendEnd??a)-a);
    add('browserPreparation','Browser audio setup',this.setup??(backendEnd===null?total:null),
      'Audio context creation and resume after pressing Start.',this.setup===null);
    add('serviceBoot','Kokoro service boot',null,'Outside this test. Docker/model boot is not started or timed by the page.');
    add('serverSetup','Server preparation',backendEnd===null?null:this.request??backendEnd,
      'Streaming worker, ownership lock and opening request preparation.',this.request===null);
    if(this.connected!==null&&this.headers!==null){
      add('connection','Kokoro connection',span(this.request,this.connected),'Loopback connection setup.');
      add('requestStartup','Kokoro request startup',span(this.connected,this.headers),
        'Request send through response headers; includes provider readiness/validation, not isolated model boot.');
      add('generation','Kokoro generation → first bytes',span(this.headers,this.firstByte),
        'Includes text/phoneme processing, synthesis, encoding and first-byte delivery; pure inference is not separately exposed.',this.firstByte===null);
      add('packet','First packet receipt & decoding',span(this.firstByte,this.packet),
        'Remaining JSON/PCM transfer, frame parsing, base64 decoding and validation.',this.packet===null);
    }else{
      add('connection','Kokoro connection',span(this.request,this.connected),
        'Loopback connection setup.',this.request!==null&&this.connected===null);
      add('requestStartup','Kokoro request startup',span(this.connected,this.headers),
        'Waiting for response headers; provider setup and validation can occur here.',this.connected!==null&&this.headers===null);
      // Old captures/mocks have no transport milestones. Keep their combined
      // provider wait explicit rather than fabricate an inference split.
      if(this.packet!==null&&this.connected===null){
        rows.find(r=>r.id==='connection').seconds=null;
        add('providerUnsplit','Kokoro first-audio wait (unsplit)',span(this.request,this.packet),
          'This capture has no transport milestones; startup and generation cannot be separated.');
      }
      add('generation','Kokoro generation → first bytes',null,
        this.packet===null?'Waiting for response headers.':'No separate generation milestone in this capture.');
      add('packet','First packet receipt & decoding',null,'Waiting for first audio bytes.');
    }
    let rhubarb=0;
    if(this.packet!==null&&backendEnd!==null){
      // Merge intervals so overlapping/malformed duplicates never double count.
      const intervals=this.intervals.map(([a,b])=>[Math.max(this.packet,a),Math.min(backendEnd,b)]);
      if(this.active&&!this.frozen)intervals.push([Math.max(this.packet,this.active.start),backendEnd]);
      intervals.sort((a,b)=>a[0]-b[0]);let end=this.packet;
      for(const [a,b] of intervals){rhubarb+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
    }
    add('rhubarb','Rhubarb before first playback',this.packet===null?null:rhubarb,
      'Region WAV/transcript preparation, recognizer process and cue parsing. Stops counting at the region that releases playback.',!!this.active&&!this.frozen);
    add('buffer','Waiting for enough aligned audio',this.packet===null?null:Math.max(0,backendEnd-this.packet-rhubarb),
      'Waiting for more input/context, preparing regions and assembling results, excluding Rhubarb intervals.',!this.frozen&&this.packet!==null);
    const remainder=this.frozen?Math.max(0,total-this.frozen.backendEnd-(this.setup??0)):null;
    add('browserDelivery','Browser delivery & scheduling',remainder,
      'Initial response delivery, aligned-region transfer/decoding and audio output scheduling. Residual, not a network-only measurement.');
    return {totalSeconds:total,complete:!!this.frozen,rows,
      accountedSeconds:rows.reduce((n,r)=>n+(r.seconds??0),0),
      measurement:'Click to estimated first Web Audio output. Active stage timers are estimates; completed durations use monotonic milestones.',
      overlap:'Only the startup path is counted. Kokoro continues generating while Rhubarb works; later work is excluded.'};
  }
}
