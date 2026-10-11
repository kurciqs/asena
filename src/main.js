import { buildExpressionTracks } from './expression_tracks.js';
import { requestJSON } from './service_client.js';
import { loadAudioMetadata, repairWavHeader } from './audio.js';
import { TurnController } from './turn_controller.js';
import * as ANI from './animation.js'
import * as EMO from "./emotion_classifier.js"
import { CLOSENESS, COMPANION_STORAGE_KEY, DEFAULT_COMPANION_PROFILE, buildCompanionPrompt, loadCompanionProfile, normalizeCompanionProfile, saveCompanionProfile } from './companion.js';
import { REPLAY_MEMORY_KEY, ReplaySession, loadFixtureAudio, loadReplayMemories, readRuntimeMode, replayProfileStorage, saveReplayMemories } from './replay.js';
import { createJsonViewer } from './json_viewer.js';

// The server owns the mode. Invalid/missing configuration never defaults to live.
const runtimeResponse = await fetch('/runtime', { cache: 'no-store' });
if (!runtimeResponse.ok) throw new Error('Runtime configuration unavailable. Restart the website server.');
const RUNTIME_MODE = readRuntimeMode(await runtimeResponse.json());
let replay = null;
let profileStorage;
if (RUNTIME_MODE === 'replay') {
    const fixtureResponse = await fetch('/replay/benchmark.json');
    if (!fixtureResponse.ok) throw new Error('Replay fixture unavailable. No AI service was called.');
    replay = new ReplaySession(await fixtureResponse.json(), new URLSearchParams(location.search).get('replay-case') ?? 'benchmark');
    profileStorage = replayProfileStorage(localStorage);
}

// ------- CONFIGS AND GLOBALS -------
const AUDIO_FOLDER = "/data/";
const LIP_SYNC = "rhubarb"; // or "dictionary"
const MEMORY_PATH = "/data/memory.json"
let KOKORO_VOICE = "af_heart";
let CONTEXT_WINDOW_MAX = 4000;
let CONTEXT_WINDOW_CURRENT = 0;
let companionProfile = replay && !profileStorage.getItem(COMPANION_STORAGE_KEY) ?
    normalizeCompanionProfile(replay.fixture.profile) : loadCompanionProfile(profileStorage);

// ------- DICTIONARY -------
let cmudict = {};
if (!replay) {
    const cmuResponse = await fetch('/dictionary/cmudict.json');
    cmudict = await cmuResponse.json();
}
// gpt slop conversion i just don't care 
const phonemeToViseme = {
    // A: Open mouth
    "AA": "A", "AE": "A", "AH": "A", "AO": "A", "AW": "A", "AY": "A",
    // B: Closed lips
    "B": "B", "P": "B", "M": "B",
    // C: Rounded mouth
    "OW": "C", "UH": "C", "UW": "C", "OY": "C",
    // D: Sibilants and affricates
    "CH": "D", "JH": "D", "SH": "D", "ZH": "D",
    // E: Smile vowels
    "IY": "E", "IH": "E", "EY": "E", "ER": "E",
    // F: Teeth on lip
    "F": "F", "V": "F",
    // G: Back consonants
    "K": "G", "G": "G", "NG": "G",
    // H: Front consonants and tongue
    "S": "H", "Z": "H", "TH": "H", "DH": "H",
    "T": "H", "D": "H", "L": "H", "R": "H", "N": "H"
};
// https://housemd-quotes.com/

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
        activeMemoryPrompt: message_history[1].content
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
    contextWindowSize.innerHTML = Math.round(CONTEXT_WINDOW_CURRENT / CONTEXT_WINDOW_MAX * 100);
}

// ------- CHATBOT LOGIC -------
let spRequest = await fetch("/system_prompt.txt");
let systemPrompt = await spRequest.text();
let memories = [];
let memoryData;
if (replay) {
    memoryData = loadReplayMemories(localStorage);
} else {
    const memoryResponse = await fetch('/data/memory.json');
    memoryData = await memoryResponse.json();
}
let memoryPrompt = "";
memoryData.forEach((mem) => {
    memoryPrompt += "- " + mem + "\n";
    memories.push(mem);
});

let message_history = [
    {
        role: "system",
        content: buildCompanionPrompt(systemPrompt, companionProfile),
    },
    {
        role: "system",
        content: "Previously remembered information:\n" + memoryPrompt,
    }
]

// ------- HELPER FUNCTIONS -------
async function chat(history, purpose = 'dialogue', turn = null) {
    turn?.assertCurrent();
    if (replay) {
        const reply = replay.reply(history, purpose);
        inspectReplay(purpose === 'memory' ? { memoryExtraction: reply } :
            { scene: replay.active.label, rawReply: reply, phase: 'text ready' });
        return reply;
    }
    const chatData = await requestJSON("/chat", {
        signal: turn?.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'open-hermes-2.5-mistral-7b-quantized',
            // model: 'tiger-gemma-9b-v1',
            messages: history,
            temperature: 0.8,
            top_p: 0.95
        })
    });

    turn?.assertCurrent();
    const reply = chatData.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('No usable reply was returned. Retry when ready.');
    CONTEXT_WINDOW_CURRENT = chatData.usage.total_tokens;

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

    // if using rhubarb, we have to write the sound to a file
    if (LIP_SYNC === "rhubarb") {
        const audioPath = AUDIO_FOLDER + `tts.wav`;
        await requestJSON('/save_audio', {
            signal: turn.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audio: audioBase64,
                filename: audioPath
            })
        });
    }

    await loadAudioMetadata(audio, { signal: turn.signal });
    turn.assertCurrent();
    return { audio, timestamps };
}

function convertToVisemes(kokoroWords) {
    // get visemes based on dictionary, can save about ten seconds, the time that rhubarb might need extra but sucks more
    const visemes = [];

    for (const { word, start_time, end_time } of kokoroWords) {
        const upperWord = word.toUpperCase();
        const phonemes = cmudict[upperWord];

        if (!phonemes) continue;

        // Remove stress markers: "AH0" → "AH"
        const cleaned = phonemes.map(p => p.replace(/\d/g, ""));

        // Time per phoneme
        const duration = end_time - start_time;
        const phonemeDuration = duration / cleaned.length;

        for (let i = 0; i < cleaned.length; i++) {
            const p = cleaned[i];
            const viseme = phonemeToViseme[p];
            if (!viseme) continue;

            visemes.push({
                value: viseme,
                start: start_time + i * phonemeDuration,
                end: start_time + (i + 1) * phonemeDuration
            });
        }
        visemes.push({
            value: "X",
            start: start_time + cleaned.length * phonemeDuration,
            end: start_time + (cleaned.length + 1) * phonemeDuration
        });
    }

    return visemes;
}

async function getVisemes(timestamps, turn) {
    turn.assertCurrent();
    if (replay) return replay.visemes();
    if (LIP_SYNC === "rhubarb") {
        const audioPath = AUDIO_FOLDER + `tts.wav`;
        const data = await requestJSON('/get_visemes', {
            signal: turn.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filepath: audioPath })
        });
        return data.visemes;
    }
    else {
        return convertToVisemes(timestamps)
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
    if (replay && !ANI.getPlaybackState().ready) {
        replayMessage('The avatar is still loading. Try again once it is visible.');
        return;
    }
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
                replayMessage(replay.finished ? 'Showcase finished. Save test memory, then choose the recall scene.' :
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
    turn.phase('preparing-speech');
    speechWarning('');
    const { audio, timestamps } = await generateTTS(parsedReply.text, turn);
    turn.assertCurrent();
    let visemes = [], emotions = [], actions = [];
    try {
        visemes = await getVisemes(timestamps, turn);
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
        const failed = () => { cleanup(); reject(new Error('Audio playback failed or timed out.')); };
        const aborted = () => { cleanup(); reject(new DOMException('Turn stopped', 'AbortError')); };
        const timer = setTimeout(failed, (Number.isFinite(audio.duration) ? audio.duration + 8 : 30) * 1000);
        audio.addEventListener('ended', ended);
        audio.addEventListener('error', failed);
        turn.signal.addEventListener('abort', aborted, { once: true });
        inspectReplay({ phase: 'playing', duration: audio.duration });
        try { Promise.resolve(ANI.talk(data)).catch(failed); } catch { failed(); }
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
    await requestJSON('/save_json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            json_data: memories,
            filename: MEMORY_PATH
        })
    });
}

// -------- ACTUALLY DOING SOMETHING 🔥 --------
if (replay) {
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
    replayMessage('Ready for scripted replay. Wait for the avatar, then press play scene.');
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
    if (state.loading) turnController.stop();
    document.getElementById('avatar-status').textContent = state.loading ? 'Loading avatar…' :
        state.error || (state.missingClips.length ? `${state.missingClips.length} optional animations unavailable` : 'Avatar ready');
    inspectReplay({});
});
ANI.loadThreeVRM();
voiceSelect.addEventListener('change', changeVoice);
