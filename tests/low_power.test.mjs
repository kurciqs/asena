import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RenderLoop,BlinkClock,renderPreferences,pixelRatio} from '../src/render_policy.js';
import {LazyAnimations} from '../src/lazy_animations.js';
import {withAbort} from '../src/asset_loading.js';
import {AvatarClient} from '../src/avatar_client.js';
import {BodyPlayback} from '../src/body_blending.js';

function scheduler(fps) {
    const pending = new Map(), deltas = []; let id = 0;
    const loop = new RenderLoop({fps,request:callback=>{pending.set(++id,callback);return id;},cancel:id=>pending.delete(id),frame:delta=>deltas.push(delta)});
    const tick = time => { const batch = [...pending.values()]; pending.clear(); batch.forEach(callback=>callback(time)); assert.ok(pending.size<=1); };
    return {loop,pending,deltas,tick};
}

test('low power halves render/update work on a 120Hz display, with no hidden work or giant resume delta', () => {
    const rates = [];
    for (const fps of [30,60]) {
        const {loop,pending,deltas,tick} = scheduler(fps);
        loop.start(); loop.start();
        for(let i=0;i<=120;i++) tick(i*1000/120);
        rates.push(deltas.length);
        assert.ok(deltas.length>=fps && deltas.length<=fps+1);
        loop.stop(); assert.equal(pending.size,0);
        const count=deltas.length; tick(120000); assert.equal(deltas.length,count);
        loop.start(); tick(120001); assert.equal(deltas.at(-1),0);
    }
    assert.ok(Math.abs(rates[1]-2*rates[0])<=1);
    assert.equal(pixelRatio(renderPreferences({quality:'low'}),3),1);
    assert.equal(pixelRatio(renderPreferences({quality:'balanced'}),3),1.5);
    assert.equal(pixelRatio(renderPreferences({quality:'high'}),3),2);
    assert.deepEqual(renderPreferences({quality:'corrupt',shadows:'true'}),{quality:'balanced',shadows:false});
});

test('blink onset and duration do not double when rendering drops from 60 to 30Hz', () => {
    const results = [30,60].map(fps=>{
        const blink = new BlinkClock(()=>0.5); let start=null, end=null;
        for(let i=1;i<fps*5;i++) {
            const closed=blink.update(1/fps);
            if (closed && start===null) start=i/fps;
            if (!closed && start!==null) {end=i/fps;break;}
        }
        return {start,duration:end-start};
    });
    assert.ok(Math.abs(results[0].start-results[1].start)<0.05);
    assert.ok(results.every(result=>Math.abs(result.duration-0.1)<0.04));
    const blocked=new BlinkClock(()=>0);assert.equal(blocked.update(4,true),false);
});

test('optional gestures are lazy, shared, serial, cached and bounded; abort ends the caller wait', async () => {
    const loaded=[]; let active=0,peak=0;
    const library = new LazyAnimations(['idle.fbx','wave.fbx','nod.fbx','missing.fbx','stalled.fbx'],async file=>{
        active++;peak=Math.max(peak,active);loaded.push(file);
        if (file==='stalled.fbx') {active--;return new Promise(()=>{});}
        await new Promise(resolve=>setTimeout(resolve,1)); active--;
        if(file==='missing.fbx') throw new Error('missing');
        return {file};
    },10);
    await library.get('idle');assert.deepEqual(loaded,['idle.fbx']);
    const one=library.get('wave'),two=library.get('wave');assert.equal(one,two);
    await Promise.all([one,two,library.get('nod')]);assert.equal(peak,1);
    await library.get('wave');assert.equal(loaded.filter(file=>file==='wave.fbx').length,1);
    assert.equal(await library.get('missing'),null);
    const controller=new AbortController();const waiting=withAbort(library.get('stalled'),controller.signal);controller.abort();
    await assert.rejects(waiting,{name:'AbortError'});
    assert.equal(await library.get('stalled'),null);assert.match(library.errors.get('stalled'),/timed out/);
});

test('a missing WebGL/CDN renderer stays isolated from the local client, and retry succeeds', async () => {
    let calls=0;
    const module={getPlaybackState:()=>({ready:true,clips:['idle']}),onPlaybackStateChange:()=>{},loadThreeVRM:async()=>{}};
    const client=new AvatarClient(async()=>{if(++calls===1)throw new Error('WebGL unavailable');return module;});
    assert.equal(calls,0,'creating the UI-side client must not load WebGL');
    await client.loadThreeVRM();assert.match(client.getPlaybackState().error,/Text chat still works/);
    assert.deepEqual(await client.preparePerformance([]),[]);
    assert.doesNotThrow(()=>client.stopPerformance());
    await client.loadThreeVRM();assert.equal(client.getPlaybackState().ready,true);
});

test('importing runtime configuration does no startup network work and invalid mode cannot activate live transport', async () => {
    const original=globalThis.fetch; let calls=0;
    try {
        globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({mode:'invalid'}));};
        const runtime=await import('../src/runtime_config.js?startup-test');
        assert.equal(calls,0);assert.equal(runtime.RUNTIME_MODE,null);
        await assert.rejects(runtime.loadRuntimeConfig(),/runtime mode/);
        assert.equal(runtime.RUNTIME_MODE,null);assert.equal(runtime.runtimeConfig,null);
        globalThis.fetch=async()=>new Response(JSON.stringify({mode:'replay',chatModel:'fixture',voice:'af_heart',lipSync:'rhubarb',
            assets:Object.fromEntries(['modelsIndex','models','animationsIndex','animations','systemPrompt','dictionary'].map(key=>[key,'/fixture']))}));
        await runtime.loadRuntimeConfig();assert.equal(runtime.RUNTIME_MODE,'replay');
    } finally {globalThis.fetch=original;}
});

test('adding a lazy gesture during a real mixer blend keeps weights finite and preserves the pose', () => {
    const root=new THREE.Group(),bone=new THREE.Bone();bone.name='arm';root.add(bone);
    const mixer=new THREE.AnimationMixer(root);
    const clip=name=>mixer.clipAction(new THREE.AnimationClip(name,1,[new THREE.NumberKeyframeTrack('arm.position[x]',[0,1],[1,1])]));
    const idle=clip('idle'),wave=clip('wave');idle.play();
    const body=new BodyPlayback({idle});body.transition(wave);body.update(0.1);mixer.update(0.1);
    const nod=clip('nod');body.add(nod);body.update(0.1);mixer.update(0.1);body.transition(nod);
    for(let i=0;i<60;i++) {
        body.update(1/60);mixer.update(1/60);
        assert.ok(Math.abs(bone.position.x-1)<1e-6);
        assert.ok(body.actions.every(action=>Number.isFinite(action.getEffectiveWeight())));
    }
});
