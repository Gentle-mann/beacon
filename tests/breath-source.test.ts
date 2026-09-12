import assert from "node:assert/strict";
import test from "node:test";
import { createBreathSource } from "../lib/breath-source";

test("manual slider is available immediately and bounded to 4–20 BPM", () => {
  const source = createBreathSource();
  assert.equal(source.mode, "slider");
  assert.equal(source.getCurrentBpm(), 12);
  source.setManualBpm(2);
  assert.equal(source.getCurrentBpm(), 4);
  source.setManualBpm(30);
  assert.equal(source.getCurrentBpm(), 20);
  source.setManualBpm(NaN);
  assert.equal(source.getCurrentBpm(), 20);
});

test("invalid or lost mic estimates fall back to the saved manual value", () => {
  const source = createBreathSource(14);
  source.setMicBpm(9);
  assert.equal(source.mode, "mic");
  assert.equal(source.getCurrentBpm(), 9);
  source.setMicBpm(null);
  assert.equal(source.mode, "slider");
  assert.equal(source.getCurrentBpm(), 14);
  source.setMicBpm(Infinity);
  assert.equal(source.mode, "slider");
  source.setMicBpm(50);
  assert.equal(source.getCurrentBpm(), 14);
});

test("moving the slider immediately takes over and subscribers can unsubscribe", () => {
  const source = createBreathSource();
  const seen: number[] = [];
  const unsubscribe = source.subscribe((bpm) => seen.push(bpm));
  source.setMicBpm(12); // Mode changes must notify even at the same BPM.
  source.setManualBpm(16);
  assert.equal(source.mode, "slider");
  assert.deepEqual(seen, [12, 16]);
  unsubscribe();
  source.setManualBpm(18);
  assert.deepEqual(seen, [12, 16]);
});
