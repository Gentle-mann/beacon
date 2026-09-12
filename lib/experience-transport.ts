import type { Reactor } from "@reactor-team/js-sdk";
import type { ExperienceMode, ExperienceTransport } from "./experience-controller";
import type { ExperienceToken } from "./experience-config";
import { ORBIS_MODEL_NAME, ORBIS_TRACKS, unwrapOrbisMessage } from "./orbis";

type Client = Pick<Reactor, "on" | "off" | "connect" | "reconnect" | "disconnect" | "sendCommand" | "uploadFile">;
type Events = { onTransportStatus(status: string): void; onMessage(message: unknown): void; onError(message: string): void };
type Lease = {
  cancelled: boolean;
  token: ExperienceToken | null;
  client: Client | null;
  sessionId?: string;
  connecting: boolean;
  sdkClose: Promise<boolean> | null;
  media: MediaStream | null;
  detach: (() => void)[];
};
type Options = {
  getMode(): ExperienceMode;
  getSeed(): number | null;
  events: Events;
  onMedia(stream: MediaStream | null): void;
  fetcher?: typeof fetch;
  loadClient?: (jwt: string) => Promise<Client>;
};

/** Each run owns its client, JWT and session ID. No account-level APIs are used. */
export function createExperienceTransport(options: Options): ExperienceTransport & { pageHide(): void } {
  const fetcher = options.fetcher ?? fetch;
  let current: Lease | null = null;
  let previewTimer: ReturnType<typeof setInterval> | null = null;
  let previewActive = false;
  let previewChunk = 0;

  async function bounded(promise: Promise<boolean>, ms: number) {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([promise, new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); })]);
    } finally { clearTimeout(timer!); }
  }

  async function closeLease(lease: Lease) {
    lease.cancelled = true;
    if (current === lease) options.onMedia(null);
    lease.media?.getTracks().forEach((track) => track.stop());
    // The SDK queues disconnect behind connect/command reads. Start it, but do
    // not wait for that queue before issuing the independent scoped server stop.
    lease.sdkClose ??= lease.client ? lease.client.disconnect().then(() => true, () => false) : Promise.resolve(!lease.connecting);
    const stopOwned = async () => {
      if (!lease.sessionId || !lease.token) return false;
      try {
        const response = await fetcher("/api/experience/stop", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: lease.sessionId, jwt: lease.token.jwt }),
          signal: AbortSignal.timeout(8_000), keepalive: true,
        });
        const result = await response.json() as { stopped?: boolean };
        return response.ok && result.stopped === true;
      } catch { return false; }
    };
    const results = await Promise.all([bounded(lease.sdkClose, 8_000), stopOwned()]);
    if (!lease.connecting && results.some(Boolean)) {
      lease.detach.forEach((detach) => detach());
      lease.detach = [];
    }
    return results.some(Boolean);
  }

  async function connect() {
    if (options.getMode() === "preview") {
      previewActive = true; previewChunk = 0;
      options.events.onTransportStatus("ready");
      return;
    }
    const lease: Lease = { cancelled: false, token: null, client: null, connecting: true, sdkClose: null, media: null, detach: [] };
    current = lease;
    let failureMessage = "Live scenery could not start. You can use the calm preview.";
    try {
      const response = await fetcher("/api/experience/token", { method: "POST", signal: AbortSignal.timeout(12_000) });
      const result = await response.json() as ExperienceToken & { error?: string };
      if (!response.ok || !result.jwt) throw new Error(failureMessage);
      lease.token = result;
      if (lease.cancelled) return;
      if (result.lockedSeed !== options.getSeed()) {
        failureMessage = "The locked seed changed. Refresh before starting a new session.";
        throw new Error(failureMessage);
      }
      const createClient = options.loadClient ?? (async (jwt: string) => {
        const { Reactor } = await import("@reactor-team/js-sdk");
        return new Reactor({ apiUrl: "https://api.reactor.inc", modelName: ORBIS_MODEL_NAME, modelTracks: [...ORBIS_TRACKS], jwt, maxSessionAttempts: 1, maxSdpAttempts: 1, readyTimeoutMs: 30_000, controlRequestTimeoutMs: 4_000, logLevel: "error" });
      });
      lease.client = await createClient(result.jwt);
      if (lease.cancelled) { lease.sdkClose = null; return; }
      const client = lease.client;
      const usable = () => current === lease && !lease.cancelled;
      const status = (value: string) => { if (usable()) options.events.onTransportStatus(value); };
      const message = (value: unknown) => { if (usable()) options.events.onMessage(value); };
      const error = () => { if (usable()) options.events.onError("The live connection reported an error. You can continue with the calm preview."); };
      const session = (value: string | undefined) => {
        if (value) lease.sessionId = value;
        if (lease.cancelled && value) void closeLease(lease);
      };
      const track = (_name: string, value: MediaStreamTrack) => {
        if (!usable()) { value.stop(); return; }
        lease.media ??= new MediaStream();
        const existing = lease.media.getTracks().find((item) => item.kind === value.kind);
        if (existing === value) return;
        if (existing) {
          lease.media.removeTrack(existing);
          existing.stop();
        }
        lease.media.addTrack(value);
        value.addEventListener("ended", () => {
          if (usable() && lease.media?.getTracks().includes(value)) options.events.onTransportStatus("disconnected");
        }, { once: true });
        options.onMedia(lease.media);
      };
      client.on("statusChanged", status);
      client.on("sessionIdChanged", session);
      client.on("message", message);
      client.on("error", error);
      client.on("trackReceived", track);
      lease.detach = [() => client.off("statusChanged", status), () => client.off("sessionIdChanged", session), () => client.off("message", message), () => client.off("error", error), () => client.off("trackReceived", track)];
      await client.connect(undefined, { maxAttempts: 1 });
    } catch {
      // SDK/provider diagnostics may contain private transport or token details.
      throw new Error(failureMessage);
    } finally {
      lease.connecting = false;
      // Covers token/load/connect completions arriving after Stop or pagehide.
      if (lease.cancelled) {
        if (!lease.client) lease.sdkClose = Promise.resolve(true);
        await closeLease(lease);
      }
    }
  }

  return {
    connect,
    async reconnect() {
      const lease = current;
      if (!lease || lease.cancelled || !lease.client) throw new Error("The original session cannot be reattached.");
      lease.connecting = true;
      try { await lease.client.reconnect({ maxAttempts: 1 }); }
      catch { throw new Error("The live connection could not recover. You can continue with the calm preview."); }
      finally { lease.connecting = false; if (lease.cancelled) await closeLease(lease); }
    },
    async prepareImage(asset) {
      const failure = "The selected scenery could not be prepared. You can continue with the calm preview.";
      if (!/^\/scenery-concepts\/[a-z0-9-]+\.png$/.test(asset.url) || !/^[a-z0-9-]+\.png$/.test(asset.name)) {
        throw new Error(failure);
      }
      if (options.getMode() === "preview") {
        if (!previewActive) return;
        options.events.onMessage({ type: "state", has_image: true });
        return { type: "image_accepted" };
      }
      const lease = current;
      if (!lease?.client || lease.cancelled) throw new Error("The live session is closed.");
      try {
        const response = await fetcher(asset.url, { cache: "force-cache", signal: AbortSignal.timeout(12_000) });
        if (!response.ok) throw new Error(failure);
        const image = await response.blob();
        if (!image.type.startsWith("image/") || image.size === 0 || image.size > 10_000_000) throw new Error(failure);
        if (lease.cancelled || current !== lease) return;
        const uploaded = await lease.client.uploadFile(image, { name: asset.name });
        if (lease.cancelled || current !== lease) return;
        const raw = await lease.client.sendCommand("set_image", { image: uploaded });
        if (lease.cancelled || current !== lease) return;
        const reply = unwrapOrbisMessage(raw);
        if (reply?.type !== "image_accepted") throw new Error(failure);
        return raw;
      } catch {
        if (lease.cancelled || current !== lease) return;
        throw new Error(failure);
      }
    },
    async sendCommand(name, data) {
      if (options.getMode() === "preview") {
        if (!previewActive) return;
        if (name === "set_prompt") {
          options.events.onMessage({ type: "prompt_accepted", prompt: data.prompt });
          options.events.onMessage({ type: "conditions_ready" });
        }
        if (name === "start") {
          options.events.onMessage({ type: "generation_started" });
          previewTimer = setInterval(() => {
            if (previewActive) options.events.onMessage({ type: "chunk_complete", chunk_index: previewChunk++, frames_emitted: 33 });
          }, 1_960);
        }
        return;
      }
      const lease = current;
      if (!lease?.client || lease.cancelled) throw new Error("The live session is closed.");
      try { return await lease.client.sendCommand(name, data); }
      catch { throw new Error("The live scene could not update. You can continue with the calm preview."); }
    },
    async close() {
      if (previewTimer) clearInterval(previewTimer);
      previewTimer = null; previewActive = false;
      if (options.getMode() === "preview") return true;
      return current ? closeLease(current) : true;
    },
    pageHide() {
      if (options.getMode() !== "live" || !current) return;
      const lease = current;
      lease.cancelled = true;
      if (lease.token && lease.sessionId && typeof navigator !== "undefined") {
        navigator.sendBeacon?.("/api/experience/stop", new Blob([JSON.stringify({ sessionId: lease.sessionId, jwt: lease.token.jwt })], { type: "application/json" }));
      }
      void closeLease(lease);
    },
  };
}
