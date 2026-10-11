import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnController } from '../src/turn_controller.js';

test('replacement invalidates a delayed response and releases its resources once', async () => {
    const events = [];
    const owner = new TurnController(state => events.push(state));
    let resolveOld, oldSignal, releases = 0;
    const old = owner.run(async turn => {
        oldSignal = turn.signal;
        turn.own(() => releases++);
        await new Promise(resolve => { resolveOld = resolve; });
        turn.assertCurrent();
        throw new Error('Stale result reached UI');
    });
    const fresh = owner.run(async turn => { turn.phase('speaking'); return 'fresh'; });
    assert.equal(await fresh, 'fresh');
    resolveOld();
    await old;
    assert.equal(oldSignal.aborted, true);
    assert.equal(releases, 1);
    assert.deepEqual(events.at(-1), { id: 2, phase: 'completed', error: null });
});

test('stop and failure release audio/gesture ownership without changing later turn state', async () => {
    const owner = new TurnController();
    let release, cleaned = 0;
    const running = owner.run(async turn => {
        turn.own(() => cleaned++);
        turn.phase('preparing-speech');
        await new Promise(resolve => { release = resolve; });
        turn.assertCurrent();
    });
    owner.stop(); owner.stop(); release(); await running;
    assert.equal(owner.state.phase, 'stopped');
    assert.equal(cleaned, 1);
    await owner.run(async turn => { turn.own(() => cleaned++); throw new Error('Audio rejected'); });
    assert.equal(owner.state.phase, 'failed');
    assert.equal(owner.state.error, 'Audio rejected');
    assert.equal(cleaned, 2);
});
