export const RENDER_PROFILES = Object.freeze({
    balanced: {fps:60, pixelRatio:1.5},
    low: {fps:30, pixelRatio:1},
    high: {fps:60, pixelRatio:2}
});
export const RENDER_STORAGE_KEY = 'asena.render.v1';
export function renderPreferences(value = {}) {
    return {quality:Object.hasOwn(RENDER_PROFILES,value?.quality) ? value.quality : 'high', shadows:value?.shadows === true};
}
export function pixelRatio(value, deviceRatio) {
    return Math.max(0.5,Math.min(Number.isFinite(deviceRatio) ? deviceRatio : 1,RENDER_PROFILES[value.quality].pixelRatio));
}

// One scheduled callback; zero updates/renders while hidden. Resume starts with
// delta zero rather than feeding a background-tab gap into spring physics.
export class RenderLoop {
    constructor({request, cancel, frame, fps = 60}) {
        Object.assign(this,{request,cancel,frame,fps});
        this.handle = null; this.last = null; this.running = false;
        this.frames = 0; this.callbacks = 0;
    }
    start() {
        if (this.running) return;
        this.running = true; this.last = null; this.schedule();
    }
    stop() {
        this.running = false;
        if (this.handle !== null) this.cancel(this.handle);
        this.handle = null; this.last = null;
    }
    schedule() { if (this.running && this.handle === null) this.handle = this.request(time => this.tick(time)); }
    tick(time) {
        this.handle = null;
        if (!this.running) return;
        this.callbacks++;
        const elapsed = this.last === null ? 0 : time-this.last;
        if (this.last === null || elapsed >= 1000/this.fps - 0.5) {
            this.last = time; this.frames++; this.frame(elapsed/1000);
        }
        this.schedule();
    }
}

export class BlinkClock {
    constructor(random = Math.random) { this.random = random; this.wait = 4; this.closed = 0; }
    update(delta, blocked = false) {
        if (this.closed > 0) { this.closed = Math.max(0,this.closed-delta); return !blocked && this.closed>0; }
        this.wait -= delta;
        if (this.wait <= 0) { this.wait = 1+3*this.random(); this.closed = blocked ? 0 : 0.1; }
        return !blocked && this.closed>0;
    }
}
