import {RHUBARB, CHANNELS, boundedWeights} from './rhubarb_mouth.js';

// Protocol framing stays separate from audio-region boundaries.
export class Lines {
  constructor() { this.decoder=new TextDecoder('utf-8',{fatal:true}); this.pending=''; }
  push(bytes,final=false) {
    this.pending+=this.decoder.decode(bytes,{stream:!final});
    if(this.pending.length>2_000_000)throw new Error('Oversized test frame');
    const lines=this.pending.split('\n');this.pending=lines.pop();
    if(final && this.pending.trim())throw new Error('Incomplete test stream');
    return lines.filter(line=>line.trim()).map(line=>JSON.parse(line));
  }
}

export function validateSegment(segment,expected,rate) {
  if(!Number.isInteger(segment.startFrame)||!Number.isInteger(segment.endFrame)||
      segment.startFrame!==expected||segment.endFrame<=expected||segment.endFrame-expected>5*rate||
      !Array.isArray(segment.cues)||segment.cues.length>4096)throw new Error('Non-contiguous audio region');
  let previous=segment.startFrame/rate;
  for(const cue of segment.cues) {
    if(!Object.hasOwn(RHUBARB,cue.value)||!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||
      cue.start<previous-1/rate||cue.end<cue.start||cue.end>segment.endFrame/rate+1/rate)throw new Error('Invalid aligned mouth region');
    previous=cue.end;
  }
}

export function weightsAt(cues,time) {
  const current=cues.find(c=>c.start<=time&&time<c.end);
  if(!current)return CHANNELS.map(()=>0);
  const base=RHUBARB[current.value];
  const previous=cues.find(c=>Math.abs(c.end-current.start)<.0001);
  // Same short transition blend as the comparison adapter; sample-global clock.
  const mix=Math.max(0,Math.min(1,(time-current.start)/.04));
  return boundedWeights(base.map((v,i)=>v*mix+(previous?RHUBARB[previous.value][i]:0)*(1-mix)));
}

export class PCMPlayer {
  constructor(context,{startupSeconds=2,rate=44100,now=()=>performance.now(),createdAt=null}={}) {
    this.context=context;this.startupSeconds=startupSeconds;this.rate=rate;this.now=now;
    this.blocks=[];this.cues=[];this.ready=0;this.played=0;this.tail=null;this.eos=false;this.stopped=false;
    this.created=createdAt??now();this.firstPlaybackSeconds=null;this.gaps=[];this.bufferPeak=0;this.bufferMinimum=null;this.waitingSince=null;this.paused=false;
  }
  add(segment) {
    if(this.stopped)throw new Error('Playback stopped');
    validateSegment(segment,this.ready,this.rate);
    if((segment.endFrame-this.position())/this.rate>12.5)throw new Error('Prepared audio exceeded its bounded queue');
    const raw=Uint8Array.from(atob(segment.pcm),c=>c.charCodeAt(0));
    const length=segment.endFrame-segment.startFrame;
    if(raw.byteLength!==length*2)throw new Error('PCM length mismatch');
    const buffer=this.context.createBuffer(1,length,this.rate);
    const target=buffer.getChannelData(0),view=new DataView(raw.buffer);
    for(let i=0;i<length;i++)target[i]=view.getInt16(i*2,true)/32768;
    this.blocks.push({startFrame:segment.startFrame,endFrame:segment.endFrame,buffer,at:null,node:null});
    this.cues.push(...segment.cues);this.ready=segment.endFrame;
    this.schedule();
  }
  finish() {this.eos=true;this.schedule();}
  schedule() {
    if(this.tail===null && this.ready/this.rate<this.startupSeconds && !this.eos)return;
    for(const block of this.blocks) {
      if(block.at!==null)continue;
      const now=this.context.currentTime;
      let at=this.tail===null ? now+.08 : this.tail;
      if(this.tail!==null && at<now) {
        const newAt=now+.025;
        this.gaps.push({sourceSeconds:block.startFrame/this.rate,seconds:newAt-at});at=newAt;
      }
      if(this.firstPlaybackSeconds===null) {
        const stamp=this.context.getOutputTimestamp?.();
        this.firstPlaybackSeconds=stamp?.contextTime>0 && stamp?.performanceTime>0 ?
          (stamp.performanceTime-this.created)/1000+at-stamp.contextTime :
          (this.now()-this.created)/1000+at-now+(this.context.outputLatency??0);
      }
      const node=this.context.createBufferSource();node.buffer=block.buffer;node.connect(this.context.destination);
      block.node=node;block.at=at;node.start(at);
      node.onended=()=>{node.onended=null;node.disconnect();node.buffer=null;block.node=null;block.buffer=null;};
      this.tail=at+(block.endFrame-block.startFrame)/this.rate;
    }
    this.sample();
  }
  outputTime() {
    const stamp=this.context.getOutputTimestamp?.();
    return stamp?.contextTime>0 && stamp?.performanceTime>0 ?
      Math.min(this.context.currentTime,stamp.contextTime+(this.now()-stamp.performanceTime)/1000) :
      Math.max(0,this.context.currentTime-(this.context.outputLatency??0));
  }
  audibleBlock() {
    const time=this.outputTime();
    return this.blocks.find(b=>b.at!==null&&time>=b.at&&time<b.at+(b.endFrame-b.startFrame)/this.rate);
  }
  position() {
    let position=this.played;
    const audioTime=this.outputTime();
    for(const b of this.blocks) {
      if(b.at===null||audioTime<b.at)break;
      position=Math.max(position,Math.min(b.endFrame,b.startFrame+Math.floor((audioTime-b.at)*this.rate)));
    }
    return position;
  }
  sample() {
    this.played=this.position();
    const held=(this.ready-this.played)/this.rate;
    this.bufferPeak=Math.max(this.bufferPeak,held);
    if(this.tail!==null && !this.eos)this.bufferMinimum=this.bufferMinimum===null?held:Math.min(this.bufferMinimum,held);
    this.blocks=this.blocks.filter(b=>b.endFrame>this.played);
    // Keep one previous region of cues to preserve blending across boundaries.
    this.cues=this.cues.filter(c=>c.end>=this.played/this.rate-.1);
    const finished=this.eos&&this.played===this.ready;
    const buffering=!this.stopped&&!this.paused&&!finished&&this.played>0&&!this.audibleBlock();
    if(buffering&&this.waitingSince===null)this.waitingSince=this.now();
    if(!buffering)this.waitingSince=null;
    return {playedFrames:this.played,playedSeconds:this.played/this.rate,bufferSeconds:held,
      firstPlaybackSeconds:this.firstPlaybackSeconds,gapCount:this.gaps.length,gapSeconds:this.gaps.reduce((n,g)=>n+g.seconds,0),
      buffering,paused:this.paused,waitingSeconds:buffering?(this.now()-this.waitingSince)/1000:0,finished};
  }
  async pause(){if(!this.stopped&&!this.paused){await this.context.suspend();this.paused=true;}}
  async resume(){if(!this.stopped&&this.paused){await this.context.resume();this.paused=false;}}
  weights() {return this.audibleBlock()?weightsAt(this.cues,this.position()/this.rate):CHANNELS.map(()=>0);}
  resources() {return {blocks:this.blocks.length,buffers:this.blocks.filter(b=>b.buffer).length,
    nodes:this.blocks.filter(b=>b.node).length,cues:this.cues.length};}
  stop() {
    if(this.stopped)return;
    this.played=this.position();this.ready=this.played;
    this.stopped=true;
    for(const b of this.blocks) {if(b.node){b.node.onended=null;try{b.node.stop();}catch{}b.node.disconnect();b.node.buffer=null;b.node=null;}b.buffer=null;}
    this.blocks=[];this.cues=[];
  }
}
