import { loadRuntimeConfig, runtimeConfig, RUNTIME_MODE, contextBudget, assets } from './runtime_config.js';
import { packConversation } from './context_budget.js';
import { dictionaryVisemes } from './dictionary_visemes.js';
import { buildExpressionTracks } from './expression_tracks.js';
import { requestJSON } from './service_client.js';
import { loadAudioMetadata, repairWavHeader } from './audio.js';
import { TurnController } from './turn_controller.js';
import { avatar as ANI } from './avatar_client.js';
import { RENDER_STORAGE_KEY, renderPreferences } from './render_policy.js';
import * as EMO from "./emotion_classifier.js"
import { CLOSENESS, COMPANION_STORAGE_KEY, DEFAULT_COMPANION_PROFILE, buildCompanionPrompt, loadCompanionProfile, normalizeCompanionProfile, saveCompanionProfile } from './companion.js';
import { REPLAY_MEMORY_KEY, ReplaySession, loadFixtureAudio, loadReplayMemories, replayProfileStorage, saveReplayMemories } from './replay.js';
import { createJsonViewer } from './json_viewer.js';

let replay = null;
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
const chatPanel = document.getElementById("chat-panel");
const dragHandle = document.getElementById("chat-drag-handle");
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

function inspectReplay(update) {
    if (!replay) return;
    replayInspection = { ...replayInspection, ...update };
    replayJsonViewer.update({
        ...replayInspection,
        animation: ANI.getPlaybackState(),
        testMemories: memories,
        activeMemoryPrompt: dialogueBudgetStats?.memoryPrompt ?? message_history[1].content,
        context: { ...dialogueBudgetStats, dialogueUsage:lastDialogueUsage, extractionUsage:lastExtractionUsage }
    });
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
    textInput.placeholder = `talk to ${companionProfile.name}...`;
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
    for (let i = message_history.length - 1; i >= 0; i--) {
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
        msgDiv.textContent = msg.content;
        chatContainer.appendChild(msgDiv);
    }
    renderContextBudget();
}

function previewBudget() {
    return packConversation({ systemPrompt:message_history[0].content, memories, dialogue:message_history.slice(2), config:contextBudget });
}
function renderContextBudget() {
    try {
        const stats = previewBudget().stats;
        contextWindowSize.textContent = `Context: ${stats.promptBound}/${stats.capacity} budget bound · ${stats.outputReserve} reserved for reply · ${stats.omittedMessages} messages omitted`;
        contextWindowSize.title = `Conservative UTF-8 byte bound; actual prompt tokens from the last dialogue request: ${lastDialogueUsage?.prompt_tokens ?? 'not measured'}. Extraction usage is separate.`;
    } catch (error) { contextWindowSize.textContent = error.message; }
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
        turn.own(() => audio.pause());
        return { audio, timestamps: speech.timestamps };
    }
    const ttsData = await requestJSON("/tts", {
        signal: turn.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "kokoro",
            input: text,
            voice: KOKORO_VOICE,
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
    turn.own(() => { audio.pause(); URL.revokeObjectURL(audioURL); });

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

async function getVisemes(timestamps, turn, audioId, audioDuration) {
    turn.assertCurrent();
    if (replay) return replay.visemes();
    if (LIP_SYNC === "rhubarb") {
        if (!audioId) throw new Error('Audio resource unavailable.');
        const data = await requestJSON('/get_visemes', {
            signal: turn.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_id: audioId })
        });
        return data.visemes;
    }
    else {
        await getDictionary();
        return dictionaryVisemes(timestamps, cmudict, audioDuration);
    }
}

let ind = 0;
const turnController = new TurnController(state => {
    const labels = { idle: 'Ready', requesting: 'Getting a reply', 'preparing-speech': 'Preparing speech',
        speaking: 'Speaking', completed: 'Finished', stopped: 'Stopped', failed: 'Failed' };
    document.getElementById('turn-status').textContent = state.error || labels[state.phase];
    document.getElementById('turn-stop').disabled = !['requesting', 'preparing-speech', 'speaking'].includes(state.phase);
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
        turn.own(() => ANI.stopPerformance());
        if (!reuseUser || message_history.at(-1)?.role !== 'user' || message_history.at(-1)?.content !== message) {
            message_history.push({ role: 'user', content: message });
        }
        if (replay) {
            replayInspection = {};
            inspectReplay({ phase: 'requesting fixture' });
        }
        renderMessages();
        try {
            const rawReply = await chat(message_history, 'dialogue', turn);
            turn.assertCurrent();
            const parsedReply = EMO.decodeTaggedMessage(rawReply);
            inspectReplay({ parsedReply });
            message_history.push({ role: 'assistant', content: rawReply });
            ind++;
            if (ind % 5 === 0) {
                const extractionHistory = [...message_history, { role: 'user', content:
                    'Summarize the recent dialogue into 1–2 short bullet points of explicitly stated user facts and preferences.' }];
                try {
                    const extracted = await chat(extractionHistory, 'memory', turn);
                    turn.assertCurrent();
                    memories.push(...('\n' + extracted).split(/\n\s*-\s+/).map(item => item.trim()).filter(Boolean));
                    inspectReplay({ phase: 'memory extracted' });
                } catch (error) {
                    if (turn.signal.aborted) throw error;
                    speechWarning(`Memory extraction skipped: ${error.message}`);
                }
            }
            renderMessages();
            lastRetry = { parsedReply, message };
            await prepareAndPlay(parsedReply, turn);
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
    const { audio, timestamps, audioId } = await generateTTS(parsedReply.text, turn);
    turn.assertCurrent();
    let visemes = [], emotions = [], actions = [];
    try {
        visemes = await getVisemes(timestamps, turn, audioId, audio.duration);
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
    return new Promise((resolve, reject) => {
        const audio = data.audio;
        const cleanup = () => {
            clearTimeout(timer);
            audio.removeEventListener('ended', ended);
            audio.removeEventListener('error', failed);
            turn.signal.removeEventListener('abort', aborted);
        };
        const ended = () => { cleanup(); resolve(); };
        const failed = error => {
            cleanup();
            reject(new Error(typeof error?.message === 'string' ? error.message : 'Audio playback failed or timed out.'));
        };
        const aborted = () => { cleanup(); reject(new DOMException('Turn stopped', 'AbortError')); };
        const timer = setTimeout(failed, (Number.isFinite(audio.duration) ? audio.duration + 8 : 30) * 1000);
        audio.addEventListener('ended', ended);
        audio.addEventListener('error', failed);
        turn.signal.addEventListener('abort', aborted, { once: true });
        inspectReplay({ phase: 'playing', duration: audio.duration });
        try { Promise.resolve(ANI.talk({...data, onWarning:speechWarning})).catch(failed); } catch (error) { failed(error); }
    });
}

// ------- UI FIDDLING -------
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
        turn.own(() => ANI.stopPerformance());
        try {
            await prepareAndPlay(retry.parsedReply, turn);
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
    saveMemoryToFile().catch(error => { document.getElementById('turn-status').textContent = error.message; replayMessage(error.message); });
});

// because i take care to cite my sources: https://www.geeksforgeeks.org/html/draggable-element-using-javascript/
function onMouseDrag(event, element) {
    let leftValue = parseInt(window.getComputedStyle(chatPanel).left);
    let topValue = parseInt(window.getComputedStyle(chatPanel).top);
    let x = `${leftValue + event.movementX}px`;
    let y = `${topValue + event.movementY}px`;
    chatPanel.style.left = x;
    chatPanel.style.top = y;
}

dragHandle.addEventListener("mousedown", (e) => {
    if (e.target.closest('button')) return;
    const onMove = (event) => onMouseDrag(event, dragHandle);

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", () => {
        document.removeEventListener("mousemove", onMove);
    }, { once: true });
});

// hide containers with keyboard because based
function toggleSettings() {
    const settings = document.getElementById('selections');
    settings.style.display = getComputedStyle(settings).display === 'none' ? 'flex' : 'none';
}

document.addEventListener('keydown', (event) => {
    if (event.key === 's' || event.key === 'S') {
        const tag = document.activeElement.tagName.toLowerCase();
        const isTyping = tag === "input" || tag === "textarea" || document.activeElement.isContentEditable;
        if (isTyping) return; // don't trigger shortcuts while typing

        toggleSettings();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'c' || event.key === 'C') {
        const el = document.getElementById('chat-panel');

        const tag = document.activeElement.tagName.toLowerCase();
        const isTyping = tag === "input" || tag === "textarea" || document.activeElement.isContentEditable;
        if (isTyping) return; // don't trigger shortcuts while typing

        if (el) {
            el.style.display = (el.style.display === 'none') ? 'flex' : 'none';
        }
    }
});

async function saveMemoryToFile() {
    if (replay) {
        saveReplayMemories(localStorage, memories);
        replayMessage(`Saved ${memories.length} test ${memories.length === 1 ? 'memory' : 'memories'} in this browser. Your real memory file was not changed.`);
        inspectReplay({ phase: 'test memory saved' });
        return;
    }
    if (memoryLoadError) throw new Error('Save is disabled because memories could not load. Repair or reload them before saving.');
    await requestJSON('/api/memories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memories })
    });
    document.getElementById('turn-status').textContent = `Saved ${memories.length} memories.`;
}

// -------- ACTUALLY DOING SOMETHING 🔥 --------
function setupReplayUI() {
    document.body.classList.add('replay-mode');
    document.getElementById('replay-panel').hidden = false;
    document.getElementById('replay-settings').addEventListener('click', toggleSettings);
    document.getElementById('replay-toggle').addEventListener('click', () => {
        const body = document.getElementById('replay-body');
        const toggle = document.getElementById('replay-toggle');
        body.hidden = !body.hidden;
        toggle.textContent = body.hidden ? 'Show debug' : 'Hide debug';
        toggle.setAttribute('aria-expanded', String(!body.hidden));
    });
    document.getElementById('replay-collapse').addEventListener('click', () => replayJsonViewer.collapseAll());
    const selector = document.getElementById('replay-case');
    for (const scenario of replay.fixture.cases) {
        const option = document.createElement('option');
        option.value = scenario.id;
        option.textContent = scenario.label;
        selector.appendChild(option);
    }
    selector.value = replay.scenario.id;
    document.getElementById('replay-description').textContent = replay.fixture.recording
        ? 'Scripted dialogue with saved Kokoro audio and Rhubarb mouth cues. Your test profile and memories stay separate.'
        : 'Scripted dialogue with silent audio and synthetic mouth timings. Your test profile and memories stay separate.';
    selector.addEventListener('change', () => {
        const url = new URL(location.href);
        url.searchParams.set('replay-case', selector.value);
        location.assign(url);
    });
    document.getElementById('replay-restart').addEventListener('click', () => location.reload());
    document.getElementById('replay-save').addEventListener('click', () => {
        saveMemoryToFile().catch(error => { document.getElementById('turn-status').textContent = error.message; replayMessage(error.message); });
    });
    document.getElementById('replay-clear').addEventListener('click', () => {
        localStorage.removeItem(REPLAY_MEMORY_KEY);
        location.reload();
    });
    textInput.value = replay.nextPrompt;
    sendButton.textContent = 'play scene';
    voiceSelect.disabled = true;
    replayMessage('Starting scripted replay. Text will be available when startup finishes.');
    inspectReplay({ phase: 'ready', fixture: replay.fixture.description });
}
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
document.getElementById('avatar-retry').addEventListener('click',()=>{
    if (ANI.module) ANI.loadThreeVRM();
    else location.reload(); // Browsers cache failed module evaluation; reload retries that graph.
});

async function bootstrap() {
    const warnings = [];
    try {
        await loadRuntimeConfig();
        LIP_SYNC = runtimeConfig.lipSync; KOKORO_VOICE = runtimeConfig.voice;
        if (RUNTIME_MODE === 'replay') {
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
            document.getElementById('replay-save').disabled = true;
        }
        message_history[0].content = buildCompanionPrompt(systemPrompt,companionProfile);
        message_history[1].content = 'Previously remembered information:\n'+memories.map(memory=>'- '+memory+'\n').join('');
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
