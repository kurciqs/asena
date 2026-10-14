import test from 'node:test';
import assert from 'node:assert/strict';
import {speechTrial} from '../src/speech_trial_controls.js';
const baseline={id:'stable-122',label:'Stable',version:1,openingSeconds:1,policy:'2s',startupSeconds:2,strategy:'sentences'};
test('trial settings preserve the accepted profile by default and distinguish valid overrides',()=>{
    assert.deepEqual(speechTrial({},baseline),{profile:baseline,speed:1});
    const trial=speechTrial({openingSeconds:.5,startupSeconds:4,speed:1.15},baseline);
    assert.equal(trial.profile.id,'custom');assert.equal(trial.profile.startupSeconds,4);assert.equal(trial.speed,1.15);
    assert.equal(speechTrial({openingSeconds:1.5,policy:'unsafe',speed:NaN},baseline).profile.id,'stable-122');
    assert.equal(baseline.startupSeconds,2);
});
