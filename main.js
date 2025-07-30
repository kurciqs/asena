import * as ANI from './animation.js'

const FLASK_SERVER = 'http://localhost:58762';
const KOKORO_TTS = 'http://localhost:8880/dev/captioned_speech';
const ANIMATIONS_INDEX_PATH = '/animations/animations.json';
const ANIMATION_DATA_PATH = '/data/animation_data.json'; // or '/animation_data.json'; --- IGNORE ---, flask needs w´no slash fuck this
// "there's a difference between those two you know" – greggory house, at some point for sure
const AUDIO_PATH = "/data/tts.wav";

// https://housemd-quotes.com/

// check if flask is running at http://localhost:58762
// if not, log an error and exit
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

// load the renderer, ADD A CONTROL FLAG LATER TO WAIT UNTIL IT HAS SAFELY LOADED
ANI.loadThreeVRM();

const textInput = document.getElementById('user-input-message');

const sendButton = document.getElementById('user-message-send');

// lock to not allow multiple responses at once
let handlingResponse = false;

let message_history = [
    {
        role: "system",
        content: "respond only in lower case.",
    }
]

const chatContainer = document.getElementById("chat-display");

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


async function handleTextResponse() {
    if (handlingResponse) {
        console.log("LOG: Already handling a response, ignoring button click.");
        return;
    }

    handlingResponse = true;
    const message = textInput.value.trim();

    if (!message) {
        handlingResponse = false;
        return;
    }

    console.log('LOG: User sent:', message);
    textInput.value = '';

    message_history.push({ role: "user", content: message });
    renderMessages();

    try {
        const chatResponse = await fetch(`${FLASK_SERVER}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'dolphin-2.6-mistral-7b.Q4_K_M.gguf',
                messages: message_history,
                temperature: 0.8,
                top_p: 0.95
            })
        });

        if (!chatResponse.ok) {
            throw new Error(`Hermes API error: ${chatResponse.status}`);
        }

        const chatData = await chatResponse.json();
        const asenaReply = chatData.choices[0].message.content;
        message_history.push({ role: "assistant", content: asenaReply });

        console.log("LOG: Asena responded:", asenaReply);
        console.log("LOG: Chat history:", message_history);


        const ttsResponse = await fetch(KOKORO_TTS, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "kokoro",
                input: asenaReply,
                voice: "af_heart",
                speed: 1.0,
                response_format: "wav",
                stream: false
            })
        });

        if (!ttsResponse.ok) {
            const errorText = await ttsResponse.text();
            throw new Error(`ERROR: TTS error: ${errorText}`);
        }

        const ttsData = await ttsResponse.json();
        const audioBase64 = ttsData.audio;
        const timestamps = ttsData.timestamps;

        if (!audioBase64) {
            throw new Error("ERROR: Empty audio content");
        }

        const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
        const audioBlob = new Blob([audioBytes], { type: "audio/wav" });
        const audioURL = URL.createObjectURL(audioBlob);

        const audio = new Audio(audioURL);

        // write the audio to a file
        await fetch('http://localhost:58762/save_audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audio: audioBase64,
                filename: AUDIO_PATH
            })
        });


        // get visemes and write to animation data
        const response = await fetch('http://localhost:58762/get_visemes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filepath: AUDIO_PATH, animation_data: ANIMATION_DATA_PATH })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error("Failed to fetch visemes: " + error);
        }

        const data = await response.json();
        console.log("Viseme data:", data.mouthCues);

        ANI.startExperience();
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

// run checkFlask every 30 seconds
setInterval(checkFlask, 30000);

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
