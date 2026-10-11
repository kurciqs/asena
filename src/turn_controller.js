export class TurnController {
    constructor(onChange = () => {}) {
        this.sequence = 0;
        this.active = null;
        this.state = { id: 0, phase: 'idle', error: null };
        this.onChange = onChange;
    }

    publish(id, phase, error = null) {
        this.state = { id, phase, error };
        this.onChange({ ...this.state });
    }

    stop() {
        const active = this.active;
        if (!active) return;
        this.active = null; // Invalidate before cleanup or abort callbacks can run.
        active.controller.abort();
        active.cleanups.splice(0).reverse().forEach(cleanup => { try { cleanup(); } catch {} });
        this.publish(active.id, 'stopped');
    }

    async run(work) {
        this.stop();
        const owner = { id: ++this.sequence, controller: new AbortController(), cleanups: [] };
        this.active = owner;
        const assertCurrent = () => {
            if (this.active !== owner || owner.controller.signal.aborted) {
                throw new DOMException('Turn stopped', 'AbortError');
            }
        };
        const context = {
            id: owner.id, signal: owner.controller.signal, assertCurrent,
            phase: phase => { assertCurrent(); this.publish(owner.id, phase); },
            own: cleanup => { assertCurrent(); owner.cleanups.push(cleanup); }
        };
        this.publish(owner.id, 'requesting');
        try {
            const result = await work(context);
            assertCurrent();
            this.publish(owner.id, 'completed');
            return result;
        } catch (error) {
            if (this.active === owner) {
                this.publish(owner.id, error.name === 'AbortError' ? 'stopped' : 'failed',
                    error.name === 'AbortError' ? null : error.message);
            }
            return undefined;
        } finally {
            if (this.active === owner) {
                this.active = null;
                owner.cleanups.splice(0).reverse().forEach(cleanup => { try { cleanup(); } catch {} });
            }
        }
    }
}
