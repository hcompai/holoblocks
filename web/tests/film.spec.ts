import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decompressFrames, parseGIF } from "gifuct-js";
import { planFilm, rising } from "../src/filmPlan";
import { model, shareMenu, site } from "./fixtures";
import { platform } from "./platform";

const HUT = {
  steps: model().steps,
  boxes: [
    { x0: 0, y0: 0, z0: 0, x1: 3, y1: 0, z1: 3, block: "stone", step: 0 },
    { x0: 1, y0: 1, z0: 1, x1: 2, y1: 2, z1: 2, block: "oak_planks", step: 1 },
  ],
};

test("a film raises each step in order, bottom layer first, before the turntable", () => {
  for (const seconds of [6, 8, 30, 60]) {
    const plan = planFilm(HUT, seconds);
    const [floor, cube] = plan.steps;
    expect(plan.steps.map((s) => s.title)).toEqual(["Floor", "Cube"]);
    expect(cube.start - floor.end).toBeCloseTo(0.3, 9);
    expect(rising(plan, floor.end + 0.15)).toEqual({ step: 0, layers: 1 });
    expect(cube.end).toBeCloseTo(plan.assembled, 9);
    expect(plan.hold).toBe(seconds - 1);
    expect(rising(plan, 0)).toEqual({ step: -1, layers: 0 });
    expect(rising(plan, cube.start)).toEqual({ step: 1, layers: 1 });
    expect(rising(plan, plan.assembled)).toEqual({ step: 1, layers: 2 });
  }
  expect(() => planFilm({ boxes: [], steps: [] }, 8)).toThrow();
  expect(() => planFilm(HUT, 5)).toThrow();
});

test("the GIF call to action appears only for a completed, nonempty build", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  const cta = page.getByRole("button", { name: "GIF", exact: true });
  agp.session("live");
  agp.say("live", "A little hut");
  agp.state("live", "running");
  agp.share("live", model());
  await page.goto("/?build=live");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model().revision);
  await expect(cta).toHaveCount(0);
  agp.answer("live", "Built.");
  agp.state("live", "idle");
  agp.sessions.get("live")!.status = "completed";
  await expect(cta).toHaveCount(1);

  await site(page, [{ ...model(), id: "empty", boxes: [], steps: [] }]);
  await page.goto("/?showcase=empty");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model().revision);
  await expect(cta).toHaveCount(0);
});

test("Share GIF makes a credited looping GIF of the build and leaves the viewer on its step", async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
    const drawn: { text: string; fits: boolean }[] = [];
    const marks = { count: 0 };
    Object.assign(window, { filmText: drawn, filmMarks: marks });
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
      drawn.push({ text, fits: x + this.measureText(text).width <= this.canvas.width });
      return fill.call(this, text, x, y, ...rest);
    };
    const arc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function (...args) {
      marks.count++;
      return arc.apply(this, args);
    };
  });
  const hut = model();
  await site(page, [{ ...hut, id: "hut" }]);
  await page.goto("/?showcase=hut");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);
  await page.getByRole("button", { name: "First step" }).click();
  await (await shareMenu(page)).getByRole("menuitem", { name: "Share GIF…" }).click();

  const dialog = page.getByRole("dialog");
  const caption = dialog.getByLabel("Caption");
  const duration = dialog.getByRole("radiogroup", { name: "Duration", exact: true });
  await expect(duration.getByRole("radio", { name: "8s" })).toHaveAttribute("aria-checked", "true");
  const camera = dialog.getByRole("radiogroup", { name: "Camera", exact: true });
  await expect(camera.getByRole("radio", { name: "Follow" })).toHaveAttribute("aria-checked", "true");
  await expect(camera.getByRole("radio")).toHaveText(["Follow", "Orbit", "Fixed"]);
  await expect(caption).toHaveValue(
    "Little Hut: 24 blocks, built with Holo4 27B by H Company. #Holo4 #HCompany #HoloBlocks",
  );
  await dialog.getByRole("checkbox", { name: "H logo" }).uncheck();
  await expect(caption).toHaveValue("Little Hut: 24 blocks, built with HoloBlocks. #HoloBlocks");
  await dialog.getByRole("checkbox", { name: "H logo" }).check();
  const link = dialog.getByRole("link", { name: "Download" });
  await expect(link).toBeVisible({ timeout: 240000 });

  await page.evaluate(() => {
    window.open = (url, target, features) => {
      Object.assign(window, { xPost: { url: String(url), target, features } });
      return null;
    };
  });
  const xDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Post on X", exact: true }).click();
  expect((await xDownload).suggestedFilename()).toMatch(/\.gif$/);
  const post = await page.evaluate(() => (window as unknown as { xPost: { url: string; features: string } }).xPost);
  const intent = new URL(post.url);
  expect(intent.origin + intent.pathname).toBe("https://x.com/intent/tweet");
  expect(intent.searchParams.get("text")).toBe(await caption.inputValue());
  expect(intent.searchParams.has("url")).toBe(false);
  expect(post.features).toBe("noopener,noreferrer");

  const pending = page.waitForEvent("download");
  await link.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("Little Hut-build.gif");
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 6).toString()).toBe("GIF89a");
  expect(bytes.includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
  expect(bytes.length).toBeLessThan(8 * 1024 * 1024);
  const gif = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  expect([gif.lsd.width, gif.lsd.height]).toEqual([640, 360]);
  const frames = decompressFrames(gif, false);
  expect(frames).toHaveLength(8 * 20);
  expect(frames.every((f) => f.delay === 50)).toBe(true);
  const { drawn, marks } = await page.evaluate(() => {
    const w = window as unknown as { filmText: { text: string; fits: boolean }[]; filmMarks: { count: number } };
    return { drawn: w.filmText, marks: w.filmMarks.count };
  });
  expect(drawn.filter((c) => c.text === " blocks").length).toBeGreaterThanOrEqual(160);
  expect(drawn.some((c) => c.text.startsWith("Powered by"))).toBe(false);
  expect(drawn.every((c) => c.fits)).toBe(true);
  expect(marks).toBeGreaterThanOrEqual(160);
  await dialog.locator(".film-preview img").screenshot({ path: testInfo.outputPath("credited-gif.png") });
  // Held shots deliberately produce identical frames between layer placements.
  const sceneChanges = (i: number) =>
    frames[i].pixels.some((p, j) => p !== frames[i].transparentIndex && j < gif.lsd.width * gif.lsd.height * 0.8);
  const plan = planFilm(HUT, 8);
  const [floor, cube] = plan.steps;
  expect(sceneChanges(Math.ceil(floor.start * 20))).toBe(true);
  expect(sceneChanges(Math.round(((floor.start + floor.end) / 2) * 20))).toBe(false);
  expect(sceneChanges(Math.round(((floor.end + cube.start) / 2) * 20))).toBe(true);
  expect(sceneChanges(Math.ceil(((cube.start + cube.end) / 2) * 20))).toBe(true);
  expect(sceneChanges(Math.round((plan.assembled + 0.5) * 20))).toBe(true);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const [file] = data.files!;
        (window as unknown as { shared: object }).shared = { name: file.name, type: file.type, text: data.text };
      },
    });
  });
  // A render lets the dialog see the platform that can now share files.
  await dialog.getByRole("button", { name: "Copy" }).click();
  await dialog.getByRole("button", { name: "Share…" }).click();
  expect(await page.evaluate(() => (window as unknown as { shared: object }).shared)).toEqual({
    name: "Little Hut-build.gif",
    type: "image/gif",
    text: expect.stringContaining("Holo4 27B by H Company"),
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("slider", { name: "Step" })).toHaveValue("0");
  expect(errors).toEqual([]);
});

test("film frames include a readable website address", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript((host) => {
    const frames: boolean[] = [];
    Object.assign(window, { websiteFrames: frames });
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
      if (text === host) {
        const width = this.measureText(text).width;
        const left = this.textAlign === "right" ? x - width : this.textAlign === "center" ? x - width / 2 : x;
        frames.push(left >= 0 && left + width <= this.canvas.width && y < this.canvas.height);
      }
      return fill.call(this, text, x, y, ...rest);
    };
  }, "blocks.hcompany.ai");
  const hut = model();
  await site(page, [{ ...hut, id: "hut" }]);
  await page.goto("/?showcase=hut");
  await (await shareMenu(page)).getByRole("menuitem", { name: "Share GIF…" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { websiteFrames: boolean[] }).websiteFrames.length), {
      timeout: 90000,
    })
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(() => (window as unknown as { websiteFrames: boolean[] }).websiteFrames.every(Boolean)),
  ).toBe(true);
  await page.locator(".film-preview").screenshot({ path: testInfo.outputPath("website-preview.png") });
  await page.keyboard.press("Escape");
});
