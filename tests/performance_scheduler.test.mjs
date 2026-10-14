import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {VRMExpression,VRMExpressionManager,VRMExpressionMorphTargetBind} from '@pixiv/three-vrm-core';
import {AudioPerformanceScheduler} from '../src/performance_scheduler.js';
import {ClockedAvatarPerformance} from '../src/clocked_avatar_performance.js';
import {BodyPlayback} from '../src/body_blending.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
class FakeAudio extends EventTarget {
    constructor(duration=4) {super();this.duration=duration;this.currentTime=0;this.paused=true;this.ended=false;this.starts=0;this.listeners=new Set();}
    addEventListener(name,callback) {super.addEventListener(name,callback);this.listeners.add(callback);}
    removeEventListener(name,callback) {super.removeEventListener(name,callback);this.listeners.delete(callback);}
    play() {this.starts++;this.paused=false;this.dispatchEvent(new Event('playing'));return Promise.resolve();}
    pause() {this.paused=true;this.dispatchEvent(new Event('pause'));}
    advance(time) {this.currentTime=time;}
    end() {this.currentTime=this.duration;this.ended=true;this.dispatchEvent(new Event('ended'));}
}
const segment=(audio=new FakeAudio(),extra={})=>({audio,visemes:[],emotions:[],actions:[],...extra});
function controlled(options={}) {
    let time=0,watch=null;
    const scheduler=new AudioPerformanceScheduler({...options,now:()=>time,repeat:callback=>{watch=callback;return 1;},cancel:()=>{watch=null;}});
    return {scheduler,advance:ms=>{time+=ms;watch?.();},watch:()=>watch};
}
function rig() {
    const root=new THREE.Group(),bone=new THREE.Bone();bone.name='arm';root.add(bone);
    const mixer=new THREE.AnimationMixer(root),manager=new VRMExpressionManager();
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3));
    geometry.morphAttributes.position=[new THREE.Float32BufferAttribute([0,1,0],3)];
    const mesh=new THREE.Mesh(geometry);root.add(mesh);
    for(const name of ['aa','happy']) {
        const expression=new VRMExpression(name);root.add(expression);manager.registerExpression(expression);
        if(name==='aa')expression.addBind(new VRMExpressionMorphTargetBind({primitives:[mesh],index:0,weight:1}));
    }
    const make=(name,start,end)=>mixer.clipAction(new THREE.AnimationClip(name,2,[new THREE.NumberKeyframeTrack('arm.position[x]',[0,2],[start,end])]));
    const animations={idle:make('idle',1,1),wave:make('wave',2,4),nod:make('nod',3,5)};
    animations.idle.play();mixer.update(0);
    return {mixer,manager,mesh,bone,animations,bodyPlayback:new BodyPlayback(animations)};
}

test('audio time freezes mouth, emotion and gesture together across pause and stalls; idle time can continue',async()=>{
    const avatar=rig();let visual;
    const h=controlled({onSegment:data=>{visual=new ClockedAvatarPerformance({...avatar,data});},onTime:(t,dt)=>{visual.sample(t,dt);avatar.manager.update();},onSegmentEnd:()=>visual.stop()});
    const audio=new FakeAudio();
    const done=h.scheduler.play([segment(audio,{visemes:[{value:'A',start:0,end:2}],emotions:[{value:'happy',start:0,end:2}],actions:[{value:'wave',start:0}]})]);
    await flush();audio.advance(1);h.scheduler.sample(.1);
    const happy=avatar.manager.getValue('happy');
    assert.equal(avatar.mesh.morphTargetInfluences[0],1);assert.ok(happy>0&&happy<.3);
    const pose=avatar.bone.position.x,gesture=avatar.animations.wave.time,idle=avatar.animations.idle.time;
    h.scheduler.pause();h.advance(120000);h.scheduler.sample(.1);
    assert.equal(avatar.bone.position.x,pose);assert.equal(avatar.animations.wave.time,gesture);
    assert.equal(avatar.mesh.morphTargetInfluences[0],1);assert.ok(avatar.animations.idle.time>idle);
    h.scheduler.resume();await flush();audio.dispatchEvent(new Event('waiting'));h.scheduler.sample(.1);
    assert.equal(avatar.bone.position.x,pose);assert.ok(Math.abs(avatar.manager.getValue('happy')-happy)<1e-6);
    audio.advance(1.25);h.scheduler.sample();assert.notEqual(avatar.bone.position.x,pose);
    audio.end();await done;assert.equal(avatar.mesh.morphTargetInfluences[0],0);assert.equal(avatar.manager.getValue('happy'),0);
    assert.equal(audio.listeners.size,0);assert.equal(h.watch(),null);
});

test('skipped frames seek to the current audio pose without firing old gestures or exposing the rest pose',()=>{
    const avatar=rig();const visual=new ClockedAvatarPerformance({...avatar,data:segment(new FakeAudio(8),{actions:[{value:'wave',start:1},{value:'nod',start:1.2}]})});
    for(const time of [0,1,1.1,1.2,1.3,2,4,7.9]) {
        visual.sample(time);
        const sum=Object.values(avatar.animations).filter(action=>action.isRunning()).reduce((sum,action)=>sum+action.getEffectiveWeight(),0);
        assert.ok(Math.abs(sum-1)<1e-6,`weight ${sum} exposes rest pose`);assert.ok(avatar.bone.position.x>=1);
    }
    assert.equal(avatar.animations.idle.getEffectiveWeight(),1);assert.equal(avatar.animations.wave.isRunning(),false);
    visual.sample(1.3);const pose=avatar.bone.position.x;visual.sample(1.3);assert.equal(avatar.bone.position.x,pose);
    visual.stop();for(let i=0;i<60;i++){avatar.bodyPlayback.update(1/60);avatar.mixer.update(1/60);assert.ok(avatar.bone.position.x>=.999);}
});

test('bounded segments play sequentially, close only after the final audio ends, and release listeners',async()=>{
    const log=[],one=new FakeAudio(2),two=new FakeAudio(3);
    const h=controlled({onSegment:s=>log.push(['start',s.audio]),onSegmentEnd:s=>log.push(['end',s.audio])});
    const done=h.scheduler.begin();h.scheduler.enqueue(segment(one));h.scheduler.enqueue(segment(two));h.scheduler.finish();
    await flush();assert.equal(one.starts,1);assert.equal(two.starts,0);one.end();await flush();
    assert.equal(two.starts,1);assert.equal(one.paused,true);assert.equal(one.listeners.size,0);assert.equal(h.scheduler.snapshot().playedSeconds,2);
    two.end();await done;assert.deepEqual(log.map(([event])=>event),['start','end','start','end']);
    assert.equal(h.scheduler.snapshot().playedSeconds,5);assert.equal(two.listeners.size,0);
});

test('queued segments retain independent cue snapshots and real expression/body playback resets safely at their boundary',async()=>{
    const avatar=rig();let visual;const targets=[];
    const h=controlled({onSegment:data=>{visual=new ClockedAvatarPerformance({...avatar,data});targets.push(data.actions[0].value);},
        onTime:time=>{visual.sample(time);avatar.manager.update();},onSegmentEnd:()=>visual.stop()});
    const one=new FakeAudio(2),two=new FakeAudio(2),cues=[{value:'nod',start:0}];
    const done=h.scheduler.play([segment(one,{actions:[{value:'wave',start:0}],visemes:[{value:'A',start:0,end:1}]}),
        segment(two,{actions:cues,visemes:[{value:'A',start:0,end:2}]})]);
    cues[0].value='wave';cues.push({value:'bad',start:NaN});
    await flush();one.advance(.5);h.scheduler.sample();assert.equal(avatar.mesh.morphTargetInfluences[0],1);
    one.end();await flush();two.advance(1);h.scheduler.sample();
    assert.deepEqual(targets,['wave','nod']);assert.equal(avatar.mesh.morphTargetInfluences[0],1);
    assert.equal(avatar.animations.nod.getEffectiveWeight(),1);assert.equal(h.scheduler.snapshot().playedSeconds,3);
    two.end();await done;assert.equal(avatar.mesh.morphTargetInfluences[0],0);
    for(let i=0;i<60;i++){avatar.bodyPlayback.update(1/60);avatar.mixer.update(1/60);assert.ok(avatar.bone.position.x>=.999);}
    assert.equal(avatar.animations.idle.getEffectiveWeight(),1);
});

test('queue capacity, duplicate media and malformed timing cannot silently grow or start invalid audio',async()=>{
    const h=controlled({maxSegments:2,maxQueuedSeconds:5});const done=h.scheduler.begin();
    const one=new FakeAudio(2);h.scheduler.enqueue(segment(one));
    assert.throws(()=>h.scheduler.enqueue(segment(one)),/own audio/);
    h.scheduler.enqueue(segment(new FakeAudio(2)));
    assert.throws(()=>h.scheduler.enqueue(segment(new FakeAudio(1))),/queue is full/);
    assert.throws(()=>h.scheduler.enqueue(segment(new FakeAudio(1),{actions:[{value:'wave',start:NaN}]})),/Invalid/);
    assert.equal(h.scheduler.snapshot().queuedSegments,1);
    h.scheduler.stop();await assert.rejects(done,{name:'AbortError'});
    const bad=new FakeAudio(Infinity);await assert.rejects(h.scheduler.play([segment(bad)]),/finite duration/);assert.equal(bad.starts,0);
    const durationBound=controlled({maxSegments:4,maxQueuedSeconds:5});
    await assert.rejects(durationBound.scheduler.play([segment(new FakeAudio(2)),segment(new FakeAudio(2)),segment(new FakeAudio(2))]),/queue is full/);
    const totalBound=controlled({maxTotalSeconds:3});
    await assert.rejects(totalBound.scheduler.play([segment(new FakeAudio(2)),segment(new FakeAudio(2))]),/duration limit/);
});

test('stop cancels queued segments and late play completion cannot restart the old performance',async()=>{
    let releasePlay;const one=new FakeAudio(),two=new FakeAudio();
    one.play=()=>{one.starts++;one.paused=false;return new Promise(resolve=>{releasePlay=resolve;});};
    let released=0;const h=controlled();const controller=new AbortController();
    const done=h.scheduler.play([segment(one,{release:()=>released++}),segment(two,{release:()=>released++})],{signal:controller.signal});
    await flush();controller.abort();await assert.rejects(done,{name:'AbortError'});
    assert.equal(two.starts,0);assert.equal(released,2);assert.equal(one.listeners.size,0);assert.equal(h.watch(),null);
    releasePlay();await flush();assert.equal(one.paused,true);assert.equal(h.scheduler.snapshot().phase,'stopped');
    assert.equal(h.scheduler.snapshot().error,null);assert.equal(h.scheduler.snapshot().paused,false);
    const fresh=new FakeAudio();const next=h.scheduler.play([segment(fresh)]);await flush();one.end();assert.equal(h.scheduler.current.segment.audio,fresh);
    fresh.end();await next;
});

test('stall deadline measures lack of progress and excludes user pause rather than limiting total playback duration',async()=>{
    const h=controlled({stallMs:1000});const audio=new FakeAudio(10);const done=h.scheduler.play([segment(audio)]);await flush();
    for(let i=1;i<5;i++){audio.advance(i);h.advance(900);}
    assert.equal(h.scheduler.phase,'playing');h.scheduler.pause();h.advance(50000);assert.equal(h.scheduler.phase,'paused');
    h.scheduler.resume();await flush();audio.dispatchEvent(new Event('waiting'));h.advance(1001);
    await assert.rejects(done,/stalled/);assert.equal(audio.paused,true);assert.equal(audio.listeners.size,0);
    const gap=h.scheduler.begin();h.advance(1001);await assert.rejects(gap,/did not arrive/);
});

test('a paused segment boundary does not start queued audio until resumed, including a producer gap',async()=>{
    const h=controlled();const one=new FakeAudio(),two=new FakeAudio();const done=h.scheduler.begin();h.scheduler.enqueue(segment(one));await flush();
    h.scheduler.pause();one.end();h.scheduler.enqueue(segment(two));h.scheduler.finish();await flush();assert.equal(two.starts,0);
    h.scheduler.resume();await flush();assert.equal(two.starts,1);two.end();await done;
    const later=h.scheduler.begin();h.scheduler.enqueue(segment(new FakeAudio()));await flush();h.scheduler.current.segment.audio.end();
    assert.equal(h.scheduler.phase,'buffering');h.scheduler.enqueue(segment(new FakeAudio()));h.scheduler.finish();await flush();h.scheduler.current.segment.audio.end();await later;
});

test('audio permission errors and malformed expression preparation fail visibly and clean up ownership',async()=>{
    const h=controlled();const audio=new FakeAudio();audio.play=()=>Promise.reject(new Error('Audio permission denied'));
    await assert.rejects(h.scheduler.play([segment(audio)]),/permission denied/);assert.equal(audio.listeners.size,0);assert.equal(h.watch(),null);
    audio.play=()=>Promise.reject(new DOMException('Playback needs a user gesture','NotAllowedError'));
    await assert.rejects(h.scheduler.play([segment(audio)]),/needs a user gesture/);
    const broken=controlled({onSegment:()=>{throw new Error('Invalid expression cue timing');}});
    const invalid=new FakeAudio();await assert.rejects(broken.scheduler.play([segment(invalid)]),/expression cue/);assert.equal(invalid.starts,0);assert.equal(invalid.listeners.size,0);
});

test('even a failing cleanup hook settles the turn and clears audio listeners instead of leaving Speaking forever',async()=>{
    const audio=new FakeAudio();
    const scheduler=new AudioPerformanceScheduler({repeat:()=>1,cancel:()=>{throw new Error('Fixture timer cleanup failed');}});
    const done=scheduler.play([segment(audio)]);await flush();audio.end();
    await assert.rejects(done,/timer cleanup failed/);assert.equal(audio.listeners.size,0);assert.equal(scheduler.phase,'failed');
});
