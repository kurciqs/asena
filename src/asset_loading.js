export function withDeadline(promise, milliseconds, label, disposeLate = () => {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            settled = true;
            reject(new Error(`${label} timed out after ${milliseconds / 1000}s`));
        }, milliseconds);
        Promise.resolve(promise).then(value => {
            if (settled) { disposeLate(value); return; }
            settled = true; clearTimeout(timer); resolve(value);
        }, error => {
            if (settled) return;
            settled = true; clearTimeout(timer); reject(error);
        });
    });
}

export class LatestLoad {
    constructor() { this.revision = 0; }
    begin() { const revision = ++this.revision; return () => revision === this.revision; }
}

export function withAbort(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new DOMException('Turn stopped','AbortError'));
    return new Promise((resolve,reject)=>{
        const abort = () => reject(new DOMException('Turn stopped','AbortError'));
        signal.addEventListener('abort',abort,{once:true});
        Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
}

export async function loadAnimationSet(files, load, timeoutMs = 15000) {
    if (!Array.isArray(files) || !files.every(file => typeof file === 'string' && /^[\w .-]+\.fbx$/i.test(file))) {
        throw new Error('Invalid animation index');
    }
    const clips = new Map(), missing = [];
    const started = performance.now();
    async function one(file) {
        const name = file.replace(/\.fbx$/i, '');
        try { clips.set(name, await withDeadline(load(file), timeoutMs, `Animation ${name}`)); }
        catch (error) { missing.push({ name, error: error.message }); }
    }
    const idle = files.find(file => file.toLowerCase() === 'idle.fbx');
    if (idle) await one(idle);
    const remaining = [...new Set(files)].filter(file => file !== idle);
    // Limit simultaneous retargeting work on the laptop.
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, remaining.length) }, async () => {
        while (cursor < remaining.length) await one(remaining[cursor++]);
    }));
    return { clips, missing, milliseconds: Math.round(performance.now() - started) };
}
