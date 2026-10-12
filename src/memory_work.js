// One bounded snapshot; foreground speech always runs before extraction.
export const MEMORY_INSTRUCTION = 'Extract at most two short bullet points of explicitly stated user facts or preferences from this dialogue. Use only user statements as evidence. Do not store character jokes, imagined events, or inferred feelings. Return an empty string if there are no facts. Do not converse or add stage directions.';

export class MemoryWork {
    constructor() { this.pending = null; }
    enqueue(dialogue, fixture = null) {
        this.pending = {dialogue: dialogue.slice(-10).map(message=>({...message})), fixture};
    }
    async drain(turn, extract, accept) {
        const job = this.pending;
        if (!job) return;
        turn.assertCurrent();
        const result = await extract(job, turn);
        turn.assertCurrent();
        accept(result);
        if (this.pending === job) this.pending = null;
    }
}

export function mergeMemories(previous, extracted) {
    if (typeof extracted !== 'string') throw new Error('Invalid memory extraction.');
    const additions = extracted.split(/\n/).map(line=>line.replace(/^\s*[-*•]\s*/, '').trim())
        .filter(line=>line && !/^(none|no facts|nothing to remember)[.!]?$/i.test(line));
    const merged = [...new Set([...previous, ...additions])];
    if (merged.length>5000 || merged.some(item=>item.length>2000) ||
        new TextEncoder().encode(JSON.stringify(merged)).length>512*1024) {
        throw new Error('Memory limit reached. Existing memories were preserved.');
    }
    return merged;
}
