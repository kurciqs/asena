import * as ANI from './animation.js'

// ------- CONFIGS AND GLOBALS -------
const FLASK_SERVER = 'http://localhost:58762';
const KOKORO_TTS = 'http://localhost:8880/dev/captioned_speech';
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

// ------- FLASK BACKEND -------
setInterval(checkFlask, 30000);
function checkFlask() {
    fetch(`${FLASK_SERVER}/status`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`DEAD: Flask server is not running at ${FLASK_SERVER}`);
            }
            console.log(`LOG: Flask server is running at ${FLASK_SERVER}.`);
        })
        .catch(error => {
            console.error('ERROR: Flask server is not running:', error);
            alert('ERROR: Flask server is not running. Please start the server and try again.');
            throw error; // Exit the script
        });
}

// ------- HTML ELEMENTS -------
const textInput = document.getElementById('user-input-message');
const chatContainer = document.getElementById("chat-display");
const sendButton = document.getElementById('user-message-send');

// ------- DISPLAY -------
function renderMessages() {
    chatContainer.innerHTML = ''
    message_history.forEach(msg => {
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
    });
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
async function chat(message) {
    message_history.push({ role: "user", content: message });
    renderMessages();
    const chatResponse = await fetch(`${FLASK_SERVER}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            //model: 'open-hermes-2.5-mistral-7b-quantized',
            model: 'tiger-gemma-9b-v1',
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
    message_history.push({ role: "assistant", content: reply });
    renderMessages();

    console.log("LOG: Asena responded:", reply);

    //let reply = "Since 2020, Blåhaj has also been associated with the LGBTQ and particularly transgender communities."
    return reply;
}

async function generateTTS(text) {
    const ttsResponse = await fetch(KOKORO_TTS, {
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
        await fetch(FLASK_SERVER + '/save_audio', {
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
        const response = await fetch(FLASK_SERVER + '/get_visemes', {
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

async function handleTextResponse() {
    // lock
    if (handlingResponse) {
        console.log("LOG: Already handling a response, ignoring button click.");
        return;
    }
    handlingResponse = true;

    // input handling
    const message = textInput.value.trim();
    if (!message) {
        handlingResponse = false;
        return;
    }
    console.log('LOG: User sent:', message);
    textInput.value = '';
    renderMessages();

    // input processing
    try {
        const start = performance.now();
        let now = start;

        // get llm response
        let rawReply = await chat(message);
        let parsedReply = parseTaggedMessage(rawReply);
        let asenaReply = parsedReply.text;
        console.log(parsedReply);
        
        console.log("LOG: Model output:", asenaReply);

        now = performance.now();
        const llmTime = now - start;

        // generate tts file with timestamps
        let { audio, timestamps } = await generateTTS(asenaReply);

        now = performance.now();
        const kokoroTime = now - start;

        // get visemes
        let visemes = await getVisemes(timestamps);

        now = performance.now();
        const rhubarbTime = now - start;

        console.log("\n LLM:", llmTime);
        console.log("\n KOKORO:", kokoroTime - llmTime);
        console.log("RHUBARB:", rhubarbTime - kokoroTime);
        console.log("TOTAL:", now - start);
        console.log("Duration:", audio.duration, "seconds\n");
        
        ANI.startExperience({ visemes: visemes, audio: audio });
    } catch (error) {
        console.error("ERROR:", error);
    }

    handlingResponse = false;
}

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
const chatPanel = document.getElementById("chat-panel");
const dragHandle = document.getElementById("chat-drag-handle");

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

// initial system render, probably useless
renderMessages();
ANI.loadThreeVRM();
