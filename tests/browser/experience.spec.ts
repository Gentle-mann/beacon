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
const pace = (page: Page) => page.getByRole("slider", { name: /Starting pace/ });

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
  await expect(guide(page)).not.toBeChecked();
  await expect(page.getByText("Willow by the water · local reference image", { exact: true })).toBeVisible();
  await startPreview(page).click();
  await expect(stopSession(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing to do. Just be here." })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-live-visible", "false");
  await page.clock.runFor(89_000);
  await expect(stopSession(page)).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Session progress" })).toHaveAttribute("aria-valuenow", "89");
  await page.clock.runFor(1_100);
  await expect(page.getByRole("heading", { name: "Take this moment with you." })).toBeVisible();
  await expect(stopSession(page)).toHaveCount(0);
  await startPreview(page).click();
  await expect(page.getByRole("progressbar", { name: "Session progress" })).toHaveAttribute("aria-valuenow", "0");
  await page.clock.runFor(4_000);
  await expect(stopSession(page)).toBeVisible();
  await stopSession(page).click();
  await expect(page.getByRole("heading", { name: "At your own pace." })).toBeVisible();
});

test("patient signals choose distinct responses and stay locked during a session", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Choose a starting pace", { exact: false }).click();
  const faster = page.getByRole("radio", { name: /^Faster breathing/ });
  const baseline = page.getByRole("radio", { name: /^Baseline breathing/ });
  await faster.click();
  await expect(faster).toHaveAttribute("aria-checked", "true");
  await expect(pace(page)).toHaveValue("18");
  await expect(page.getByText("Still mist lake · local reference image", { exact: true })).toBeVisible();
  await expect(page.locator(".experience-scene-image")).toHaveAttribute("src", /protective-still-lake/);
  await baseline.click();
  await expect(baseline).toHaveAttribute("aria-checked", "true");
  await expect(pace(page)).toHaveValue("12");
  await startPreview(page).click();
  await expect(faster).toBeDisabled();
  await expect(baseline).toBeDisabled();
  await stopSession(page).click();
  await expect(faster).toBeEnabled();
});

test("Stop ends preview immediately and later timer ticks cannot revive the scene", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await guide(page).click();
  await startPreview(page).click();
  await page.clock.runFor(5_000);
  await stopSession(page).click();
  await expect(page.getByRole("heading", { name: "At your own pace." })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Session progress" })).toHaveCount(0);
  await expect(startPreview(page)).toBeEnabled();
  await page.clock.runFor(120_000);
  await expect(page.getByRole("heading", { name: "At your own pace." })).toBeVisible();
  await expect(stopSession(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Breathe (in|out)$/ })).toHaveCount(0);
});

test("guide, motion and manual pace expose keyboard controls and capture pace for the current moment", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const details = page.getByText("Choose a starting pace", { exact: false });
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
  await pace(page).press("End");
  await expect(pace(page)).toHaveValue("20");
  await expect(page.getByText("Changes apply to your next moment.", { exact: true })).toBeVisible();
  await page.clock.runFor(6_000);
  // The captured 4 BPM has a 7.5s inhale; the new 20 BPM applies next time.
  await expect(page.getByRole("heading", { name: "Breathe in", exact: true })).toBeVisible();
  await page.clock.runFor(2_000);
  await expect(page.getByRole("heading", { name: "Breathe out", exact: true })).toBeVisible();
  await guide(page).click();
  await expect(guide(page)).not.toBeChecked();
  await expect(page.getByRole("heading", { name: "Nothing to do. Just be here." })).toBeVisible();
  await stopSession(page).click();
});

test("denied microphone permission leaves manual pace and preview usable", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Choose a starting pace", { exact: false }).click();
  await page.getByRole("button", { name: "Use microphone", exact: true }).click();
  await expect(page.locator(".experience-mic-actions").getByRole("status")).toContainText("Microphone permission was denied");
  await expect(page.getByText("Manual pace selected", { exact: true })).toBeVisible();
  await pace(page).press("ArrowRight");
  await expect(pace(page)).toHaveValue("12.5");
  await startPreview(page).click();
  await expect(stopSession(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing to do. Just be here." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use microphone", exact: true })).toBeDisabled();
  await stopSession(page).click();
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
  await page.getByText("Choose a starting pace", { exact: false }).click();
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
  await expect(page.getByText("Local preview is silent", { exact: true })).toBeVisible();
  await guide(page).click();
  await startPreview(page).click();
  await expect(page.locator(".experience-guide-orb")).toHaveCSS("transform", "none");
  await stopSession(page).focus();
  await stopSession(page).press("Enter");
  await expect(startPreview(page)).toBeEnabled();
});
