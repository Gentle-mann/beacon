/**
 * Breath rate from an amplitude envelope. Deliberately simple and robust
 * rather than accurate — this is a stage demo, not a spirometer.
 *
 * The signal: breathing through a mic is broadband noise that swells and fades
 * roughly once per breath. At 4-24 breaths/min that is a 0.07-0.4 Hz
 * oscillation riding on top of whatever else the room is doing.
 *
 * The method:
 *   1. RMS of the raw samples, every ~50ms.
 *   2. A FAST envelope (~0.4s) — the shape of one breath.
 *   3. A SLOW baseline (~8s) — the room, and the breather's own loudness.
 *   4. A rising crossing of fast over slow, with hysteresis, marks one breath.
 *   5. BPM is the median of recent inter-crossing intervals.
 *
 * Median, not mean: one missed or doubled crossing would drag a mean badly,
 * and a single bad breath should not move the world the patient is watching.
 *
 * Kept as a pure class with no Web Audio in it, so the detection maths can be
 * driven with a synthetic signal and checked without a microphone or a human.
 */

export const BREATH = {
  /** How often the caller should push a sample. */
  sampleMs: 50,
  /** Fast envelope time constant, seconds. About one breath's rise. */
  fastTau: 0.4,
  /** Slow baseline time constant, seconds. Several breaths. */
  slowTau: 8,
  /** Fast must exceed slow by this fraction to count as a rise. */
  hysteresis: 0.12,
  /** Plausible human range. Anything outside is a mis-detection, not a breath. */
  minBpm: 4,
  maxBpm: 30,
  /** Intervals outside this are dropped before the median. */
  minIntervalS: 60 / 30,
  maxIntervalS: 60 / 4,
  /** How many recent intervals feed the median. */
  window: 5,
  /** Envelope history kept for the waveform display. */
  historyLength: 300,
  /**
   * An inhale does not last this long. When the envelope stays above the
   * baseline for longer, it is sustained sound — talking — not a breath, so
   * readings taken during it are not trustworthy.
   */
  speechHoldS: 4,
  /**
   * Consecutive identical RMS samples that mean the input has stalled — a
   * suspended AudioContext or paused track keeps handing back the same buffer.
   * Without this the detector LATCHES: fast and slow converge to the same
   * value, release needs fast < slow*0.94, which a constant signal can never
   * satisfy, so `rising` stays true forever and never recovers even once audio
   * returns.
   *
   * Must exceed the longest plausible QUIET phase of a real breath or slow
   * breathing trips it: at the 4 bpm floor the gap is about 8s. Real microphone
   * input is never bit-identical, so in practice this only fires on a genuinely
   * frozen stream.
   */
  stallSamples: 200,
} as const;

export type BreathState = {
  /** Smoothed envelope, arbitrary units. */
  envelope: number;
  /** Slow baseline the envelope is compared against. */
  baseline: number;
  /** true while the envelope is above the baseline — i.e. mid-breath. */
  rising: boolean;
  /** Median BPM over the recent window, or null until enough breaths seen. */
  bpm: number | null;
  /** Breaths counted since start. */
  cycles: number;
  /**
   * True while the envelope has been held above the baseline longer than any
   * real inhale — i.e. someone is talking. Readings taken now get discarded.
   */
  speechSuspect: boolean;
  /** True when the input has gone constant — stalled, not quiet. */
  stalled: boolean;
  /** Recent envelope samples, oldest first, for drawing. */
  history: number[];
  /** Baseline samples matching `history`, so the display can show the threshold. */
  baselineHistory: number[];
};

function emaAlpha(tauSeconds: number, dtSeconds: number) {
  return 1 - Math.exp(-dtSeconds / tauSeconds);
}

export class BreathDetector {
  private fast = 0;
  private slow = 0;
  private primed = false;
  private above = false;
  private lastCrossingMs: number | null = null;
  private intervals: number[] = [];
  private lastMs: number | null = null;
  private risingSinceMs: number | null = null;
  private lastRms: number | null = null;
  private identicalCount = 0;

  cycles = 0;
  history: number[] = [];
  baselineHistory: number[] = [];

  reset() {
    this.fast = 0;
    this.slow = 0;
    this.primed = false;
    this.above = false;
    this.lastCrossingMs = null;
    this.intervals = [];
    this.lastMs = null;
    this.risingSinceMs = null;
    this.lastRms = null;
    this.identicalCount = 0;
    this.cycles = 0;
    this.history = [];
    this.baselineHistory = [];
  }

  /** Feed one RMS sample. `tMs` is a monotonic clock in milliseconds. */
  push(rms: number, tMs: number): BreathState {
    const dt = this.lastMs === null ? BREATH.sampleMs / 1000 : Math.max(0.001, (tMs - this.lastMs) / 1000);
    this.lastMs = tMs;

    // Stall detection comes first: a latched `above` must be released before
    // any crossing logic runs, or it never recovers.
    if (this.lastRms !== null && rms === this.lastRms) {
      this.identicalCount += 1;
    } else {
      this.identicalCount = 0;
    }
    this.lastRms = rms;
    const stalled = this.identicalCount >= BREATH.stallSamples;
    if (stalled) {
      this.above = false;
      this.risingSinceMs = null;
      // Drop the crossing anchor too: the gap across a stall is not a breath
      // interval, and keeping it would inject a fake one on resume.
      this.lastCrossingMs = null;
    }

    if (!this.primed) {
      // Start both filters at the first sample so the baseline does not spend
      // its first several seconds climbing from zero and firing false breaths.
      this.fast = rms;
      this.slow = rms;
      this.primed = true;
    } else {
      this.fast += emaAlpha(BREATH.fastTau, dt) * (rms - this.fast);
      this.slow += emaAlpha(BREATH.slowTau, dt) * (rms - this.slow);
    }

    const threshold = this.slow * (1 + BREATH.hysteresis);
    const releaseAt = this.slow * (1 - BREATH.hysteresis * 0.5);

    if (!this.above && this.fast > threshold) {
      this.above = true;
      this.risingSinceMs = tMs;
      if (this.lastCrossingMs !== null) {
        const interval = (tMs - this.lastCrossingMs) / 1000;
        if (interval >= BREATH.minIntervalS && interval <= BREATH.maxIntervalS) {
          this.intervals.push(interval);
          if (this.intervals.length > BREATH.window) this.intervals.shift();
          this.cycles += 1;
        }
        // An interval outside the plausible range is dropped, but the crossing
        // still re-anchors the clock — otherwise one cough desynchronises
        // every interval that follows it.
      }
      this.lastCrossingMs = tMs;
    } else if (this.above && this.fast < releaseAt) {
      this.above = false;
      this.risingSinceMs = null;
    }

    this.history.push(this.fast);
    this.baselineHistory.push(threshold);
    if (this.history.length > BREATH.historyLength) {
      this.history.shift();
      this.baselineHistory.shift();
    }

    const heldFor =
      this.above && this.risingSinceMs !== null
        ? (tMs - this.risingSinceMs) / 1000
        : 0;

    return {
      envelope: this.fast,
      baseline: threshold,
      rising: this.above,
      speechSuspect: heldFor > BREATH.speechHoldS,
      stalled,
      bpm: this.bpm(),
      cycles: this.cycles,
      history: this.history,
      baselineHistory: this.baselineHistory,
    };
  }

  /** Median of recent intervals, as BPM. Null until two clean breaths. */
  bpm(): number | null {
    if (this.intervals.length < 2) return null;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    const bpm = 60 / median;
    if (bpm < BREATH.minBpm || bpm > BREATH.maxBpm) return null;
    return bpm;
  }
}

/** RMS of a Float32 time-domain block. */
export function rmsOf(samples: Float32Array) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Median of a numeric list, or null when empty. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
