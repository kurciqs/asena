// UTF-8 bytes are a conservative text-token bound for Qwen's byte-level BPE.
// This is deliberately labelled as a budget bound, not an exact token count.
export const DEFAULT_BUDGET = { capacity:8192, outputReserve:512, profileBudget:4096, memoryBudget:1024, templateReserve:256, messageOverhead:64 };
const encoder = new TextEncoder();
export const byteTokens = text => encoder.encode(text.normalize('NFC')).length;

export function normalizeBudget(value = {}) {
    const config = { ...DEFAULT_BUDGET, ...value };
    for (const key of Object.keys(DEFAULT_BUDGET)) {
        if (!Number.isSafeInteger(config[key]) || config[key] <= 0) throw new Error('Invalid context budget configuration.');
    }
    if (config.outputReserve + config.templateReserve >= config.capacity) throw new Error('Context capacity must leave room for dialogue.');
    return config;
}

export function packConversation({ systemPrompt, memories = [], dialogue = [], config = DEFAULT_BUDGET }) {
    config = normalizeBudget(config);
    if (typeof systemPrompt !== 'string' || !Array.isArray(memories) || !Array.isArray(dialogue)) throw new Error('Invalid conversation data.');
    if (byteTokens(systemPrompt) > config.profileBudget) throw new Error('Your companion settings exceed the profile budget. Shorten them or increase ASENA_PROFILE_BUDGET.');
    const prefix = 'Previously remembered information:\n';
    let memoryPrompt = prefix, selectedMemories = [];
    for (const memory of memories.toReversed()) {
        if (typeof memory !== 'string') continue;
        const line = `- ${memory}\n`;
        if (byteTokens(memoryPrompt + line) > config.memoryBudget) continue;
        memoryPrompt += line; selectedMemories.push(memory);
    }
    if (byteTokens(memoryPrompt) > config.memoryBudget) throw new Error('Memory budget is too small for its header.');
    const messages = [{ role:'system', content:`${systemPrompt}\n\n${memoryPrompt}` }];
    const cost = message => byteTokens(message.content) + config.messageOverhead;
    let promptBound = config.templateReserve + cost(messages[0]);
    const inputLimit = config.capacity - config.outputReserve;
    if (promptBound >= inputLimit) throw new Error('The profile and memories leave no room for dialogue. Increase the context capacity or reduce their budgets.');
    const groups = [];
    for (const message of dialogue) {
        if (!message || !['user','assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('Invalid dialogue message.');
        if (message.role === 'user' || !groups.length) groups.push([]);
        groups.at(-1).push({ role:message.role, content:message.content });
    }
    let kept = [];
    for (let i = groups.length - 1; i >= 0; i--) {
        const group = groups[i], groupCost = group.reduce((sum,message)=>sum+cost(message),0);
        if (promptBound + groupCost > inputLimit) {
            if (i === groups.length - 1) throw new Error('The newest turn is too long for the context budget. Shorten the message or increase ASENA_CONTEXT_CAPACITY.');
            break;
        }
        kept = [...group,...kept]; promptBound += groupCost;
    }
    messages.push(...kept);
    return { messages, maxTokens:config.outputReserve, stats: {
        capacity:config.capacity, promptBound, outputReserve:config.outputReserve, keptMessages:kept.length,
        omittedMessages:dialogue.length-kept.length, selectedMemories:selectedMemories.length, omittedMemories:memories.length-selectedMemories.length,
        memoryPrompt, counting:'conservative UTF-8 byte bound',
    } };
}
