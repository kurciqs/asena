/**
 * FrequencyAnalyzer — Real-time viseme detection from audio frequency analysis.
 *
 * Uses AnalyserNode FFT data to classify audio frames into viseme categories
 * based on frequency band energy distribution, amplitude, and zero-crossing rate.
 *
 * Detection pipeline:
 *   1. Silence gate → sil
 *   2. Band energy extraction (5 bands)
 *   3. Feature classification (sibilant, fricative, vowel, plosive, nasal)
 *   4. Viseme selection with confidence scoring
 *   5. Temporal smoothing (EMA + holdoff)
 *
 * @module FrequencyAnalyzer
 */

import {
  calculateRMS,
  extractBandEnergies,
  smoothValue,
  clamp,
} from './audio-utils.js';
import {
  EXTENDED_TO_SIMPLE,
  VISEME_SHAPES,
  getTransitionWeight,
} from './visemes.js';

/** Default analyzer configuration. */
const DEFAULTS = {
  fftSize: 256,
  silenceThreshold: 0.015,
  smoothingFactor: 0.35,
  holdFrames: 2,           // Minimum frames to hold a viseme before switching
  intensitySmoothing: 0.2,
  energySmoothing: 0.5,    // AnalyserNode smoothingTimeConstant
};

export class FrequencyAnalyzer {
  /**
   * @param {AnalyserNode} analyserNode - Connected AnalyserNode.
   * @param {number} sampleRate - AudioContext sample rate.
   * @param {Object} [options]
   */
  constructor(analyserNode, sampleRate, options = {}) {
    this.analyser = analyserNode;
    this.sampleRate = sampleRate;
    this.opts = { ...DEFAULTS, ...options };

    // Configure analyser
    this.analyser.fftSize = this.opts.fftSize;
    this.analyser.smoothingTimeConstant = this.opts.energySmoothing;

    // Analysis buffers
    this.timeDomainData = new Uint8Array(this.analyser.fftSize);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);

    // State
    this._currentViseme = 'sil';
    this._currentIntensity = 0;
    this._holdCounter = 0;
    this._smoothedAmplitude = 0;
    this._smoothedBands = { sub: 0, low: 0, mid: 0, high: 0, veryHigh: 0 };
    this._previousViseme = 'sil';
    this._transitionProgress = 1; // 0..1 blend between prev → current
    this._frameCount = 0;
  }

  /**
   * Analyze the current audio frame and return viseme data.
   * Call this once per animation frame (~60fps) or at your desired analysis rate.
   *
   * @returns {VisemeFrame}
   */
  analyze() {
    this._frameCount++;

    // ── Gather raw data ──────────────────────────────────────────
    this.analyser.getByteTimeDomainData(this.timeDomainData);
    this.analyser.getByteFrequencyData(this.frequencyData);

    const rawAmplitude = calculateRMS(this.timeDomainData, true);
    this._smoothedAmplitude = smoothValue(
      this._smoothedAmplitude,
      rawAmplitude,
      this.opts.smoothingFactor
    );

    // ── Band energies ────────────────────────────────────────────
    const rawBands = extractBandEnergies(this.frequencyData, this.sampleRate);
    for (const key of Object.keys(rawBands)) {
      this._smoothedBands[key] = smoothValue(
        this._smoothedBands[key] || 0,
        rawBands[key],
        this.opts.smoothingFactor
      );
    }
    const bands = this._smoothedBands;

    // ── Silence gate ─────────────────────────────────────────────
    if (this._smoothedAmplitude < this.opts.silenceThreshold) {
      return this._emitViseme('sil', 0, bands);
    }

    // ── Feature extraction ───────────────────────────────────────
    const intensity = clamp(this._smoothedAmplitude * 3, 0, 1);
    const { viseme, confidence } = this._classifyViseme(bands, intensity);

    // ── Hold-off: prevent rapid flickering ───────────────────────
    if (viseme !== this._currentViseme) {
      this._holdCounter++;
      if (this._holdCounter < this.opts.holdFrames) {
        // Keep current viseme during hold period
        return this._emitViseme(this._currentViseme, intensity, bands);
      }
      this._holdCounter = 0;
    } else {
      this._holdCounter = 0;
    }

    return this._emitViseme(viseme, intensity, bands, confidence);
  }

  /**
   * Classify the current audio frame into a viseme.
   * @private
   */
  _classifyViseme(bands, intensity) {
    const { sub, low, mid, high, veryHigh } = bands;
    const totalEnergy = sub + low + mid + high + veryHigh;

    if (totalEnergy < 0.01) {
      return { viseme: 'sil', confidence: 0.9 };
    }

    // ── Sibilants (S, Z, SH) → heavy high-frequency ─────────────
    const sibilantScore = (high + veryHigh) / (totalEnergy + 0.001);
    if (sibilantScore > 0.55 && high > 0.15) {
      if (veryHigh > high * 0.8) {
        return { viseme: 'SS', confidence: sibilantScore };
      }
      return { viseme: 'CH', confidence: sibilantScore * 0.85 };
    }

    // ── Fricatives (F, V, TH) → mid-high energy ─────────────────
    const fricativeScore = (mid + high) / (totalEnergy + 0.001);
    if (fricativeScore > 0.5 && high > 0.1 && low < 0.15) {
      return { viseme: 'FF', confidence: fricativeScore * 0.8 };
    }

    // ── Plosives (P, B, T, D) → sudden energy burst ─────────────
    // Detected by high intensity with relatively flat spectrum
    const flatness = 1 - Math.abs(high - low) / (totalEnergy + 0.001);
    if (intensity > 0.6 && flatness > 0.7 && this._smoothedAmplitude > 0.08) {
      if (low > mid) {
        return { viseme: 'PP', confidence: 0.6 };
      }
      return { viseme: 'DD', confidence: 0.6 };
    }

    // ── Nasals (M, N, NG) → strong sub/low, weak mid/high ───────
    if (sub > 0.2 && low > 0.15 && high < 0.08 && mid < low * 0.7) {
      return { viseme: 'nn', confidence: 0.65 };
    }

    // ── Vowels — classified by formant-like band patterns ────────
    // This is approximate; real formant tracking needs higher FFT resolution

    // Wide open (AA/AH): strong low+mid, moderate sub
    if (low > 0.2 && mid > 0.15 && intensity > 0.5) {
      return { viseme: 'aa', confidence: 0.7 };
    }

    // EH/AE: mid stronger than low
    if (mid > low && mid > 0.15 && intensity > 0.3) {
      return { viseme: 'E', confidence: 0.65 };
    }

    // OH/AO: sub+low dominant, some mid
    if (sub > mid && low > mid && intensity > 0.3) {
      return { viseme: 'O', confidence: 0.6 };
    }

    // IH/IY: higher-mid energy, narrower mouth
    if (mid > 0.1 && high > low * 0.5 && intensity > 0.2) {
      return { viseme: 'I', confidence: 0.55 };
    }

    // UW/OW: strong sub, weak everything else
    if (sub > 0.15 && high < 0.05) {
      return { viseme: 'U', confidence: 0.5 };
    }

    // ── Default: amplitude-based fallback ────────────────────────
    if (intensity > 0.5) return { viseme: 'aa', confidence: 0.4 };
    if (intensity > 0.3) return { viseme: 'E', confidence: 0.35 };
    if (intensity > 0.15) return { viseme: 'I', confidence: 0.3 };
    return { viseme: 'sil', confidence: 0.5 };
  }

  /**
   * Build and return the viseme frame, updating transitions.
   * @private
   */
  _emitViseme(viseme, intensity, bands, confidence = 0.5) {
    // Track transitions
    if (viseme !== this._currentViseme) {
      this._previousViseme = this._currentViseme;
      this._currentViseme = viseme;
      this._transitionProgress = 0;
    } else {
      // Advance transition
      const weight = getTransitionWeight(this._previousViseme, this._currentViseme);
      this._transitionProgress = Math.min(1, this._transitionProgress + (1 - weight) * 0.3);
    }

    // Smooth intensity
    this._currentIntensity = smoothValue(
      this._currentIntensity,
      intensity,
      this.opts.intensitySmoothing
    );

    // Get mouth shape parameters (interpolated during transition)
    const prevShape = VISEME_SHAPES[this._previousViseme] || VISEME_SHAPES.sil;
    const currShape = VISEME_SHAPES[this._currentViseme] || VISEME_SHAPES.sil;
    const t = this._transitionProgress;

    return {
      viseme: this._currentViseme,
      simpleViseme: EXTENDED_TO_SIMPLE[this._currentViseme] || 'A',
      intensity: this._currentIntensity,
      confidence,
      amplitude: this._smoothedAmplitude,
      bands: { ...this._smoothedBands },
      shape: {
        open:  prevShape.open  + (currShape.open  - prevShape.open)  * t,
        width: prevShape.width + (currShape.width - prevShape.width) * t,
        round: prevShape.round + (currShape.round - prevShape.round) * t,
      },
      transition: {
        from: this._previousViseme,
        to: this._currentViseme,
        progress: this._transitionProgress,
      },
      frame: this._frameCount,
    };
  }

  /** Reset analyzer state. */
  reset() {
    this._currentViseme = 'sil';
    this._currentIntensity = 0;
    this._holdCounter = 0;
    this._smoothedAmplitude = 0;
    this._smoothedBands = { sub: 0, low: 0, mid: 0, high: 0, veryHigh: 0 };
    this._previousViseme = 'sil';
    this._transitionProgress = 1;
    this._frameCount = 0;
  }
}

/**
 * @typedef {Object} VisemeFrame
 * @property {string} viseme - Extended viseme key.
 * @property {string} simpleViseme - Simple (A-F) viseme key.
 * @property {number} intensity - Smoothed speech intensity [0, 1].
 * @property {number} confidence - Classification confidence [0, 1].
 * @property {number} amplitude - Smoothed RMS amplitude [0, 1].
 * @property {Object} bands - Frequency band energies.
 * @property {Object} shape - Interpolated mouth shape {open, width, round}.
 * @property {Object} transition - Transition state {from, to, progress}.
 * @property {number} frame - Analysis frame counter.
 */
