import assert from "node:assert/strict";
import test from "node:test";
import { createExperienceController, type ExperienceTransport } from "../lib/experience-controller";
import type { SceneryId } from "../lib/sceneries";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let now = 1_000;
  let id = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const commands: { name: string; data: Record<string, unknown> }[] = [];
  let closes = 0;
  let reconnects = 0;
  let closeConfirmed = true;
  const transport: ExperienceTransport = {
    connect: async () => { controller.onTransportStatus("ready"); },
    reconnect: async () => { reconnects++; controller.onTransportStatus("ready"); },
    close: async () => { closes++; return closeConfirmed; },
    prepareImage: async () => { controller.onMessage({ type: "state", has_image: true }); return undefined; },
    sendCommand: async (name, data) => {
      commands.push({ name, data });
      if (name === "set_prompt") controller.onMessage({ type: "conditions_ready" });
      if (name === "start") controller.onMessage({ type: "generation_started" });
      return undefined;
    },
  };
  const controller = createExperienceController(transport, {
    now: () => now,
    setTimeout: (run, delay) => { const key = ++id; timers.set(key, { at: now + delay, run }); return key; },
    clearTimeout: (key) => { timers.delete(key as number); },
  });
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at).find((entry) => entry[1].at <= end);
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].run();
      await flush();
    }
    now = end;
    await flush();
  }
  const start = (sceneId: SceneryId = "still-lake") => controller.start({ mode: "live", seed: 123, startBpm: 18, sceneId });
  return { controller, transport, commands, start, advance, closes: () => closes, reconnects: () => reconnects, unconfirmed: () => { closeConfirmed = false; } };
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

test("arms with supplied seed, catches synchronous conditions event, and needs model start truth", async () => {
  const f = fixture();
  await f.start("willow-breeze");
  assert.equal(f.controller.getSnapshot().status, "running");
  assert.deepEqual(f.commands.map((item) => item.name), ["set_seed", "set_audio_prompt", "set_prompt", "start"]);
  assert.equal(f.commands[0].data.seed, 123);
  assert.equal(f.controller.getSnapshot().guideEnabled, false);
  assert.equal(f.controller.getSnapshot().sceneId, "willow-breeze");
  assert.match(String(f.commands.find((item) => item.name === "set_prompt")?.data.prompt), /clear mature healthy green willow/i);
});

test("reference-image conditioning completes before live scene commands", async () => {
  const f = fixture();
  const sequence: string[] = [];
  const imageReady = deferred<void>();
  f.transport.prepareImage = async (asset) => {
    sequence.push(`image:${asset.name}`);
    await imageReady.promise;
    f.controller.onMessage({ type: "state", has_image: true });
  };
  const original = f.transport.sendCommand;
  f.transport.sendCommand = async (name, data) => { sequence.push(name); return original(name, data); };
  const starting = f.start("willow-breeze");
  await flush();
  assert.deepEqual(sequence, ["image:willow-breeze-v2.png"]);
  imageReady.resolve();
  await starting;
  assert.deepEqual(sequence, ["image:willow-breeze-v2.png", "set_seed", "set_audio_prompt", "set_prompt", "start"]);
});

test("a state snapshot from before set_image cannot satisfy image conditioning", async () => {
  const f = fixture();
  f.transport.connect = async () => {
    f.controller.onMessage({ type: "state", has_image: true });
    f.controller.onTransportStatus("ready");
  };
  f.transport.prepareImage = async () => ({ type: "image_accepted" });
  const starting = f.start("willow-breeze");
  await flush();
  assert.equal(f.commands.length, 0);
  f.controller.onMessage({ type: "state", has_image: true });
  await starting;
  assert.equal(f.commands.at(-1)?.name, "start");
});

test("an explicit unconditioned start falls back instead of claiming the selected image is live", async () => {
  const f = fixture();
  const original = f.transport.sendCommand;
  f.transport.sendCommand = async (name, data) => {
    if (name === "start") {
      f.commands.push({ name, data });
      f.controller.onMessage({ type: "generation_started", image_conditioned: false });
      return;
    }
    return original(name, data);
  };
  await f.start("willow-breeze");
  await flush();
  assert.equal(f.controller.getSnapshot().status, "fallback");
  assert.match(f.controller.getSnapshot().error ?? "", /without the selected image/i);
});

test("deadline closes the session at 90s even when no chunk ever arrives", async () => {
  const f = fixture(); await f.start();
  await f.advance(89_999);
  assert.equal(f.closes(), 0);
  await f.advance(1);
  assert.equal(f.closes(), 1);
  assert.equal(f.controller.getSnapshot().status, "completed");
  assert.equal(f.controller.getSnapshot().elapsedMs, 90_000);
});

test("only unique real chunk events drive prompts, and scene preferences preserve the template", async () => {
  const f = fixture(); await f.start();
  f.controller.setGuide(true);
  f.controller.setMotion("still");
  for (const index of [0, 0, 1, 1, 4, -1, NaN, 3, 5]) {
    await f.advance(100);
    f.controller.onMessage({ type: "chunk_complete", chunk_index: index, frames_emitted: 33 });
    await flush();
    f.controller.onMessage({ type: "state", current_chunk: 500 });
  }
  const prompts = f.commands.filter((command) => command.name === "set_prompt");
  assert.equal(prompts.length, 3); // opening + accepted events 2 and 4
  assert.ok(prompts.every((item) => String(item.data.prompt).startsWith("The same wide mist-covered mountain lake")));
  assert.match(String(prompts.at(-1)!.data.prompt), /almost still/);
});

test("a running session accepts a new patient scene for the next generated prompt", async () => {
  const f = fixture(); await f.start("willow-breeze");
  f.controller.setScene("still-lake");
  assert.equal(f.controller.getSnapshot().sceneId, "still-lake");
  f.controller.onMessage({ type: "chunk_complete", chunk_index: 0, frames_emitted: 33 });
  f.controller.onMessage({ type: "chunk_complete", chunk_index: 1, frames_emitted: 33 });
  await flush();
  const prompts = f.commands.filter((command) => command.name === "set_prompt");
  assert.match(String(prompts.at(-1)!.data.prompt), /mist-covered mountain lake/i);
});

test("Stop invalidates a late connection so it can never arm or start", async () => {
  const f = fixture(); const connecting = deferred<void>();
  f.transport.connect = () => connecting.promise;
  const start = f.start();
  await flush(); await f.controller.stop();
  f.controller.onTransportStatus("ready"); connecting.resolve();
  await start; await flush();
  assert.equal(f.commands.length, 0);
  assert.ok(f.closes() >= 2, "late connection is cleaned again");
  assert.equal(f.controller.getSnapshot().status, "stopped");
});

test("startup timeout and errors do not masquerade as a running scene", async () => {
  const f = fixture(); const connecting = deferred<void>();
  f.transport.connect = () => connecting.promise;
  void f.start(); await f.advance(30_000);
  assert.equal(f.controller.getSnapshot().status, "fallback");
  assert.ok(f.closes() > 0);
  connecting.resolve(); await flush();
  assert.equal(f.commands.length, 0);

  const g = fixture();
  g.transport.sendCommand = async () => undefined;
  void g.start(); await flush();
  g.controller.onError("set_seed failed"); await flush();
  assert.equal(g.controller.getSnapshot().status, "fallback");
});

test("loss of ready recovers the same arc without a new seed or deadline", async () => {
  const f = fixture(); await f.start(); await f.advance(80_000);
  f.controller.onTransportStatus("waiting"); await flush();
  assert.equal(f.controller.getSnapshot().status, "recovering");
  f.controller.onMessage({ type: "chunk_complete", chunk_index: 40, frames_emitted: 33 });
  await flush();
  assert.equal(f.controller.getSnapshot().status, "running");
  assert.equal(f.reconnects(), 1);
  assert.equal(f.commands.filter((command) => command.name === "set_seed").length, 1);
  await f.advance(10_000);
  assert.equal(f.controller.getSnapshot().status, "completed");
});

test("a stuck reconnect never queues more reconnects and falls back within 12s", async () => {
  const f = fixture(); await f.start();
  const pending = deferred<void>(); let attempts = 0;
  f.transport.reconnect = () => { attempts++; return pending.promise; };
  f.controller.onTransportStatus("connecting");
  await f.advance(12_000);
  assert.equal(attempts, 1);
  assert.equal(f.controller.getSnapshot().status, "fallback");
  pending.resolve(); f.controller.onTransportStatus("ready"); await flush();
  assert.equal(f.controller.getSnapshot().status, "fallback");
});

test("unconfirmed cleanup blocks a new start and can be retried", async () => {
  const f = fixture(); await f.start(); f.unconfirmed();
  await f.controller.stop();
  assert.equal(f.controller.getSnapshot().cleanupPending, true);
  await f.start();
  assert.equal(f.commands.filter((command) => command.name === "start").length, 1);
});

test("Stop during preparation ignores a late conditions event", async () => {
  const f = fixture();
  f.transport.sendCommand = async (name, data) => { f.commands.push({ name, data }); return undefined; };
  const start = f.start(); await flush();
  assert.equal(f.controller.getSnapshot().status, "preparing");
  await f.controller.stop();
  f.controller.onMessage({ type: "conditions_ready" });
  await start;
  assert.equal(f.commands.filter((item) => item.name === "start").length, 0);
});

test("a rejected preparation command from an old run cannot close the new run", async () => {
  const f = fixture();
  const original = f.transport.sendCommand;
  let reject!: (error: Error) => void;
  f.transport.sendCommand = () => new Promise((_, fail) => { reject = fail; });
  const oldStart = f.start(); await flush();
  await f.controller.stop();
  f.transport.sendCommand = original;
  await f.start();
  reject(new Error("Late command failure")); await oldStart;
  assert.equal(f.controller.getSnapshot().status, "running");
  assert.equal(f.closes(), 1, "only the old run should have been closed");
});

test("the deadline starts at dispatch, and delayed generation truth never extends it", async () => {
  const f = fixture();
  const command = f.transport.sendCommand;
  f.transport.sendCommand = (name, data) => name === "start" ? Promise.resolve(undefined) : command(name, data);
  await f.start();
  assert.equal(f.controller.getSnapshot().status, "preparing");
  await f.advance(10_000);
  f.controller.onMessage({ type: "generation_started" });
  await f.advance(80_000);
  assert.equal(f.controller.getSnapshot().status, "completed");
  assert.equal(f.closes(), 1);
});

test("early completion and reset close the session without claiming a full 90 seconds", async () => {
  for (const type of ["generation_complete", "generation_reset"]) {
    const f = fixture(); await f.start(); await f.advance(10_000);
    f.controller.onMessage({ type }); await flush();
    assert.equal(f.controller.getSnapshot().status, "fallback");
    assert.equal(f.controller.getSnapshot().elapsedMs, 10_000);
    assert.match(f.controller.getSnapshot().error ?? "", /ended early/);
    assert.equal(f.closes(), 1);
    await f.advance(90_000);
    assert.equal(f.controller.getSnapshot().status, "fallback");
  }
});

test("rapid chunks keep only one latest pending prompt and Stop discards it", async () => {
  const f = fixture(); await f.start();
  const pending = deferred<unknown>();
  f.transport.sendCommand = (name, data) => { f.commands.push({ name, data }); return pending.promise; };
  for (let index = 0; index < 10; index++) {
    await f.advance(100);
    f.controller.onMessage({ type: "chunk_complete", chunk_index: index, frames_emitted: 33 });
  }
  assert.equal(f.commands.filter((item) => item.name === "set_prompt").length, 2);
  await f.controller.stop(); pending.resolve(undefined); await flush();
  assert.equal(f.commands.filter((item) => item.name === "set_prompt").length, 2);
});

test("an old pending prompt cannot release or drain a newer run's prompt queue", async () => {
  const f = fixture();
  const normalSend = f.transport.sendCommand;
  const oldReply = deferred<unknown>();
  const newReply = deferred<unknown>();
  const prompts = () => f.commands.filter((item) => item.name === "set_prompt");
  const chunk = async (index: number) => {
    await f.advance(100);
    f.controller.onMessage({ type: "chunk_complete", chunk_index: index, frames_emitted: 33 });
    await flush();
  };

  await f.start();
  f.transport.sendCommand = (name, data) => {
    f.commands.push({ name, data });
    return oldReply.promise;
  };
  await chunk(0); await chunk(1);
  assert.equal(prompts().length, 2, "old run has an opening and an unresolved update");

  // Scoped server cleanup can finish before the old SDK command promise settles.
  await f.controller.stop();
  f.transport.sendCommand = normalSend;
  await f.start();
  f.transport.sendCommand = (name, data) => {
    f.commands.push({ name, data });
    return newReply.promise;
  };
  await chunk(0); await chunk(1);
  f.controller.setMotion("still");
  await chunk(2); await chunk(3);
  assert.equal(prompts().length, 4, "new run has one unresolved update and one queued replacement");

  oldReply.resolve(undefined);
  await flush();
  assert.equal(prompts().length, 4, "old completion must not drain the newer run's queue");

  f.controller.setMotion("gentle");
  f.controller.setGuide(true);
  await chunk(4); await chunk(5);
  assert.equal(prompts().length, 4, "old completion must not release the newer run's busy lock");

  newReply.resolve(undefined);
  await flush();
  assert.equal(prompts().length, 5, "only the newer command completion may send the latest replacement");
  assert.match(String(prompts().at(-1)!.data.prompt), /ripple/);
  assert.match(String(prompts().at(-1)!.data.prompt), /The mist/);
  assert.equal(f.controller.getSnapshot().status, "running");
  await f.controller.stop();
});
