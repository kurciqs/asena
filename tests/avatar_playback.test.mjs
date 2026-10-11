import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {VRMExpression, VRMExpressionManager, VRMExpressionMorphTargetBind} from '@pixiv/three-vrm-core';
import {buildVrmExpressionTracks, MOUTH_EXPRESSIONS} from '../src/expression_tracks.js';
import {BodyPlayback} from '../src/body_blending.js';

test('real VRM expression names bind through the mixer and change mesh morphs in the same frame', () => {
    const scene = new THREE.Group();
    const manager = new VRMExpressionManager();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0], 3));
    geometry.morphAttributes.position = MOUTH_EXPRESSIONS.map(() => new THREE.Float32BufferAttribute([0,1,0], 3));
    const mesh = new THREE.Mesh(geometry);
    scene.add(mesh);
    MOUTH_EXPRESSIONS.forEach((name, index) => {
        const expression = new VRMExpression(name);
        // The scene name deliberately differs from the manager key (the regression).
        assert.equal(expression.name, `VRMExpression_${name}`);
        expression.addBind(new VRMExpressionMorphTargetBind({primitives:[mesh], index, weight:1}));
        manager.registerExpression(expression);
        scene.add(expression);
    });
    const cues = MOUTH_EXPRESSIONS.map((name, i) => ({value:['A','C','D','F'][i], start:i, end:i+1}));
    const tracks = buildVrmExpressionTracks({duration:4, visemes:cues}, manager);
    assert.equal(tracks.length, 4);
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(new THREE.AnimationClip('speech', 4, tracks.map(
        track => new THREE.NumberKeyframeTrack(track.name, track.times, track.values))));
    action.setLoop(THREE.LoopOnce, 0).play();
    for (let i = 0; i < 4; i++) {
        mixer.setTime(i + 0.5);
        manager.update();
        assert.equal(manager.getValue(MOUTH_EXPRESSIONS[i]), 1);
        assert.equal(mesh.morphTargetInfluences[i], 1, 'mouth geometry must move, not just cue data');
    }
    mixer.setTime(4);
    manager.update();
    assert.ok(mesh.morphTargetInfluences.every(weight => weight === 0));
    action.stop();
    mixer.uncacheClip(action.getClip());
    manager.update();
    assert.ok(mesh.morphTargetInfluences.every(weight => weight === 0));
    assert.throws(() => buildVrmExpressionTracks({duration:1,visemes:[{value:'A',start:0,end:1}]},new VRMExpressionManager()), /no supported mouth/);
    const partialManager = new VRMExpressionManager();
    partialManager.registerExpression(new VRMExpression('oh'));
    assert.throws(() => buildVrmExpressionTracks({duration:1,visemes:[{value:'A',start:0,end:1}]},partialManager), /no supported mouth/);
});

function bodyRig() {
    const scene = new THREE.Group();
    const arm = new THREE.Bone(); arm.name = 'arm'; scene.add(arm);
    const mixer = new THREE.AnimationMixer(scene);
    const pose = (name, angle) => {
        const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angle).toArray();
        return mixer.clipAction(new THREE.AnimationClip(name,10,[new THREE.QuaternionKeyframeTrack('arm.quaternion',[0,10],[...quaternion,...quaternion])]));
    };
    const actions = {idle:pose('idle',-1),wave:pose('wave',-0.7),nod:pose('nod',-0.9)};
    actions.idle.play(); mixer.update(0);
    const body = new BodyPlayback(actions);
    function frame(delta = 1/120) {
        body.update(delta); mixer.update(delta);
        const sum = Object.values(actions).filter(action=>action.isRunning()).reduce((total, action)=>total+action.getEffectiveWeight(),0);
        assert.ok(Math.abs(sum-1)<1e-6, `body weight ${sum} would expose the T-pose`);
        const angle = new THREE.Euler().setFromQuaternion(arm.quaternion).z;
        assert.ok(angle < -0.69 && angle >= -1.001, `arm returned toward the default pose: ${angle}`);
    }
    return {actions,body,frame,mixer};
}

test('starting and cleaning up repeated turns preserves the running idle pose and its time', () => {
    const {actions,body,frame} = bodyRig();
    for(let i=0;i<20;i++) {
        const time = actions.idle.time;
        body.transition(actions.idle); // Turn start / cleanup / repeated Stop.
        assert.equal(actions.idle.time,time);
        frame();
    }
});

test('gesture return and interrupted crossfades never contribute the rest pose', () => {
    const {actions,body,frame} = bodyRig();
    for(const target of [actions.wave,actions.nod,actions.idle,actions.wave,actions.idle]) {
        body.transition(target);
        frame(0); // Check the transition boundary too.
        for(let i=0;i<20;i++) frame(); // Interrupt before the preceding fade finishes.
    }
    for(let i=0;i<80;i++) frame();
    assert.equal(actions.idle.getEffectiveWeight(),1);
    assert.ok(actions.idle.isRunning());
    assert.ok(!actions.wave.isRunning());
    for(const target of [actions.wave, actions.idle]) {
        body.transition(target);
        for(let i=0;i<80;i++) frame();
    }
});
