export type BreathSource = {
  getCurrentBpm(): number;
  getStableBpm(windowMs?: number): number;
  subscribe(cb: (bpm: number) => void): () => void;
  readonly mode: "mic" | "slider";
};

export type BreathSnapshot = { bpm: number; manualBpm: number; mode: "mic" | "slider" };

/** One source for both inputs. Losing the mic restores the last slider value. */
export function createBreathSource(initialBpm = 12) {
  const clamp = (value: number) => Math.min(20, Math.max(4, value));
  const initial = Number.isFinite(initialBpm) ? clamp(initialBpm) : 12;
  let snapshot: BreathSnapshot = { bpm: initial, manualBpm: initial, mode: "slider" };
  let recentMic: { at: number; bpm: number }[] = [];
  const listeners = new Set<(bpm: number) => void>();
  function publish(next: BreathSnapshot) {
    if (next.bpm === snapshot.bpm && next.mode === snapshot.mode && next.manualBpm === snapshot.manualBpm) return;
    snapshot = next;
    listeners.forEach((cb) => cb(snapshot.bpm));
  }
  return {
    get mode() { return snapshot.mode; },
    getCurrentBpm: () => snapshot.bpm,
    getStableBpm(windowMs = 5_000) {
      if (snapshot.mode !== "mic") return snapshot.manualBpm;
      const cutoff = Date.now() - Math.max(0, windowMs);
      const values = recentMic.filter((reading) => reading.at >= cutoff).map((reading) => reading.bpm).sort((a, b) => a - b);
      if (!values.length) return snapshot.bpm;
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    },
    getSnapshot: () => snapshot,
    subscribe(cb: (bpm: number) => void) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    setManualBpm(bpm: number) {
      if (!Number.isFinite(bpm)) return;
      recentMic = [];
      publish({ bpm: clamp(bpm), manualBpm: clamp(bpm), mode: "slider" });
    },
    setMicBpm(bpm: number | null) {
      const valid = bpm !== null && Number.isFinite(bpm) && bpm >= 4 && bpm <= 20;
      if (valid) {
        recentMic.push({ at: Date.now(), bpm });
        if (recentMic.length > 200) recentMic = recentMic.slice(-200);
      } else recentMic = [];
      publish({ ...snapshot, bpm: valid ? bpm : snapshot.manualBpm, mode: valid ? "mic" : "slider" });
    },
  } satisfies BreathSource & Record<string, unknown>;
}
