/**
 * Viseme definitions, mappings, and phoneme data.
 *
 * Supports two standard sets:
 *   - EXTENDED (15 shapes) — Oculus/MPEG-4 standard
 *   - SIMPLE   (6 shapes)  — Preston Blair / Hanna-Barbera
 *
 * @module visemes
 */

// ─── Extended 15-shape set (Oculus OVRLipSync compatible) ────────────────────

export const EXTENDED_VISEMES = /** @type {const} */ ({
  sil: { label: 'Silent',     description: 'Mouth closed, neutral' },
  PP:  { label: 'P/B/M',      description: 'Lips pressed together' },
  FF:  { label: 'F/V',        description: 'Lower lip to upper teeth' },
  TH:  { label: 'TH',         description: 'Tongue between teeth' },
  DD:  { label: 'D/T/N/L',    description: 'Tongue to upper palate' },
  kk:  { label: 'K/G',        description: 'Back of tongue raised' },
  CH:  { label: 'CH/SH/J',    description: 'Lips pursed forward' },
  SS:  { label: 'S/Z',        description: 'Teeth close, slight smile' },
  nn:  { label: 'N/NG',       description: 'Mouth slightly open, nasal' },
  RR:  { label: 'R',          description: 'Lips slightly rounded' },
  aa:  { label: 'AA/AH',      description: 'Wide open mouth' },
  E:   { label: 'EH/AE',      description: 'Mouth open, slight smile' },
  I:   { label: 'IH/IY',      description: 'Small opening, smile' },
  O:   { label: 'OH/AO',      description: 'Rounded, medium open' },
  U:   { label: 'UW/OW',      description: 'Small rounded opening' },
});

/** @type {string[]} Ordered list of extended viseme keys. */
export const EXTENDED_VISEME_KEYS = Object.keys(EXTENDED_VISEMES);

// ─── Simple 6-shape set (Preston Blair / Hanna-Barbera) ─────────────────────

export const SIMPLE_VISEMES = /** @type {const} */ ({
  A: { label: 'Rest / M/B/P closed',  extendedMap: ['sil'] },
  B: { label: 'M / B / P',            extendedMap: ['PP', 'nn'] },
  C: { label: 'EE / S / soft sounds',  extendedMap: ['E', 'I', 'SS'] },
  D: { label: 'AH / wide open',       extendedMap: ['aa', 'DD', 'kk'] },
  E: { label: 'OH / round',           extendedMap: ['O', 'RR', 'CH'] },
  F: { label: 'OO / F / V / tight',   extendedMap: ['FF', 'TH', 'U'] },
});

/** @type {string[]} Ordered list of simple viseme keys. */
export const SIMPLE_VISEME_KEYS = Object.keys(SIMPLE_VISEMES);

// ─── Extended → Simple mapping ──────────────────────────────────────────────

/** @type {Object<string, string>} */
export const EXTENDED_TO_SIMPLE = {};
for (const [simpleKey, def] of Object.entries(SIMPLE_VISEMES)) {
  for (const ext of def.extendedMap) {
    EXTENDED_TO_SIMPLE[ext] = simpleKey;
  }
}

// ─── CMU/ARPABET Phoneme → Extended Viseme ──────────────────────────────────

export const PHONEME_TO_VISEME = /** @type {const} */ ({
  // Vowels
  AA: 'aa', AE: 'E',  AH: 'aa', AO: 'O',  AW: 'aa',
  AY: 'aa', EH: 'E',  ER: 'RR', EY: 'E',  IH: 'I',
  IY: 'I',  OW: 'O',  OY: 'O',  UH: 'U',  UW: 'U',
  // Consonants
  B:  'PP', CH: 'CH', D:  'DD', DH: 'TH', F:  'FF',
  G:  'kk', HH: 'aa', JH: 'CH', K:  'kk', L:  'DD',
  M:  'PP', N:  'nn', NG: 'nn', P:  'PP', R:  'RR',
  S:  'SS', SH: 'CH', T:  'DD', TH: 'TH', V:  'FF',
  W:  'U',  Y:  'I',  Z:  'SS', ZH: 'CH',
});

/** @type {string[]} All known ARPABET phonemes. */
export const ARPABET_PHONEMES = Object.keys(PHONEME_TO_VISEME);

// ─── Viseme transition weights (coarticulation hints) ───────────────────────
// Higher weight = slower transition (more blending needed)

/** @type {Object<string, Object<string, number>>} */
export const TRANSITION_WEIGHTS = {
  sil: { aa: 0.3, E: 0.3, I: 0.3, O: 0.3, U: 0.3, PP: 0.2, FF: 0.2 },
  aa:  { sil: 0.4, E: 0.5, O: 0.6, I: 0.5, PP: 0.3, SS: 0.3 },
  PP:  { aa: 0.2, sil: 0.2, E: 0.3, FF: 0.4 },
  FF:  { aa: 0.3, PP: 0.4, sil: 0.2 },
  SS:  { sil: 0.2, aa: 0.3, CH: 0.6 },
};

/**
 * Get the transition weight between two visemes.
 * @param {string} from
 * @param {string} to
 * @returns {number} Weight 0..1 (higher = more blending).
 */
export function getTransitionWeight(from, to) {
  return TRANSITION_WEIGHTS[from]?.[to] ?? 0.35; // sensible default
}

// ─── Mouth shape parameters for procedural rendering ────────────────────────
// Each viseme maps to normalized parameters: openness, width, roundness

/** @type {Object<string, {open: number, width: number, round: number}>} */
export const VISEME_SHAPES = {
  sil: { open: 0.00, width: 0.50, round: 0.0 },
  PP:  { open: 0.00, width: 0.40, round: 0.0 },
  FF:  { open: 0.05, width: 0.55, round: 0.0 },
  TH:  { open: 0.10, width: 0.50, round: 0.0 },
  DD:  { open: 0.20, width: 0.50, round: 0.0 },
  kk:  { open: 0.25, width: 0.45, round: 0.0 },
  CH:  { open: 0.15, width: 0.35, round: 0.6 },
  SS:  { open: 0.05, width: 0.60, round: 0.0 },
  nn:  { open: 0.15, width: 0.50, round: 0.0 },
  RR:  { open: 0.20, width: 0.40, round: 0.4 },
  aa:  { open: 0.90, width: 0.60, round: 0.0 },
  E:   { open: 0.50, width: 0.65, round: 0.0 },
  I:   { open: 0.25, width: 0.70, round: 0.0 },
  O:   { open: 0.60, width: 0.40, round: 0.8 },
  U:   { open: 0.20, width: 0.30, round: 0.9 },
};

/**
 * Get interpolated mouth shape between two visemes.
 * @param {string} fromViseme
 * @param {string} toViseme
 * @param {number} t - Interpolation factor [0, 1].
 * @returns {{open: number, width: number, round: number}}
 */
export function interpolateShapes(fromViseme, toViseme, t) {
  const a = VISEME_SHAPES[fromViseme] || VISEME_SHAPES.sil;
  const b = VISEME_SHAPES[toViseme] || VISEME_SHAPES.sil;
  const clampT = Math.max(0, Math.min(1, t));
  return {
    open:  a.open  + (b.open  - a.open)  * clampT,
    width: a.width + (b.width - a.width) * clampT,
    round: a.round + (b.round - a.round) * clampT,
  };
}
