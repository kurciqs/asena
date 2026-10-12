import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryWork,mergeMemories} from '../src/memory_work.js';
import {TurnController} from '../src/turn_controller.js';

test('extraction snapshots survive foreground cancellation and cannot accept stale facts',async()=>{
    const work=new MemoryWork(),controller=new TurnController();let release,accepted=[];
    const dialogue=Array.from({length:30},(_,i)=>({role:'user',content:String(i)}));
    work.enqueue(dialogue,'- Alex prefers mint tea.');dialogue.at(-1).content='Changed';
    assert.equal(work.pending.dialogue.length,10);assert.equal(work.pending.dialogue.at(-1).content,'29');
    const run=controller.run(turn=>work.drain(turn,()=>new Promise(resolve=>release=resolve),fact=>accepted.push(fact)));
    controller.stop();release('stale');await run;
    assert.deepEqual(accepted,[]);assert.ok(work.pending);
    await controller.run(turn=>work.drain(turn,async job=>job.fixture,fact=>accepted.push(fact)));
    assert.deepEqual(accepted,['- Alex prefers mint tea.']);assert.equal(work.pending,null);
});
test('memory acceptance deduplicates, retains string-list storage, and rejects overflow atomically',()=>{
    const original=['Alex prefers mint tea.'];
    assert.deepEqual(mergeMemories(original,'- Alex prefers mint tea.\n- Alex studies maths.'),[...original,'Alex studies maths.']);
    assert.deepEqual(mergeMemories(original,'None.'),original);
    assert.throws(()=>mergeMemories(original,'x'.repeat(2001)),/limit/);assert.equal(original.length,1);
});
