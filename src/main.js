import * as ANI from './animation.js'

// ------- CONFIGS AND GLOBALS -------
const AUDIO_FOLDER = "/data/";
const LIP_SYNC = "rhubarb"; // or "dictionary"

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
}

// ------- CHATBOT LOGIC -------
let spRequest = await fetch("/system_prompt.txt");
let systemPrompt = await spRequest.text();
let handlingResponse = false;
let message_history = [
    {
        role: "system",
        content: systemPrompt,
    }
]

// ------- HELPER FUNCTIONS -------
async function chat() {
    const chatResponse = await fetch("/chat", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'open-hermes-2.5-mistral-7b-quantized',
            // model: 'tiger-gemma-9b-v1',
            messages: message_history,
            temperature: 0.8,
            top_p: 0.95
        })
    });

    if (!chatResponse.ok) {
        throw new Error(`LMS API error: ${chatResponse.status}`);
    }

    const chatData = await chatResponse.json();
    const reply = chatData.choices[0].message.content;
    renderMessages();

    console.log("LOG: Asena responded:", reply);

    //let reply = "Since 2020, Blåhaj has also been associated with the LGBTQ and particularly transgender communities."
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
            const viseme = phonemeToViseme[p] || "I"; // i think I looks kinda universal imo
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

// vibe-coded string parsing there's nothing i love llms for than not having to think about string parsing

function decodeTaggedMessage(text) {
    const tagRegex = /(EMOTION|ACTION):\s*([a-zA-Z_]+)/gi;
    const tokens = [];
    let cleanText = '';
    let lastIndex = 0;

    // This stores events with relative positions in the cleaned text
    const emotions = [];
    const actions = [];

    // Go through all tags
    for (const match of text.matchAll(tagRegex)) {
        const [fullMatch, type, value] = match;
        const matchStart = match.index;
        const matchEnd = matchStart + fullMatch.length;

        // Append clean text before the tag
        cleanText += text.slice(lastIndex, matchStart);
        lastIndex = matchEnd;

        // Record the current position in the clean text
        const cleanPos = cleanText.length;

        if (type.toUpperCase() === 'EMOTION') {
            emotions.push({
                position: cleanPos,
                value: value
            });
        } else if (type.toUpperCase() === 'ACTION') {
            actions.push({
                position: cleanPos,
                value: value
            });
        }
    }

    // Append remaining clean text
    cleanText += text.slice(lastIndex);
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    return {
        text: cleanText,
        emotions: emotions,
        actions: actions
    };
}

function getEmotions(timestamps, emotions) {
    let emotionTimestamps = []
    let currentText = "";
    let last = 0;
    // TODO: maybe optimise for exact words, spaces are a problem atm
    timestamps.forEach((timestamp) => {
        for (let i = last; i < emotions.length; i++) {
            let emotion = emotions[i];
            if (currentText.length >= emotion.position) {
                emotionTimestamps.push({ value: emotion.value, start: timestamp.start_time, end: timestamp.end_time })
                last++;
                break;
            }
        }
        if (timestamp.value === "!" || timestamp.value === "." || timestamp.value === "?" || timestamp.value === ",")
            currentText += timestamp.word;
        currentText += timestamp.word + 1; // spaces
    });

    let newEmotionTimestamps = [];
    for (let i = 0; i < emotionTimestamps.length; i++) {
        let emo = emotionTimestamps[i];

        newEmotionTimestamps.push({ value: emo.value, start: emo.start, end: i === emotionTimestamps.length - 1 ? timestamps[timestamps.length - 1].end_time + 1 : emotionTimestamps[i + 1].start })
    }
    return newEmotionTimestamps;
}

function getActions(timestamps, actions) {
    let actionTimestamps = []
    let currentText = "";
    let last = 0;
    timestamps.forEach((timestamp) => {
        for (let i = last; i < actions.length; i++) {
            let action = actions[i];
            if (currentText.length >= action.position) {
                actionTimestamps.push({ value: action.value, start: timestamp.start_time })
                last++;
                break;
            }
        }
        if (timestamp.value === "!" || timestamp.value === "." || timestamp.value === "?" || timestamp.value === ",")
            currentText += timestamp.word;
        currentText += timestamp.word + 1; // don't forget spaces
    });

    let newActionTimestamps = [];
    for (let i = 0; i < actionTimestamps.length; i++) {
        let ac = actionTimestamps[i];

        newActionTimestamps.push({ value: ac.value, start: ac.start })
    }
    return newActionTimestamps;
}

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
    message += " (respond briefly)"

    message_history.push({ role: "user", content: message });
    renderMessages();

    // input processing
    try {
        const start = performance.now();
        let now = start;

        // get llm response
        let rawReply = await chat(message);
        let parsedReply = decodeTaggedMessage(rawReply);

        let asenaReply = parsedReply.text;
        message_history.push({ role: "assistant", content: asenaReply });
        renderMessages();

        console.log(parsedReply);

        now = performance.now();
        const llmTime = now - start;

        // generate tts file with timestamps
        let { audio, timestamps } = await generateTTS(asenaReply);

        now = performance.now();
        const kokoroTime = now - start;

        // get visemes
        let visemes = await getVisemes(timestamps);
        let emotions = getEmotions(timestamps, parsedReply.emotions);
        let actions = getActions(timestamps, parsedReply.actions);
        console.log(emotions)
        console.log(actions)

        now = performance.now();
        const rhubarbTime = now - start;

        console.log("\n LLM:", llmTime);
        console.log("\n KOKORO:", kokoroTime - llmTime);
        console.log("RHUBARB:", rhubarbTime - kokoroTime);
        console.log("TOTAL:", now - start);
        audio.addEventListener("loadedmetadata", () => {
            console.log("Duration:", audio.duration);
        });

        ANI.talk({ emotions: emotions, visemes: visemes, actions: actions, audio: audio });
        // ANI.talk({ emotions: parsedReply.emotions, visemes: [], audio: new Audio() });
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

// -------- ACTUALLY DOING SOMETHING 🔥 --------
renderMessages();
ANI.loadThreeVRM();
