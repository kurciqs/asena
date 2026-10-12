// Only known directions are removed. Other starred text retains its words.
const directions = {
    smiles: [['emotion', 'happy']], giggles: [['emotion', 'happy']],
    sighs: [['emotion', 'sad'], ['action', 'sigh']],
    frowns: [['emotion', 'angry']], blushes: [['emotion', 'surprised']],
    relaxes: [['emotion', 'relaxed']], waves: [['action', 'wave']],
    nods: [['action', 'head_nod']], 'shakes head': [['action', 'head_shake']],
    'crosses arms': [['action', 'hands_crossed']], shrugs: [['action', 'shrugging']],
    'talks softly': [['action', 'talking']], hums: [['action', 'humming']],
    thanks: [['action', 'thanking']], 'frowns deeply': [['action', 'frowning']]
};
const normalize = text => text.replace(/\s+/g, ' ').trim();

export function decodeTaggedMessage(input) {
    if (typeof input !== 'string') throw new Error('Reply must be text');
    let clean = '', cursor = 0;
    const cues = [], warnings = [];
    const pairedStars = /(?<![\\*])(\*{1,2})([^*]+?)\1(?!\*)/g;
    for (const match of input.matchAll(pairedStars)) {
        clean += input.slice(cursor, match.index);
        const direction = match[1].length === 1 ? directions[normalize(match[2]).toLowerCase()] : null;
        if (direction) {
            for (const [type, value] of direction) cues.push({ type, value, rawPosition: clean.length });
        } else {
            clean += /^\s*[\d.+-]+\s*$/.test(match[2]) ? match[0] : match[2];
            if (match[1].length === 1) warnings.push(`Unrecognized starred text retained: ${match[2]}`);
        }
        cursor = match.index + match[0].length;
    }
    clean += input.slice(cursor);
    const text = normalize(clean);
    const normalizedCues = cues.map(({ type, value, rawPosition }) => ({ type, value,
        position: Math.min(text.length, clean.slice(0, rawPosition).replace(/\s+/g, ' ').trimStart().length) }));
    return { text, emotions: normalizedCues.filter(cue => cue.type === 'emotion').map(({ type, ...cue }) => cue),
        actions: normalizedCues.filter(cue => cue.type === 'action').map(({ type, ...cue }) => cue), warnings };
}

function compact(text) {
    return text.normalize('NFKC').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').toLowerCase().replace(/\s/g, '');
}

export function alignWordAnchors(timestamps, text, partial=false) {
    if (!Array.isArray(timestamps)) throw new Error('Word timings must be an array');
    let offset = 0, previous = 0;
    const words = timestamps.map(stamp => {
        if (typeof stamp.word !== 'string' || !Number.isFinite(stamp.start_time) || !Number.isFinite(stamp.end_time) ||
            stamp.start_time < 0 || stamp.end_time < stamp.start_time || stamp.start_time < previous) {
            throw new Error('Invalid or unordered word timing');
        }
        previous = stamp.start_time;
        const token = compact(stamp.word);
        const word = { offset, limit: offset + token.length, start: stamp.start_time, end: stamp.end_time, token };
        offset = word.limit;
        return word;
    });
    const timedText=words.map(word => word.token).join('');
    if (text !== undefined && words.length && (partial?!compact(text).startsWith(timedText):compact(text)!==timedText)) {
        throw new Error('Word timings do not match normalized spoken text');
    }
    return words;
}

function timedCues(timestamps, cues, text, available, partial=false) {
    if (!Array.isArray(timestamps) || !Array.isArray(cues) || !timestamps.length || !cues.length) return [];
    const spoken = text ?? timestamps.map(stamp => stamp.word).join(' ');
    const words = alignWordAnchors(timestamps, spoken, partial);
    return cues.filter(cue => cue && Number.isInteger(cue.position) && cue.position >= 0 && cue.position <= spoken.length &&
        (!available || available.has(cue.value))).map(cue => {
        const offset = compact(spoken.slice(0, cue.position)).length;
        const word = words.find(word => word.limit > offset);
        return { value: cue.value, start: word?.start ?? words.at(-1).end };
    }).filter(cue=>!partial||cue.start<words.at(-1).end).sort((a, b) => a.start - b.start);
}

export function getPartialPerformance(timestamps, parsed, available) {
    const actions=timedCues(timestamps,parsed.actions,parsed.text,available,true);
    const emotions=timedCues(timestamps,parsed.emotions,parsed.text,undefined,true);
    return {actions,emotions:emotions.map((cue,index)=>({...cue,end:emotions[index+1]?.start??180}))};
}

export function getActions(timestamps, actions, text, available) {
    return timedCues(timestamps, actions, text, available);
}

export function getEmotions(timestamps, emotions, text, duration) {
    const cues = timedCues(timestamps, emotions, text);
    const end = Number.isFinite(duration) ? duration : (timestamps.at(-1)?.end_time ?? 0);
    return cues.map(cue => ({ ...cue, end: Math.max(cue.start,
        Math.min(end, cues.find(next => next.start > cue.start)?.start ?? end)) }));
}

// Optional keyword prototype; explicit tags remain the main performance contract.
export function decodeTaggedMessageRaw(input) {
    const result = decodeTaggedMessage(input);
    if (result.emotions.length || result.actions.length) return result;
    const maps = { happy: ['happy', 'glad', 'yay'], sad: ['sad', 'sorry', 'lonely'],
        surprised: ['really', 'wow'], relaxed: ['okay', 'fine'] };
    for (const sentence of result.text.matchAll(/[^.!?]+[.!?]*/g)) {
        for (const [value, keywords] of Object.entries(maps)) {
            if (keywords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(sentence[0]))) {
                result.emotions.push({ value, position: sentence.index }); break;
            }
        }
    }
    return result;
}
