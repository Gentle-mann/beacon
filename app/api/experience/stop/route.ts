import {
  EXPERIENCE_REACTOR_API_URL,
  experienceJson,
  isExperienceJwt,
  isExperienceSessionId,
  isSameOriginExperienceRequest,
  readExperienceStopBody,
} from "@/lib/experience-api.server";

/** Capability-scoped cleanup also works after live mode has been disabled. */
export async function POST(request: Request) {
  if (!isSameOriginExperienceRequest(request)) return experienceJson({ error: "Request not allowed." }, 403);
  let body: unknown;
  try { body = await readExperienceStopBody(request); }
  catch { return experienceJson({ error: "Invalid session details." }, 400); }
  if (!body || typeof body !== "object" || !("sessionId" in body) || !("jwt" in body) ||
      !isExperienceSessionId(body.sessionId) || !isExperienceJwt(body.jwt)) {
    return experienceJson({ error: "Invalid session details." }, 400);
  }
  try {
    // Use only the caller's capability. Reactor checks its signature and ownership.
    // The account API key is never used, even if deletion is denied.
    const response = await fetch(`${EXPERIENCE_REACTOR_API_URL}/sessions/${body.sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${body.jwt}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok || response.status === 404 || response.status === 410) return experienceJson({ stopped: true });
    if (response.status === 401 || response.status === 403) {
      return experienceJson({ error: "The session could not be stopped with these details." }, response.status);
    }
    return experienceJson({ error: "Session cleanup could not be confirmed." }, 502);
  } catch {
    return experienceJson({ error: "Session cleanup could not be confirmed." }, 502);
  }
}
