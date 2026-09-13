import { expect, test, type Page } from "@playwright/test";

const forbiddenRequests = new WeakMap<Page, string[]>();
const unavailable = {
  liveEnabled: false,
  lockedSeed: null,
  arcDurationMs: 90_000,
  maxSessionDurationSeconds: 120,
  unavailableReason: "Live sessions are not configured yet. The local preview is ready.",
};

const startPreview = (page: Page) => page.getByRole("button", { name: "Start preview" });
const stopSession = (page: Page) => page.getByRole("button", { name: "Stop session", exact: true });
const guide = (page: Page) => page.getByRole("switch", { name: /Breathing guide/ });
const pace = (page: Page) => page.getByRole("slider", { name: /Breathing pace/ });

test.beforeEach(async ({ page }) => {
  const forbidden: string[] = [];
  forbiddenRequests.set(page, forbidden);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:3100" && url.pathname === "/api/experience/config" && request.method() === "GET") {
      await route.fulfill({ json: unavailable });
      return;
    }
    if (url.origin !== "http://127.0.0.1:3100" || url.pathname.startsWith("/api/") || /reactor_wasm|\.wasm$/.test(url.pathname)) {
      forbidden.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
  // All permission tests stay synthetic; never open the user's audio hardware.
  await page.addInitScript(() => {
    class SilentAudioContext {
      state = "suspended";
      onstatechange = null;
      async resume() { this.state = "running"; }
      async close() { this.state = "closed"; }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: SilentAudioContext });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new DOMException("Synthetic permission denial", "NotAllowedError")) },
    });
  });
});

test.afterEach(async ({ page }) => {
  // Preview teardown must remain local too, including the pagehide path.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  expect(forbiddenRequests.get(page), "Preview attempted a live API, SDK download, or external request").toEqual([]);
});

test("live is disabled by default and a local preview completes at 90 seconds then restarts", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start live session", exact: true })).toBeDisabled();
  await expect(page.getByText(unavailable.unavailableReason, { exact: true })).toBeVisible();
  await page.getByText("Breathing, motion & sensors", { exact: false }).click();
  await expect(guide(page)).not.toBeChecked();
  await expect(page.getByText("Willow by the water · local reference image", { exact: true })).toBeVisible();
  await expect(page.locator(".experience-intro")).toHaveCount(0);
  const breathMonitor = page.getByLabel("Live breathing monitor");
  await expect(breathMonitor.getByRole("img", { name: /Live breathing amplitude/ })).toBeVisible();
  await expect(breathMonitor.getByRole("status")).toHaveText("Mic starts with session");
  await startPreview(page).click();
  await expect(stopSession(page)).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-status", "running");
  await expect(page.locator("main")).toHaveAttribute("data-live-visible", "false");
  await page.clock.runFor(89_000);
  await expect(stopSession(page)).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Session progress" })).toHaveAttribute("aria-valuenow", "89");
  await page.clock.runFor(1_100);
  await expect(page.locator("main")).toHaveAttribute("data-status", "completed");
  await expect(stopSession(page)).toHaveCount(0);
  await startPreview(page).click();
  await expect(page.getByRole("progressbar", { name: "Session progress" })).toHaveAttribute("aria-valuenow", "0");
  await page.clock.runFor(4_000);
  await expect(stopSession(page)).toBeVisible();
  await stopSession(page).click();
  await expect(page.locator("main")).toHaveAttribute("data-status", "stopped");
});

test("patient signals choose distinct responses and remain available during a session", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Breathing, motion & sensors", { exact: false }).click();
  const faster = page.getByRole("radio", { name: /^Faster breathing/ });
  const baseline = page.getByRole("radio", { name: /^Baseline breathing/ });
  await faster.click();
  await expect(faster).toHaveAttribute("aria-checked", "true");
  await expect(pace(page)).toHaveValue("18");
  await expect(page.getByText("Still mist lake · local reference image", { exact: true })).toBeVisible();
  await expect(page.locator(".experience-scene-base")).toHaveAttribute("src", /protective-still-lake/);
  await expect(page.locator("audio[aria-label=\"Ambient scene sound\"]")).toHaveAttribute("src", /still-lake-loop/);
  await baseline.click();
  await expect(baseline).toHaveAttribute("aria-checked", "true");
  await expect(pace(page)).toHaveValue("12");
  await startPreview(page).click();
  await expect(faster).toBeEnabled();
  await faster.click();
  await expect(faster).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".experience-scene-base")).toHaveAttribute("src", /protective-still-lake/);
  await expect(page.locator("main")).toHaveAttribute("data-motion", "still");
  await baseline.click();
  await expect(baseline).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".experience-scene-base")).toHaveAttribute("src", /willow-breeze/);
  await expect(page.locator("audio[aria-label=\"Ambient scene sound\"]")).toHaveAttribute("src", /willow-breeze-loop/);
  await expect(page.locator("main")).toHaveAttribute("data-motion", "gentle");
  await stopSession(page).click();
  await expect(faster).toBeEnabled();
});

test("the willow canopy visibly sways over a continuous matching ambience", async ({ page }) => {
  await page.goto("/");
  const layers = page.locator(".experience-willow-layer");
  await expect(layers).toHaveCount(3);
  await expect(layers.first()).toHaveCSS("animation-name", /experience-willow/);
  const initialTransform = await layers.first().evaluate((layer) => getComputedStyle(layer).transform);
  await expect.poll(
    () => layers.first().evaluate((layer) => getComputedStyle(layer).transform),
    { message: "The foreground leaves should move instead of reading as a still image" },
  ).not.toBe(initialTransform);

  const sound = page.getByRole("button", { name: "Turn sound on", exact: true });
  await sound.click();
  const audio = page.locator("audio[aria-label=\"Ambient scene sound\"]");
  await expect(audio).toHaveAttribute("src", /willow-breeze-loop/);
  await expect(audio).toHaveAttribute("loop", "");
  await expect.poll(() => audio.evaluate((element) => !(element as HTMLAudioElement).paused)).toBe(true);
});

test("live breath activity switches to clouds immediately and quiet returns to the tree", async ({ page }) => {
  await page.addInitScript(() => {
    let amplitude = 0;
    const track = { readyState: "live", onended: null as (() => void) | null, stop() { this.readyState = "ended"; } };
    class ResponsiveAudioContext {
      state = "running";
      onstatechange: (() => void) | null = null;
      async resume() {}
      async close() { this.state = "closed"; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() {
        return {
          fftSize: 2048,
          getFloatTimeDomainData(buffer: Float32Array) {
            for (let i = 0; i < buffer.length; i++) buffer[i] = i % 2 ? amplitude : -amplitude;
          },
          disconnect() {},
        };
      }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: ResponsiveAudioContext });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) },
    });
    Object.defineProperty(window, "__setDemoMicAmplitude", {
      configurable: true,
      value: (next: number) => { amplitude = next; },
    });
  });
  await page.goto("/");
  await startPreview(page).click();
  const monitor = page.getByLabel("Live breathing monitor");
  await expect(monitor.getByRole("status")).toHaveText("Listening · tree scene");
  await page.waitForTimeout(1_600);
  await page.evaluate(() => (window as unknown as { __setDemoMicAmplitude(value: number): void }).__setDemoMicAmplitude(0.2));
  await expect(monitor.getByRole("status")).toHaveText("Fast breath detected · cloud scene");
  await expect(page.locator("main")).toHaveAttribute("data-scene", "still-lake");
  await page.evaluate(() => (window as unknown as { __setDemoMicAmplitude(value: number): void }).__setDemoMicAmplitude(0));
  await expect(monitor.getByRole("status")).toHaveText("Listening · tree scene", { timeout: 5_000 });
  await expect(page.locator("main")).toHaveAttribute("data-scene", "willow-breeze");
  await stopSession(page).click();
});

test("Stop ends preview immediately and later timer ticks cannot revive the scene", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByText("Breathing, motion & sensors", { exact: false }).click();
  await guide(page).click();
  await startPreview(page).click();
  await page.clock.runFor(5_000);
  await stopSession(page).click();
  await expect(page.locator("main")).toHaveAttribute("data-status", "stopped");
  await expect(page.getByRole("progressbar", { name: "Session progress" })).toHaveCount(0);
  await expect(startPreview(page)).toBeEnabled();
  await page.clock.runFor(120_000);
  await expect(page.locator("main")).toHaveAttribute("data-status", "stopped");
  await expect(stopSession(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Breathe (in|out)$/ })).toHaveCount(0);
});

test("guide, motion and manual pace stay keyboard accessible while the scene responds", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const details = page.getByText("Breathing, motion & sensors", { exact: false });
  await details.focus();
  await details.press("Enter");
  await pace(page).press("Home");
  await expect(pace(page)).toHaveValue("4");
  await expect(page.locator(".experience-pace output")).toContainText("4.0");
  await guide(page).focus();
  await guide(page).press("Space");
  await expect(guide(page)).toBeChecked();
  const still = page.getByRole("button", { name: "Still", exact: true });
  await still.focus();
  await still.press("Enter");
  await expect(still).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Gentle", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("main")).toHaveAttribute("data-motion", "still");
  await startPreview(page).click();
  await expect(page.getByRole("heading", { name: "Breathe in", exact: true })).toBeVisible();
  await page.getByText("Breathing, motion & sensors", { exact: false }).click();
  await pace(page).press("End");
  await expect(pace(page)).toHaveValue("20");
  await expect(page.getByText("Changes update the scene. The optional guide keeps the rhythm captured at Start.", { exact: true })).toBeVisible();
  await page.clock.runFor(6_000);
  // The captured 4 BPM has a 7.5s inhale; the new 20 BPM applies next time.
  await expect(page.getByRole("heading", { name: "Breathe in", exact: true })).toBeVisible();
  await page.clock.runFor(2_000);
  await expect(page.getByRole("heading", { name: "Breathe out", exact: true })).toBeVisible();
  await guide(page).click();
  await expect(guide(page)).not.toBeChecked();
  await expect(page.locator("main")).toHaveAttribute("data-status", "running");
  await stopSession(page).click();
});

test("denied microphone permission leaves manual pace and preview usable", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Breathing, motion & sensors", { exact: false }).click();
  await page.getByRole("button", { name: "Use microphone", exact: true }).click();
  await expect(page.locator(".experience-mic-actions").getByRole("status")).toContainText("Microphone permission was denied");
  await expect(page.getByText("Manual pace selected", { exact: true })).toBeVisible();
  await pace(page).press("ArrowRight");
  await expect(pace(page)).toHaveValue("12.5");
  await startPreview(page).click();
  await expect(stopSession(page)).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-status", "running");
  await page.getByText("Breathing, motion & sensors", { exact: false }).click();
  await expect(page.getByRole("button", { name: "Use microphone", exact: true })).toBeEnabled();
  await stopSession(page).click();
  await page.getByText("Breathing, motion & sensors", { exact: false }).click();
  await expect(page.getByRole("button", { name: "Use microphone", exact: true })).toBeEnabled();
});

test("configuration failure still offers a usable local preview", async ({ page }) => {
  await page.route("**/api/experience/config", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start live session", exact: true })).toBeDisabled();
  await expect(page.getByText("Live scenery is unavailable. The preview works without a connection.", { exact: true })).toBeVisible();
  await startPreview(page).click();
  await expect(stopSession(page)).toBeVisible();
  await stopSession(page).click();
  await expect(startPreview(page)).toBeEnabled();
});

test("mobile controls fit at 375px and Stop stays reachable after scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByText("Breathing, motion & sensors", { exact: false }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await startPreview(page).click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(stopSession(page)).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(stopSession(page)).toBeInViewport({ ratio: 1 });
  await stopSession(page).click();
  await expect(startPreview(page)).toBeEnabled();
});

test("reduced motion disables decorative movement and sound controls remain keyboard accessible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".experience-live-video")).toHaveCSS("transition-duration", "0s");
  const sound = page.getByRole("button", { name: "Turn sound on", exact: true });
  await sound.focus();
  await sound.press("Enter");
  await expect(page.getByRole("button", { name: "Mute sound", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Breathing, motion & sensors", { exact: false }).click();
  await expect(page.getByText("Ambient sound on", { exact: true })).toBeVisible();
  await expect.poll(() => page.locator("audio[aria-label=\"Ambient scene sound\"]").evaluate((audio) => !(audio as HTMLAudioElement).paused)).toBe(true);
  await guide(page).click();
  await startPreview(page).click();
  await expect(page.locator(".experience-guide-orb")).toHaveCSS("transform", "none");
  await stopSession(page).focus();
  await stopSession(page).press("Enter");
  await expect(startPreview(page)).toBeEnabled();
});
