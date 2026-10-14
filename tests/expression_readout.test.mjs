import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {VRMExpression,VRMExpressionManager} from '@pixiv/three-vrm-core';
import {EMOTION_NAMES,emotionWeightsAt} from '../src/emotion_envelope.js';
import {ClockedAvatarPerformance} from '../src/clocked_avatar_performance.js';
import {sampleExpressionDisplay,expressionDisplayText,createExpressionReadouts} from '../src/expression_readout.js';

function rig(){
    const scene=new THREE.Group(),manager=new VRMExpressionManager();
    for(const name of EMOTION_NAMES){const expression=new VRMExpression(name);manager.registerExpression(expression);scene.add(expression);}
    return {manager,mixer:new THREE.AnimationMixer(scene)};
}

test('readout follows the applied PCM blend, including overlap, a faded cue, pause and clearing',()=>{
    const {manager}=rig(),emotions=[{value:'happy',start:0,end:2},{value:'sad',start:2,end:15}];
    function apply(time){const weights=emotionWeightsAt(emotions,time,{speaking:true});for(const name of EMOTION_NAMES)manager.setValue(name,weights[name]);manager.update();return weights;}
    const weights=apply(2.2);
    const display=sampleExpressionDisplay(manager,{emotions,time:2.2,phase:'playing',active:true});
    assert.deepEqual(display.weights,weights);
    assert.equal(display.cue,'sad');
    assert.match(expressionDisplayText(display).summary,/Happy/);
    assert.match(expressionDisplayText(display).summary,/Sad/);
    for(const phase of ['paused','buffering']){
        const held=sampleExpressionDisplay(manager,{emotions,time:2.2,phase,active:true});
        assert.deepEqual(held.weights,weights);assert.match(expressionDisplayText(held).clock,new RegExp(phase,'i'));
    }
    apply(10);
    const faded=sampleExpressionDisplay(manager,{emotions,time:10,phase:'playing',active:true});
    assert.equal(faded.cue,'sad');assert.equal(expressionDisplayText(faded).summary,'Neutral');
    apply(2.2);for(const name of EMOTION_NAMES)manager.setValue(name,0);
    const stopped=sampleExpressionDisplay(manager,{emotions,time:2.2,phase:'stopped',active:false});
    assert.equal(stopped.cue,null);assert.equal(expressionDisplayText(stopped).summary,'Neutral');
});

test('full recording readout measures actual mixer values and uses segment time for cue selection',()=>{
    const {manager,mixer}=rig(),emotions=[{value:'surprised',start:0,end:3}];
    const performance=new ClockedAvatarPerformance({manager,mixer,animations:{},data:{audio:{duration:3},visemes:[],actions:[],emotions}});
    performance.sample(.1);
    const first=sampleExpressionDisplay(manager,{emotions:performance.emotions,time:12.1,cueTime:.1,active:true,phase:'playing'});
    assert.equal(first.cue,'surprised');assert.match(expressionDisplayText(first).clock,/12.1s/);
    performance.sample(1);
    const second=sampleExpressionDisplay(manager);
    assert.ok(second.weights.surprised>first.weights.surprised);
    assert.equal(second.weights.surprised,manager.getValue('surprised'));
    performance.stop();
    assert.equal(expressionDisplayText(sampleExpressionDisplay(manager)).summary,'Neutral');
});

test('unavailable rigs and missing channels are not reported as a successful expression',()=>{
    assert.equal(expressionDisplayText(sampleExpressionDisplay(null)).summary,'Avatar not ready');
    const manager=new VRMExpressionManager();
    assert.equal(expressionDisplayText(sampleExpressionDisplay(manager)).summary,'No emotion bindings');
    manager.registerExpression(new VRMExpression('happy'));manager.setValue('happy',.1125);
    const display=sampleExpressionDisplay(manager);
    assert.match(expressionDisplayText(display).detail,/Happy 11%/);
    assert.match(expressionDisplayText(display).detail,/Unavailable: Sad, Angry, Surprised, Relaxed/);
});

test('readout leaves hidden views untouched and updates existing text nodes when reopened',()=>{
    const roots=[{hidden:true,details:null},{hidden:false,details:{open:false}}].map(state=>({...state,children:[],
        append(...children){this.children.push(...children);},
        closest(selector){return selector==='[hidden]'?(this.hidden?this:null):this.details;}}));
    let writes=0;
    const document={hidden:false,querySelectorAll:()=>roots,createElement:()=>({
        get textContent(){return this.value??'';},set textContent(value){writes++;this.value=value;}})};
    const view=createExpressionReadouts(document),display={available:true,weights:{happy:.1},missing:[],time:1,phase:'playing',cue:'happy'};
    const before=writes;view.update(display);assert.equal(writes,before);
    roots[0].hidden=false;view.update(display);assert.equal(roots[0].children[1].textContent,'Happy');
    const after=writes;view.update(display);assert.equal(writes,after);
    document.hidden=true;view.update({...display,weights:{}});assert.equal(writes,after);
    document.hidden=false;roots[1].details.open=true;view.update({...display,weights:{}});
    assert.equal(roots[1].children[1].textContent,'Neutral');
});
