import test from 'node:test';
import assert from 'node:assert/strict';
import {dueGestures} from '../src/gesture_clock.js';
test('opening gestures wait for audible samples, rather than word metadata',()=>{
    const cues=[{value:'wave',start:0}],seen=new Set(),available=new Set(['wave']);
    assert.deepEqual(dueGestures(cues,{playedFrames:0,playedSeconds:0},seen,available),[]);
    assert.equal(seen.size,0);
    assert.deepEqual(dueGestures(cues,{playedFrames:2400,playedSeconds:.1},seen,available),cues);
    assert.deepEqual(dueGestures(cues,{playedFrames:4800,playedSeconds:.2},seen,available),[]);
});
test('paused/buffering frames hold cues; assets arriving after their anchor cannot replay old gestures',()=>{
    const cues=[{value:'wave',start:0}],seen=new Set(),available=new Set(['wave']);
    assert.deepEqual(dueGestures(cues,{playedFrames:2400,playedSeconds:.1,paused:true},seen,available),[]);
    assert.deepEqual(dueGestures(cues,{playedFrames:2400,playedSeconds:.1,buffering:true},seen,available),[]);
    assert.deepEqual(dueGestures(cues,{playedFrames:48000,playedSeconds:2},seen,available),[]);
    assert.equal(seen.size,1);
});
