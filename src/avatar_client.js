import { withDeadline } from './asset_loading.js';

// The chat/settings graph never imports WebGL or its CDN dependencies directly.
export class AvatarClient {
    constructor(load = () => import('./animation.js')) {
        this.load = load;
        this.module = null;
        this.loading = null;
        this.listeners = new Set();
        this.state = { ready:false, loading:false, clips:[], missingClips:[], error:null };
    }
    getPlaybackState() { return this.module?.getPlaybackState() ?? this.state; }
    onPlaybackStateChange(listener) {
        this.listeners.add(listener); listener(this.getPlaybackState());
        return () => this.listeners.delete(listener);
    }
    publish() { for (const listener of this.listeners) listener(this.getPlaybackState()); }
    async loadThreeVRM() {
        if (this.module) return this.module.loadThreeVRM();
        if (this.loading) return this.loading;
        this.state = {...this.state, loading:true, error:null}; this.publish();
        this.loading = (async () => {
            try {
                this.module = await withDeadline(this.load(),20000,'Avatar renderer',late=>late.disposeRenderer?.());
                this.module.onPlaybackStateChange(() => this.publish());
                await this.module.loadThreeVRM();
            } catch (error) {
                this.state = {...this.state, loading:false, error:`Avatar unavailable: ${error.message} Text chat still works.`};
                this.publish();
            } finally { this.loading = null; }
        })();
        return this.loading;
    }
    stopPerformance() { this.module?.stopPerformance(); }
    preparePerformance(actions, signal) { return this.module?.preparePerformance(actions, signal) ?? Promise.resolve([]); }
    talk(data) { if (!this.module) throw new Error('Avatar unavailable'); return this.module.talk(data); }
    setRenderPreferences(value) { this.module?.setRenderPreferences(value); }
}
export const avatar = new AvatarClient();
