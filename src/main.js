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

let handlingResponse = false;
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
async function chat(history, purpose = 'dialogue') {
    if (replay) {
        const reply = replay.reply(history, purpose);
        inspectReplay(purpose === 'memory' ? { memoryExtraction: reply } :
            { scene: replay.active.label, rawReply: reply, phase: 'text ready' });
        return reply;
    }
    const chatResponse = await fetch("/chat", {
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

    if (!chatResponse.ok) {
        throw new Error(`LMS API error: ${chatResponse.status}`);
    }

    const chatData = await chatResponse.json();
    const reply = chatData.choices[0].message.content;
    CONTEXT_WINDOW_CURRENT = chatData.usage.total_tokens;

    renderMessages();

    console.log("LOG: Asena responded:", reply);

    return reply;
}

async function generateTTS(text) {
    if (replay) {
        const speech = replay.speech();
        inspectReplay({ phase: 'loading fixture audio', audio: speech.audio, timestamps: speech.timestamps,
            speech, alignment: replay.active.alignment });
        const audio = await loadFixtureAudio(speech.audio);
        return { audio, timestamps: speech.timestamps };
    }
    const ttsResponse = await fetch("/tts", {
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
    if (!ttsResponse.ok) {
        console.log(ttsResponse)
        const errorText = await ttsResponse.text();
        throw new Error(`ERROR: TTS error: ${errorText}`);
    }

    const ttsData = await ttsResponse.json();
    const audioBase64 = ttsData.audio;
    const timestamps = ttsData.timestamps;
    console.log(timestamps)
    if (!audioBase64) {
        throw new Error("ERROR: Empty audio content");
    }

    const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    const audioBlob = new Blob([audioBytes], { type: "audio/wav" });
    const audioURL = URL.createObjectURL(audioBlob);

    const audio = new Audio(audioURL);

    // if using rhubarb, we have to write the sound to a file
    if (LIP_SYNC === "rhubarb") {
        const audioPath = AUDIO_FOLDER + `tts.wav`;
        await fetch('/save_audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audio: audioBase64,
                filename: audioPath
            })
        });
    }

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

async function getVisemes(timestamps) {
    if (replay) return replay.visemes();
    if (LIP_SYNC === "rhubarb") {
        const audioPath = AUDIO_FOLDER + `tts.wav`;
        const response = await fetch('/get_visemes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filepath: audioPath })
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error("Failed to fetch visemes: " + error);
        }
        const data = await response.json();

        return data.visemes;
    }
    else {
        return convertToVisemes(timestamps)
    }
}

let ind = 0;
// pretty much the main function
async function handleTextResponse() {
    // lock
    if (handlingResponse) {
        console.log("LOG: Already handling a response, ignoring button click.");
        return;
    }
    handlingResponse = true;

    if (replay && !ANI.getPlaybackState().ready) {
        replayMessage('The avatar is still loading. Try again once it is visible.');
        inspectReplay({ phase: 'waiting for avatar' });
        handlingResponse = false;
        return;
    }
    if (replay && replay.finished) {
        replayMessage('This scene is finished. Restart it or choose another scene.');
        handlingResponse = false;
        return;
    }

    // input handling
    let message = textInput.value.trim();
    if (!message) {
        handlingResponse = false;
        return;
    }
    console.log('LOG: User sent:', message);
    textInput.value = '';

    ind++;

    message_history.push({ role: "user", content: message });
    console.log(message_history);

    renderMessages();

    // input processing
    try {
        if (replay) {
            sendButton.disabled = true;
            replayMessage(`Playing scripted scene ${replay.cursor + 1} of ${replay.turns.length}. Using saved audio.`);
            replayInspection = {};
            inspectReplay({ phase: 'requesting fixture' });
        }
        const start = performance.now();
        let now = start;

        // get llm response
        let rawReply = await chat(message_history);
        let parsedReply = EMO.decodeTaggedMessage(rawReply);
        inspectReplay({ parsedReply });

        let asenaReply = parsedReply.text;
        message_history.push({ role: "assistant", content: rawReply });

        // every five messages, store some imporant information
        if (ind % 5 === 0) {
            console.log("LOG: EXTRACTING MEMORY.")
            let newMessageHistory = message_history.slice(); // copy to not fuck around with the real messageline
            let prompt = "Summarize your recent dialogue (last 5 responses) with the user into 1–2 short bullet points that describe important facts, user preferences, or character behavior. Be concise, don't give an introduction.";
            newMessageHistory.push({ role: "user", content: prompt });

            let extractedMemory = "\n" + (await chat(newMessageHistory, 'memory'));
            let mems = extractedMemory.split(/\n\s*-\s+/).map(s => s.trim()).filter(s => s.length > 0);
            mems.forEach((mem) => { memories.push(mem) });
            inspectReplay({ phase: 'memory extracted' });
        }
        renderMessages();

        now = performance.now();
        const llmTime = now - start;

        // generate tts file with timestamps
        let { audio, timestamps } = await generateTTS(asenaReply);

        now = performance.now();
        const kokoroTime = now - start;

        // get visemes
        let visemes = await getVisemes(timestamps);
        let emotions = EMO.getEmotions(timestamps, parsedReply.emotions, parsedReply.text);
        let actions = EMO.getActions(timestamps, parsedReply.actions, parsedReply.text);
        inspectReplay({ phase: 'performance prepared', spokenText: asenaReply, visemes, emotions, actions });

        console.log(emotions)
        console.log(actions)

        now = performance.now();
        const rhubarbTime = now - start;

        // time logging for testing
        console.log("\n LLM:", llmTime);
        console.log("\n KOKORO:", kokoroTime - llmTime);
        console.log("RHUBARB:", rhubarbTime - kokoroTime);
        console.log("TOTAL:", now - start);

        audio.addEventListener("loadedmetadata", () => {
            console.log("Duration:", audio.duration);
        });

        const performanceData = { emotions, visemes, actions, audio };
        if (replay) {
            await playReplay(performanceData);
            inspectReplay({ phase: 'playback ended' });
            replayMessage(replay.finished ?
                (replay.scenario.kind === 'benchmark' ? 'Showcase finished. Save test memory, then choose the recall scene.' : 'Scene finished. Restart to repeat it.') :
                `Scene finished. Next: ${replay.turns[replay.cursor].label}.`);
            textInput.value = replay.nextPrompt;
        } else {
            ANI.talk(performanceData);
        }
    } catch (error) {
        console.error("ERROR:", error);
        replayMessage(error.message);
        inspectReplay({ phase: 'failed', error: error.message });
    }

    handlingResponse = false;
    if (replay) sendButton.disabled = false;
}

async function playReplay(data) {
    return new Promise((resolve, reject) => {
        const audio = data.audio;
        const cleanup = () => {
            clearTimeout(timer);
            audio.removeEventListener('ended', ended);
            audio.removeEventListener('error', failed);
        };
        const ended = () => { cleanup(); resolve(); };
        const failed = () => {
            cleanup();
            audio.pause();
            reject(new Error('Replay playback failed or timed out. No speech service was called.'));
        };
        const timer = setTimeout(failed, (audio.duration + 8) * 1000);
        audio.addEventListener('ended', ended);
        audio.addEventListener('error', failed);
        inspectReplay({ phase: 'playing', duration: audio.duration });
        try {
            Promise.resolve(ANI.talk(data)).catch(failed);
        } catch {
            failed();
        }
    });
}

// ------- UI FIDDLING -------
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
    saveMemoryToFile().catch(error => replayMessage(error.message));
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
    await fetch('/save_json', {
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
        saveMemoryToFile().catch(error => replayMessage(error.message));
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
if (replay) ANI.onPlaybackStateChange(() => inspectReplay({}));
ANI.loadThreeVRM();
voiceSelect.addEventListener('change', changeVoice);
