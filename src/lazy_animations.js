import { withDeadline } from './asset_loading.js';

export class LazyAnimations {
    constructor(files, load, timeoutMs = 15000) {
        if (!Array.isArray(files) || !files.every(file => typeof file==='string' && /^[\w .-]+\.fbx$/i.test(file))) throw new Error('Invalid animation index');
        this.files = new Map(files.map(file=>[file.replace(/\.fbx$/i,''),file]));
        this.load = load; this.timeoutMs = timeoutMs;
        this.clips = new Map(); this.pending = new Map(); this.errors = new Map();
        this.queue = Promise.resolve(); // Retarget only one optional FBX at a time.
    }
    get(name) {
        if (this.clips.has(name)) return Promise.resolve(this.clips.get(name));
        if (this.pending.has(name)) return this.pending.get(name);
        if (!this.files.has(name) || this.errors.has(name)) return Promise.resolve(null);
        const pending = this.queue.then(async () => {
            try {
                const clip = await withDeadline(this.load(this.files.get(name)),this.timeoutMs,`Animation ${name}`);
                this.clips.set(name,clip); return clip;
            } catch (error) { this.errors.set(name,error.message); return null; }
            finally { this.pending.delete(name); }
        });
        this.queue = pending;
        this.pending.set(name,pending); return pending;
    }
}
