import { advanceEntrainment, ARC_DURATION_MS, createEntrainmentState, promptAt, type EntrainmentState } from "./entrainment";
import { chunkIndexOf, unwrapOrbisMessage } from "./orbis";
import { buildSceneryPrompt, getScenery, type SceneryId } from "./sceneries";

export type ExperienceStatus = "idle" | "connecting" | "preparing" | "running" | "recovering" | "stopping" | "completed" | "stopped" | "fallback";
export type ExperienceMode = "preview" | "live";
export type ExperienceMotion = "gentle" | "still";
export type ExperiencePrompt = { at: number; text: string; source: string; chunkIndex: number | null; outcome: "pending" | "accepted" | "error" };
export type ExperienceSnapshot = {
  status: ExperienceStatus;
  mode: ExperienceMode;
  elapsedMs: number;
  startBpm: number;
  sceneId: SceneryId;
  guideEnabled: boolean;
  motion: ExperienceMotion;
  framesSeen: boolean;
  error: string | null;
  cleanupPending: boolean;
  promptLog: ExperiencePrompt[];
};
export type ExperienceTransport = {
  connect(): Promise<void>;
  reconnect(): Promise<void>;
  prepareImage(asset: { url: string; name: string }): Promise<unknown>;
  sendCommand(name: string, data: Record<string, unknown>): Promise<unknown>;
  /** Must close owned server sessions independently of a blocked SDK queue. */
  close(): Promise<boolean>;
};
export type ExperienceClock = {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(id: unknown): void;
};
const defaultClock: ExperienceClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
function signal() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => { resolve = done; });
  return { resolve, promise };
}

/** A bounded session, shared by the actual Reactor adapter and offline fixture. */
export function createExperienceController(transport: ExperienceTransport, clock: ExperienceClock = defaultClock) {
  let snapshot: ExperienceSnapshot = { status: "idle", mode: "preview", elapsedMs: 0, startBpm: 12, sceneId: "willow-breeze", guideEnabled: false, motion: "gentle", framesSeen: false, error: null, cleanupPending: false, promptLog: [] };
  const listeners = new Set<() => void>();
  const timers = new Set<unknown>();
  let epoch = 0;
  let active = false;
  let arc: EntrainmentState | null = null;
  let rawStatus = "disconnected";
  let ready = signal();
  let imageReady = signal();
  let conditions = signal();
  let startupTimer: unknown;
  let recoveryTimer: unknown;
  let recoverySequence = 0;
  let pendingLifecycle = 0;
  let endStatus: ExperienceStatus = "stopped";
  let promptBusy = false;
  let queuedPrompt: { text: string; source: string; chunkIndex: number | null; epoch: number } | null = null;

  function publish(change: Partial<ExperienceSnapshot>) {
    snapshot = { ...snapshot, ...change };
    listeners.forEach((listener) => listener());
  }
  function later(callback: () => void, delay: number) {
    const id = clock.setTimeout(() => { timers.delete(id); callback(); }, delay);
    timers.add(id);
    return id;
  }
  function cancel(id: unknown) { clock.clearTimeout(id); timers.delete(id); }
  const valid = (id: number) => active && epoch === id;
  function currentElapsed() { return arc ? Math.min(ARC_DURATION_MS, Math.max(0, clock.now() - arc.startedAtMs)) : 0; }
  function scenePrompt(elapsed: number) {
    const timing = promptAt(snapshot.startBpm, elapsed);
    return buildSceneryPrompt(snapshot.sceneId, {
      motion: snapshot.motion,
      targetBpm: timing.targetBpm,
      phase: snapshot.guideEnabled ? timing.phase : null,
    });
  }

  async function cleanup(id: number) {
    // A late failure from an old start may arrive after a new run has begun.
    if (id !== epoch || active) return;
    let confirmed = false;
    try { confirmed = await transport.close(); } catch { /* The UI preserves unconfirmed cleanup. */ }
    if (id !== epoch || active) return;
    publish({
      status: endStatus,
      cleanupPending: !confirmed || pendingLifecycle > 0,
      error: !confirmed ? "Live-session closure is not confirmed. Retry Stop; the provider duration limit remains the backstop." : snapshot.error,
    });
  }

  async function finish(status: ExperienceStatus, error: string | null = null) {
    if (!active && !snapshot.cleanupPending) return;
    active = false;
    const id = ++epoch;
    endStatus = status;
    recoverySequence++;
    queuedPrompt = null;
    ready.resolve(false);
    imageReady.resolve(false);
    conditions.resolve(false);
    for (const timer of timers) clock.clearTimeout(timer);
    timers.clear();
    publish({ status: "stopping", framesSeen: false, elapsedMs: currentElapsed(), error, cleanupPending: true });
    await cleanup(id);
  }

  async function command(name: string, data: Record<string, unknown>, id: number) {
    if (!valid(id)) return false;
    const result = await transport.sendCommand(name, data);
    if (!valid(id)) return false;
    if (result) onMessage(result);
    return valid(id);
  }

  async function sendPrompt(text: string, source: string, chunkIndex: number | null, id: number) {
    if (!valid(id)) return;
    if (promptBusy) { queuedPrompt = { text, source, chunkIndex, epoch: id }; return; }
    promptBusy = true;
    const entry: ExperiencePrompt = { at: clock.now(), text, source, chunkIndex, outcome: "pending" };
    publish({ promptLog: [...snapshot.promptLog, entry].slice(-100) });
    try {
      await command("set_prompt", { prompt: text }, id);
    } catch (error) {
      if (valid(id)) {
        publish({ promptLog: snapshot.promptLog.map((item) => item === entry ? { ...item, outcome: "error" } : item) });
        void finish("fallback", error instanceof Error ? error.message : "The scene could not update.");
      }
    } finally {
      // A reply from a closed run must not release/drain the next run's queue.
      if (id === epoch) {
        promptBusy = false;
        const queued = queuedPrompt;
        queuedPrompt = null;
        if (queued && valid(queued.epoch) && rawStatus === "ready" && currentElapsed() < ARC_DURATION_MS) {
          void sendPrompt(queued.text, queued.source, queued.chunkIndex, queued.epoch);
        }
      }
    }
  }

  function pulse(id: number) {
    if (!valid(id)) return;
    const elapsedMs = currentElapsed();
    publish({ elapsedMs });
    if (arc && elapsedMs >= ARC_DURATION_MS) { void finish("completed"); return; }
    later(() => pulse(id), 100);
  }

  async function start(options: { mode: ExperienceMode; seed: number | null; startBpm: number; sceneId: SceneryId }) {
    if (active || snapshot.cleanupPending || pendingLifecycle) return;
    if (options.mode === "live" && (!Number.isSafeInteger(options.seed) || options.seed === null || options.seed < 0)) {
      publish({ status: "fallback", error: "A locked seed is required before starting live video." });
      return;
    }
    const id = ++epoch;
    active = true;
    rawStatus = "disconnected";
    arc = null;
    ready = signal(); imageReady = signal(); conditions = signal();
    promptBusy = false; queuedPrompt = null;
    const scenery = getScenery(options.sceneId);
    publish({ status: "connecting", mode: options.mode, sceneId: scenery.id, startBpm: Math.min(20, Math.max(4, Number.isFinite(options.startBpm) ? options.startBpm : 12)), elapsedMs: 0, framesSeen: false, promptLog: [], cleanupPending: false, error: null });
    startupTimer = later(() => { if (valid(id)) void finish("fallback", "The scene took too long to start. You can keep using the calm preview."); }, 30_000);
    pulse(id);
    pendingLifecycle++;
    try {
      try { await transport.connect(); }
      finally { pendingLifecycle--; }
      if (!valid(id)) { await cleanup(epoch); return; }
      if (!await ready.promise || !valid(id)) return;
      publish({ status: "preparing" });
      if (scenery.image && scenery.imageName) {
        // A connection snapshot can arrive before set_image. Only a state
        // emitted after this point may confirm the selected reference image.
        imageReady = signal();
        const result = await transport.prepareImage({ url: scenery.image, name: scenery.imageName });
        if (!valid(id)) return;
        if (result) onMessage(result);
        if (!await imageReady.promise || !valid(id)) return;
      }
      if (!await command("set_seed", { seed: options.seed ?? 0 }, id)) return;
      if (!await command("set_audio_prompt", { prompt: scenery.audioPrompt }, id)) return;
      // Install conditions signal before dispatch: replies may arrive synchronously.
      await sendPrompt(scenePrompt(0), `${options.mode}:opening`, null, id);
      if (!valid(id) || !await conditions.promise || !valid(id)) return;
      arc = createEntrainmentState(snapshot.startBpm, clock.now());
      later(() => { if (valid(id)) void finish("completed"); }, ARC_DURATION_MS);
      // The deadline begins before dispatch. Delayed acknowledgement never extends it.
      await command("start", {}, id);
      // Running is established only by generation_started / state.started.
    } catch (error) {
      if (valid(id)) await finish("fallback", error instanceof Error ? error.message : "Could not start the scene.");
      else await cleanup(epoch);
    }
  }

  function confirmRunning() {
    if (!active || !arc || rawStatus !== "ready") return;
    cancel(startupTimer);
    cancel(recoveryTimer);
    recoverySequence++;
    publish({ status: "running", error: null });
  }

  function recover() {
    if (!active || !arc || snapshot.status === "recovering") return;
    const id = epoch;
    const sequence = ++recoverySequence;
    queuedPrompt = null;
    publish({ status: "recovering", framesSeen: false });
    recoveryTimer = later(() => {
      if (valid(id) && snapshot.status === "recovering") void finish("fallback", "The connection could not recover. The calm scene remains available.");
    }, 12_000);
    const attempt = async (number: number) => {
      if (!valid(id) || sequence !== recoverySequence || snapshot.status !== "recovering") return;
      pendingLifecycle++;
      try {
        // A never-settling reconnect is NOT followed by another queued reconnect.
        await transport.reconnect();
      } catch { /* A settled rejection can retry within the overall deadline. */ }
      finally { pendingLifecycle--; }
      if (!valid(id)) { await cleanup(epoch); return; }
      if (sequence !== recoverySequence || snapshot.status !== "recovering" || rawStatus === "ready") return;
      if (number < 3) later(() => { void attempt(number + 1); }, number * 500);
      else void finish("fallback", "The connection could not recover. The calm scene remains available.");
    };
    void attempt(1);
  }

  function onTransportStatus(status: string) {
    const previous = rawStatus;
    rawStatus = status;
    if (!active) return;
    if (status === "ready") { ready.resolve(true); return; }
    if (arc && previous === "ready") recover();
  }

  function onMessage(raw: unknown) {
    if (!active) return;
    const message = unwrapOrbisMessage(raw);
    if (!message?.type) return;
    if (message.type === "state" && message.has_image === true) imageReady.resolve(true);
    if (message.type === "conditions_ready") conditions.resolve(true);
    if (message.type === "prompt_accepted") {
      const index = snapshot.promptLog.findIndex((entry) => entry.outcome === "pending" && (typeof message.prompt !== "string" || entry.text === message.prompt));
      if (index >= 0) publish({ promptLog: snapshot.promptLog.map((entry, i) => i === index ? { ...entry, outcome: "accepted" } : entry) });
    }
    if (message.type === "command_error") {
      // Provider payloads can contain connection details. Keep them out of the patient UI.
      void finish("fallback", "The live scene could not apply an update. You can continue with the calm preview.");
      return;
    }
    if (message.type === "generation_started" && getScenery(snapshot.sceneId).image && message.image_conditioned === false) {
      void finish("fallback", "The live scene started without the selected image. The local reference view is still available.");
      return;
    }
    if (message.type === "generation_started" || message.type === "generation_resumed" || message.type === "state" && message.started === true) confirmRunning();
    if (message.type === "generation_complete" || message.type === "generation_reset") {
      if (arc && currentElapsed() >= ARC_DURATION_MS) void finish("completed");
      else void finish("fallback", "The live scene ended early. The calm preview is still available.");
      return;
    }
    if (message.type !== "chunk_complete" || !arc || rawStatus !== "ready") return;
    const index = chunkIndexOf(message);
    if (index === null || !Number.isSafeInteger(index) || index < 0) return;
    if ((message.frames_emitted ?? 0) > 0) {
      if (snapshot.status === "recovering") confirmRunning();
      publish({ framesSeen: true });
    }
    if (snapshot.status !== "running") return;
    const result = advanceEntrainment(arc, { chunkIndex: index, timestampMs: clock.now() });
    arc = result.state;
    if (arc.ended) { void finish("completed"); return; }
    if (result.prompt) void sendPrompt(scenePrompt(result.prompt.elapsedMs), `${snapshot.mode}:${snapshot.guideEnabled ? "guide" : "preference"}`, index, epoch);
  }

  function onError(message: string) {
    if (!active || snapshot.status === "recovering") return;
    void finish("fallback", message || "The live scene is unavailable. The calm preview is still here.");
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
    stop: () => finish("stopped", snapshot.cleanupPending ? snapshot.error : null),
    dispose: () => { void finish("stopped"); },
    setGuide: (enabled: boolean) => publish({ guideEnabled: enabled }),
    setMotion: (motion: ExperienceMotion) => publish({ motion }),
    setScene: (sceneId: SceneryId) => {
      if (snapshot.cleanupPending || active && !["running", "recovering"].includes(snapshot.status)) return;
      const nextSceneId = getScenery(sceneId).id;
      if (snapshot.sceneId === nextSceneId) return;
      publish({ sceneId: nextSceneId });
      if (active && snapshot.status === "running" && rawStatus === "ready") {
        void sendPrompt(scenePrompt(currentElapsed()), `${snapshot.mode}:signal`, null, epoch);
      }
    },
    onTransportStatus, onMessage, onError,
  };
}
export type ExperienceController = ReturnType<typeof createExperienceController>;
