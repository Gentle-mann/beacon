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
 * Currently 1234 — the calm-validated seed from the 8-seed sweep, and the one
 * picked by eye against 2026. It was the only seed that never blew a highlight
 * (peak luma 183 vs 214-255 for every other seed), logged zero flare samples
 * across 28, and its banding fell over the 90s arc (comb 11.47 -> 6.41) instead
 * of climbing.
 *
 * ALTERNATE: 2026 is prettier and warmer but grows a literal sun on the horizon
 * with a gold reflection column by ~32s — which lands exactly where the arc
 * holds at 6 bpm.
 *
 * Swapping is this one line.
 */
export const SEED = 1234;

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
  "a dense stand of young willow and tall meadow grass filling the frame, " +
  "flat grey overcast sky, no sun, no shadows, soft even light";

export const CAMERA =
  "a locked-off medium-wide shot, camera perfectly still, the foliage filling " +
  "most of the frame";

/** Closing clause. Also byte-identical every send — it is what buys continuity. */
export const CONTINUITY = "Continuous slow motion, no cuts, a single unbroken take.";

/**
 * PHASES are the only thing that varies. Ordered MOST movement to LEAST.
 *
 * THE RESPONSE DIRECTION MATTERS AND IT IS NOT THE OBVIOUS ONE.
 *
 * A fast, anxious breath must NOT be met with a fast, agitated world — that
 * mirrors distress back at the person and makes it worse. It is met instead
 * with soft, living movement: wind through leaves, present and visible so the
 * scene reads as responding, but never busy and never sharp.
 *
 * As the breath slows, the wind drops and the foliage settles toward stillness.
 * Anxiety is met with gentle motion; calm is rewarded with quiet. The scene is
 * calm at BOTH ends of the range — only the amount of movement changes.
 *
 * Foliage rather than water on purpose: leaves are soft mass motion with no
 * fine detail to survive, which is what 832x480 before upscaling can actually
 * hold. Ripples and sharp edges muddy; a moving canopy does not.
 */
export const PHASES = [
  "A steady gentle wind moves through the leaves and grass, the whole mass shifting and turning softly",
  "The wind eases, the foliage moving in slow broad waves that travel across the frame",
  "The movement softens, only the outer leaves and grass heads still turning",
  "The wind drops away, the foliage settling, a few leaves drifting slowly",
  "Almost everything is still, one slow breath of air passing through the grass and fading",
  "The foliage is completely still, the air motionless, nothing moving",
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
  "Soft wind moving through leaves and long grass, distant and gentle, no music, no voices.";
