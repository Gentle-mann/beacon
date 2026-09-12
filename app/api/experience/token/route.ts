import {
  EXPERIENCE_MODEL_NAME,
  EXPERIENCE_REACTOR_API_URL,
  EXPERIENCE_TOKEN_LIFETIME_SECONDS,
  experienceJson,
  getExperienceConfig,
  isExperienceJwt,
  isSameOriginExperienceRequest,
} from "@/lib/experience-api.server";
import type { ExperienceToken } from "@/lib/experience-config";

export async function POST(request: Request) {
  if (!isSameOriginExperienceRequest(request)) return experienceJson({ error: "Request not allowed." }, 403);
  const config = getExperienceConfig();
  if (!config.liveEnabled || config.lockedSeed === null) {
    return experienceJson({ error: config.unavailableReason }, 503);
  }
  try {
    // Official constraints: https://docs.reactor.inc/authentication
    // max_sessions counts lifetime creates, so recovery must reattach to this session.
    const response = await fetch(`${EXPERIENCE_REACTOR_API_URL}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Reactor-API-Key": process.env.REACTOR_API_KEY! },
      body: JSON.stringify({
        expires_after: EXPERIENCE_TOKEN_LIFETIME_SECONDS,
        authorization_details: [{
          type: "session",
          resources: { models: { match: [EXPERIENCE_MODEL_NAME] } },
          constraints: { max_sessions: 1, max_session_duration_seconds: config.maxSessionDurationSeconds },
        }],
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return experienceJson({ error: "Live scenery could not start. Try the guided session." }, response.status === 429 ? 503 : 502);
    }
    const result: unknown = await response.json();
    const jwt = result && typeof result === "object" && "jwt" in result ? result.jwt : null;
    if (!isExperienceJwt(jwt)) throw new Error("Invalid token response");
    const token: ExperienceToken = {
      jwt,
      lockedSeed: config.lockedSeed,
      arcDurationMs: config.arcDurationMs,
      maxSessionDurationSeconds: config.maxSessionDurationSeconds,
    };
    return experienceJson(token);
  } catch {
    // Never return provider payloads or thrown messages, which may contain credentials.
    return experienceJson({ error: "Live scenery could not start. Try the guided session." }, 502);
  }
}
