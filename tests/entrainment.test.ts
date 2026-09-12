import assert from "node:assert/strict";
import test from "node:test";
import { buildPrompt, CAMERA, CONTINUITY, SETTING } from "../lib/scene";
import {
  advanceEntrainment,
  ARC_DURATION_MS,
  breathPhase,
  createEntrainmentState,
  integratedBreathCycles,
  phaseClause,
  promptAt,
  targetRate,
} from "../lib/entrainment";

const close = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test("rate starts at measured BPM, decreases smoothly to six at 75s, then holds", () => {
  assert.equal(targetRate(18, 0), 18);
  assert.equal(targetRate(18, 37_500), 12);
  assert.equal(targetRate(18, 75_000), 6);
  assert.equal(targetRate(18, 90_000), 6);
  assert.equal(targetRate(18, 100_000), 6);
  assert.equal(targetRate(18, -1), 18);
  let previous = targetRate(18, 0);
  for (let elapsed = 100; elapsed <= 90_000; elapsed += 100) {
    const rate = targetRate(18, elapsed);
    assert.ok(rate <= previous && rate >= 6);
    assert.ok(previous - rate < 0.017);
    previous = rate;
  }
});

test("a person already below six BPM is never guided upward", () => {
  for (const start of [4, 5.5, 6]) {
    for (const elapsed of [0, 1_000, 37_500, 75_000, 90_000]) {
      assert.equal(targetRate(start, elapsed), start);
    }
  }
});

test("phase accumulates the changing rate and stays continuous at the ramp boundary", () => {
  // Integral of a linear 18→6 ramp: 12 BPM * 1.25 minutes = 15 cycles.
  close(integratedBreathCycles(18, 37_500), 9.375);
  close(integratedBreathCycles(18, 75_000), 15);
  close(integratedBreathCycles(18, 90_000), 16.5);
  close(integratedBreathCycles(18, 100_000), 16.5);
  close(integratedBreathCycles(18, 75_001) - integratedBreathCycles(18, 74_999), 0.0002, 1e-8);
  // Multiplying current rate by elapsed would give 7.5 cycles here, the wrong phase.
  assert.equal(breathPhase(18, 37_500), "inhale");
  assert.equal(breathPhase(6, 4_999), "inhale");
  assert.equal(breathPhase(6, 5_000), "exhale");
  assert.equal(breathPhase(6, 10_000), "inhale");
});

test("only phase clauses vary; prompts use the scene's canonical template", () => {
  const inhale = promptAt(6, 0);
  const exhale = promptAt(6, 5_000);
  assert.equal(inhale.text, buildPrompt(phaseClause("inhale")));
  assert.equal(exhale.text, buildPrompt(phaseClause("exhale")));
  assert.notEqual(inhale.text, exhale.text);
  for (const prompt of [inhale, exhale]) {
    assert.ok(prompt.text.startsWith(`The same ${SETTING}, the same ${CAMERA}. `));
    assert.ok(prompt.text.endsWith(CONTINUITY));
  }
});

test("only every second valid forward chunk produces a timestamped prompt", () => {
  const initial = createEntrainmentState(18, 10_000);
  const first = advanceEntrainment(initial, { chunkIndex: 0, timestampMs: 11_960 });
  assert.equal(first.prompt, null);
  assert.equal(initial.acceptedChunks, 0, "the reducer must not mutate old state");
  const duplicate = advanceEntrainment(first.state, { chunkIndex: 0, timestampMs: 12_000 });
  assert.equal(duplicate.state, first.state);
  assert.equal(duplicate.prompt, null);
  const second = advanceEntrainment(duplicate.state, { chunkIndex: 1, timestampMs: 13_920 });
  assert.equal(second.state.acceptedChunks, 2);
  assert.equal(second.prompt?.timestampMs, 13_920);
  assert.equal(second.prompt?.elapsedMs, 3_920);
  assert.equal(second.prompt?.targetBpm, targetRate(18, 3_920));
  assert.equal(second.prompt?.text, promptAt(18, 3_920).text);
});

test("invalid indexes, out-of-order timestamps, and stale chunks cannot advance cadence", () => {
  let state = createEntrainmentState(12, 1_000);
  state = advanceEntrainment(state, { chunkIndex: 4, timestampMs: 3_000 }).state;
  for (const tick of [
    { chunkIndex: 3, timestampMs: 4_000 },
    { chunkIndex: 5, timestampMs: 2_000 },
    { chunkIndex: 5, timestampMs: 3_000 },
    { chunkIndex: 5, timestampMs: Number.NaN },
    { chunkIndex: -1, timestampMs: 4_000 },
    { chunkIndex: 5.5, timestampMs: 4_000 },
  ]) {
    const result = advanceEntrainment(state, tick);
    assert.equal(result.state, state);
    assert.equal(result.prompt, null);
  }
  const next = advanceEntrainment(state, { chunkIndex: 9, timestampMs: 5_000 });
  assert.equal(next.state.acceptedChunks, 2, "missing chunks do not create extra sends");
  assert.ok(next.prompt);
});

test("irregular chunks sample real elapsed time without assuming a fixed generation interval", () => {
  let state = createEntrainmentState(18, 50_000);
  state = advanceEntrainment(state, { chunkIndex: 10, timestampMs: 52_500 }).state;
  const delayed = advanceEntrainment(state, { chunkIndex: 11, timestampMs: 62_345 });
  assert.equal(delayed.prompt?.elapsedMs, 12_345);
  assert.equal(delayed.prompt?.targetBpm, targetRate(18, 12_345));
  assert.equal(delayed.prompt?.phase, breathPhase(18, 12_345));
  assert.equal(delayed.state.acceptedChunks, 2);
});

test("exactly 90 seconds and all later events stop the arc without emitting", () => {
  let state = createEntrainmentState(18, 1_000);
  state = advanceEntrainment(state, { chunkIndex: 0, timestampMs: 2_960 }).state;
  const end = advanceEntrainment(state, { chunkIndex: 1, timestampMs: 91_000 });
  assert.equal(end.state.ended, true);
  assert.equal(end.prompt, null, "the second chunk must not send at the hard limit");
  assert.equal(advanceEntrainment(end.state, { chunkIndex: 2, timestampMs: 95_000 }).prompt, null);
  assert.equal(advanceEntrainment(end.state, { chunkIndex: 2, timestampMs: 5_000 }).state, end.state);
  const staleEnd = advanceEntrainment(state, { chunkIndex: 0, timestampMs: 92_000 });
  assert.equal(staleEnd.state.ended, true, "the deadline still applies to duplicate chunks");
});

test("offline 1.96-second chunk stream emits 22 prompts and stops before 90 seconds", () => {
  let state = createEntrainmentState(18, 0);
  const prompts = [];
  for (let chunkIndex = 0; chunkIndex < 50; chunkIndex += 1) {
    const result = advanceEntrainment(state, { chunkIndex, timestampMs: (chunkIndex + 1) * 1_960 });
    state = result.state;
    if (result.prompt) prompts.push(result.prompt);
  }
  assert.equal(prompts.length, 22);
  assert.equal(prompts[0].elapsedMs, 3_920);
  assert.equal(prompts.at(-1)?.elapsedMs, 86_240);
  assert.ok(prompts.every((prompt) => prompt.elapsedMs < ARC_DURATION_MS));
  assert.deepEqual([...new Set(prompts.map((prompt) => prompt.phase))].sort(), ["exhale", "inhale"]);
  assert.equal(state.ended, true);
});

test("invalid initial inputs fail explicitly and bad chunk timestamps are ignored", () => {
  for (const bpm of [0, -1, Number.NaN, Infinity]) {
    assert.throws(() => createEntrainmentState(bpm, 0), RangeError);
  }
  assert.throws(() => targetRate(12, Number.NaN), RangeError);
  assert.throws(() => createEntrainmentState(12, Number.NaN), RangeError);
  const state = createEntrainmentState(12, 1_000);
  assert.equal(advanceEntrainment(state, { chunkIndex: 0, timestampMs: 999 }).state, state);
  assert.equal(advanceEntrainment(state, { chunkIndex: 0, timestampMs: Infinity }).state, state);
});
