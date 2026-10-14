import test from 'node:test';
import assert from 'node:assert/strict';
import {RHUBARB,CHANNELS,boundedWeights} from '../src/rhubarb_mouth.js';

// Retain the shared mapping checks after removing the alternative-method lab.
test('canonical Rhubarb maps closure and vowels onto their correct rig channels',()=>{
    assert.deepEqual(CHANNELS,['aa','ih','ou','ee','oh','closed']);
    assert.equal(RHUBARB.A.slice(0,5).reduce((a,b)=>a+b,0),0);
    assert.ok(RHUBARB.A[5]>0);
    assert.ok(RHUBARB.D[0]>RHUBARB.B[1]);
    assert.ok(RHUBARB.E[4]>0);assert.ok(RHUBARB.F[2]>0);
    assert.deepEqual(RHUBARB.X,Array(6).fill(0));
});

test('canonical mouth blending keeps closure and opening within a shared finite budget',()=>{
    for(const closed of [0,.35,.5,1]){
        const weights=boundedWeights([1,1,1,1,1,closed]);
        assert.ok(weights.slice(0,5).reduce((a,b)=>a+b,0)<=1-closed+.000001);
        assert.equal(weights[5],closed);
    }
    assert.deepEqual(boundedWeights([-1,0,0,0,0,2]),[0,0,0,0,0,1]);
    for(const invalid of [null,[],[0,0,0,0,0,NaN],[0,0,0,0,0,Infinity]])assert.throws(()=>boundedWeights(invalid),/Invalid mouth/);
});
