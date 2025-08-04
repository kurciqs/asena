import * as ANI from './animation.js'
import * as EMO from "./emotion_classifier.js"

// ------- CONFIGS AND GLOBALS -------
const AUDIO_FOLDER = "/data/";
const LIP_SYNC = "rhubarb"; // or "dictionary"
const MEMORY_PATH = "/data/memory.json"
let CONTEXT_WINDOW_MAX = 4000;
let CONTEXT_WINDOW_CURRENT = 0;

// ------- DICTIONARY -------
let cmuResponse = await fetch('/dictionary/cmudict.json');
let cmudict = await cmuResponse.json();
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

// ------- DISPLAY -------
function renderMessages() {
    chatContainer.innerHTML = ''
    for (let i = message_history.length - 1; i >= 0; i--) {
        let msg = message_history[i]
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
let memoryReponse = await fetch('/data/memory.json');
let memoryData = await memoryReponse.json();
let memoryPrompt = "";
memoryData.forEach((mem) => {
    memoryPrompt += "- " + mem + "\n";
    memories.push(mem);
});

let handlingResponse = false;
let message_history = [
    {
        role: "system",
        content: systemPrompt,
    },
    {
        role: "system",
        content: "Previously remembered information:\n" + memoryPrompt,
    }
]

// ------- HELPER FUNCTIONS -------
async function chat(history) {
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

    // let reply = "Oh, that's so sweet! EMOTION:happy Yes, I agree. ACTION:head_nod Who are you? EMOTION:surprised Oh, that's so sweet! EMOTION:sad Yes, I agree. ACTION:frowning Who are you? EMOTION:angry";
    return reply;
}

async function generateTTS(text) {
    const ttsResponse = await fetch("/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "kokoro",
            input: text,
            voice: "af_heart",
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

    // input handling
    let message = textInput.value.trim();
    if (!message) {
        handlingResponse = false;
        return;
    }
    console.log('LOG: User sent:', message);
    textInput.value = '';

    // prompt bashing experiments
    let spBASH = "";
    if (ind % 3 === 2) {

        spBASH = "Only use the following stage directions: smiles, giggles, sighs, frowns, blushes, relaxes, waves, nods, shakes head, crosses arms, shrugs, talks softly, hums, thanks, frowns deeply. Respond briefly.";
        message_history.push({ role: "system", content: spBASH });
    }
    ind++;

    message_history.push({ role: "user", content: message });
    console.log(message_history);

    renderMessages();

    // input processing
    try {
        const start = performance.now();
        let now = start;

        // get llm response
        let rawReply = await chat(message_history);
        let parsedReply = EMO.decodeTaggedMessage(rawReply);

        let asenaReply = parsedReply.text;
        message_history.push({ role: "assistant", content: rawReply });

        // every five messages, store some imporant information
        if (ind % 5 === 0) {
            console.log("LOG: EXTRACTING MEMORY.")
            let newMessageHistory = message_history.slice(); // copy to not fuck around with the real messageline
            let prompt = "Summarize your recent dialogue (last 5 responses) with the user into 1–2 short bullet points that describe important facts, user preferences, or character behavior. Be concise, don't give an introduction.";
            newMessageHistory.push({ role: "user", content: prompt });

            let extractedMemory = "\n" + (await chat(newMessageHistory));
            let mems = extractedMemory.split(/\n\s*-\s+/).map(s => s.trim()).filter(s => s.length > 0);
            mems.forEach((mem) => { memories.push(mem) });
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

        ANI.talk({ emotions: emotions, visemes: visemes, actions: actions, audio: audio });
    } catch (error) {
        console.error("ERROR:", error);
    }

    handlingResponse = false;
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
    saveMemoryToFile(memories);
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
    const onMove = (event) => onMouseDrag(event, dragHandle);

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", () => {
        document.removeEventListener("mousemove", onMove);
    }, { once: true });
});

// hide containers with keyboard because based
document.addEventListener('keydown', (event) => {
    if (event.key === 's' || event.key === 'S') {
        const el = document.getElementById('selections');

        const tag = document.activeElement.tagName.toLowerCase();
        const isTyping = tag === "input" || tag === "textarea" || document.activeElement.isContentEditable;
        if (isTyping) return; // don't trigger shortcuts while typing

        if (el) {
            el.style.display = (el.style.display === 'none') ? 'flex' : 'none';
        }
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
renderMessages();
ANI.loadThreeVRM();
