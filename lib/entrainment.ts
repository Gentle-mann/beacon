import { buildPrompt } from "./scene";

export const RAMP_DURATION_MS = 75_000;
export const ARC_DURATION_MS = 90_000;
export const DESTINATION_BPM = 6;

export type BreathPhase = "inhale" | "exhale";

export type EntrainmentPrompt = {
  elapsedMs: number;
  targetBpm: number;
  phase: BreathPhase;
  text: string;
};

export type TimestampedPrompt = EntrainmentPrompt & { timestampMs: number };

export type EntrainmentState = {
  readonly startBpm: number;
  readonly startedAtMs: number;
  readonly lastTimestampMs: number;
  readonly lastChunkIndex: number | null;
  readonly acceptedChunks: number;
  readonly ended: boolean;
};

export type ChunkTick = {
  chunkIndex: number;
  /** Event receipt time in the same clock as startedAtMs, not chunkIndex * 1.96s. */
  timestampMs: number;
};

function assertStartBpm(startBpm: number) {
  if (!Number.isFinite(startBpm) || startBpm <= 0) {
    throw new RangeError("Starting BPM must be a finite positive number.");
  }
}

function arcElapsed(elapsedMs: number) {
  if (!Number.isFinite(elapsedMs)) {
    throw new RangeError("Elapsed time must be finite.");
  }
  return Math.min(ARC_DURATION_MS, Math.max(0, elapsedMs));
}

/** Linear, gradual reduction to six by 75s; rates already below six stay put. */
export function targetRate(startBpm: number, elapsedMs: number): number {
  assertStartBpm(startBpm);
  const progress = Math.min(arcElapsed(elapsedMs) / RAMP_DURATION_MS, 1);
  const destination = Math.min(startBpm, DESTINATION_BPM);
  return startBpm + (destination - startBpm) * progress;
}

/**
 * Integrate rate over time to preserve phase while BPM changes. Using elapsed
 * time * the current rate would rewind the cycle during the downward ramp.
 * Sampling freezes at the end of the 90s arc.
 */
export function integratedBreathCycles(startBpm: number, elapsedMs: number): number {
  assertStartBpm(startBpm);
  const elapsed = arcElapsed(elapsedMs);
  const rampElapsed = Math.min(elapsed, RAMP_DURATION_MS);
  const destination = Math.min(startBpm, DESTINATION_BPM);
  const rampArea = startBpm * rampElapsed +
    ((destination - startBpm) * rampElapsed * rampElapsed) / (2 * RAMP_DURATION_MS);
  const holdArea = destination * Math.max(0, elapsed - RAMP_DURATION_MS);
  return (rampArea + holdArea) / 60_000;
}

/** The first half of each integrated cycle inhales; the second half exhales. */
export function breathPhase(startBpm: number, elapsedMs: number): BreathPhase {
  const cyclePosition = integratedBreathCycles(startBpm, elapsedMs) % 1;
  return cyclePosition < 0.5 ? "inhale" : "exhale";
}

/** Initial phase wording for offline testing; Eni can tune against the locked seed. */
export function phaseClause(phase: BreathPhase): string {
  return phase === "inhale"
    ? "The water slowly rises in a broad gentle swell"
    : "The water slowly recedes, the swell settling and softening";
}

/** A preview sample. Sending and the hard deadline are controlled by advanceEntrainment. */
export function promptAt(startBpm: number, elapsedMs: number): EntrainmentPrompt {
  const elapsed = arcElapsed(elapsedMs);
  const phase = breathPhase(startBpm, elapsed);
  return {
    elapsedMs: elapsed,
    targetBpm: targetRate(startBpm, elapsed),
    phase,
    text: buildPrompt(phaseClause(phase)),
  };
}

/** Start an arc from one captured BPM; do not restart it on each live BPM update. */
export function createEntrainmentState(startBpm: number, startedAtMs: number): EntrainmentState {
  assertStartBpm(startBpm);
  if (!Number.isFinite(startedAtMs)) {
    throw new RangeError("Arc start time must be finite.");
  }
  return {
    startBpm,
    startedAtMs,
    lastTimestampMs: startedAtMs,
    lastChunkIndex: null,
    acceptedChunks: 0,
    ended: false,
  };
}

/**
 * Pure chunk_complete reducer. Pass the real chunk_index and event timestamp.
 * Emit only on every second accepted forward event; lost chunks are never
 * backfilled. Deduplicate replays and reject regressing timestamps/indexes.
 * No timers, SDK, network, or side effects: the caller logs/sends each result.
 * At/after 90s, return no prompt and latch ended, including for stale chunks.
 */
export function advanceEntrainment(
  state: EntrainmentState,
  tick: ChunkTick,
): { state: EntrainmentState; prompt: TimestampedPrompt | null } {
  const ignored = { state, prompt: null };
  if (state.ended || !Number.isFinite(tick.timestampMs)) return ignored;
  const elapsedMs = tick.timestampMs - state.startedAtMs;
  if (elapsedMs >= ARC_DURATION_MS) {
    return { state: { ...state, ended: true }, prompt: null };
  }
  if (
    elapsedMs < 0 ||
    !Number.isSafeInteger(tick.chunkIndex) ||
    tick.chunkIndex < 0 ||
    (state.lastChunkIndex !== null && (
      tick.chunkIndex <= state.lastChunkIndex || tick.timestampMs <= state.lastTimestampMs
    ))
  ) return ignored;

  const next: EntrainmentState = {
    ...state,
    lastTimestampMs: tick.timestampMs,
    lastChunkIndex: tick.chunkIndex,
    acceptedChunks: state.acceptedChunks + 1,
  };
  return {
    state: next,
    prompt: next.acceptedChunks % 2 === 0
      ? { ...promptAt(state.startBpm, elapsedMs), timestampMs: tick.timestampMs }
      : null,
  };
}
