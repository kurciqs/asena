// Preserve the existing approximate phoneme mapping; bound all generated cues.
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

export function dictionaryVisemes(words, dictionary, audioDuration) {
    if (!Number.isFinite(audioDuration) || audioDuration <= 0) throw new Error('Playable audio metadata is required');
    if (!Array.isArray(words) || !dictionary || typeof dictionary !== 'object') throw new Error('Invalid dictionary speech data');
    const visemes = [];
    let previous = 0;
    for (const {word, start_time, end_time} of words) {
        if (typeof word !== 'string' || !Number.isFinite(start_time) || !Number.isFinite(end_time) ||
            start_time < previous || end_time < start_time) throw new Error('Invalid dictionary word timing');
        previous = start_time;
        const phonemes = dictionary[word.toUpperCase()];
        if (!Array.isArray(phonemes) || !phonemes.length) continue;
        const start = Math.min(start_time, audioDuration), end = Math.min(end_time, audioDuration);
        if (end <= start) continue;
        const step = (end-start)/phonemes.length;
        for (let i=0; i<phonemes.length; i++) {
            const value = phonemeToViseme[phonemes[i].replace(/\d/g, '')];
            if (value) visemes.push({value, start:start+i*step, end:Math.min(end,start+(i+1)*step)});
        }
        // Expression tracks return to zero at each cue end. An extra rest interval
        // would extend beyond the word, overlap the next word or overrun the WAV.
    }
    return visemes;
}
