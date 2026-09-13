import assert from "node:assert/strict";
import test from "node:test";
import { BREATH_ACTIVITY_RELEASE_MS, BreathActivityLatch } from "../lib/breath-activity";
import type { BreathReading } from "../lib/breath-detector";

const quiet: BreathReading = {
  envelope: 0.001,
  bpm: null,
  quality: "quiet",
  airflow: "settling",
  speechSuspect: false,
};

test("a clear airflow rise switches immediately and quiet returns after the release window", () => {
  const latch = new BreathActivityLatch();
  assert.equal(latch.update(quiet, 0), "quiet");
  assert.equal(latch.update({ ...quiet, quality: "listening", airflow: "rising" }, 100), "active");
  assert.equal(latch.update(quiet, 100 + BREATH_ACTIVITY_RELEASE_MS - 1), "active");
  assert.equal(latch.update(quiet, 100 + BREATH_ACTIVITY_RELEASE_MS), "quiet");
});

test("repeated fast breaths extend the cloud scene without flicker", () => {
  const latch = new BreathActivityLatch();
  const rise = { ...quiet, quality: "listening", airflow: "rising" } as const;
  assert.equal(latch.update(rise, 2_000), "active");
  assert.equal(latch.update(rise, 4_500), "active");
  assert.equal(latch.update(quiet, 7_299), "active");
  assert.equal(latch.update(quiet, 7_300), "quiet");
});

test("calibration and speech-like sustained sound cannot activate the cue", () => {
  const latch = new BreathActivityLatch();
  assert.equal(latch.update({ ...quiet, quality: "calibrating", airflow: "rising" }, 100), "quiet");
  assert.equal(latch.update({ ...quiet, quality: "listening", airflow: "rising", speechSuspect: true }, 200), "quiet");
});
