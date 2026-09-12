export type BreathReading = {
  envelope: number;
  bpm: number | null;
  quality: "calibrating" | "quiet" | "listening" | "tracking";
  airflow: "rising" | "settling";
  speechSuspect: boolean;
};

/** RMS of the centred signal: a DC offset is not airflow energy. */
export function rmsAmplitude(samples: Float32Array): number {
  if (!samples.length) return 0;
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;
  let sum = 0;
  for (const sample of samples) sum += (sample - mean) ** 2;
  return Math.sqrt(sum / samples.length);
}

const WINDOW_MS = 30_000;
const MIN_INTERVAL_MS = 3_000;
const MAX_INTERVAL_MS = 15_000;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * A sound-envelope heuristic, not a physiological measurement. It expects one
 * audible airflow swell per breath; speech or two audible bursts per cycle can
 * fool it. Use the visible trace and keep the manual fallback available.
 */
export class BreathDetector {
  private history: { at: number; value: number }[] = [];
  private breaths: number[] = [];
  private lastAt: number | null = null;
  private beganAt = 0;
  private highAt: number | null = null;
  private audibleMs = 0;
  private reading: BreathReading = { envelope: 0, bpm: null, quality: "calibrating", airflow: "settling", speechSuspect: false };

  update(amplitude: number, at: number): BreathReading {
    if (!Number.isFinite(at) || !Number.isFinite(amplitude) || amplitude < 0 || (this.lastAt !== null && at <= this.lastAt)) return this.reading;
    if (this.lastAt === null || at - this.lastAt > 2_000) {
      this.history = [];
      this.breaths = [];
      this.highAt = null;
      this.beganAt = at;
      this.reading = { envelope: 0, bpm: null, quality: "calibrating", airflow: "settling", speechSuspect: false };
    }
    const dt = this.lastAt === null ? 50 : at - this.lastAt;
    this.lastAt = at;
    const envelope = this.reading.envelope + (1 - Math.exp(-dt / 160)) * (Math.min(1, amplitude) - this.reading.envelope);
    this.history.push({ at, value: envelope });
    this.history = this.history.filter((sample) => at - sample.at <= WINDOW_MS);
    // Keep the boundary breath to measure one interval straddling the window.
    while (this.breaths.length > 1 && this.breaths[1] < at - WINDOW_MS) this.breaths.shift();
    const levels = this.history.map((sample) => sample.value).sort((a, b) => a - b);
    const floor = levels[Math.floor(levels.length * 0.1)];
    const peak = levels[Math.floor(levels.length * 0.95)];
    const span = peak - floor;
    const calibrated = at - this.beganAt >= 1_500;
    const hasSignal = span >= 0.004;
    if (calibrated && hasSignal) {
      if (this.highAt === null && envelope > floor + span * 0.65) {
        this.highAt = at;
        this.audibleMs = 0;
      }
      else if (this.highAt !== null && envelope < floor + span * 0.3) {
        const lastBreath = this.breaths.at(-1);
        const duration = at - this.highAt;
        if (duration >= 400 && this.audibleMs >= 350 && duration <= 7_000 && (lastBreath === undefined || this.highAt - lastBreath >= MIN_INTERVAL_MS - 100)) {
          this.breaths.push(this.highAt);
        }
        this.highAt = null;
      }
      if (this.highAt !== null && amplitude > floor + span * 0.3) this.audibleMs += dt;
    } else this.highAt = null;

    let bpm: number | null = null;
    const intervals = this.breaths.slice(1).map((value, i) => value - this.breaths[i]).slice(-5);
    if (intervals.length >= 2) {
      const middle = median(intervals);
      const lastBreath = this.breaths.at(-1)!;
      const regular = intervals.every((interval) => interval >= MIN_INTERVAL_MS - 100 && interval <= MAX_INTERVAL_MS + 100 && Math.abs(interval - middle) / middle <= 0.3);
      if (hasSignal && regular && at - lastBreath <= Math.min(WINDOW_MS, middle * 1.8)) {
        bpm = Math.min(20, Math.max(4, 60_000 / middle));
      }
    }
    const quiet = !hasSignal || envelope < 0.001 && at - (this.breaths.at(-1) ?? this.beganAt) > 7_500;
    // Seven seconds preserves a plausible audible inhale at the supported 4 BPM floor.
    const speechSuspect = this.highAt !== null && at - this.highAt > 7_000;
    this.reading = {
      envelope,
      bpm,
      quality: !calibrated ? "calibrating" : bpm !== null ? "tracking" : quiet ? "quiet" : "listening",
      airflow: this.highAt === null ? "settling" : "rising",
      speechSuspect,
    };
    return this.reading;
  }
}
