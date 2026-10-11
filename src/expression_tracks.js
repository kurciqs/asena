// Structural track repair; the approximate viseme mapping and smile strength remain tunable later.
export const MOUTH_CHANNELS = { A: 'aa', B: null, C: 'oh', D: 'ee', E: 'ee', F: 'ou', G: 'aa', H: 'aa', X: null };
const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed'];

function range(cue, duration) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end < cue.start || cue.end > duration + 0.05) {
        throw new Error('Invalid expression cue timing');
    }
    return { ...cue, start: Math.min(cue.start, duration), end: Math.min(cue.end, duration) };
}

export function buildExpressionTracks({ duration, visemes = [], emotions = [] }, resolveBinding) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Playable audio metadata is required');
    if (!Array.isArray(visemes) || !Array.isArray(emotions)) throw new Error('Expression cues must be arrays');
    const groups = new Map();
    function group(name) {
        const binding = resolveBinding(name);
        if (typeof binding !== 'string' || !binding) return null;
        if (!groups.has(binding)) groups.set(binding, []);
        return groups.get(binding);
    }
    for (const name of new Set(Object.values(MOUTH_CHANNELS).filter(Boolean))) group(name);
    for (const name of EMOTIONS) group(name);
    for (const raw of visemes) {
        const cue = range(raw, duration);
        if (!Object.hasOwn(MOUTH_CHANNELS, cue.value)) throw new Error('Unknown mouth cue');
        const name = MOUTH_CHANNELS[cue.value];
        if (name && cue.end > cue.start) group(name)?.push({
            points: [cue.start, (cue.start + cue.end) / 2, cue.end], values: [0, 1, 0]
        });
    }
    for (const raw of emotions) {
        const cue = range(raw, duration);
        if (!EMOTIONS.includes(cue.value) || cue.end === cue.start) continue;
        const intensity = cue.value === 'happy' ? 0.3 : 0.5;
        group(cue.value)?.push({ points: [Math.max(0, cue.start - 0.05), cue.start, cue.end, Math.min(duration, cue.end + 0.05)],
            values: [0, intensity, intensity, 0] });
    }
    function sample(curve, time) {
        const {points,values} = curve;
        if (time < points[0] || time > points.at(-1)) return 0;
        // Last duplicate timestamp wins, giving well-defined boundary values.
        for (let i = points.length - 1; i >= 0; i--) {
            if (time >= points[i]) {
                if (i === points.length - 1) return values[i];
                const span = points[i + 1] - points[i];
                return span ? values[i] + (values[i + 1] - values[i]) * (time - points[i]) / span : values[i + 1];
            }
        }
        return 0;
    }
    return [...groups].map(([name, curves]) => {
        const times = [...new Set([0, duration, ...curves.flatMap(curve => curve.points)])].sort((a,b) => a-b);
        const values = times.map(time => time === duration ? 0 : Math.max(0, ...curves.map(curve => sample(curve,time))));
        return { name, times, values };
    });
}
