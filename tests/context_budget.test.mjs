import test from 'node:test';
import assert from 'node:assert/strict';
import { packConversation, byteTokens, normalizeBudget } from '../src/context_budget.js';

const config={capacity:1600,outputReserve:200,profileBudget:500,memoryBudget:250,templateReserve:100,messageOverhead:32};
test('long histories keep whole recent turns within the input/output budget',()=> {
    const dialogue=Array.from({length:100},(_,i)=>[{role:'user',content:`question ${i} `+'x'.repeat(70)},{role:'assistant',content:`answer ${i} `+'y'.repeat(70)}]).flat();
    dialogue.push({role:'user',content:'latest question'});
    const packed=packConversation({systemPrompt:'current profile',memories:['old preference','recent preference'],dialogue,config});
    assert.ok(packed.stats.promptBound+packed.maxTokens<=config.capacity);
    assert.ok(packed.stats.omittedMessages>180);
    assert.equal(packed.messages[1].role,'user');
    assert.equal(packed.messages.at(-1).content,'latest question');
    assert.equal(packed.messages.filter(m=>m.role==='system').length,1);
    assert.match(packed.messages[0].content,/current profile/);
    assert.equal(dialogue.length,201,'trimming does not erase the displayed transcript');
});
test('memory and profile bounds contain Unicode and reject an oversized newest turn',()=> {
    const memories=Array.from({length:100},(_,i)=>`记忆 ${i} `+'🌸'.repeat(20));
    const packed=packConversation({systemPrompt:'profile',memories,dialogue:[{role:'user',content:'你好'}],config});
    assert.ok(byteTokens(packed.stats.memoryPrompt)<=config.memoryBudget);
    assert.ok(packed.stats.omittedMemories>0);
    assert.match(packed.stats.memoryPrompt,/99/);
    assert.throws(()=>packConversation({systemPrompt:'🌸'.repeat(200),config}),/profile budget/);
    assert.throws(()=>packConversation({systemPrompt:'profile',dialogue:[{role:'user',content:'🌸'.repeat(1000)}],config}),/newest turn/);
    assert.throws(()=>normalizeBudget({outputReserve:99999}),/capacity/);
});
test('accepted memory and profile changes are reflected in the next packed request',()=> {
    const args={systemPrompt:'Friendly current profile',memories:[],dialogue:[{role:'user',content:'hi'}],config};
    const first=packConversation(args);
    const extraction=packConversation({...args,dialogue:[...args.dialogue,{role:'user',content:'Summarize this conversation.'}]});
    assert.equal(first.stats.keptMessages,1);
    assert.equal(extraction.stats.keptMessages,2);
    args.memories.push('Alex prefers mint tea.');args.systemPrompt='Affectionate updated profile';
    const next=packConversation(args);
    assert.match(next.messages[0].content,/Affectionate updated profile/);
    assert.match(next.messages[0].content,/Alex prefers mint tea/);
    assert.doesNotMatch(first.messages[0].content,/mint tea/);
});
