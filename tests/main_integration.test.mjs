import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
        AbortSignal, Promise, startupReady:false, profileEditedDuringStartup:false,
        loadRuntimeConfig:async()=>{}, runtimeConfig:{lipSync:'dictionary',voice:'af_heart'}, RUNTIME_MODE:'live',
        LIP_SYNC:null, KOKORO_VOICE:null, replay:null, profileStorage:null, companionProfile:{},
        localStorage:{}, loadCompanionProfile:()=>({}), renderCompanionProfile(){},
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
