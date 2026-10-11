// Keep the total body weight at one, including when a transition is interrupted.
// Fading the only running action in from zero exposes the avatar's rest pose.
export class BodyPlayback {
    constructor(actions, duration = 0.5) {
        this.actions = Object.values(actions);
        this.duration = duration;
        this.transitionState = null;
        this.current = this.actions.find(action => action.isRunning()) ?? null;
    }

    transition(target) {
        if (!target || (target === this.current && target.isRunning())) return;
        this.add(target);
        const starts = this.actions.map(action => action.isRunning() ? action.getEffectiveWeight() : 0);
        const total = starts.reduce((sum, weight) => sum + weight, 0);
        if (!target.isRunning()) target.reset().play();
        this.actions.forEach((action, i) => {
            action.stopFading();
            action.setEffectiveWeight(total ? starts[i] / total : Number(action === target));
        });
        this.current = target;
        this.transitionState = total ? { target, starts: starts.map(weight => weight / total), elapsed: 0 } : null;
    }

    add(action) {
        if (this.actions.includes(action)) return;
        this.actions.push(action);
        this.transitionState?.starts.push(0);
    }

    update(delta) {
        const state = this.transitionState;
        if (!state) return false;
        state.elapsed += delta;
        const progress = Math.min(1, state.elapsed / this.duration);
        this.actions.forEach((action, i) => {
            action.setEffectiveWeight(state.starts[i] * (1 - progress) + Number(action === state.target) * progress);
            if (progress === 1 && action !== state.target) action.stop();
        });
        if (progress === 1) this.transitionState = null;
        return progress === 1;
    }
}
