import {
  advanceEntrainment,
  ARC_DURATION_MS,
  createEntrainmentState,
} from "../lib/entrainment";

/** Runs immediately with synthetic timestamps. It never creates an Orbis session. */
function main() {
  const startBpm = Number(process.argv[2] ?? 18);
  const chunkMs = Number(process.argv[3] ?? 1_960);
  if (!Number.isFinite(chunkMs) || chunkMs <= 0 || chunkMs < 1) {
    throw new RangeError("Chunk duration must be at least 1ms.");
  }
  const startedAtMs = Date.now();
  let state = createEntrainmentState(startBpm, startedAtMs);
  let promptCount = 0;
  console.log(`Offline 90s arc: ${startBpm} BPM, synthetic chunks every ${chunkMs}ms.`);
  for (let chunkIndex = 0; !state.ended; chunkIndex += 1) {
    const timestampMs = startedAtMs + (chunkIndex + 1) * chunkMs;
    const result = advanceEntrainment(state, { chunkIndex, timestampMs });
    state = result.state;
    if (!result.prompt) continue;
    const prompt = result.prompt;
    promptCount += 1;
    console.log(
      `[${new Date(prompt.timestampMs).toISOString()}] ` +
      `t=+${(prompt.elapsedMs / 1_000).toFixed(2)}s chunk=${chunkIndex} ` +
      `target=${prompt.targetBpm.toFixed(2)} BPM phase=${prompt.phase}\n${prompt.text}`,
    );
  }
  console.log(`Arc ended: ${promptCount} prompts; no sends at/after ${ARC_DURATION_MS / 1_000}s.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Usage: npm run simulate:entrainment -- [startBpm=18] [chunkMs=1960]");
  process.exitCode = 1;
}
