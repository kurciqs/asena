import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REPLAY_MEMORY_KEY, ReplaySession, loadFixtureAudio, loadReplayMemories,
    readRuntimeMode, replayProfileStorage, saveReplayMemories, validateFixture } from '../src/replay.js';
import { decodeTaggedMessage, getActions, getEmotions } from '../src/emotion_classifier.js';
import { COMPANION_STORAGE_KEY, loadCompanionProfile, saveCompanionProfile } from '../src/companion.js';

const fixture = JSON.parse(await readFile(new URL('../src/replay/benchmark.json', import.meta.url), 'utf8'));
const storage = () => {
    const data = new Map();
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const history = memories => [{ role: 'system', content: 'character profile' },
    { role: 'system', content: 'Previously remembered information:\n' + memories.map(item => `- ${item}\n`).join('') }];

test('configuration and incomplete fixtures fail closed', () => {
    assert.equal(readRuntimeMode({ mode: 'replay' }), 'replay');
    for (const value of [null, {}, { mode: 'unknown' }]) assert.throws(() => readRuntimeMode(value));
    assert.throws(() => new ReplaySession(null));
    assert.throws(() => new ReplaySession(fixture, 'typo'));
    const missingTurn = structuredClone(fixture);
    delete missingTurn.turns[0].speech;
    assert.throws(() => validateFixture(missingTurn));
    const remoteAudio = structuredClone(fixture);
    remoteAudio.turns[0].speech.audio = 'http://localhost:8880/tts.wav';
    assert.throws(() => validateFixture(remoteAudio));
    const pastAudioEnd = structuredClone(fixture);
    pastAudioEnd.turns[0].speech.duration = 0.01;
    assert.throws(() => validateFixture(pastAudioEnd), /timing/);
});

test('five benchmark replies use existing parsing and performance mapping without any network', () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('network forbidden'); };
    try {
        const session = new ReplaySession(fixture);
        const actions = [];
        for (let i = 0; i < 5; i++) {
            assert.equal(session.nextPrompt, fixture.turns[i].user);
            const parsed = decodeTaggedMessage(session.reply(history([])));
            const speech = session.speech();
            // Kokoro returns punctuation as separate tokens, unlike the synthetic fixture.
            assert.equal(parsed.text.replace(/\s/g, ''), speech.timestamps.map(item => item.word).join(''));
            if (speech.spokenText) assert.equal(parsed.text, speech.spokenText);
            actions.push(...getActions(speech.timestamps, parsed.actions, parsed.text).map(item => item.value));
            assert.ok(Array.isArray(getEmotions(speech.timestamps, parsed.emotions, parsed.text)));
            assert.ok(session.visemes().length > 0);
        }
        assert.deepEqual(actions, ['wave', 'head_shake', 'head_nod', 'shrugging']);
        assert.equal(session.finished, true);
        assert.throws(() => session.reply(history([])), /finished/);
        assert.equal(session.reply(history([]), 'memory'), '- Alex prefers mint tea.');
    } finally { globalThis.fetch = originalFetch; }
});

test('service failure fixtures throw at the requested stage without falling back', () => {
    for (const stage of ['chat', 'tts', 'alignment']) {
        const session = new ReplaySession(fixture, `${stage}-error`);
        if (stage === 'chat') {
            assert.throws(() => session.reply(history([])), /Replay chat failure/);
            assert.equal(session.cursor, 0);
        } else {
            session.reply(history([]));
            if (stage === 'tts') assert.throws(() => session.speech(), /Replay tts failure/);
            else assert.throws(() => session.visemes(), /Replay alignment failure/);
        }
    }
});

test('missing audio and timestamps are explicit fixture variants', () => {
    const missing = new ReplaySession(fixture, 'missing-audio');
    missing.reply(history([]));
    assert.equal(missing.speech().audio, '/replay/missing-audio.wav');
    const empty = new ReplaySession(fixture, 'missing-timestamps');
    const parsed = decodeTaggedMessage(empty.reply(history([])));
    assert.deepEqual(empty.speech().timestamps, []);
    assert.deepEqual(getActions([], parsed.actions), []);
    assert.deepEqual(getEmotions([], parsed.emotions), []);
    assert.ok(empty.visemes().length > 0);
});

test('saved test memory survives a new session; recall depends on the supplied memory prompt', () => {
    const store = storage();
    store.setItem('asena.companion.v1', 'real profile');
    store.setItem('real-memories', 'real data');
    const session = new ReplaySession(fixture);
    for (let i = 0; i < 5; i++) session.reply(history([]));
    const extracted = ('\n' + session.reply(history([]), 'memory')).split(/\n\s*-\s+/)
        .map(item => item.trim()).filter(Boolean);
    saveReplayMemories(store, extracted);
    assert.deepEqual(loadReplayMemories(store), [fixture.expectedMemory]);
    assert.equal(store.getItem('asena.companion.v1'), 'real profile');
    assert.equal(store.getItem('real-memories'), 'real data');
    const recalled = new ReplaySession(fixture, 'recall');
    assert.equal(recalled.reply(history(loadReplayMemories(store))), fixture.recall.reply);
    const absent = new ReplaySession(fixture, 'recall');
    assert.equal(absent.reply(history([])), fixture.recall.withoutMemory.reply);
    assert.equal(absent.speech().timestamps.map(item => item.word).join(''), fixture.recall.withoutMemory.reply.replace(/\s/g, ''));
    const unrelated = new ReplaySession(fixture, 'recall');
    assert.equal(unrelated.reply([{ role: 'user', content: fixture.expectedMemory }]), fixture.recall.withoutMemory.reply);
});

test('test companion settings never read or overwrite the live profile', () => {
    const store = storage();
    store.setItem(COMPANION_STORAGE_KEY, JSON.stringify({ name: 'Personal companion', closeness: 'intimate' }));
    const isolated = replayProfileStorage(store);
    assert.equal(loadCompanionProfile(isolated).name, 'Asena');
    saveCompanionProfile(fixture.profile, isolated);
    assert.equal(loadCompanionProfile(isolated).closeness, 'affectionate');
    assert.equal(loadCompanionProfile(store).name, 'Personal companion');
    assert.equal(loadCompanionProfile(store).closeness, 'intimate');
});

test('bad or unavailable storage reports failure instead of using real memory', () => {
    const store = storage();
    store.setItem(REPLAY_MEMORY_KEY, '{}');
    assert.throws(() => loadReplayMemories(store));
    assert.throws(() => saveReplayMemories(store, [null]));
    assert.throws(() => saveReplayMemories({ setItem: () => { throw new Error('quota'); } }, []), /quota/);
});

class FakeAudio extends EventTarget {
    constructor(event, duration = 6) { super(); this.event = event; this.duration = duration; }
    load() { if (this.event) queueMicrotask(() => this.dispatchEvent(new Event(this.event))); }
    pause() {}
}

test('fixture audio load rejects missing files, invalid durations, remote paths and stalls', async () => {
    const ready = await loadFixtureAudio('/replay/silence.wav', () => new FakeAudio('loadedmetadata'));
    assert.equal(ready.duration, 6);
    await assert.rejects(loadFixtureAudio('/replay/missing-audio.wav', () => new FakeAudio('error')), /No TTS/);
    await assert.rejects(loadFixtureAudio('/replay/silence.wav', () => new FakeAudio('loadedmetadata', NaN)), /invalid/);
    await assert.rejects(loadFixtureAudio('/replay/silence.wav', () => new FakeAudio(null), 5), /No TTS/);
    assert.throws(() => loadFixtureAudio('http://localhost:8880/audio.wav'), /local fixture/);
});
