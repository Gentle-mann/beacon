import assert from "node:assert/strict";
import test from "node:test";
import { BreathDetector, rmsAmplitude } from "../lib/breath-detector";

function feed(detector: BreathDetector, bpm: number, until = 40_000) {
  let reading = detector.update(0, 0);
  for (let at = 50; at <= until; at += 50) {
    const cycle = (at % (60_000 / bpm)) / (60_000 / bpm);
    // One audible airflow envelope per breath, plus a small noise floor.
    const amplitude = 0.003 + (cycle < 0.4 ? 0.07 * Math.sin(cycle / 0.4 * Math.PI) : 0);
    reading = detector.update(amplitude, at);
  }
  return reading;
}

test("RMS measures energy and removes DC offset", () => {
  assert.equal(rmsAmplitude(new Float32Array([0.5, -0.5])), 0.5);
  assert.equal(rmsAmplitude(new Float32Array([0.5, 0.5])), 0);
  assert.equal(rmsAmplitude(new Float32Array()), 0);
});

for (const bpm of [4, 6, 12, 20]) {
  test(`estimates a synthetic ${bpm} BPM envelope over a rolling window`, () => {
    const reading = feed(new BreathDetector(), bpm, 60_000);
    assert.ok(reading.bpm !== null, "needs a usable estimate");
    assert.ok(Math.abs(reading.bpm - bpm) < 0.7, `${reading.bpm} vs ${bpm}`);
  });
}

test("silence, steady noise, and isolated clicks do not become breaths", () => {
  for (const kind of ["silence", "steady", "clicks"]) {
    const detector = new BreathDetector();
    for (let at = 0; at < 40_000; at += 50) {
      const amplitude = kind === "silence" ? 0 : kind === "steady" ? 0.03 : at % 5_000 === 0 ? 0.2 : 0;
      assert.equal(detector.update(amplitude, at).bpm, null, kind);
    }
  }
});

test("stale signal and long sampling gaps invalidate the estimate", () => {
  const detector = new BreathDetector();
  assert.ok(feed(detector, 12).bpm !== null);
  for (let at = 40_050; at <= 55_000; at += 50) detector.update(0, at);
  assert.equal(detector.update(0, 55_050).bpm, null);
  assert.equal(detector.update(0.08, 80_000).bpm, null);
});
