import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {VRMExpression, VRMExpressionManager} from '@pixiv/three-vrm-core';
import {buildExpressionTracks, prepareVrmExpressionTracks} from '../src/expression_tracks.js';
import * as EMO from '../src/emotion_classifier.js';
import {AudioPerformanceScheduler} from '../src/performance_scheduler.js';
import {ClockedAvatarPerformance} from '../src/clocked_avatar_performance.js';
import {MemoryWork} from '../src/memory_work.js';

// Execute the production orchestration with controlled IO. This catches ordering
// and fallback gaps that isolated loader/controller/track tests cannot exercise.
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function section(source, start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, 'production entrypoints must exist');
    return source.slice(from, to);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
}

function startupHarness() {
    const avatar = deferred(), memory = deferred();
    const state = {loading:true, ready:false};
    let submitted = 0;
    const context = vm.createContext({
        AbortSignal, Promise, startupReady:false, profileEditedDuringStartup:false,turnMetrics:null,beginTurnMetrics(){},
        loadRuntimeConfig:async()=>{}, runtimeConfig:{lipSync:'dictionary',voice:'af_heart'}, RUNTIME_MODE:'live',
        LIP_SYNC:null, KOKORO_VOICE:null, replay:null, profileStorage:null, companionProfile:{},
        localStorage:{}, loadCompanionProfile:()=>({}), renderCompanionProfile(){},setupDebugUI(){},
        voiceSelect:{options:[{value:'af_heart'}]}, renderSettings:{},
        ANI:{loadThreeVRM:()=>avatar.promise, setRenderPreferences(){}, getPlaybackState:()=>state},
        assets:{systemPrompt:'/system_prompt.txt'}, fetch:async()=>({ok:true,text:async()=>'Fixture prompt'}),
        requestJSON:()=>memory.promise, systemPrompt:'fallback', memories:[], memoryLoadError:null,
        saveButton:{disabled:true}, sendButton:{disabled:true}, textInput:{disabled:true,value:'Hello'},
        startupStatus:{textContent:''}, document:{getElementById:()=>({})},
        buildCompanionPrompt:prompt=>prompt, message_history:[{content:''},{content:''}],
        renderMessages(){}, inspectReplay(){}, replayMessage(){}, lastRetry:null,
        turnController:{run:async()=>{submitted++;}}
    });
    vm.runInContext(section(main,'async function bootstrap() {','\nbootstrap();'),context);
    vm.runInContext(section(main,'async function handleTextResponse(', '\nlet lastRetry ='),context);
    return {context, state, avatar, memory, submitted:()=>submitted};
}

test('text stays gated until both avatar and data startup settle, in either completion order', async()=>{
    for (const avatarFirst of [false,true]) {
        const h = startupHarness();
        const boot = h.context.bootstrap();
        await flush();
        if (avatarFirst) {h.state.loading=false;h.state.ready=true;h.avatar.resolve();}
        else h.memory.resolve({memories:[]});
        await flush();
        assert.equal(h.context.textInput.disabled,true);
        assert.equal(h.context.sendButton.disabled,true);
        await h.context.handleTextResponse();
        assert.equal(h.submitted(),0);
        assert.equal(h.context.textInput.value,'Hello');
        if (avatarFirst) h.memory.resolve({memories:[]});
        else {h.state.loading=false;h.state.ready=true;h.avatar.resolve();}
        await boot;
        assert.equal(h.context.textInput.disabled,false);
        assert.equal(h.context.sendButton.disabled,false);
        await h.context.handleTextResponse();
        assert.equal(h.submitted(),1);
    }
});

test('a settled avatar failure allows text fallback, but invalid runtime keeps text disabled',async()=>{
    const h=startupHarness();
    const boot=h.context.bootstrap();
    h.memory.resolve({memories:[]});h.state.loading=false;h.avatar.reject(new Error('Fixture renderer failure'));
    await boot;
    assert.equal(h.context.textInput.disabled,false);
    assert.match(h.context.startupStatus.textContent,/Avatar unavailable/);
    await h.context.handleTextResponse();assert.equal(h.submitted(),1);
    const broken=startupHarness();
    broken.context.loadRuntimeConfig=async()=>{throw new Error('Invalid runtime');};
    await broken.context.bootstrap();
    assert.equal(broken.context.textInput.disabled,true);
    assert.equal(broken.context.sendButton.disabled,true);
    assert.equal(broken.context.startupReady,false);
});

function speechHarness(manager) {
    const warnings=[];
    let starts=0;
    const audio=new EventTarget();audio.duration=1;audio.currentTime=0;
    audio.pause=()=>{};
    const scene=new THREE.Group();manager.expressions.forEach(expression=>scene.add(expression));
    const animation=fs.readFileSync(new URL('../src/animation.js',import.meta.url),'utf8');
    const renderer={currentMixer:new THREE.AnimationMixer(scene),expressionPlayback:{},peak:0};
    let visual;
    renderer.performanceScheduler=new AudioPerformanceScheduler({
        onSegment:data=>{visual=new ClockedAvatarPerformance({mixer:renderer.currentMixer,manager,animations:{},data});renderer.expressionPlayback=visual.inspection;},
        onTime:time=>{visual?.sample(time);manager.update();renderer.peak=Math.max(renderer.peak,manager.getValue('aa')??0);},
        onSegmentEnd:()=>{visual?.stop();visual=null;}
    });
    audio.play=()=>{starts++;setImmediate(()=>{audio.currentTime=.5;renderer.performanceScheduler.sample();audio.currentTime=1;audio.dispatchEvent(new Event('ended'));});return Promise.resolve();};
    const rendererContext=vm.createContext({...renderer,animationsLoaded:true,stopPerformance:()=>renderer.performanceScheduler.stop()});
    vm.runInContext(section(animation,'export function talk(data) {','\nexport function pausePerformance').replace('export ',''),rendererContext);
    const context=vm.createContext({
        setTimeout,clearTimeout,DOMException,buildExpressionTracks,EMO,replay:null,RUNTIME_MODE:'live',runtimeConfig:{},LIP_SYNC:'rhubarb',turnMetrics:null,
        generateTTS:async()=>({audio,timestamps:[{word:'Hello',start_time:0,end_time:1}]}),
        getVisemes:async()=>[{value:'A',start:.1,end:.9}],
        speechWarning:message=>warnings.push(message),inspectReplay(){},
        ANI:{getPlaybackState:()=>({ready:true,clips:[]}),preparePerformance:async a=>a,talk:data=>rendererContext.talk(data)}
    });
    vm.runInContext(section(main,'async function prepareAndPlay(', '// ------- UI FIDDLING -------'),context);
    const turn={signal:new AbortController().signal,assertCurrent(){},phase(){},own(){}};
    return {context,renderer,warnings,starts:()=>starts,run:()=>context.prepareAndPlay({text:'Hello',emotions:[{value:'happy',position:0}],actions:[]},turn)};
}

test('real speech orchestration plays audio and reports missing rig bindings without opening the mouth',async()=>{
    // Neither no mouth presets nor a partially supported rig may discard audio.
    for (const names of [[],['oh','happy']]) {
        const manager=new VRMExpressionManager();names.forEach(name=>manager.registerExpression(new VRMExpression(name)));
        const h=speechHarness(manager);
        await h.run();
        assert.equal(h.starts(),1);
        assert.match(h.warnings.at(-1),/no supported mouth expression bindings/);
        assert.match(h.renderer.expressionPlayback.warning,/without facial animation/);
        h.renderer.currentMixer.update(.5);manager.update();
        assert.ok(manager.expressions.every(expression=>expression.weight===0));
    }
});

test('supported rigs retain speech movement and actual playback errors retain their diagnostic',async()=>{
    const manager=new VRMExpressionManager();manager.registerExpression(new VRMExpression('aa'));
    const h=speechHarness(manager);
    await h.run();assert.equal(h.starts(),1);
    assert.equal(h.renderer.expressionPlayback.warning,null);
    assert.ok(h.renderer.peak>.99,'mouth moves during actual scheduler playback');
    assert.equal(manager.getValue('aa'),0,'mouth closes when the owned performance ends');
    h.context.ANI.talk=()=>Promise.reject(new Error('Fixture audio permission denied'));
    await assert.rejects(h.run(),/Fixture audio permission denied/);
    assert.throws(()=>prepareVrmExpressionTracks({duration:1,visemes:[{value:'A',start:0,end:2}]},manager),/Invalid expression cue timing/);
});

test('opt-in live speech streams parsed text and keeps complete/replay paths separate',async()=>{
    const manager=new VRMExpressionManager();manager.registerExpression(new VRMExpression('aa'));
    const h=speechHarness(manager);h.context.runtimeConfig.speechStreaming=true;h.context.runtimeConfig.speechProfile={policy:'2s',openingSeconds:1,startupSeconds:2,strategy:'sentences'};
    let input=null,cleanups=0;h.context.KOKORO_VOICE='af_heart';
    h.context.ANI.stopPerformance=()=>{cleanups++;};h.context.ANI.beginPcmPerformance=()=>{};
    h.context.playSpeechStream=async options=>{input=options.text;assert.equal(options.speechProfile,h.context.runtimeConfig.speechProfile);options.onPlayer({sample:()=>({}),weights:()=>[]});options.onWords([{word:'Hello',start_time:0,end_time:1}]);options.onClock({playedFrames:100,buffering:false});};
    h.context.document={getElementById:()=>({})};
    await h.run();assert.equal(input,'Hello');assert.equal(h.starts(),0);assert.equal(cleanups,1);
});

test('the fifth production reply is displayed and spoken before fact extraction',async()=>{
    const events=[],work=new MemoryWork();
    const context=vm.createContext({startupReady:true,turnMetrics:null,beginTurnMetrics(){},ANI:{getPlaybackState:()=>({loading:false}),stopPerformance(){}},
        replay:null,textInput:{value:'Remember my tea.'},lastRetry:null,document:{getElementById:()=>({})},
        message_history:[{role:'system',content:''},{role:'system',content:''}],ind:4,memoryWork:work,
        turnController:{run:async fn=>fn({own(){},assertCurrent(){},signal:new AbortController().signal})},
        chat:async()=>{events.push('reply');return '*smiles* Mint tea. I will remember.';},EMO,
        inspectReplay(){},renderMessages(){events.push('display');},replayMessage(){},
        prepareAndPlay:async()=>events.push('speech'),extractPendingMemories:async()=>events.push('extract')});
    vm.runInContext(section(main,'async function handleTextResponse(', '\nlet lastRetry ='),context);
    await context.handleTextResponse();
    assert.deepEqual(events.slice(-3),['display','speech','extract']);
    assert.equal(work.pending.dialogue.at(-1).role,'assistant');
});

test('late cleanup from a stopped speech turn cannot stop its replacement',async()=>{
    const manager=new VRMExpressionManager(),h=speechHarness(manager),pending=[];
    h.context.runtimeConfig.speechStreaming=true;h.context.KOKORO_VOICE='af_heart';
    let stops=0;h.context.ANI.stopPerformance=()=>stops++;
    h.context.playSpeechStream=()=>new Promise(resolve=>pending.push(resolve));
    const first=new AbortController(),second=new AbortController();
    const turn=signal=>({signal,assertCurrent(){},phase(){},own(){}});
    const parsed={text:'Hello',actions:[],emotions:[]};
    const old=h.context.prepareAndPlay(parsed,turn(first.signal));await flush();first.abort();
    const replacement=h.context.prepareAndPlay(parsed,turn(second.signal));await flush();
    pending[0]();await old;assert.equal(stops,0);
    pending[1]();await replacement;assert.equal(stops,1);
});
test('an unresolved optional gesture load never blocks the speech request',async()=>{
    const manager=new VRMExpressionManager(),h=speechHarness(manager);
    h.context.runtimeConfig.speechStreaming=true;h.context.KOKORO_VOICE='af_heart';
    h.context.ANI.preparePerformance=()=>new Promise(()=>{});
    h.context.ANI.stopPerformance=()=>{};
    let requested=false;
    h.context.playSpeechStream=async()=>{requested=true;};
    await h.run();assert.equal(requested,true);
});
test('complete-recording speech also proceeds when an optional gesture cannot load',async()=>{
    const manager=new VRMExpressionManager();manager.registerExpression(new VRMExpression('aa'));
    const h=speechHarness(manager);h.context.ANI.preparePerformance=()=>new Promise(()=>{});
    await h.run();assert.equal(h.starts(),1);
});
