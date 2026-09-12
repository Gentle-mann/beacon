import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("full offline trace captures the source once and exports all 22 timestamped prompts", async ({ page }) => {
  const forbidden: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") || !request.url().startsWith("http://127.0.0.1:3100")) forbidden.push(request.url());
  });
  await page.goto("/breath");
  const slider = page.getByRole("slider");
  await slider.fill("18");
  await page.getByRole("button", { name: "Simulate full 90s" }).click();
  await expect(page.getByLabel("Target BPM", { exact: true })).toHaveText("6.0");
  await expect(page.getByLabel("Prompt count", { exact: true })).toHaveText("22");
  await expect(page.getByText("Captured 18.0 BPM · slider")).toBeVisible();
  await slider.fill("4");
  await expect(page.getByText("Captured 18.0 BPM · slider")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  const content = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(content.simulated).toBe(true);
  expect(content.startBpm).toBe(18);
  expect(content.prompts).toHaveLength(22);
  expect(content.prompts.at(-1).elapsedMs).toBe(86_240);
  for (const prompt of content.prompts) {
    expect(prompt.elapsedMs).toBeLessThan(90_000);
    expect(prompt.text).toContain("Continuous slow motion, no cuts, a single unbroken take.");
    expect(Date.parse(prompt.at)).toBe(prompt.timestampMs);
  }
  await page.getByRole("button", { name: "Simulate full 90s" }).click();
  await expect(page.getByLabel("Target BPM", { exact: true })).toHaveText("4.0");
  await expect(page.getByText("Captured 4.0 BPM · slider")).toBeVisible();
  expect(forbidden).toEqual([]);
});

test("real-time preview samples fake chunks and stops at its deadline", async ({ page }) => {
  await page.clock.install();
  await page.goto("/breath");
  await page.getByRole("button", { name: "Play 90s preview" }).click();
  await page.clock.runFor(3_000);
  await expect(page.getByLabel("Prompt count", { exact: true })).toHaveText("0");
  await page.clock.runFor(1_000);
  await expect(page.getByLabel("Prompt count", { exact: true })).toHaveText("1");
  await page.clock.runFor(86_100);
  await expect(page.getByLabel("Arc elapsed", { exact: true })).toHaveText("90.0 / 90s");
  await expect(page.getByLabel("Prompt count", { exact: true })).toHaveText("22");
  await expect(page.getByRole("button", { name: "Stop preview" })).toHaveCount(0);
  await page.clock.runFor(10_000);
  await expect(page.getByLabel("Prompt count", { exact: true })).toHaveText("22");
  await page.getByRole("button", { name: "Play 90s preview" }).click();
  await expect(page.getByLabel("Prompt count", { exact: true })).toHaveText("0");
  await page.clock.runFor(4_000);
  await expect(page.getByLabel("Prompt count", { exact: true })).toHaveText("1");
  await page.getByRole("button", { name: "Stop preview" }).click();
  await page.clock.runFor(5_000);
  await expect(page.getByLabel("Prompt count", { exact: true })).toHaveText("1");
});

test("workbench remains within a narrow viewport after simulation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/breath");
  await page.getByRole("button", { name: "Simulate full 90s" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("slider")).toBeVisible();
});
