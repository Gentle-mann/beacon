import { expect, test, type Page } from "@playwright/test";

type MicSnapshot = {
  requests: number;
  streams: { stopCalls: number; hasEndedHandler: boolean }[];
  contexts: {
    state: string;
    closeCalls: number;
    inputDisconnects: number;
    analyserDisconnects: number;
    samples: number;
    hasStateHandler: boolean;
  }[];
};

type FakeMic = {
  snapshot(): MicSnapshot;
  resolve(requestIndex: number, alreadyEnded?: boolean): void;
  end(streamIndex: number): void;
  suspend(contextIndex: number): void;
};

declare global {
  interface Window {
    __fakeMic: FakeMic;
  }
}

/** A controllable browser device; no native microphone or speaker is used. */
async function installFakeMic(page: Page, deny = false, amplitude = 0) {
  await page.addInitScript(({ denyPermission, sampleAmplitude }) => {
    type Track = { readyState: "live" | "ended"; stopCalls: number; onended: (() => void) | null; stop(): void };
    const streams: { track: Track; getTracks(): Track[]; getAudioTracks(): Track[] }[] = [];
    const requests: ((stream: unknown) => void)[] = [];
    const contexts: FakeAudioContext[] = [];

    class FakeAudioContext {
      state = "suspended";
      closeCalls = 0;
      inputDisconnects = 0;
      analyserDisconnects = 0;
      samples = 0;
      onstatechange: (() => void) | null = null;
      constructor() { contexts.push(this); }
      async resume() { this.state = "running"; }
      async close() { this.closeCalls += 1; this.state = "closed"; }
      createMediaStreamSource() {
        return {
          connect: () => {},
          disconnect: () => { this.inputDisconnects += 1; },
        };
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          getFloatTimeDomainData: (buffer: Float32Array) => {
            this.samples += 1;
            // Alternating signs avoid a DC-only signal, which RMS removes.
            for (let i = 0; i < buffer.length; i++) buffer[i] = i % 2 ? sampleAmplitude : -sampleAmplitude;
          },
          disconnect: () => { this.analyserDisconnects += 1; },
        };
      }
    }

    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => new Promise((resolve, reject) => {
          requests.push(resolve);
          if (denyPermission) reject(new DOMException("Test permission denial", "NotAllowedError"));
        }),
      },
    });
    window.__fakeMic = {
      snapshot: () => ({
        requests: requests.length,
        streams: streams.map(({ track }) => ({ stopCalls: track.stopCalls, hasEndedHandler: track.onended !== null })),
        contexts: contexts.map((context) => ({
          state: context.state,
          closeCalls: context.closeCalls,
          inputDisconnects: context.inputDisconnects,
          analyserDisconnects: context.analyserDisconnects,
          samples: context.samples,
          hasStateHandler: context.onstatechange !== null,
        })),
      }),
      resolve: (requestIndex, alreadyEnded = false) => {
        const track: Track = {
          readyState: alreadyEnded ? "ended" : "live",
          stopCalls: 0,
          onended: null,
          stop() { this.stopCalls += 1; this.readyState = "ended"; },
        };
        const stream = { track, getTracks: () => [track], getAudioTracks: () => [track] };
        streams.push(stream);
        requests[requestIndex](stream);
      },
      end: (streamIndex) => {
        streams[streamIndex].track.readyState = "ended";
        streams[streamIndex].track.onended?.();
      },
      suspend: (contextIndex) => {
        const context = contexts[contextIndex];
        context.state = "suspended";
        context.onstatechange?.();
      },
    };
  }, { denyPermission: deny, sampleAmplitude: amplitude });
}

const micSnapshot = (page: Page) => page.evaluate(() => window.__fakeMic.snapshot());
const slider = (page: Page) => page.getByRole("slider", { name: "Manual BPM" });
const sourceBpm = (page: Page) => page.getByLabel("Current source BPM");
const micStatus = (page: Page) => page.locator(".mic-status");
const forbiddenRequests = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  // Abort unexpected traffic before it can mint a token or touch a live slot.
  const forbidden: string[] = [];
  forbiddenRequests.set(page, forbidden);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3100" || url.pathname.startsWith("/api/")) {
      forbidden.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
});

test.afterEach(async ({ page }) => {
  expect(forbiddenRequests.get(page), "Offline workbench attempted API or external traffic").toEqual([]);
});

test("offline slider starts at 12 and supports keyboard updates across 4–20 BPM", async ({ page }) => {
  await installFakeMic(page);
  await page.goto("/breath");
  await expect(sourceBpm(page)).toHaveText("12.0");
  await expect(slider(page)).toHaveAttribute("min", "4");
  await expect(slider(page)).toHaveAttribute("max", "20");
  await slider(page).focus();
  await slider(page).press("ArrowRight");
  await expect(sourceBpm(page)).toHaveText("12.5");
  await slider(page).press("Home");
  await expect(sourceBpm(page)).toHaveText("4.0");
  await slider(page).press("ArrowLeft");
  await expect(sourceBpm(page)).toHaveText("4.0");
  await slider(page).press("End");
  await expect(sourceBpm(page)).toHaveText("20.0");
  await slider(page).press("ArrowRight");
  await expect(sourceBpm(page)).toHaveText("20.0");
  await expect(page.getByText("Detected: —", { exact: true })).toBeVisible();
  expect((await micSnapshot(page)).requests).toBe(0);
});

test("denied microphone permission closes audio and leaves the slider usable", async ({ page }) => {
  await installFakeMic(page, true);
  await page.goto("/breath");
  await page.getByRole("button", { name: "Use microphone", exact: true }).click();
  await expect(micStatus(page)).toContainText("permission was denied");
  await expect(page.getByRole("button", { name: "Use microphone", exact: true })).toBeEnabled();
  await expect.poll(async () => (await micSnapshot(page)).contexts[0]?.state).toBe("closed");
  await slider(page).press("ArrowRight");
  await expect(sourceBpm(page)).toHaveText("12.5");
  await expect(micStatus(page)).toContainText("Microphone off");
  expect((await micSnapshot(page)).streams).toEqual([]);
});

for (const cancelWith of ["slider", "cancel button"] as const) {
  test(`pending permission canceled by ${cancelWith} stops a late stream`, async ({ page }) => {
    await installFakeMic(page);
    await page.goto("/breath");
    await page.getByRole("button", { name: "Use microphone", exact: true }).click();
    await expect(micStatus(page)).toContainText("Waiting for microphone permission");
    if (cancelWith === "slider") await slider(page).press("ArrowRight");
    else await page.getByRole("button", { name: "Cancel microphone", exact: true }).click();
    await page.evaluate(() => window.__fakeMic.resolve(0));
    await expect.poll(async () => (await micSnapshot(page)).streams[0]?.stopCalls).toBe(1);
    await expect(micStatus(page)).toContainText("Microphone off");
    await expect(page.getByRole("button", { name: "Stop microphone", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use microphone", exact: true })).toBeEnabled();
    await expect(sourceBpm(page)).toHaveText(cancelWith === "slider" ? "12.5" : "12.0");
    expect((await micSnapshot(page)).contexts[0]).toMatchObject({ state: "closed", closeCalls: 1, samples: 0 });
  });
}

test("a late canceled permission cannot replace or stop a newer microphone", async ({ page }) => {
  await installFakeMic(page);
  await page.goto("/breath");
  await page.getByRole("button", { name: "Use microphone", exact: true }).click();
  await page.getByRole("button", { name: "Cancel microphone", exact: true }).click();
  await page.getByRole("button", { name: "Use microphone", exact: true }).click();
  await page.evaluate(() => window.__fakeMic.resolve(1));
  await expect(page.getByRole("button", { name: "Stop microphone", exact: true })).toBeVisible();
  await page.evaluate(() => window.__fakeMic.resolve(0));
  await expect.poll(async () => (await micSnapshot(page)).streams[1]?.stopCalls).toBe(1);
  expect((await micSnapshot(page)).streams[0].stopCalls).toBe(0);
  await expect.poll(async () => (await micSnapshot(page)).contexts[1]?.samples).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Stop microphone", exact: true })).toBeVisible();
  await expect(page.getByText("Detected: —", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop microphone", exact: true }).click();
  await expect.poll(async () => (await micSnapshot(page)).streams[0]?.stopCalls).toBe(1);
  expect((await micSnapshot(page)).contexts[1]).toMatchObject({ state: "closed", closeCalls: 1, inputDisconnects: 1, analyserDisconnects: 1 });
});

test("an already-ended granted stream falls back before analysis starts", async ({ page }) => {
  await installFakeMic(page);
  await page.goto("/breath");
  await slider(page).press("ArrowRight");
  await page.getByRole("button", { name: "Use microphone", exact: true }).click();
  await page.evaluate(() => window.__fakeMic.resolve(0, true));
  await expect(page.getByRole("button", { name: "Use microphone", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop microphone", exact: true })).toHaveCount(0);
  await expect(sourceBpm(page)).toHaveText("12.5");
  await expect(page.getByText("Detected: —", { exact: true })).toBeVisible();
  expect((await micSnapshot(page)).streams[0]).toEqual({ stopCalls: 1, hasEndedHandler: false });
  expect((await micSnapshot(page)).contexts[0]).toMatchObject({ state: "closed", closeCalls: 1, samples: 0 });
  await slider(page).press("ArrowRight");
  await expect(sourceBpm(page)).toHaveText("13.0");
});

test("microphone failure clears the previously live waveform", async ({ page }) => {
  await installFakeMic(page, false, 0.25);
  await page.goto("/breath");
  const waveform = page.getByRole("img", { name: /Live microphone amplitude envelope/ });
  const raisedTracePixels = () => waveform.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d")!;
    // Ignore the off baseline at the bottom; grid lines are neutral gray.
    const height = Math.max(1, canvas.height - Math.ceil(24 * window.devicePixelRatio));
    const pixels = context.getImageData(0, 0, canvas.width, height).data;
    let green = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 1] > 100 && pixels[i + 1] > pixels[i] * 1.3 && pixels[i + 3] > 0) green += 1;
    }
    return green;
  });
  await page.getByRole("button", { name: "Use microphone", exact: true }).click();
  await page.evaluate(() => window.__fakeMic.resolve(0));
  await expect.poll(raisedTracePixels).toBeGreaterThan(0);
  await page.evaluate(() => window.__fakeMic.end(0));
  await expect(micStatus(page)).toContainText("Microphone disconnected");
  await expect.poll(raisedTracePixels).toBe(0);
});

for (const failure of ["device ended", "audio suspended"] as const) {
  test(`${failure} restores manual input and releases every audio resource`, async ({ page }) => {
    await installFakeMic(page);
    await page.goto("/breath");
    await slider(page).press("ArrowRight");
    await page.getByRole("button", { name: "Use microphone", exact: true }).click();
    await page.evaluate(() => window.__fakeMic.resolve(0));
    await expect(page.getByRole("button", { name: "Stop microphone", exact: true })).toBeVisible();
    await expect.poll(async () => (await micSnapshot(page)).contexts[0]?.samples).toBeGreaterThan(0);
    if (failure === "device ended") await page.evaluate(() => window.__fakeMic.end(0));
    else await page.evaluate(() => window.__fakeMic.suspend(0));
    await expect(micStatus(page)).toContainText(failure === "device ended" ? "Microphone disconnected" : "Microphone paused");
    await expect(sourceBpm(page)).toHaveText("12.5");
    await expect(page.getByText("Detected: —", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use microphone", exact: true })).toBeEnabled();
    const snapshot = await micSnapshot(page);
    expect(snapshot.streams[0]).toEqual({ stopCalls: 1, hasEndedHandler: false });
    expect(snapshot.contexts[0]).toMatchObject({ state: "closed", closeCalls: 1, inputDisconnects: 1, analyserDisconnects: 1, hasStateHandler: false });
    // A canceled analyser loop must stay canceled through subsequent frames.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect((await micSnapshot(page)).contexts[0].samples).toBe(snapshot.contexts[0].samples);
    await slider(page).press("ArrowRight");
    await expect(sourceBpm(page)).toHaveText("13.0");
  });
}
