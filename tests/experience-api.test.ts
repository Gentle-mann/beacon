import assert from "node:assert/strict";
import test from "node:test";
import { GET as getConfig } from "../app/api/experience/config/route";
import { POST as mintToken } from "../app/api/experience/token/route";
import { POST as stopSession } from "../app/api/experience/stop/route";
import { getExperienceConfig, isSameOriginExperienceRequest } from "../lib/experience-api.server";
import { fakeJwt } from "./fixtures";

const ORIGIN = "http://127.0.0.1:3100";
const FAKE_KEY = "test-server-key-never-return-this";
const FAKE_JWT = fakeJwt("unit-test");
const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const ENABLED = { REACTOR_API_KEY: FAKE_KEY, BEACON_LIVE_ENABLED: "true", BEACON_LOCKED_SEED: "17" };
type Environment = Partial<typeof ENABLED>;

async function withEnvironment(environment: Environment, run: () => Promise<void>) {
  const original = Object.fromEntries(Object.keys(ENABLED).map((key) => [key, process.env[key]]));
  for (const key of Object.keys(ENABLED)) {
    const value = environment[key as keyof Environment];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { await run(); }
  finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function request(endpoint: string, options: RequestInit = {}) {
  return new Request(`${ORIGIN}/api/experience/${endpoint}`, {
    ...options,
    headers: { "sec-fetch-site": "same-origin", ...options.headers },
  });
}

function stopRequest(body: unknown, headers: Record<string, string> = {}) {
  return request("stop", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

test("live configuration requires explicit enablement, a key, and an unsigned integer seed", () => {
  assert.equal(getExperienceConfig(ENABLED).liveEnabled, true);
  for (const seed of ["0", "4294967295"]) {
    assert.equal(getExperienceConfig({ ...ENABLED, BEACON_LOCKED_SEED: seed }).lockedSeed, Number(seed));
  }
  for (const seed of [undefined, "", " ", "-1", "1.5", "1e3", "Infinity", "NaN", " 17", "17 ", "00", "4294967296", "9999999999999999"]) {
    const config = getExperienceConfig({ ...ENABLED, BEACON_LOCKED_SEED: seed });
    assert.equal(config.liveEnabled, false, `Seed must be rejected: ${seed}`);
    assert.equal(config.lockedSeed, null);
    assert.ok(config.unavailableReason);
  }
  for (const flag of [undefined, "", "false", "TRUE", "1"]) {
    assert.equal(getExperienceConfig({ ...ENABLED, BEACON_LIVE_ENABLED: flag }).liveEnabled, false);
  }
  assert.equal(getExperienceConfig({ ...ENABLED, REACTOR_API_KEY: " " }).liveEnabled, false);
});

test("config GET has no provider traffic and exposes only browser-safe configuration", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected provider call"); });
  await withEnvironment(ENABLED, async () => {
    const response = getConfig(request("config"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.deepEqual(await response.json(), {
      liveEnabled: true, lockedSeed: 17, arcDurationMs: 90_000,
      maxSessionDurationSeconds: 120, unavailableReason: null,
    });
    assert.equal(provider.mock.callCount(), 0);
  });
});

test("token minting remains disabled for every missing configuration prerequisite", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected provider call"); });
  for (const environment of [{}, { ...ENABLED, REACTOR_API_KEY: undefined }, { ...ENABLED, BEACON_LIVE_ENABLED: undefined }, { ...ENABLED, BEACON_LOCKED_SEED: undefined }]) {
    await withEnvironment(environment, async () => {
      const response = await mintToken(request("token", { method: "POST" }));
      assert.equal(response.status, 503);
      assert.equal(typeof (await response.json()).error, "string");
    });
  }
  assert.equal(provider.mock.callCount(), 0);
});

test("token grants exactly one model session with a provider-enforced 120 second lifetime", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(url, "https://api.reactor.inc/tokens");
    assert.equal(options?.method, "POST");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("Reactor-API-Key"), FAKE_KEY);
    assert.equal(headers.has("Authorization"), false);
    assert.deepEqual(JSON.parse(options?.body as string), {
      expires_after: 300,
      authorization_details: [{
        type: "session", resources: { models: { match: ["reactor/visko-orbis-stable"] } },
        constraints: { max_sessions: 1, max_session_duration_seconds: 120 },
      }],
    });
    assert.equal(options?.redirect, "error");
    assert.equal(options?.cache, "no-store");
    assert.ok(options?.signal instanceof AbortSignal);
    return Response.json({ jwt: FAKE_JWT });
  });
  await withEnvironment(ENABLED, async () => {
    const response = await mintToken(request("token", { method: "POST", headers: { Origin: ORIGIN } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      jwt: FAKE_JWT, lockedSeed: 17, arcDurationMs: 90_000, maxSessionDurationSeconds: 120,
    });
    assert.equal(provider.mock.callCount(), 1);
  });
});

test("provider token errors stay generic and provider quota rejection becomes unavailable", async (t) => {
  let providerStatus = 500;
  t.mock.method(globalThis, "fetch", async () => new Response(`Private provider payload ${FAKE_KEY}`, { status: providerStatus }));
  await withEnvironment(ENABLED, async () => {
    for (const status of [401, 403, 429, 500]) {
      providerStatus = status;
      const response = await mintToken(request("token", { method: "POST" }));
      assert.equal(response.status, status === 429 ? 503 : 502);
      const body = await response.text();
      assert.equal(body.includes(FAKE_KEY), false);
      assert.equal(body.includes("Private provider"), false);
    }
  });
});

test("token network errors and malformed provider success responses fail closed", async (t) => {
  const responses: (() => Response)[] = [
    () => { throw new Error(FAKE_KEY); },
    () => new Response("not json"),
    () => Response.json({ jwt: "not-a-jwt" }),
    () => Response.json({}),
    () => Response.json(null),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!());
  await withEnvironment(ENABLED, async () => {
    while (responses.length) {
      const response = await mintToken(request("token", { method: "POST" }));
      assert.equal(response.status, 502);
      assert.equal((await response.text()).includes(FAKE_KEY), false);
    }
  });
});

test("all routes reject cross-origin requests before touching the provider", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected provider call"); });
  await withEnvironment(ENABLED, async () => {
    const deniedHeaders: Record<string, string>[] = [
      { Origin: "https://another-site.example" },
      { Origin: "null" },
      { Origin: ORIGIN, "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ];
    for (const headers of deniedHeaders) {
      assert.equal(getConfig(request("config", { headers })).status, 403);
      assert.equal((await mintToken(request("token", { method: "POST", headers }))).status, 403);
      assert.equal((await stopSession(stopRequest({ sessionId: SESSION_ID, jwt: FAKE_JWT }, headers))).status, 403);
    }
    assert.equal((await mintToken(new Request(`${ORIGIN}/api/experience/token`, { method: "POST" }))).status, 403);
    assert.equal(provider.mock.callCount(), 0);
  });
});

test("same-origin checks use the browser-facing Host when Next normalizes request.url", () => {
  const request = new Request("http://localhost:3100/api/experience/token", {
    method: "POST",
    headers: {
      Host: "127.0.0.1:3100",
      Origin: "http://127.0.0.1:3100",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.equal(isSameOriginExperienceRequest(request), true);
  assert.equal(isSameOriginExperienceRequest(new Request(request.url, {
    method: "POST",
    headers: { Host: "127.0.0.1:3100", Origin: "https://127.0.0.1:3100", "Sec-Fetch-Site": "same-origin" },
  })), false);
});

test("stop deletes only the named session using the caller JWT and never the account key", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(url, `https://api.reactor.inc/sessions/${SESSION_ID}`);
    assert.equal(options?.method, "DELETE");
    assert.deepEqual(Object.fromEntries(new Headers(options?.headers)), { authorization: `Bearer ${FAKE_JWT}` });
    assert.equal(options?.body, undefined);
    assert.equal(options?.redirect, "error");
    return new Response(null, { status: 204 });
  });
  await withEnvironment(ENABLED, async () => {
    const response = await stopSession(stopRequest({ sessionId: SESSION_ID, jwt: FAKE_JWT }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { stopped: true });
    assert.equal(provider.mock.callCount(), 1);
  });
});

test("sendBeacon string cleanup works with live mode disabled and no server key", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  await withEnvironment({}, async () => {
    const response = await stopSession(stopRequest({ sessionId: SESSION_ID, jwt: FAKE_JWT }, { "Content-Type": "text/plain;charset=UTF-8" }));
    assert.equal(response.status, 200);
  });
});

test("stop rejects path injection, invalid JWT shapes and missing details without provider traffic", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected provider call"); });
  const invalidBodies: unknown[] = [null, [], {}, { jwt: FAKE_JWT }, { sessionId: SESSION_ID }];
  for (const sessionId of ["", "../all", "id/other", "id?all=1", "id#fragment", "%2F..", "x".repeat(129), 7]) {
    invalidBodies.push({ sessionId, jwt: FAKE_JWT });
  }
  for (const jwt of ["", "a.b.c", "invalid", `${FAKE_JWT}\n`, "a".repeat(8_193), null, 7]) {
    invalidBodies.push({ sessionId: SESSION_ID, jwt });
  }
  for (const body of invalidBodies) {
    assert.equal((await stopSession(stopRequest(body))).status, 400);
  }
  assert.equal(provider.mock.callCount(), 0);
});

test("stop bounds both declared and actual body size and handles malformed JSON", async (t) => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected provider call"); });
  const cases: RequestInit[] = [
    { body: "not json", headers: { "Content-Type": "application/json" } },
    { body: " ".repeat(13_000), headers: { "Content-Type": "application/json" } },
    { body: "{}", headers: { "Content-Type": "application/json", "Content-Length": "999999" } },
    { body: "{}", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    { headers: { "Content-Type": "application/json" } },
  ];
  for (const options of cases) assert.equal((await stopSession(request("stop", { ...options, method: "POST" }))).status, 400);
  assert.equal(provider.mock.callCount(), 0);
});

test("provider ownership denial is preserved with no master-key fallback or retries", async (t) => {
  let providerStatus = 403;
  const provider = t.mock.method(globalThis, "fetch", async () => new Response(FAKE_KEY, { status: providerStatus }));
  await withEnvironment(ENABLED, async () => {
    for (const status of [401, 403]) {
      providerStatus = status;
      const response = await stopSession(stopRequest({ sessionId: SESSION_ID, jwt: FAKE_JWT }));
      assert.equal(response.status, status);
      assert.equal((await response.text()).includes(FAKE_KEY), false);
    }
    assert.equal(provider.mock.callCount(), 2);
  });
});

test("already absent sessions are idempotent cleanup success", async (t) => {
  let providerStatus = 404;
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: providerStatus }));
  for (const status of [404, 410]) {
    providerStatus = status;
    const response = await stopSession(stopRequest({ sessionId: SESSION_ID, jwt: FAKE_JWT }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { stopped: true });
  }
});

test("cleanup transport or provider failure cannot claim that a session stopped", async (t) => {
  let throwError = false;
  t.mock.method(globalThis, "fetch", async () => {
    if (throwError) throw new Error(FAKE_JWT);
    return new Response(FAKE_KEY, { status: 500 });
  });
  for (const shouldThrow of [false, true]) {
    throwError = shouldThrow;
    const response = await stopSession(stopRequest({ sessionId: SESSION_ID, jwt: FAKE_JWT }));
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.stopped, undefined);
    assert.equal(JSON.stringify(body).includes(FAKE_JWT), false);
    assert.equal(JSON.stringify(body).includes(FAKE_KEY), false);
  }
});
