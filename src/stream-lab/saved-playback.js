import {weightsAt} from './playback.js';

// A recording's own media clock drives its stored cues. No delivery simulation.
export class SavedPlayback {
  constructor(clip, audio = new Audio(clip.audio)) {
    this.clip=clip;this.audio=audio;this.audio.preload='auto';
    this.started=null;this.firstPlaybackSeconds=null;
    this.audio.onplaying=()=>{if(this.firstPlaybackSeconds===null)this.firstPlaybackSeconds=(performance.now()-this.started)/1000;};
  }
  play(){this.started=performance.now();return this.audio.play();}
  sample(){return {playedSeconds:this.audio.currentTime,durationSeconds:this.clip.duration,
    finished:this.audio.ended,firstPlaybackSeconds:this.firstPlaybackSeconds};}
  weights(){return this.audio.paused||this.audio.ended?[0,0,0,0,0,0]:weightsAt(this.clip.cues,this.audio.currentTime);}
  stop(){this.audio.pause();this.audio.onended=null;this.audio.onerror=null;this.audio.onplaying=null;this.audio.removeAttribute('src');this.audio.load();}
}
