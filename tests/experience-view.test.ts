import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowLiveMedia } from "../lib/experience-view";

test("a manual scene choice keeps the local fallback over a running live stream", () => {
  const runningLive = { mode: "live" as const, status: "running" as const, framesSeen: true };
  assert.equal(shouldShowLiveMedia(runningLive, false), true);
  assert.equal(shouldShowLiveMedia(runningLive, true), false);
});

test("live media remains hidden before frames arrive and outside a live run", () => {
  assert.equal(shouldShowLiveMedia({ mode: "live", status: "running", framesSeen: false }, false), false);
  assert.equal(shouldShowLiveMedia({ mode: "preview", status: "running", framesSeen: true }, false), false);
});
