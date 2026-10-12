import {CHANNELS,RHUBARB,boundedWeights} from '../rhubarb_mouth.js';
export {CHANNELS,RHUBARB,boundedWeights};
export const OCULUS = {
  aa: [.65, 0, 0, 0, 0, 0], E: [0, 0, 0, .6, 0, 0], I: [0, .55, 0, 0, 0, 0],
  O: [0, 0, 0, 0, .55, 0], U: [0, 0, .55, 0, 0, 0], PP: [0, 0, 0, 0, 0, .35],
  SS: [0, .2, 0, 0, 0, 0], TH: [0, .18, 0, 0, 0, 0], DD: [0, .2, 0, 0, 0, 0],
  FF: [0, .12, 0, 0, 0, 0], kk: [.2, 0, 0, 0, 0, 0], nn: [0, .1, 0, 0, 0, 0],
  RR: [0, 0, .2, 0, 0, 0], CH: [0, .25, 0, 0, 0, 0], sil: [0, 0, 0, 0, 0, 0]
};
export const DICTIONARY = {
  A: OCULUS.aa, B: OCULUS.PP, C: OCULUS.O, D: OCULUS.CH,
  E: OCULUS.I, F: OCULUS.FF, G: OCULUS.kk, H: OCULUS.DD, X: OCULUS.sil
};
export const LEGACY = {A:'aa', B:null, C:'oh', D:'ee', E:'ee', F:'ou', G:'aa', H:'aa', X:null};

export function sampleFrames(frames, fps, time, duration) {
  if (!Number.isFinite(time) || time < 0 || time >= duration) return CHANNELS.map(() => 0);
  const position = time * fps;
  const left = Math.min(frames.length - 1, Math.floor(position));
  const right = Math.min(frames.length - 1, left + 1);
  const blend = position - Math.floor(position);
  return boundedWeights(frames[left].map((value, i) => value * (1 - blend) + frames[right][i] * blend));
}

export function arkitToMouth(coefficients, names) {
  if (coefficients.length !== 52 || names.length !== 52) throw new Error('ARKit channel ordering is required');
  const value = Object.fromEntries(names.map((name, index) => [name, Math.max(0, Math.min(1, coefficients[index]))]));
  const lower = ((value.mouthLowerDownLeft ?? 0) + (value.mouthLowerDownRight ?? 0)) / 2;
  const upper = ((value.mouthUpperUpLeft ?? 0) + (value.mouthUpperUpRight ?? 0)) / 2;
  const open = .65 * (value.jawOpen ?? 0) + .35 * Math.max(lower, upper);
  const close = value.mouthClose ?? 0;
  const pucker = value.mouthPucker ?? 0, funnel = value.mouthFunnel ?? 0;
  const stretch = ((value.mouthStretchLeft ?? 0) + (value.mouthStretchRight ?? 0)) / 2;
  const rounding = Math.max(pucker, funnel);
  // Provisional retargeting onto five VRoid vowels, not a native 52-shape face.
  return boundedWeights([
    .8 * open * (1 - rounding) * (1 - stretch),
    .45 * stretch * (1 - rounding), .6 * pucker,
    .5 * open * stretch * (1 - rounding), .6 * funnel,
    .35 * close
  ]);
}
