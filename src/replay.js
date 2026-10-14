// Replay has no live transport. Exhausted/missing fixtures fail instead of falling back.
export const REPLAY_MEMORY_KEY = 'asena.replay.memories.v1';
export const REPLAY_PROFILE_PREFIX = 'asena.replay.';

export function replayProfileStorage(storage) {
    return {
        getItem: key => storage.getItem(REPLAY_PROFILE_PREFIX + key),
        setItem: (key, value) => storage.setItem(REPLAY_PROFILE_PREFIX + key, value)
    };
}

export function readRuntimeMode(value) {
    if (!value || !['live', 'replay', 'preview'].includes(value.mode)) {
        throw new Error('Missing or invalid runtime mode. Restart the website server.');
    }
    return value.mode;
}

export function loadReplayMemories(storage) {
    const raw = storage.getItem(REPLAY_MEMORY_KEY);
    const value = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
        throw new Error('Test memories are invalid. Clear test memory to restart.');
    }
    return value;
}

export function saveReplayMemories(storage, memories) {
    if (!Array.isArray(memories) || !memories.every(item => typeof item === 'string')) {
        throw new Error('Test memories must be a list of strings.');
    }
    storage.setItem(REPLAY_MEMORY_KEY, JSON.stringify(memories));
}

export function validateFixture(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.turns) || !value.turns.length ||
        !Array.isArray(value.cases) || !value.cases.length || !value.profile) {
        throw new Error('Missing or invalid replay fixture.');
    }
    const ids = new Set();
    for (const scenario of value.cases) {
        if (!scenario.id || ids.has(scenario.id) || !['benchmark', 'recall', 'single', 'sequence'].includes(scenario.kind)) {
            throw new Error('Invalid or duplicate replay case.');
        }
        ids.add(scenario.id);
        if(scenario.turns!==undefined&&(!Array.isArray(scenario.turns)||!scenario.turns.length||scenario.turns.length>16||scenario.turns.some(index=>!Number.isInteger(index)||!value.turns[index])))throw new Error('Invalid replay sequence.');
        if(scenario.turns!==undefined&&!['benchmark','sequence'].includes(scenario.kind))throw new Error('Invalid replay sequence kind.');
        if(scenario.kind==='sequence'&&!scenario.turns)throw new Error('Missing replay sequence.');
        if (scenario.kind === 'single' && !value.turns[scenario.turn]) {
            throw new Error('Replay case refers to a missing turn.');
        }
        if (scenario.error && !['chat', 'tts', 'alignment'].includes(scenario.error.stage)) {
            throw new Error('Invalid replay error stage.');
        }
    }
    for (const turn of [...value.turns, value.recall, value.recall?.withoutMemory]) {
        if (!turn || typeof turn.user !== 'string' || typeof turn.reply !== 'string' ||
            !turn.speech || !Array.isArray(turn.speech.timestamps) || !Array.isArray(turn.visemes)) {
            throw new Error('Missing replay text, speech metadata, or mouth cues.');
        }
        assertAudioPath(turn.speech.audio);
        const duration = turn.speech.duration;
        if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
            throw new Error('Invalid replay audio duration.');
        }
        for (const stamp of turn.speech.timestamps) {
            if (typeof stamp.word !== 'string' || !validRange(stamp.start_time, stamp.end_time) ||
                (duration !== undefined && stamp.end_time > duration + 0.000001)) {
                throw new Error('Invalid replay word timing.');
            }
        }
        for (const cue of turn.visemes) {
            if (!['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'].includes(cue.value) ||
                !validRange(cue.start, cue.end) ||
                (duration !== undefined && cue.end > duration + 0.000001)) {
                throw new Error('Invalid replay mouth timing.');
            }
        }
    }
    return value;
}

function validRange(start, end) {
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start;
}

function assertAudioPath(path) {
    if (typeof path !== 'string' || !/^\/replay\/[a-zA-Z0-9_-]+\.wav$/.test(path)) {
        throw new Error('Replay audio must be a local fixture WAV.');
    }
}

export class ReplaySession {
    constructor(fixture, caseId = 'benchmark') {
        this.fixture = validateFixture(fixture);
        this.scenario = fixture.cases.find(item => item.id === caseId);
        if (!this.scenario) throw new Error(`Unknown replay case: ${caseId}`);
        this.turns = this.scenario.turns ? this.scenario.turns.map(index=>fixture.turns[index]) : this.scenario.kind === 'benchmark' ? fixture.turns :
            [this.scenario.kind === 'recall' ? fixture.recall : fixture.turns[this.scenario.turn]];
        this.cursor = 0;
        this.active = null;
    }

    get nextPrompt() { return this.turns[this.cursor]?.user ?? ''; }
    get finished() { return this.cursor >= this.turns.length; }

    failAt(stage) {
        if (this.scenario.error?.stage === stage) {
            throw new Error(`Replay ${stage} failure: ${this.scenario.error.message}`);
        }
    }

    reply(history, purpose = 'dialogue') {
        if (purpose === 'memory') {
            if (!this.active || typeof this.active.memoryExtraction !== 'string') {
                throw new Error('No extraction fixture for this turn. No model was called.');
            }
            return this.active.memoryExtraction;
        }
        if (purpose !== 'dialogue') throw new Error('Unknown replay request purpose.');
        if (this.finished) throw new Error('Replay finished. Restart the scene to replay it.');
        this.failAt('chat');
        this.active = structuredClone(this.turns[this.cursor++]);
        if (this.scenario.kind === 'recall') {
            const memory = history.find(message => message.role === 'system' &&
                message.content.includes('Previously remembered information:\n'))?.content ?? '';
            if (!memory.split('\n').some(line => line === `- ${this.fixture.expectedMemory}`)) {
                this.active = structuredClone(this.fixture.recall.withoutMemory);
            }
        }
        return this.active.reply;
    }

    speech() {
        if (!this.active) throw new Error('No active replay turn.');
        this.failAt('tts');
        const speech = structuredClone(this.active.speech);
        if (this.scenario.missingAudio) speech.audio = '/replay/missing-audio.wav';
        if (this.scenario.missingTimestamps) speech.timestamps = [];
        assertAudioPath(speech.audio);
        return speech;
    }

    visemes() {
        if (!this.active) throw new Error('No active replay turn.');
        this.failAt('alignment');
        return structuredClone(this.active.visemes);
    }
}

export function loadFixtureAudio(path, createAudio = url => new Audio(url), timeoutMs = 8000, signal) {
    assertAudioPath(path);
    return new Promise((resolve, reject) => {
        const audio = createAudio(path);
        const cleanup = () => {
            clearTimeout(timer);
            audio.removeEventListener('loadedmetadata', ready);
            audio.removeEventListener('error', failed);
            signal?.removeEventListener('abort', aborted);
        };
        const ready = () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
                failed();
                return;
            }
            cleanup();
            resolve(audio);
        };
        const failed = () => {
            cleanup();
            audio.pause();
            reject(new Error(`Replay audio unavailable or invalid: ${path}. No TTS was called.`));
        };
        const aborted = () => {
            cleanup(); audio.pause();
            reject(new DOMException('Turn stopped', 'AbortError'));
        };
        const timer = setTimeout(failed, timeoutMs);
        audio.preload = 'auto';
        audio.addEventListener('loadedmetadata', ready);
        audio.addEventListener('error', failed);
        if (signal?.aborted) { aborted(); return; }
        signal?.addEventListener('abort', aborted, { once: true });
        audio.load();
    });
}
