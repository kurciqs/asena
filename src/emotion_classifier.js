// vibe-coded string parsing there's nothing i love llms for than not having to think about string parsing

const emotionMap = {
    happy: ["love", "yay", "sweet", "glad", "missed", "happy", "smile"],
    sad: ["sorry", "alone", "lonely", "cry", "gone", "sad", "hurt"],
    angry: ["angry", "mad", "hate", "stop", "ugh", "annoying", "mean"],
    surprised: ["what", "no way", "really", "huh", "omg", "!"],
    relaxed: ["okay", "fine", "sure", "hm", "mm", "alright"]
};

const actionMap = {
    wave: ["hello", "hi", "bye", "see you", "hey"],
    head_nod: ["yes", "yeah", "right", "sure"],
    head_shake: ["no", "nah", "never", "don’t"],
    sigh: ["sigh", "tired", "ugh", "exhausted"],
    frowning: ["sad", "angry", "mean", "jerk", "sorry"],
    thanking: ["thank", "thanks", "appreciate", "grateful"],
    hands_crossed: ["wait", "enough", "listen", "serious"],
    shrugging: ["maybe", "guess", "whatever", "dunno", "unsure"],
    talking: ["say", "talk", "told", "tell", "explain"],
    humming: ["happy", "glad", "lucky", "good"]
};

const verbToTag = {
    // EMOTIONS
    'smiles': { type: 'emotion', value: 'happy' },
    'giggles': { type: 'emotion', value: 'happy' },
    'sighs': { type: 'emotion', value: 'sad' },
    'frowns': { type: 'emotion', value: 'angry' },
    'blushes': { type: 'emotion', value: 'surprised' },
    'relaxes': { type: 'emotion', value: 'relaxed' },

    // ACTIONS
    'waves': { type: 'action', value: 'wave' },
    'nods': { type: 'action', value: 'head_nod' },
    'shakes head': { type: 'action', value: 'head_shake' },
    'crosses arms': { type: 'action', value: 'hands_crossed' },
    'shrugs': { type: 'action', value: 'shrugging' },
    'talks softly': { type: 'action', value: 'talking' },
    'hums': { type: 'action', value: 'humming' },
    'thanks': { type: 'action', value: 'thanking' },
    'frowns deeply': { type: 'action', value: 'frowning' },
    'sighs': { type: 'action', value: 'sigh' } // can also be emotion; up to you
};

// this one is for when you make the llm tag things itself, and unless you packing some epic online api it's probably gonna suck so use the hardcoder below FIRE FIRE
export function decodeTaggedMessage(text) {
    const tagRegex = /\*([^*]+)\*/g;
    const emotions = [];
    const actions = [];
    let cleanText = '';
    let lastIndex = 0;

    for (const match of text.matchAll(tagRegex)) {
        const fullMatch = match[0];
        const verb = match[1].trim().toLowerCase();
        const start = match.index;
        const end = start + fullMatch.length;

        // Append clean text before the tag
        cleanText += text.slice(lastIndex, start);
        lastIndex = end;

        const cleanPos = cleanText.length;

        if (verbToTag[verb]) {
            const { type, value } = verbToTag[verb];
            if (type === 'emotion') {
                emotions.push({ position: cleanPos, value });
            } else if (type === 'action') {
                actions.push({ position: cleanPos, value });
            }
        }
    }

    // Append remaining text
    cleanText += text.slice(lastIndex);
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    return {
        text: cleanText,
        emotions,
        actions
    };
}

export function decodeTaggedMessageRaw(text) {
    const result = tagSentences(text, emotionMap, actionMap);
    console.log(result);
    return result; 
}

function splitIntoSentences(text) {
    return text.match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()) || [];
}

function getBestMatch(map, sentence) {
  const lower = sentence.toLowerCase();
  for (const [tag, keywords] of Object.entries(map)) {
    if (keywords.some(word => lower.includes(word))) {
      return tag;
    }
  }
  return null;
}

function tagSentences(text, emotionMap, actionMap) {
    const sentences = splitIntoSentences(text);
    const tagged = [];
    let actions = [];
    let emotions = [];

    let cursor = 0;
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const emotion = getBestMatch(emotionMap, sentence) || "neutral";
        
        let action = null;
        if (i % 3 === 0) {
            const group = sentences.slice(i, i + 3).join(" ");
            action = getBestMatch(actionMap, group) || "idle";
        }
        
        let tags = [`EMOTION:${emotion}`];
        if (action) tags.unshift(`ACTION:${action}`);
        tagged.push(`${tags.join(" ")} ${sentence}`);

        if (action)
            actions.push({value: action, position: cursor});
        emotions.push({value: emotion, position: cursor});
        cursor += sentence.length;
    }

    return { text: text, emotions: emotions, actions: actions };
}

export function getEmotions(timestamps, emotions) {
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

export function getActions(timestamps, actions) {
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
