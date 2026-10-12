import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SavedPlayback} from '../src/stream-lab/saved-playback.js';
import {weightsAt} from '../src/pcm_stream_playback.js';
test('stored audio clock drives original mouth cues, with no prepared-audio gate',async()=>{
  const clip={audio:'/replay/intro.wav',duration:3,cues:[{start:0,end:1,value:'D'},{start:1,end:3,value:'A'}]};
  const audio={currentTime:.4,paused:true,ended:false,play(){this.paused=false;this.onplaying();return Promise.resolve();},pause(){this.paused=true;},removeAttribute(){this.removed=true;},load(){}};
  const player=new SavedPlayback(clip,audio);await player.play();
  assert.deepEqual(player.weights(),weightsAt(clip.cues,.4));
  audio.currentTime=1.4;assert.deepEqual(player.weights(),weightsAt(clip.cues,1.4));
  assert.equal(player.sample().playedSeconds,1.4);audio.paused=true;assert.deepEqual(player.weights(),[0,0,0,0,0,0]);
  player.stop();assert.equal(audio.removed,true);
});
