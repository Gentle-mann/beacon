import assert from "node:assert/strict";
import test from "node:test";
import { createExperienceTransport } from "../lib/experience-transport";
import type { ExperienceMode } from "../lib/experience-controller";
import type { ExperienceToken } from "../lib/experience-config";
import { fakeJwt } from "./fixtures";

type TransportOptions = Parameters<typeof createExperienceTransport>[0];
type Client = Awaited<ReturnType<NonNullable<TransportOptions["loadClient"]>>>;
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const TOKEN: ExperienceToken = {
  jwt: fakeJwt("transport-test"),
  lockedSeed: 17,
  arcDurationMs: 90_000,
  maxSessionDurationSeconds: 120,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }

/** Deliberately never imports or constructs the SDK's real Reactor class. */
class FakeReactor {
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly connectCalls: unknown[][] = [];
  readonly reconnectCalls: unknown[] = [];
  readonly commands: { name: string; data: Record<string, unknown> }[] = [];
  readonly uploads: { file: Blob; options?: { name?: string } }[] = [];
  disconnectCalls = 0;
  connectImpl = async () => { this.emit("sessionIdChanged", SESSION_ID); this.emit("statusChanged", "ready"); };
  reconnectImpl = async () => { this.emit("statusChanged", "ready"); };
  disconnectImpl = async () => {};
  commandImpl = async () => ({ type: "test_reply" });
  uploadImpl = async () => ({ id: "uploaded-reference", name: "reference.png", mime_type: "image/png", size: 4 });

  on(event: string, listener: (...args: unknown[]) => void) {
    let handlers = this.listeners.get(event);
    if (!handlers) { handlers = new Set(); this.listeners.set(event, handlers); }
    handlers.add(listener);
  }
  off(event: string, listener: (...args: unknown[]) => void) { this.listeners.get(event)?.delete(listener); }
  emit(event: string, ...args: unknown[]) { for (const listener of [...this.listeners.get(event) ?? []]) listener(...args); }
  connect(...args: unknown[]) { this.connectCalls.push(args); return this.connectImpl(); }
  reconnect(options: unknown) { this.reconnectCalls.push(options); return this.reconnectImpl(); }
  disconnect() { this.disconnectCalls++; return this.disconnectImpl(); }
  async sendCommand(name: string, data: Record<string, unknown>) {
    this.commands.push({ name, data });
    return this.commandImpl();
  }
  async uploadFile(file: File | Blob, options?: { name?: string }) {
    this.uploads.push({ file, options });
    return this.uploadImpl();
  }
  asClient() { return this as unknown as Client; }
}

function fixture(initialMode: ExperienceMode = "live") {
  const client = new FakeReactor();
  const calls: { url: string; options?: RequestInit }[] = [];
  const loadedTokens: string[] = [];
  const statuses: string[] = [];
  const messages: unknown[] = [];
  const errors: string[] = [];
  const media: (MediaStream | null)[] = [];
  const behavior = {
    mode: initialMode,
    seed: 17,
    token: async () => Response.json(TOKEN),
    stop: async () => Response.json({ stopped: true }),
    asset: async () => new Response(new Blob(["image"], { type: "image/png" })),
    load: async () => client.asClient(),
  };
  const fetcher: typeof fetch = async (input, options) => {
    const url = String(input);
    calls.push({ url, options });
    if (url === "/api/experience/token") return behavior.token();
    if (url === "/api/experience/stop") return behavior.stop();
    if (url.startsWith("/scenery-concepts/")) return behavior.asset();
    throw new Error(`Unexpected endpoint in transport test: ${url}`);
  };
  const transport = createExperienceTransport({
    getMode: () => behavior.mode,
    getSeed: () => behavior.seed,
    fetcher,
    loadClient: async (jwt) => { loadedTokens.push(jwt); return behavior.load(); },
    events: {
      onTransportStatus: (status) => { statuses.push(status); },
      onMessage: (message) => { messages.push(message); },
      onError: (error) => { errors.push(error); },
    },
    onMedia: (stream) => { media.push(stream); },
  });
  const stopCalls = () => calls.filter((call) => call.url === "/api/experience/stop");
  return { client, calls, loadedTokens, statuses, messages, errors, media, behavior, transport, stopCalls };
}

test("preview emits prompt/start events without tokens or SDK loading and Stop clears its chunk interval", async (t) => {
  type Timer = ReturnType<typeof setInterval>;
  const intervals = new Map<Timer, () => void>();
  t.mock.method(globalThis, "setInterval", (callback: () => void, delay: number) => {
    assert.equal(delay, 1_960);
    const timer = {} as Timer;
    intervals.set(timer, callback);
    return timer;
  });
  const cleared = t.mock.method(globalThis, "clearInterval", (timer: Timer) => { intervals.delete(timer); });
  const f = fixture("preview");
  try {
    await f.transport.connect();
    assert.deepEqual(f.statuses, ["ready"]);
    await f.transport.sendCommand("set_prompt", { prompt: "The water settles." });
    await f.transport.sendCommand("start", {});
    assert.deepEqual(f.messages, [
      { type: "prompt_accepted", prompt: "The water settles." },
      { type: "conditions_ready" },
      { type: "generation_started" },
    ]);
    assert.equal(intervals.size, 1);
    const tick = [...intervals.values()][0];
    tick(); tick();
    assert.deepEqual(f.messages.slice(-2), [
      { type: "chunk_complete", chunk_index: 0, frames_emitted: 33 },
      { type: "chunk_complete", chunk_index: 1, frames_emitted: 33 },
    ]);
    assert.equal(await f.transport.close(), true);
    assert.equal(intervals.size, 0);
    assert.equal(cleared.mock.callCount(), 1);
    const count = f.messages.length;
    tick(); // Even a previously queued callback cannot emit after Stop.
    await f.transport.sendCommand("set_prompt", { prompt: "late" });
    assert.equal(f.messages.length, count);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.loadedTokens, []);
    assert.equal(f.client.connectCalls.length, 0);
  } finally { await f.transport.close(); }
});

test("live reference image is uploaded and accepted before startup commands", async () => {
  const f = fixture();
  f.client.commandImpl = async () => ({ type: "image_accepted", width: 1672, height: 941 });
  try {
    await f.transport.connect();
    const reply = await f.transport.prepareImage({ url: "/scenery-concepts/silk-pavilion.png", name: "silk-pavilion.png" });
    assert.deepEqual(reply, { type: "image_accepted", width: 1672, height: 941 });
    assert.equal(f.client.uploads.length, 1);
    assert.equal(f.client.uploads[0].options?.name, "silk-pavilion.png");
    assert.equal(f.client.uploads[0].file.type, "image/png");
    assert.deepEqual(f.client.commands, [{ name: "set_image", data: { image: { id: "uploaded-reference", name: "reference.png", mime_type: "image/png", size: 4 } } }]);
  } finally { await f.transport.close(); }
});

test("Stop during a pending reference upload prevents set_image", async () => {
  const f = fixture();
  const upload = deferred<{ id: string; name: string; mime_type: string; size: number }>();
  f.client.uploadImpl = () => upload.promise;
  await f.transport.connect();
  const preparing = f.transport.prepareImage({ url: "/scenery-concepts/sea-of-clouds.png", name: "sea-of-clouds.png" });
  await flush();
  const closing = f.transport.close();
  upload.resolve({ id: "late-upload", name: "sea-of-clouds.png", mime_type: "image/png", size: 5 });
  await preparing;
  await closing;
  assert.equal(f.client.commands.some((item) => item.name === "set_image"), false);
});

test("live connection checks the configured seed and uses one scoped token", async () => {
  const f = fixture();
  try {
    await f.transport.connect();
    assert.deepEqual(f.loadedTokens, [TOKEN.jwt]);
    assert.deepEqual(f.client.connectCalls, [[]]);
    assert.deepEqual(f.statuses, ["ready"]);
    const reply = await f.transport.sendCommand("set_seed", { seed: 17 });
    assert.deepEqual(f.client.commands, [{ name: "set_seed", data: { seed: 17 } }]);
    assert.deepEqual(reply, { type: "test_reply" });
    f.client.emit("message", { type: "conditions_ready" });
    assert.deepEqual(f.messages, [{ type: "conditions_ready" }]);
    await f.transport.reconnect();
    assert.deepEqual(f.client.reconnectCalls, [{ maxAttempts: 1 }]);
    assert.equal(f.client.connectCalls.length, 1);
    assert.equal(f.loadedTokens.length, 1);
    assert.deepEqual(f.calls.map((call) => call.url), ["/api/experience/token"]);
  } finally { await f.transport.close(); }
});

test("owned server Stop is issued while the SDK disconnect queue remains unresolved", async () => {
  const f = fixture();
  const disconnect = deferred<void>();
  f.client.disconnectImpl = () => disconnect.promise;
  await f.transport.connect();
  const closing = f.transport.close();
  let completed = false;
  void closing.then(() => { completed = true; });
  try {
    await flush();
    assert.equal(f.client.disconnectCalls, 1);
    assert.equal(f.stopCalls().length, 1, "server cleanup must not wait behind disconnect");
    assert.equal(completed, false);
    const stop = f.stopCalls()[0];
    assert.deepEqual(JSON.parse(stop.options?.body as string), { sessionId: SESSION_ID, jwt: TOKEN.jwt });
    assert.equal(stop.options?.method, "POST");
    assert.equal(stop.options?.keepalive, true);
    assert.equal(f.calls.some((call) => call.url === "/api/sessions"), false);
  } finally { disconnect.resolve(); }
  assert.equal(await closing, true);
});

test("a token arriving after Stop cannot load or connect the SDK", async () => {
  const f = fixture();
  const token = deferred<Response>();
  f.behavior.token = () => token.promise;
  const connecting = f.transport.connect();
  await flush();
  assert.equal(await f.transport.close(), false, "pending lifecycle must remain unconfirmed");
  token.resolve(Response.json(TOKEN));
  await connecting;
  assert.equal(f.loadedTokens.length, 0);
  assert.equal(f.client.connectCalls.length, 0);
  assert.equal(f.client.disconnectCalls, 0);
  assert.deepEqual(f.calls.map((call) => call.url), ["/api/experience/token"]);
  assert.equal(await f.transport.close(), true);
});

test("a late session ID during Stop is deleted with the closing lease's captured capability", async () => {
  const f = fixture();
  const connect = deferred<void>();
  const disconnect = deferred<void>();
  f.client.connectImpl = () => connect.promise;
  f.client.disconnectImpl = () => disconnect.promise;
  const connecting = f.transport.connect();
  await flush();
  assert.equal(f.client.connectCalls.length, 1);
  const closing = f.transport.close();
  try {
    await flush();
    assert.equal(f.stopCalls().length, 0, "no session ID exists yet");
    f.client.emit("sessionIdChanged", SESSION_ID);
    f.client.emit("sessionIdChanged", undefined); // SDK reset must not erase the owned ID.
    f.client.emit("statusChanged", "ready");
    f.client.emit("message", { type: "generation_started" });
    await flush();
    assert.equal(f.stopCalls().length, 1);
    assert.deepEqual(JSON.parse(f.stopCalls()[0].options?.body as string), { sessionId: SESSION_ID, jwt: TOKEN.jwt });
    assert.deepEqual(f.statuses, [], "late status does not revive the run");
    assert.deepEqual(f.messages, [], "late model events do not revive the run");
  } finally { connect.resolve(); disconnect.resolve(); }
  await connecting;
  assert.equal(await closing, true);
  await flush();
  assert.ok(f.stopCalls().every((call) => JSON.parse(call.options?.body as string).sessionId === SESSION_ID));
  assert.equal(f.calls.filter((call) => call.url === "/api/experience/token").length, 1);
  assert.equal(f.client.disconnectCalls, 1);
  assert.ok([...f.client.listeners.values()].every((handlers) => handlers.size === 0));
});

test("a changed locked seed fails before any client is loaded or connected", async () => {
  const f = fixture();
  f.behavior.seed = 18;
  await assert.rejects(f.transport.connect(), /locked seed changed/i);
  assert.equal(f.loadedTokens.length, 0);
  assert.equal(f.client.connectCalls.length, 0);
  assert.equal(f.stopCalls().length, 0);
  assert.equal(await f.transport.close(), true);
});

test("SDK error callbacks use generic UI text and cannot leak raw error details", async () => {
  const f = fixture();
  await f.transport.connect();
  const raw = `SDK internal authorization diagnostics ${TOKEN.jwt}`;
  f.client.emit("error", { code: "private_transport_failure", message: raw, detail: raw });
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0], /live connection reported an error/i);
  assert.equal(f.errors[0].includes(TOKEN.jwt), false);
  assert.equal(f.errors[0].includes("private_transport_failure"), false);
  await f.transport.close();
  f.client.emit("error", new Error(raw));
  assert.equal(f.errors.length, 1, "closed leases no longer forward errors");
});

test("recoverable SDK events do not abort a connection that is still retrying", async () => {
  const f = fixture();
  await f.transport.connect();
  f.client.emit("error", { code: "REQUEST_TIMEOUT", operation: "connect", recoverable: true });
  assert.deepEqual(f.errors, []);
  await f.transport.close();
});

test("a client finishing its lazy load after Stop is disconnected without ever connecting", async () => {
  const f = fixture();
  const load = deferred<Client>();
  f.behavior.load = () => load.promise;
  const connecting = f.transport.connect();
  await flush();
  assert.equal(f.loadedTokens.length, 1);
  assert.equal(await f.transport.close(), false);
  load.resolve(f.client.asClient());
  await connecting;
  assert.equal(f.client.connectCalls.length, 0);
  assert.equal(f.client.disconnectCalls, 1);
  assert.equal(f.stopCalls().length, 0);
  assert.equal(await f.transport.close(), true);
});

const RAW_DIAGNOSTIC = `private_sdk_diagnostic containing ${TOKEN.jwt}`;

async function rejectsWithSafeMessage(operation: Promise<unknown>, expected: RegExp) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, expected);
    assert.equal(error.message.includes("private_sdk_diagnostic"), false);
    assert.equal(error.message.includes(TOKEN.jwt), false);
    return true;
  });
}

for (const failure of ["token response", "token request", "SDK loader", "SDK connect"] as const) {
  test(`${failure} rejection cannot expose provider or SDK diagnostics`, async () => {
    const f = fixture();
    if (failure === "token response") f.behavior.token = async () => Response.json({ error: RAW_DIAGNOSTIC }, { status: 502 });
    if (failure === "token request") f.behavior.token = async () => { throw new Error(RAW_DIAGNOSTIC); };
    if (failure === "SDK loader") f.behavior.load = async () => { throw new Error(RAW_DIAGNOSTIC); };
    if (failure === "SDK connect") f.client.connectImpl = async () => { throw new Error(RAW_DIAGNOSTIC); };
    try { await rejectsWithSafeMessage(f.transport.connect(), /live scenery could not start/i); }
    finally { await f.transport.close(); }
  });
}

test("reconnect rejection uses generic guidance without exposing raw SDK diagnostics", async () => {
  const f = fixture();
  await f.transport.connect();
  f.client.reconnectImpl = async () => { throw new Error(RAW_DIAGNOSTIC); };
  try {
    await rejectsWithSafeMessage(f.transport.reconnect(), /live connection could not recover/i);
    assert.equal(f.calls.filter((call) => call.url === "/api/experience/token").length, 1);
    assert.deepEqual(f.client.reconnectCalls, [{ maxAttempts: 1 }]);
  } finally { await f.transport.close(); }
});

test("command rejection uses generic guidance without exposing raw SDK diagnostics", async () => {
  const f = fixture();
  await f.transport.connect();
  f.client.commandImpl = async () => { throw new Error(RAW_DIAGNOSTIC); };
  try { await rejectsWithSafeMessage(f.transport.sendCommand("set_prompt", { prompt: "water" }), /live scene could not update/i); }
  finally { await f.transport.close(); }
});

test("stale owned cleanup cannot clear the media callback of a newer live run", async () => {
  const f = fixture();
  const oldDisconnect = deferred<void>();
  f.client.disconnectImpl = () => oldDisconnect.promise;
  await f.transport.connect();
  const closingOld = f.transport.close();
  const newer = new FakeReactor();
  const newerId = "00000000-0000-4000-8000-000000000003";
  newer.connectImpl = async () => { newer.emit("sessionIdChanged", newerId); newer.emit("statusChanged", "ready"); };
  f.behavior.load = async () => newer.asClient();
  f.behavior.token = async () => Response.json({ ...TOKEN, jwt: `${TOKEN.jwt}_new` });
  try {
    await f.transport.connect();
    const mediaCallsBeforeLateCleanup = f.media.length;
    f.client.emit("sessionIdChanged", SESSION_ID);
    await flush();
    assert.equal(f.media.length, mediaCallsBeforeLateCleanup, "old cleanup must not blank the newer run");
    assert.ok(f.stopCalls().every((call) => {
      const details = JSON.parse(call.options?.body as string);
      return details.sessionId === SESSION_ID && details.jwt === TOKEN.jwt;
    }));
    assert.equal(newer.disconnectCalls, 0);
  } finally {
    oldDisconnect.resolve();
    await closingOld;
    await f.transport.close();
  }
});

test("a replaced video track is released and only the current track ending reports disconnection", async (t) => {
  class FakeTrack extends EventTarget {
    readonly kind = "video";
    stopCalls = 0;
    stop() { this.stopCalls++; }
    end() { this.dispatchEvent(new Event("ended")); }
  }
  class FakeMediaStream {
    private tracks: MediaStreamTrack[] = [];
    getTracks() { return [...this.tracks]; }
    addTrack(track: MediaStreamTrack) { this.tracks.push(track); }
    removeTrack(track: MediaStreamTrack) { this.tracks = this.tracks.filter((item) => item !== track); }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "MediaStream");
  Object.defineProperty(globalThis, "MediaStream", { value: FakeMediaStream, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "MediaStream", original);
    else Reflect.deleteProperty(globalThis, "MediaStream");
  });
  const f = fixture();
  const oldVideo = new FakeTrack();
  const replacementVideo = new FakeTrack();
  await f.transport.connect();
  try {
    f.client.emit("trackReceived", "main_video", oldVideo);
    f.client.emit("trackReceived", "main_video", replacementVideo);
    const currentStream = f.media.at(-1)!;
    assert.deepEqual(currentStream.getTracks(), [replacementVideo]);
    oldVideo.end();
    assert.deepEqual(f.statuses, ["ready"], "a removed track ending must not disconnect its replacement");
    assert.equal(oldVideo.stopCalls, 1, "replacing a track must release the old resource");
    replacementVideo.end();
    assert.deepEqual(f.statuses, ["ready", "disconnected"]);
  } finally { await f.transport.close(); }
  assert.equal(oldVideo.stopCalls, 1);
  assert.equal(replacementVideo.stopCalls, 1);
});
