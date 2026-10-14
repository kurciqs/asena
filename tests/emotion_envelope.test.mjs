import test from 'node:test';
import assert from 'node:assert/strict';
import {emotionWeightsAt,expressionPreferences,EXPRESSION_PRESETS} from '../src/emotion_envelope.js';
import {buildExpressionTracks} from '../src/expression_tracks.js';
test('expressions fade from neutral, settle back, and share the same held audio time',()=>{
    const cues=[{value:'happy',start:1,end:30}],settings=EXPRESSION_PRESETS.balanced;
    const sample=t=>emotionWeightsAt(cues,t,{settings});
    assert.equal(sample(1).happy,0);assert.ok(sample(1.2).happy>0&&sample(1.2).happy<sample(2).happy);
    assert.ok(sample(5.7).happy<sample(2).happy);assert.equal(sample(7).happy,0);
    assert.deepEqual(sample(2),sample(2),'pause cannot advance a clocked envelope');
    assert.ok(emotionWeightsAt(cues,2,{speaking:true}).happy<sample(2).happy);
});
test('full-WAV emotion tracks have smooth bounded weights and clear at the end',()=>{
    const tracks=buildExpressionTracks({duration:3,emotions:[{value:'happy',start:0,end:3}]},name=>name==='happy'?name:null);
    assert.equal(tracks.length,1);const t=tracks[0];
    assert.equal(t.values[0],0);assert.equal(t.values.at(-1),0);
    assert.ok(t.values.some(w=>w>0&&w<.1));
    assert.ok(t.values.every((w,i)=>i===0||Math.abs(w-t.values[i-1])<.06));
    assert.ok(Object.values(expressionPreferences({strength:100,attack:NaN,release:-4})).every(Number.isFinite));
});
