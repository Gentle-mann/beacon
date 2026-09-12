import {
  EXPERIENCE_ARC_DURATION_MS,
  EXPERIENCE_MAX_SESSION_DURATION_SECONDS,
  type ExperienceConfig,
} from "./experience-config";

export const EXPERIENCE_REACTOR_API_URL = "https://api.reactor.inc";
export const EXPERIENCE_MODEL_NAME = "reactor/visko-orbis-stable";
// Includes mint/connect time, the full 120s session cap, and cleanup/reattachment.
export const EXPERIENCE_TOKEN_LIFETIME_SECONDS = 300;
const MAX_STOP_BODY_BYTES = 12_288;

type ExperienceEnvironment = {
  REACTOR_API_KEY?: string;
  BEACON_LIVE_ENABLED?: string;
  BEACON_LOCKED_SEED?: string;
};

/** No network access, and no key or other server configuration in the result. */
export function getExperienceConfig(environment: ExperienceEnvironment = {
  REACTOR_API_KEY: process.env.REACTOR_API_KEY,
  BEACON_LIVE_ENABLED: process.env.BEACON_LIVE_ENABLED,
  BEACON_LOCKED_SEED: process.env.BEACON_LOCKED_SEED,
}): ExperienceConfig {
  const seedText = environment.BEACON_LOCKED_SEED ?? "";
  const candidate = /^(0|[1-9]\d{0,9})$/.test(seedText) ? Number(seedText) : NaN;
  // Restrict configured seeds to unsigned 32-bit integers; never guess one.
  const lockedSeed = Number.isInteger(candidate) && candidate <= 0xffff_ffff ? candidate : null;
  const liveEnabled = environment.BEACON_LIVE_ENABLED === "true" &&
    Boolean(environment.REACTOR_API_KEY?.trim()) && lockedSeed !== null;
  return {
    liveEnabled,
    lockedSeed,
    arcDurationMs: EXPERIENCE_ARC_DURATION_MS,
    maxSessionDurationSeconds: EXPERIENCE_MAX_SESSION_DURATION_SECONDS,
    unavailableReason: liveEnabled ? null : "Live scenery is still being prepared. You can use the guided session now.",
  };
}

export function experienceJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
  });
}

/** Browser request isolation for this private demo; this is not user authentication. */
export function isSameOriginExperienceRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === new URL(request.url).origin;
  return site === "same-origin";
}

/** Shape validation only. Reactor verifies the signature and session ownership. */
export function isExperienceJwt(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 8_192 &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

export function isExperienceSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

/** Accept JSON and sendBeacon's string payload without accepting unbounded bodies. */
export async function readExperienceStopBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json" && contentType !== "text/plain") throw new Error("Invalid body");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_STOP_BODY_BYTES)) {
    throw new Error("Invalid body");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid body");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_STOP_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Invalid body");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
