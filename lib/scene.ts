/**
 * THE TUNING FILE. Hand-edit this; it holds no logic.
 *
 * Everything the model is ever told about the world lives here. The rule that
 * makes prompt morphing work instead of cutting: SETTING and CAMERA must be
 * byte-identical on every single send. Only PHASE changes. If you retype the
 * setting slightly differently between sends, the model treats it as a new
 * scene and you get a cut.
 *
 * Constraints worth remembering while you tune (from the API reference):
 *  - Generation is 832x480 before upscaling. No faces, no text, no fine detail.
 *  - Water, light, sky, landscape. Things that move without needing to be sharp.
 *  - A prompt lands at the next chunk boundary, ~1.8s. Nothing here is instant.
 */

/**
 * THE SEED. Read once at start, so a fixed seed makes a run reproducible.
 *
 * Currently 2026 — building against it.
 *
 * ALTERNATE: 1234 is the calm-validated seed from the 8-seed sweep. It was the
 * only seed that never blew a highlight (peak luma 183 vs 214-255 for every
 * other seed), logged zero flare samples across 28, and its banding fell over
 * the 90s arc (comb 11.47 -> 6.41) instead of climbing. 2026 by contrast peaks
 * at 251 around t=46s with a bright sun column down the beach.
 *
 * Swapping is this one line.
 */
export const SEED = 2026;

/** Sweep results, for when we come back to this. Peak luma / when / banding. */
export const SEED_NOTES = {
  1234: "peak 183@12s, 0 flares, comb 11.47->6.41 — calmest, no sun",
  7: "peak 214@76s, comb 8.63->8.57 — clean ripples, but peaks on the hold",
  555: "peak 255@0s, comb 4.46->5.14 — bright throughout but eventless",
  2026: "peak 251@46s, comb 2.99->3.25 — sun column mid-arc, low banding",
} as const;

/**
 * THE ARC. Shortened from 4 minutes to 90s: image coherence visibly degrades
 * past ~90s (severe streaking by 215s in an unrestated run), so the descent has
 * to finish before the picture rots.
 */
export const ARC = {
  /** Total run, seconds. */
  durationS: 90,
  /** Reach the target rate by here; the remainder is a hold. */
  descentS: 75,
  /** Breaths per minute we are leading toward. */
  targetBpm: 6,
  /** Send a prompt every Nth chunk_complete. Never a wall-clock timer. */
  chunksPerSend: 2,
} as const;

export const SETTING =
  "a wide shallow tidal lagoon at dawn, pale sand below clear water, " +
  "low mist on the far shoreline, soft overcast light";

export const CAMERA =
  "a locked-off wide shot, camera perfectly still, horizon level and low";

/** Closing clause. Also byte-identical every send — it is what buys continuity. */
export const CONTINUITY = "Continuous slow motion, no cuts, a single unbroken take.";

/**
 * PHASES are the only thing that varies. Each is one clause describing the
 * water's motion. They are ordered from fastest/most agitated to slowest/most
 * still, so the entrainment loop at Gate 4 can index into them by breath rate.
 *
 * Keep every phrase the same grammatical shape. The model is steadier when the
 * only thing that changes between two prompts is the adjectives.
 */
export const PHASES = [
  "The water moves in quick shallow ripples, many small crests crossing each other",
  "The ripples lengthen and begin to travel in one direction",
  "Long low swells roll through slowly, one after another",
  "The swells arrive further apart, the surface smoothing between them",
  "The surface is almost still, one slow swell passing through and fading",
  "The water is glassy and barely moves, the mist settling onto it",
] as const;

/**
 * The prompt template. SETTING and CAMERA are interpolated verbatim, never
 * reworded. This is the single place a prompt string is ever built.
 */
export function buildPrompt(phase: string) {
  return `The same ${SETTING}, the same ${CAMERA}. ${phase}. ${CONTINUITY}`;
}

/** The fixed opening prompt. Sent once before start; the arc morphs from here. */
export const OPENING_PROMPT = buildPrompt(PHASES[0]);

/**
 * Where the arc should be at `elapsed` seconds: a linear descent from the
 * breather's own rate to ARC.targetBpm over ARC.descentS, then a hold.
 * Small decrements, never a jump — the point is to be followable.
 */
export function targetRateAt(elapsedS: number, startBpm: number) {
  const t = Math.min(1, Math.max(0, elapsedS / ARC.descentS));
  return startBpm + (ARC.targetBpm - startBpm) * t;
}

/**
 * Pick the phase clause for a given rate. PHASES runs fastest to slowest, so
 * the index walks the list as the target rate comes down.
 */
export function phaseForRate(bpm: number, startBpm: number) {
  const span = Math.max(1e-6, startBpm - ARC.targetBpm);
  const progress = Math.min(1, Math.max(0, (startBpm - bpm) / span));
  const index = Math.min(
    PHASES.length - 1,
    Math.round(progress * (PHASES.length - 1)),
  );
  return { index, phase: PHASES[index] };
}

/**
 * One-sentence SOUND caption, not a scene description (the API reference is
 * explicit about this, and only ~128 tokens are read).
 *
 * UNVERIFIED as a live lever: audio_prompt_accepted is documented as applying
 * "from the next start", which implies it does NOT hot-swap mid-run. Gate 2
 * spends 30 seconds testing that and then either uses it or drops it for good.
 */
export const AUDIO_PROMPT =
  "Slow shallow water lapping over sand, distant and soft, no music, no voices.";
