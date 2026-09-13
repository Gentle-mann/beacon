import type { BreathReading } from "./breath-detector";

export type BreathActivity = "active" | "quiet";

// Long enough to bridge the quiet gap between breaths at the 18 BPM demo
// pace, but short enough to return to the willow soon after airflow stops.
export const BREATH_ACTIVITY_RELEASE_MS = 2_800;

/**
 * Fast visual cue for the demo. Unlike the stable BPM estimate, this does not
 * wait for multiple complete cycles: one clear airflow rise activates it and
 * repeated breaths keep it active.
 */
export class BreathActivityLatch {
  private activeUntil = -Infinity;
  private activity: BreathActivity = "quiet";

  update(reading: BreathReading, at: number): BreathActivity {
    if (!Number.isFinite(at)) return this.activity;
    const clearAirflow = reading.quality !== "calibrating" &&
      reading.airflow === "rising" && !reading.speechSuspect;
    if (clearAirflow) {
      this.activeUntil = at + BREATH_ACTIVITY_RELEASE_MS;
      this.activity = "active";
    } else if (at >= this.activeUntil) {
      this.activity = "quiet";
    }
    return this.activity;
  }
}
