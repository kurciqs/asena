import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {dictionaryVisemes} from '../src/dictionary_visemes.js';
import {buildExpressionTracks} from '../src/expression_tracks.js';

test('a short final word keeps visible mouth motion and closes within the recording',()=>{
    const cues=dictionaryVisemes([{word:'Hi',start_time:.1,end_time:.9}],{HI:['HH','AY1']},1);
    const tracks=buildExpressionTracks({duration:1,visemes:cues},name=>name==='aa'?'mouth.weight':null);
    const root=new THREE.Group(), mouth=new THREE.Object3D();mouth.name='mouth';mouth.weight=0;root.add(mouth);
    const mixer=new THREE.AnimationMixer(root);
    mixer.clipAction(new THREE.AnimationClip('speech',1,tracks.map(t=>new THREE.NumberKeyframeTrack(t.name,t.times,t.values)))).play();
    mixer.setTime(.7);assert.ok(mouth.weight>.99,'valid speech must retain its mouth movement');
    mixer.setTime(.95);assert.equal(mouth.weight,0,'mouth closes before audio ends');
    assert.ok(cues.every(c=>c.start>=0 && c.end<=1));
});

test('dictionary timing handles adjacent words, trailing timestamp overshoot, and unknown words',()=>{
    const cues=dictionaryVisemes([
        {word:'hey',start_time:0,end_time:.5},
        {word:'you',start_time:.5,end_time:1.03},
        {word:'?',start_time:1.03,end_time:1.04}
    ],{HEY:['HH','EY1'],YOU:['Y','UW1']},1);
    assert.ok(cues.every(c=>c.end<=1 && c.end>=c.start));
    assert.doesNotThrow(()=>buildExpressionTracks({duration:1,visemes:cues},name=>name));
    assert.deepEqual(dictionaryVisemes([{word:'unknown',start_time:0,end_time:1}],{},1),[]);
    assert.throws(()=>dictionaryVisemes([{word:'hey',start_time:NaN,end_time:1}],{},1),/timing/);
});

test('all saved Kokoro clips produce bounded dictionary tracks using their recorded timings',()=>{
    const fixture=JSON.parse(fs.readFileSync(new URL('../src/replay/benchmark.json',import.meta.url)));
    const dictionary=JSON.parse(fs.readFileSync(new URL('../src/dictionary/cmudict.json',import.meta.url)));
    for(const turn of [...fixture.turns,fixture.recall,fixture.recall.withoutMemory]) {
        const {duration,timestamps}=turn.speech;
        const visemes=dictionaryVisemes(timestamps,dictionary,duration);
        assert.ok(visemes.length>0,turn.label);
        assert.ok(visemes.every(c=>c.end<=duration),turn.label);
        assert.doesNotThrow(()=>buildExpressionTracks({duration,visemes},name=>name),turn.label);
    }
});
