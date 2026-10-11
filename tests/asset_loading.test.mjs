import test from 'node:test';
import assert from 'node:assert/strict';
import { LatestLoad, loadAnimationSet, withDeadline } from '../src/asset_loading.js';

test('idle loads first and rejected or stalled gestures settle with fallback information', async () => {
    const order = [];
    const result = await loadAnimationSet(['wave.fbx', 'idle.fbx', 'missing.fbx', 'stalled.fbx'], file => {
        order.push(file);
        if (file === 'missing.fbx') return Promise.reject(new Error('404'));
        if (file === 'stalled.fbx') return new Promise(() => {});
        return Promise.resolve(file);
    }, 10);
    assert.equal(order[0], 'idle.fbx');
    assert.deepEqual([...result.clips.keys()], ['idle', 'wave']);
    assert.deepEqual(result.missing.map(item => item.name).sort(), ['missing', 'stalled']);
});

test('late model completions are discarded and a timed-out model is disposed when it arrives', async () => {
    const latest = new LatestLoad();
    const old = latest.begin(), current = latest.begin();
    assert.equal(old(), false); assert.equal(current(), true);
    let finish, disposed = [];
    const promise = new Promise(resolve => { finish = resolve; });
    await assert.rejects(withDeadline(promise, 5, 'Model', value => disposed.push(value)), /timed out/);
    finish('late model'); await Promise.resolve();
    assert.deepEqual(disposed, ['late model']);
});
