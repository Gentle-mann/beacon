import assert from "node:assert/strict";
import test from "node:test";
import { SCENERIES, buildSceneryPrompt, getScenery } from "../lib/sceneries";

test("the catalog keeps the lagoon and maps every generated concept to a reference image", () => {
  assert.equal(SCENERIES.length, 9);
  assert.equal(getScenery("lagoon").image, null);
  for (const scenery of SCENERIES.filter((item) => item.id !== "lagoon")) {
    assert.match(scenery.image ?? "", /^\/scenery-concepts\/.+\.png$/);
    assert.ok(scenery.audioPrompt.length > 20);
  }
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

test("unknown scenery IDs fail closed to the lagoon", () => {
  assert.equal(getScenery("not-a-scene").id, "lagoon");
});
