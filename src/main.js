import { loadRuntimeConfig, runtimeConfig, RUNTIME_MODE, contextBudget, assets } from './runtime_config.js';
import { packConversation } from './context_budget.js';
import { dictionaryVisemes } from './dictionary_visemes.js';
import { buildExpressionTracks } from './expression_tracks.js';
import { requestJSON } from './service_client.js';
import {playSpeechStream} from './speech_stream.js';
import { loadAudioMetadata, repairWavHeader } from './audio.js';
import { TurnController } from './turn_controller.js';
import { avatar as ANI } from './avatar_client.js';
import { RENDER_STORAGE_KEY, renderPreferences } from './render_policy.js';
import * as EMO from "./emotion_classifier.js"
import { CLOSENESS, COMPANION_STORAGE_KEY, DEFAULT_COMPANION_PROFILE, buildCompanionPrompt, loadCompanionProfile, normalizeCompanionProfile, saveCompanionProfile } from './companion.js';
import { REPLAY_MEMORY_KEY, ReplaySession, loadFixtureAudio, loadReplayMemories, replayProfileStorage, saveReplayMemories } from './replay.js';
import { createToolPanel, wireChatLayout } from './ui_panels.js';
import { createJsonViewer } from './json_viewer.js';
import {MemoryWork, MEMORY_INSTRUCTION, mergeMemories} from './memory_work.js';
import {TurnMetrics} from './turn_metrics.js';
import {setupExpressionControls} from './expression_controls.js';
import {expressionPreferences} from './emotion_envelope.js';

let replay = null;
let previewSpeechSource = null;
let expressionConfig=expressionPreferences();
let startupReady = false;
let profileEditedDuringStartup = false;
let profileStorage = {getItem:()=>null, setItem:()=>{throw new Error('Configuration still loading');}};
// ------- CONFIGS AND GLOBALS -------
let LIP_SYNC = null;
let KOKORO_VOICE = 'af_heart';
let dialogueBudgetStats = null;
let lastDialogueUsage = null;
let lastExtractionUsage = null;
let companionProfile = normalizeCompanionProfile(null);

// Dictionary is optional and only fetched when a dictionary speech turn needs it.
let cmudict = {};
let dictionaryRequest = null;
async function getDictionary() {
    dictionaryRequest ??= requestJSON(assets.dictionary, { timeoutMs:8000 });
    cmudict = await dictionaryRequest;
    return cmudict;
}
// ------- HTML ELEMENTS -------
const textInput = document.getElementById('user-input-message');
const chatContainer = document.getElementById("chat-display");
const sendButton = document.getElementById('user-message-send');
const toolPanel = createToolPanel();
const chatLayout = wireChatLayout();
const contextWindowSize = document.getElementById("context-size");
const saveButton = document.getElementById('saveMemoryBtn');
const voiceSelect = document.getElementById("select-voice");
const companionDialog = document.getElementById('companion-dialog');
const companionForm = document.getElementById('companion-form');
const companionStatus = document.getElementById('companion-status');
const companionLabel = document.getElementById('companion-label');
const replayStatus = document.getElementById('replay-status');
const replayInspector = document.getElementById('replay-inspector');
const replayJsonViewer = createJsonViewer(replayInspector);
let replayInspection = {};
let turnMetrics = null;
let inspectionTimer = null;

function inspectReplay(update) {
    replayInspection = { ...replayInspection, ...update };
    if(inspectionTimer!==null)return;
    inspectionTimer=setTimeout(()=>{
    inspectionTimer=null;
    replayJsonViewer.update({
        ...replayInspection,
        timing:turnMetrics?.snapshot()??null,
        animation: ANI.getPlaybackState(),
        testMemories: memories,
        activeMemoryPrompt: dialogueBudgetStats?.memoryPrompt ?? message_history[1].content,
        context: { ...dialogueBudgetStats, dialogueUsage:lastDialogueUsage, extractionUsage:lastExtractionUsage }
    });
    const summary=document.getElementById('turn-timing-summary'),data=turnMetrics?.snapshot();
    if(data){
        const first=data.milestones.firstAudio;
        summary.textContent=`Reply: ${data.durations.reply?.toFixed(2)??'—'}s · first voice: ${first?.toFixed(2)??'—'}s · prepared: ${data.clock?.bufferSeconds?.toFixed(1)??'—'}s.`;
        document.getElementById('turn-report-download').disabled=false;
    }
    },150);
}

function replayMessage(message) {
    if (replay) replayStatus.textContent = message;
}

function fillCompanionForm() {
    for (const [key, value] of Object.entries(companionProfile)) {
        companionForm.elements.namedItem(key).value = value;
    }
}

function renderCompanionProfile() {
    companionLabel.textContent = `${companionProfile.name} · ${CLOSENESS[companionProfile.closeness].label}`;
    textInput.placeholder = `Talk to ${companionProfile.name}…`;
    document.title = companionProfile.name;
}

function applyCompanionProfile(value) {
    if (!startupReady) profileEditedDuringStartup = true;
    companionProfile = normalizeCompanionProfile(value);
    message_history[0].content = buildCompanionPrompt(systemPrompt, companionProfile);
    try {
        saveCompanionProfile(companionProfile, profileStorage);
        companionStatus.textContent = replay ? 'Saved for replay. The scripted replies remain fixed.' :
            'Saved. Your companion will use these settings in the next reply.';
    } catch {
        companionStatus.textContent = 'Applied for this visit. This browser could not save the settings for next time.';
    }
    fillCompanionForm();
    renderCompanionProfile();
    renderContextBudget();
}

function changeVoice() {
    KOKORO_VOICE = voiceSelect.value;
    console.log(KOKORO_VOICE)
}

// ------- DISPLAY -------
function renderMessages() {
    chatContainer.innerHTML = ''
    for (let i = 0; i < message_history.length; i++) {
        let msg = message_history[i]
        if (msg.role === 'system') continue;
        const msgDiv = document.createElement("div");
        switch (msg.role) {
            case "user":
                msgDiv.className = "msg-user";
                break;
            case "assistant":
                msgDiv.className = "msg-asena";

                break;
            case "system":
                msgDiv.className = "msg-system";

                break;
            default:
                break;
        }
        const author=document.createElement('span'); author.className='message-author';
        author.textContent=msg.role==='user' ? 'You' : companionProfile.name;
        msgDiv.append(author,document.createTextNode(msg.content));
        chatContainer.appendChild(msgDiv);
    }
    document.getElementById('chat-empty').hidden=message_history.some(message=>message.role!=='system');
    chatContainer.scrollTop=chatContainer.scrollHeight;
    renderContextBudget();
}

function previewBudget() {
    return packConversation({ systemPrompt:message_history[0].content, memories, dialogue:message_history.slice(2), config:contextBudget });
}
function renderContextBudget() {
    const format = value=>value.toLocaleString('en-US');
    try {
        const stats = previewBudget().stats;
        contextWindowSize.textContent = `Context estimate · ${format(stats.promptBound)} / ${format(stats.capacity)}`;
        contextWindowSize.title = 'Conservative UTF-8 text-size bound, not an exact token count.';
        for (const [id,value] of Object.entries({instructions:stats.instructionsBound, memories:stats.memoryBound,
            conversation:stats.dialogueBound, overhead:stats.overheadBound, reserve:stats.outputReserve})) {
            document.getElementById(`context-${id}`).textContent=format(value);
        }
        document.getElementById('context-status').textContent =
            `${stats.keptMessages ? `${stats.keptMessages} conversation messages included.` : 'No conversation messages yet.'} `+
            `${stats.selectedMemories} memories included.`+
            (stats.omittedMessages ? ` ${stats.omittedMessages} older messages left out of this request.` : '')+
            (stats.omittedMemories ? ` ${stats.omittedMemories} memories left out of this request.` : '');
        document.getElementById('context-actual').textContent = Number.isFinite(lastDialogueUsage?.prompt_tokens)
            ? `Last model request: ${format(lastDialogueUsage.prompt_tokens)} actual input tokens. This may differ from the current estimate.`
            : replay ? 'Recorded replay does not measure model token usage.' : 'Actual model usage will appear after a reply, if provided by the service.';
    } catch (error) {
        contextWindowSize.textContent='Context needs attention';
        document.getElementById('context-status').textContent=error.message;
        document.getElementById('context-actual').textContent='';
        for(const id of ['instructions','memories','conversation','overhead','reserve']) document.getElementById(`context-${id}`).textContent='—';
    }
}

// ------- CHATBOT LOGIC -------
let systemPrompt = 'You are a warm, playful digital companion. Respond naturally and concisely. Respect the active companion profile and the user\'s preferences. Treat memories as context; do not invent a shared past.';
let memories = [];
let memoryLoadError = null;
let message_history = [
    {role:'system', content:buildCompanionPrompt(systemPrompt,companionProfile)},
    {role:'system', content:'Previously remembered information:\n'}
];

// ------- HELPER FUNCTIONS -------
async function chat(history, purpose = 'dialogue', turn = null) {
    turn?.assertCurrent();
    const packed = packConversation({ systemPrompt:history[0].content, memories, dialogue:history.slice(2), config:contextBudget });
    if (purpose === 'dialogue') dialogueBudgetStats = packed.stats;
    renderContextBudget();
    if (replay) {
        const reply = replay.reply(packed.messages, purpose);
        inspectReplay(purpose === 'memory' ? { memoryExtraction: reply } :
            { scene: replay.active.label, rawReply: reply, phase: 'text ready' });
        return reply;
    }
    const chatData = await requestJSON("/chat", {
        signal: turn?.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: runtimeConfig.chatModel,
            messages: packed.messages,
            max_tokens: packed.maxTokens,
            temperature: 0.8,
            top_p: 0.95
        })
    });

    turn?.assertCurrent();
    const reply = chatData.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('No usable reply was returned. Retry when ready.');
    const usage = chatData.usage && typeof chatData.usage === 'object' ? chatData.usage : null;
    if (purpose === 'dialogue') lastDialogueUsage = usage;
    else lastExtractionUsage = usage;

    renderMessages();

    console.log("LOG: Asena responded:", reply);

    return reply;
}

async function generateTTS(text, turn) {
    turn.assertCurrent();
    if (replay) {
        const speech = replay.speech();
        inspectReplay({ phase: 'loading fixture audio', audio: speech.audio, timestamps: speech.timestamps,
            speech, alignment: replay.active.alignment });
        const audio = await loadFixtureAudio(speech.audio, undefined, 8000, turn.signal);
        turn.assertCurrent();
        turn.own(() => {audio.pause();audio.removeAttribute('src');audio.load();});
        return { audio, timestamps: speech.timestamps };
    }
    const ttsData = await requestJSON("/tts", {
        signal: turn.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "kokoro",
            input: text,
            voice: turn.speech?.voice??KOKORO_VOICE,
            speed: 1.0,
            response_format: "wav",
            stream: false
        })
    })
    turn.assertCurrent();
    const audioBase64 = ttsData.audio;
    const timestamps = ttsData.timestamps;
    console.log(timestamps)
    if (!audioBase64) {
        throw new Error("ERROR: Empty audio content");
    }

    const audioBytes = repairWavHeader(Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0)));
    const audioBlob = new Blob([audioBytes], { type: "audio/wav" });
    const audioURL = URL.createObjectURL(audioBlob);

    const audio = new Audio(audioURL);
    turn.own(() => { audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(audioURL); });

    let audioId = null;
    if (LIP_SYNC === 'rhubarb') {
        try {
            const saved = await requestJSON('/api/audio', {
                signal: turn.signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio: audioBase64 })
            });
            audioId = saved.audio_id;
            // Server expiry is a backstop if a cancelled upload response loses its ID.
            turn.own(() => { requestJSON(`/api/audio/${audioId}`, { method: 'DELETE', timeoutMs: 5000 }).catch(() => {}); });
        } catch (error) {
            if (turn.signal.aborted) throw error;
            speechWarning(`Audio storage unavailable; lip sync will be skipped. ${error.message}`);
        }
    }

    await loadAudioMetadata(audio, { signal: turn.signal });
    turn.assertCurrent();
    return { audio, timestamps, audioId };
}

async function getVisemes(timestamps, turn, audioId, audioDuration, spokenText) {
    turn.assertCurrent();
    if (replay) return replay.visemes();
    if (LIP_SYNC === "rhubarb") {
        if (!audioId) throw new Error('Audio resource unavailable.');
        const data = await requestJSON('/get_visemes', {
            signal: turn.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_id: audioId, spoken_text: spokenText })
        });
        inspectReplay({ phase: 'mouth aligned', alignment: data.alignment });
        return data.visemes;
    }
    else {
        await getDictionary();
        return dictionaryVisemes(timestamps, cmudict, audioDuration);
    }
}

let ind = 0;
const memoryWork = new MemoryWork();
async function extractPendingMemories(turn) {
    if (!memoryWork.pending) return;
    turn.phase('remembering');
    turnMetrics?.mark('memoryStart');
    try {
        await memoryWork.drain(turn, async (job, owner) => {
            if (replay) {
                if (typeof job.fixture !== 'string') throw new Error('No extraction fixture. No model was called.');
                return job.fixture;
            }
            const packed = packConversation({systemPrompt:MEMORY_INSTRUCTION, dialogue:job.dialogue, config:contextBudget});
            const data = await requestJSON('/chat', {signal:owner.signal, method:'POST',
                headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:runtimeConfig.chatModel,
                    messages:packed.messages, max_tokens:Math.min(128,packed.maxTokens), temperature:0.2})});
            owner.assertCurrent();
            lastExtractionUsage = data.usage ?? null;
            return data.choices?.[0]?.message?.content;
        }, result => {
            memories = mergeMemories(memories,result);
            renderContextBudget();
            document.getElementById('memory-save-status').textContent='New facts ready to save.';
            inspectReplay({memoryExtraction:result, memoryPhase:'ready to save'});
        });
    } catch (error) {
        if (turn.signal.aborted) throw error;
        document.getElementById('memory-save-status').textContent=`Memory extraction postponed: ${error.message}`;
        inspectReplay({memoryPhase:'postponed', memoryError:error.message});
    } finally { if(turnMetrics?.id===turn.id)turnMetrics.mark('memoryEnd'); }
}
const turnController = new TurnController(state => {
    if(turnMetrics?.id===state.id){
        turnMetrics.status=state.phase;
        if(['completed','stopped','failed'].includes(state.phase))turnMetrics.finish(state.phase);
    }
    const labels = { idle: 'Ready', requesting: 'Getting a reply', 'preparing-speech': 'Preparing speech',
        speaking: 'Speaking', remembering: 'Updating memory', completed: 'Finished', stopped: 'Stopped', failed: 'Failed' };
    document.getElementById('turn-status').textContent = state.error || labels[state.phase];
    document.getElementById('turn-status').dataset.phase = state.phase;
    document.getElementById('turn-stop').disabled = !['requesting', 'preparing-speech', 'speaking', 'remembering'].includes(state.phase);
    if(state.phase!=='speaking')document.getElementById('turn-pause').hidden=true;
    inspectReplay({ turn: state, phase: state.phase });
});

async function handleTextResponse({ reuseUser = false } = {}) {
    if (!startupReady || ANI.getPlaybackState().loading) return;
    if (replay?.finished) {
        replayMessage('This scene is finished. Restart it or choose another scene.');
        return;
    }
    const message = textInput.value.trim();
    if (!message) return;
    textInput.value = '';
    lastRetry = { message };
    document.getElementById('turn-retry').hidden = true;
    await turnController.run(async turn => {
        beginTurnMetrics(turn);
        turn.own(() => ANI.stopPerformance());
        if (!reuseUser || message_history.at(-1)?.role !== 'user' || message_history.at(-1)?.content !== message) {
            message_history.push({ role: 'user', content: message });
        }
        replayInspection = {};
        inspectReplay({ phase: replay?'requesting fixture':'requesting model' });
        renderMessages();
        try {
            const rawReply = await chat(message_history, 'dialogue', turn);
            turn.assertCurrent();
            turnMetrics?.mark('firstText');
            const parsedReply = EMO.decodeTaggedMessage(rawReply);
            turnMetrics?.mark('parsed');
            inspectReplay({ parsedReply });
            message_history.push({ role: 'assistant', content: rawReply });
            ind++;
            if (ind % 5 === 0) {
                memoryWork.enqueue(message_history.slice(2), replay?.active?.memoryExtraction ?? null);
            }
            renderMessages();
            lastRetry = { parsedReply, message };
            await prepareAndPlay(parsedReply, turn);
            await extractPendingMemories(turn);
            document.getElementById('turn-retry').hidden = true;
            lastRetry = null;
            turn.assertCurrent();
            inspectReplay({ phase: 'playback ended' });
            if (replay) {
                replayMessage(replay.finished ? (replay.scenario.kind === 'benchmark' ? 'Showcase finished. Save test memory, then choose the recall scene.' : 'Scene finished. Restart it or choose another scene.') :
                    `Scene finished. Next: ${replay.turns[replay.cursor].label}.`);
                textInput.value = replay.nextPrompt;
            }
        } catch (error) {
            if (!turn.signal.aborted) {
                document.getElementById('turn-retry').hidden = false;
                replayMessage(error.message);
                inspectReplay({ phase: 'failed', error: error.message });
            }
            throw error;
        }
    });
}

let lastRetry = null;
function speechWarning(message) {
    document.getElementById('speech-warning').textContent = message;
    inspectReplay({ warning: message });
}

async function prepareAndPlay(parsedReply, turn) {
    if (!ANI.getPlaybackState().ready) {
        speechWarning('Avatar unavailable or still loading. Showing this reply as text only.');
        return;
    }
    turn.phase('preparing-speech');
    speechWarning('');
    if((!replay||RUNTIME_MODE==='preview')&&runtimeConfig?.speechStreaming&&LIP_SYNC==='rhubarb'){
        let player=null,words=[],cues={actions:[],emotions:[]},speaking=false;
        turnMetrics?.mark('gesturePreparation');
        let available=new Set(ANI.getPlaybackState().loadedClips??ANI.getPlaybackState().clips),active=true;
        turn.own(()=>{active=false;});
        const refreshCues=()=>{try{cues=EMO.getPartialPerformance(words,parsedReply,available);}catch(error){speechWarning(`Emotion and gesture timing unavailable. ${error.message}`);}};
        // Optional clip loading overlaps generation; a late clip cannot delay or
        // restart speech. The renderer skips a gesture whose audible anchor passed.
        ANI.preparePerformance(parsedReply.actions.map(cue=>({value:cue.value})),turn.signal).then(()=>{
            if(!active||turn.signal.aborted)return;
            turn.assertCurrent();
            if(turnMetrics?.id===turn.id)turnMetrics.mark('gesturesReady');
            available=new Set(ANI.getPlaybackState().loadedClips??ANI.getPlaybackState().clips);
            refreshCues();
        }).catch(error=>{if(active&&!turn.signal.aborted)speechWarning(`Gesture unavailable; speech continues. ${error.message}`);});
        try{
            turnMetrics?.mark('speechRequested');
            await playSpeechStream({text:parsedReply.text,voice:turn.speech?.voice??KOKORO_VOICE,signal:turn.signal,speechProfile:turn.speech?.profile??runtimeConfig.speechProfile,
                source:RUNTIME_MODE==='preview'?turn.speech?.source:null,
                onPlayer:value=>{player=value;ANI.beginPcmPerformance(()=>({...player.sample(),weights:player.weights(),...cues}),player);},
                onWarning:speechWarning,onReport:report=>{if(turnMetrics?.id===turn.id){turnMetrics.observeSpeech(report);inspectReplay({speechReport:turnMetrics.speech});}},
                onEvent:event=>{turn.assertCurrent();inspectReplay({speechPhase:event.type==='provider-stage'?event.phase:event.type});},
                onWords:stamps=>{words.push(...stamps);refreshCues();},
                onClock:clock=>{
                    turn.assertCurrent();
                    turnMetrics?.observeClock(clock);
                    inspectReplay({});
                    if(clock.playedFrames>0&&!speaking){speaking=true;turn.phase('speaking');}
                    if(speaking){
                        document.getElementById('turn-status').textContent=clock.paused?'Paused':clock.buffering?'Waiting for speech':'Speaking';
                        const pause=document.getElementById('turn-pause');pause.hidden=false;pause.textContent=clock.paused?'Resume':'Pause';
                    }
                }});
        }catch(error){
            if(!turn.signal.aborted){
                const heard=error.report?.browser?.playedSeconds??0;
                speechWarning(`Voice stopped${heard>0?` after ${heard.toFixed(1)} seconds`:''}. The reply remains above. Retry restarts the voice from the beginning. ${error.message}`);
                inspectReplay({fallback:'text only'});
            }
            throw error;
        }finally{active=false;if(!turn.signal.aborted)ANI.stopPerformance();}
        return;
    }
    const { audio, timestamps, audioId } = await generateTTS(parsedReply.text, turn);
    turn.assertCurrent();
    let visemes = [], emotions = [], actions = [];
    try {
        visemes = await getVisemes(timestamps, turn, audioId, audio.duration, parsedReply.text);
        if (!Array.isArray(visemes)) throw new Error('Missing mouth cues.');
        buildExpressionTracks({ duration: audio.duration, visemes }, name => name);
    } catch (error) {
        if (turn.signal.aborted || replay) throw error;
        visemes = [];
        speechWarning(`Lip sync unavailable. Playing audio with a closed mouth. ${error.message}`);
    }
    turn.assertCurrent();
    try {
        if (!timestamps?.length) throw new Error('No word timing was returned.');
        emotions = EMO.getEmotions(timestamps, parsedReply.emotions, parsedReply.text, audio.duration);
        actions = EMO.getActions(timestamps, parsedReply.actions, parsedReply.text, new Set(ANI.getPlaybackState().clips));
    } catch (error) {
        if (turn.signal.aborted || replay) throw error;
        speechWarning(`Emotion and gesture timing unavailable. Playing audio without those cues. ${error.message}`);
    }
    actions = await ANI.preparePerformance(actions, turn.signal);
    turn.assertCurrent();
    inspectReplay({ phase: 'performance prepared', spokenText: parsedReply.text, visemes, emotions, actions });
    turn.phase('speaking');
    await playPerformance({ audio, visemes, emotions, actions }, turn);
}

async function playPerformance(data, turn) {
    turn.assertCurrent();
    inspectReplay({phase:'playing',duration:data.audio.duration});
    const playing=()=>{if(turnMetrics?.id===turn.id)turnMetrics.mark('firstAudio');};
    data.audio.addEventListener('playing',playing,{once:true});
    turn.own(()=>data.audio.removeEventListener('playing',playing));
    await ANI.talk({...data,signal:turn.signal,onWarning:speechWarning});
    turn.assertCurrent();
}

// ------- UI FIDDLING -------
document.getElementById('turn-pause').addEventListener('click',()=>{
    if(ANI.getPlaybackState().scheduler?.paused)ANI.resumePerformance();
    else ANI.pausePerformance();
});
document.getElementById('turn-retry').addEventListener('click', async () => {
    if (!lastRetry) return;
    const retry = lastRetry;
    document.getElementById('turn-retry').hidden = true;
    if (!retry.parsedReply) {
        textInput.value = retry.message;
        await handleTextResponse({ reuseUser: true });
        return;
    }
    await turnController.run(async turn => {
        beginTurnMetrics(turn,true);
        turn.own(() => ANI.stopPerformance());
        try {
            await prepareAndPlay(retry.parsedReply, turn);
            await extractPendingMemories(turn);
            turn.assertCurrent();
            lastRetry = null;
            if (replay) { textInput.value = replay.nextPrompt; replayMessage('Scene finished.'); }
        } catch (error) {
            if (!turn.signal.aborted) document.getElementById('turn-retry').hidden = false;
            throw error;
        }
    });
});
document.getElementById('turn-stop').addEventListener('click', () => {
    turnController.stop();
    replayMessage('Stopped. Choose the next scene or restart this one.');
    if (replay) textInput.value = replay.nextPrompt;
});
sendButton.addEventListener('click', function (e) {
    console.log("LOG: Message sent, handling response.");
    handleTextResponse();
})

textInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        console.log("LOG: Message sent, handling response.");
        handleTextResponse();
    }
});
saveButton.addEventListener('click', () => {
    saveMemoryToFile().catch(error => { document.getElementById('memory-save-status').textContent = error.message; replayMessage(error.message); });
});

function toggleSettings() { toolPanel.toggle('settings'); }

document.addEventListener('keydown',event=>{
    const active=document.activeElement;
    if (document.getElementById('companion-dialog').open || active.closest('#utility-panels') ||
        ['INPUT','TEXTAREA','SELECT'].includes(active.tagName) || active.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase()==='s') {event.preventDefault();toggleSettings();}
    if (event.key.toLowerCase()==='c') {event.preventDefault();chatLayout.toggle();}
});

async function saveMemoryToFile() {
    if (replay) {
        saveReplayMemories(localStorage, memories);
        replayMessage(`Saved ${memories.length} test ${memories.length === 1 ? 'memory' : 'memories'} in this browser. Your real memory file was not changed.`);
        document.getElementById('memory-save-status').textContent=`Saved ${memories.length} test memories.`;
        inspectReplay({ phase: 'test memory saved' });
        return;
    }
    if (memoryLoadError) throw new Error('Save is disabled because memories could not load. Repair or reload them before saving.');
    await requestJSON('/api/memories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memories })
    });
    document.getElementById('memory-save-status').textContent = `Saved ${memories.length} memories.`;
}

// -------- ACTUALLY DOING SOMETHING 🔥 --------
function setupReplayUI() {
    document.body.classList.add('replay-mode');
    toolPanel.enableDebug();
    document.getElementById('chat-mode').hidden=false;
    if (innerWidth>=1000) toolPanel.open('debug',document.getElementById('debug-toggle'),false);
    document.getElementById('voice-note').textContent='Recorded scenes use their saved voice.';
    document.getElementById('memory-note').textContent='Test memories are saved in this browser, separate from your live memories.';
    saveButton.textContent='Save test memories';
    document.getElementById('chat-empty').querySelector('h2').textContent='Try a saved scene.';
    document.getElementById('chat-empty').querySelector('p').textContent='Play the introduction, or choose a different scene in Debug.';
    const selector = document.getElementById('replay-case');
    for (const scenario of replay.fixture.cases) {
        if(RUNTIME_MODE==='preview'&&!['benchmark','recall'].includes(scenario.kind))continue;
        const option = document.createElement('option');
        option.value = scenario.id;
        option.textContent = scenario.label;
        selector.appendChild(option);
    }
    selector.value = replay.scenario.id;
    document.getElementById('replay-description').textContent = replay.fixture.recording
        ? 'Saved dialogue, voice and mouth timings. Test profile and memories stay separate.'
        : 'Scripted dialogue with silent audio and synthetic mouth timings. Your test profile and memories stay separate.';
    selector.addEventListener('change', () => {
        const url = new URL(location.href);
        url.searchParams.set('replay-case', selector.value);
        location.assign(url);
    });
    document.getElementById('replay-restart').addEventListener('click', () => location.reload());
    document.getElementById('replay-save').addEventListener('click', () => {
        saveMemoryToFile().catch(error => { document.getElementById('memory-save-status').textContent = error.message; replayMessage(error.message); });
    });
    document.getElementById('replay-clear').addEventListener('click', () => {
        localStorage.removeItem(REPLAY_MEMORY_KEY);
        location.reload();
    });
    textInput.value = replay.nextPrompt;
    sendButton.textContent = 'Play scene';
    voiceSelect.disabled = true;
    replayMessage('Starting scripted replay. Text will be available when startup finishes.');
    inspectReplay({ phase: 'ready', fixture: replay.fixture.description });
    if (RUNTIME_MODE==='preview') {
        const sourceSelect=document.getElementById('preview-speech-source');
        previewSpeechSource=runtimeConfig.speechSource;
        document.getElementById('preview-speech-controls').hidden=false;
        for(const source of runtimeConfig.previewSpeechSources)sourceSelect.add(new Option(source==='kokoro'?'Live Kokoro + Rhubarb':'Saved voice · no generation',source));
        sourceSelect.value=previewSpeechSource;
        const updateSource=()=>{
            previewSpeechSource=sourceSelect.value;
            document.getElementById('debug-source').textContent=previewSpeechSource==='kokoro'?'Live Kokoro · no LLM':'Saved voice · AI services off';
            document.getElementById('voice-note').textContent=previewSpeechSource==='kokoro'?'Used for the next scripted spoken reply.':'Saved scenes use their recorded voice.';
            voiceSelect.disabled=previewSpeechSource!=='kokoro';
        };
        sourceSelect.addEventListener('change',updateSource);updateSource();
        document.getElementById('debug-mode').textContent='Scripted preview';
        document.getElementById('debug-source').textContent=runtimeConfig.speechSource==='kokoro'?'Live Kokoro · no LLM':'Saved voice · AI services off';
        document.getElementById('chat-mode').textContent='Preview';
        document.getElementById('replay-description').textContent='Scripted conversation in the main chat. Speech uses the shared PCM player and selected 1 / 2 / 2 profile. Test memories stay separate.';
        document.getElementById('chat-empty').querySelector('h2').textContent='Meet her in the main chat.';
        document.getElementById('chat-empty').querySelector('p').textContent='Play the introduction, teasing, disagreement and emotes. Replies are scripted until LLM integration.';
        document.getElementById('voice-note').textContent=runtimeConfig.speechSource==='kokoro'?'Used for the next scripted spoken reply.':'Saved scenes use their recorded voice.';
        voiceSelect.disabled=runtimeConfig.speechSource!=='kokoro';
    }
}
function setupDebugUI() {
    toolPanel.enableDebug();
    setupExpressionControls(document,localStorage,settings=>{
        expressionConfig=settings;ANI.setExpressionPreferences(settings);
        turnMetrics?.recordExpressionChange(settings);
        inspectReplay({expressionSettings:settings});
    });
    document.getElementById('replay-collapse').addEventListener('click',()=>replayJsonViewer.collapseAll());
    document.getElementById('turn-report-download').addEventListener('click',()=>{
        if(!turnMetrics)return;
        const url=URL.createObjectURL(new Blob([JSON.stringify(turnMetrics.snapshot(),null,2)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`asena-turn-${turnMetrics.id}.json`;link.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    const profile=runtimeConfig.speechProfile;
    document.getElementById('speech-policy-note').textContent=runtimeConfig.speechStreaming?
        `Speech: ${profile.label} · ${profile.strategy}.`:'Speech: complete recording.';
    if(!replay){
        document.getElementById('debug-tab').textContent='Debug';
        document.getElementById('debug-mode').textContent='Live conversation';
        document.getElementById('debug-source').textContent='Prepared services only';
        document.getElementById('replay-description').textContent='Current turn, speech timing, queue state and performance cues.';
        document.getElementById('replay-controls').hidden=true;
        document.getElementById('replay-reset').hidden=true;
    }
}
function beginTurnMetrics(turn,retry=false){
    turn.speech={voice:KOKORO_VOICE,profile:structuredClone(runtimeConfig?.speechProfile??null),source:previewSpeechSource??runtimeConfig?.speechSource};
    turnMetrics=new TurnMetrics(turn.id,{mode:RUNTIME_MODE,speechSource:turn.speech.source,
        speechProfile:turn.speech.profile,voice:turn.speech.voice,chatModel:runtimeConfig?.chatModel,retry,expressionSettings:expressionConfig});
}
window.addEventListener('pagehide',()=>turnController.stop());
renderCompanionProfile();
document.getElementById('customize-companion').addEventListener('click', () => {
    fillCompanionForm();
    companionStatus.textContent = '';
    companionDialog.showModal();
});
document.getElementById('close-companion').addEventListener('click', () => companionDialog.close());
document.getElementById('reset-companion').addEventListener('click', () => applyCompanionProfile(DEFAULT_COMPANION_PROFILE));
companionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    applyCompanionProfile(Object.fromEntries(new FormData(companionForm)));
});
renderMessages();
ANI.onPlaybackStateChange(state => {
    textInput.disabled = sendButton.disabled = !startupReady || state.loading;
    if (state.loading) turnController.stop();
    document.getElementById('avatar-status').textContent = state.loading ? 'Loading avatar…' :
        state.error || (state.missingClips.length ? `${state.missingClips.length} optional animations unavailable` : 'Avatar ready');
    const clock=state.scheduler, pauseButton=document.getElementById('turn-pause');
    pauseButton.hidden=turnController.state.phase!=='speaking' || !['starting','playing','paused','waiting','buffering'].includes(clock?.phase);
    pauseButton.textContent=clock?.paused?'Resume':'Pause';
    if(!pauseButton.hidden) document.getElementById('turn-status').textContent=
        clock.paused?'Paused':clock.phase==='waiting'?'Waiting for audio':clock.phase==='buffering'?'Waiting for speech':'Speaking';
    inspectReplay({});
});

if (![...voiceSelect.options].some(option => option.value === KOKORO_VOICE)) {
    voiceSelect.add(new Option(KOKORO_VOICE,KOKORO_VOICE));
}
voiceSelect.value = KOKORO_VOICE;
voiceSelect.addEventListener('change', changeVoice);


// Wire all controls before any optional data, CDN library, or WebGL is requested.
sendButton.disabled = true;
textInput.disabled = true;
saveButton.disabled = true;
const startupStatus = document.getElementById('startup-status');
let renderSettings = renderPreferences();
try { renderSettings = renderPreferences(JSON.parse(localStorage.getItem(RENDER_STORAGE_KEY) ?? '{}')); } catch {}
const qualitySelect = document.getElementById('render-quality');
const shadowsCheck = document.getElementById('render-shadows');
qualitySelect.value = renderSettings.quality; shadowsCheck.checked = renderSettings.shadows;
function changeRenderSettings() {
    renderSettings = renderPreferences({quality:qualitySelect.value,shadows:shadowsCheck.checked});
    try { localStorage.setItem(RENDER_STORAGE_KEY,JSON.stringify(renderSettings)); } catch {}
    ANI.setRenderPreferences(renderSettings);
}
qualitySelect.addEventListener('change',changeRenderSettings);
shadowsCheck.addEventListener('change',changeRenderSettings);
document.getElementById('settings-toggle').addEventListener('click',toggleSettings);
document.getElementById('debug-toggle').addEventListener('click',()=>toolPanel.toggle('debug'));
document.getElementById('avatar-retry').addEventListener('click',()=>{
    if (ANI.module) ANI.loadThreeVRM();
    else location.reload(); // Browsers cache failed module evaluation; reload retries that graph.
});

async function bootstrap() {
    const warnings = [];
    try {
        await loadRuntimeConfig();
        LIP_SYNC = runtimeConfig.lipSync; KOKORO_VOICE = runtimeConfig.voice;
        if (RUNTIME_MODE === 'replay' || RUNTIME_MODE === 'preview') {
            const fixture = await requestJSON('/replay/benchmark.json',{timeoutMs:8000});
            replay = new ReplaySession(fixture,new URLSearchParams(location.search).get('replay-case') ?? 'benchmark');
            profileStorage = replayProfileStorage(localStorage);
        } else profileStorage = localStorage;
        if (!profileEditedDuringStartup) {
            companionProfile = loadCompanionProfile(profileStorage);
            if (replay) {
                try { if (!profileStorage.getItem(COMPANION_STORAGE_KEY)) companionProfile = normalizeCompanionProfile(replay.fixture.profile); } catch {}
            }
        } else {
            try { saveCompanionProfile(companionProfile,profileStorage); } catch { warnings.push('Profile applies for this visit; browser storage is unavailable.'); }
        }
        renderCompanionProfile();
        setupDebugUI();
        if (replay) setupReplayUI();
        if (![...voiceSelect.options].some(option=>option.value===KOKORO_VOICE)) voiceSelect.add(new Option(KOKORO_VOICE,KOKORO_VOICE));
        voiceSelect.value = KOKORO_VOICE;
        // Load concurrently, but open text input only after all startup work settles.
        const results = await Promise.allSettled([
            (async()=>{
                const response = await fetch(assets.systemPrompt,{signal:AbortSignal.timeout(8000)});
                if (!response.ok) throw new Error('Companion prompt unavailable; using a basic prompt for this visit.');
                const text = await response.text();
                if (!text.trim()) throw new Error('Companion prompt is empty; using a basic prompt for this visit.');
                return text;
            })(),
            replay ? Promise.resolve().then(()=>loadReplayMemories(localStorage)) : requestJSON('/api/memories',{timeoutMs:8000}).then(data=>data.memories),
            ANI.loadThreeVRM().then(()=>ANI.setRenderPreferences(renderSettings))
        ]);
        if (results[2].status === 'rejected') warnings.push(`Avatar startup failed: ${results[2].reason.message}`);
        if (!ANI.getPlaybackState().ready) warnings.push('Avatar unavailable. Text chat is ready; retry the avatar in settings.');
        if (results[0].status==='fulfilled') systemPrompt = results[0].value;
        else warnings.push(results[0].reason.message);
        if (results[1].status==='fulfilled' && Array.isArray(results[1].value) && results[1].value.every(value=>typeof value==='string')) {
            memories = results[1].value; saveButton.disabled = false;
        } else {
            memoryLoadError = results[1].reason?.message ?? 'Invalid memory response.';
            warnings.push(`${memoryLoadError} Memory saving is disabled to preserve existing data.`);
            document.getElementById('memory-save-status').textContent='Memory could not load. Saving is disabled to preserve existing data.';
            document.getElementById('replay-save').disabled = true;
        }
        message_history[0].content = buildCompanionPrompt(systemPrompt,companionProfile);
        message_history[1].content = 'Previously remembered information:\n'+memories.map(memory=>'- '+memory+'\n').join('');
        document.getElementById('turn-status').textContent='Ready';
        startupReady = true; textInput.disabled = sendButton.disabled = ANI.getPlaybackState().loading;
        renderMessages(); inspectReplay({});
        startupStatus.textContent = warnings.join(' ');
        replayMessage('Ready for scripted replay.');
    } catch (error) {
        startupStatus.textContent = `${error.message} Settings remain available; reload after repairing setup.`;
        sendButton.disabled = true; // Never infer a live mode after a replay/config failure.
        textInput.disabled = true;
    }
}
bootstrap();
