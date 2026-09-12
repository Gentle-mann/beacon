import assert from "node:assert/strict";
import test from "node:test";
import { PATIENT_SIGNALS, SCENERIES, buildSceneryPrompt, getScenery, patientSignalForBpm } from "../lib/sceneries";

test("the focused catalog maps both patient signals to reference images", () => {
  assert.equal(SCENERIES.length, 2);
  assert.equal(PATIENT_SIGNALS.length, 2);
  for (const scenery of SCENERIES) {
    assert.match(scenery.image ?? "", /^\/scenery-concepts\/.+\.png$/);
    assert.ok(scenery.audioPrompt.length > 20);
  }
  assert.equal(patientSignalForBpm(18).sceneId, "still-lake");
  assert.equal(patientSignalForBpm(12).sceneId, "willow-breeze");
});

test("pace and phase alter motion while the selected setting and camera remain byte-identical", () => {
  for (const scenery of SCENERIES) {
    const active = buildSceneryPrompt(scenery.id, { motion: "gentle", targetBpm: 16, phase: "inhale" });
    const settled = buildSceneryPrompt(scenery.id, { motion: "gentle", targetBpm: 6, phase: "exhale" });
    const still = buildSceneryPrompt(scenery.id, { motion: "still", targetBpm: 16, phase: null });
    const prefix = `The same ${scenery.setting}, the same ${scenery.camera}.`;
    assert.ok(active.startsWith(prefix));
    assert.ok(settled.startsWith(prefix));
    assert.ok(still.startsWith(prefix));
    assert.notEqual(active, settled);
    assert.match(still, /almost still/i);
    assert.match(active, /single unbroken take/i);
  }
});

test("unknown scenery IDs fall back to the baseline response", () => {
  assert.equal(getScenery("not-a-scene").id, "willow-breeze");
});
