export type BreathSource = {
  getCurrentBpm(): number;
  subscribe(cb: (bpm: number) => void): () => void;
  readonly mode: "mic" | "slider";
};

export type BreathSnapshot = { bpm: number; manualBpm: number; mode: "mic" | "slider" };

/** One source for both inputs. Losing the mic restores the last slider value. */
export function createBreathSource(initialBpm = 12) {
  const clamp = (value: number) => Math.min(20, Math.max(4, value));
  const initial = Number.isFinite(initialBpm) ? clamp(initialBpm) : 12;
  let snapshot: BreathSnapshot = { bpm: initial, manualBpm: initial, mode: "slider" };
  const listeners = new Set<(bpm: number) => void>();
  function publish(next: BreathSnapshot) {
    if (next.bpm === snapshot.bpm && next.mode === snapshot.mode && next.manualBpm === snapshot.manualBpm) return;
    snapshot = next;
    listeners.forEach((cb) => cb(snapshot.bpm));
  }
  return {
    get mode() { return snapshot.mode; },
    getCurrentBpm: () => snapshot.bpm,
    getSnapshot: () => snapshot,
    subscribe(cb: (bpm: number) => void) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    setManualBpm(bpm: number) {
      if (!Number.isFinite(bpm)) return;
      publish({ bpm: clamp(bpm), manualBpm: clamp(bpm), mode: "slider" });
    },
    setMicBpm(bpm: number | null) {
      const valid = bpm !== null && Number.isFinite(bpm) && bpm >= 4 && bpm <= 20;
      publish({ ...snapshot, bpm: valid ? bpm : snapshot.manualBpm, mode: valid ? "mic" : "slider" });
    },
  } satisfies BreathSource & Record<string, unknown>;
}
