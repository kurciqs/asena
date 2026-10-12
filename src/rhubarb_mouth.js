// Source-specific Rhubarb mapping shared by streaming playback and auditions.
export const CHANNELS = ['aa', 'ih', 'ou', 'ee', 'oh', 'closed'];
export const RHUBARB = {
  A: [0, 0, 0, 0, 0, .35], B: [0, .3, 0, 0, 0, 0], C: [.12, 0, 0, .48, 0, 0],
  D: [.75, 0, 0, 0, 0, 0], E: [0, 0, 0, 0, .55, 0], F: [0, 0, .6, 0, 0, 0],
  G: [0, .12, 0, 0, 0, 0], H: [.25, .12, 0, 0, 0, 0], X: [0, 0, 0, 0, 0, 0]
};
export function boundedWeights(values) {
  if (!Array.isArray(values) || values.length !== CHANNELS.length || values.some(v => !Number.isFinite(v))) {
    throw new Error('Invalid mouth weights');
  }
  const bounded = values.map(v => Math.max(0, Math.min(1, v)));
  const total = bounded.slice(0, 5).reduce((a, b) => a + b, 0);
  // Closure and opening are competing movements, not additive jaw opening.
  const openingBudget = 1 - bounded[5];
  if (total > openingBudget) for (let i = 0; i < 5; i++) bounded[i] *= openingBudget / total;
  return bounded;
}
