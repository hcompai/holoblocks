import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decompressFrames, parseGIF } from "gifuct-js";
import { planFilm, rising } from "../src/filmPlan";
import { model, site } from "./fixtures";

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
    expect(floor.end).toBeCloseTo(cube.start, 9);
    expect(cube.end).toBeCloseTo(plan.assembled, 9);
    expect(plan.hold).toBe(seconds - 1);
    expect(rising(plan, 0)).toEqual({ step: -1, layers: 0 });
    expect(rising(plan, cube.start)).toEqual({ step: 1, layers: 1 });
    expect(rising(plan, plan.assembled)).toEqual({ step: 1, layers: 2 });
  }
  expect(() => planFilm({ boxes: [], steps: [] }, 8)).toThrow();
  expect(() => planFilm(HUT, 5)).toThrow();
});

test("Share a GIF makes a looping GIF of the build and leaves the viewer on its step", async ({ page }) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false }),
  );
  const hut = model();
  await site(page, [{ ...hut, id: "hut" }]);
  await page.goto("/?showcase=hut");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);
  await page.getByRole("button", { name: "First step" }).click();
  await page.getByRole("button", { name: "Share a GIF" }).click();

  const dialog = page.getByRole("dialog");
  const caption = dialog.getByLabel("Suggested caption");
  await expect(dialog.getByRole("combobox", { name: "Duration" })).toHaveValue("8");
  await expect(caption).toHaveValue(
    "Little Hut: 24 Minecraft blocks, built with HOLO4 by H Company. #HOLO4 #Blockyard #Minecraft",
  );
  await dialog.getByRole("checkbox", { name: "H Company logo" }).uncheck();
  await expect(caption).toHaveValue("Little Hut: 24 Minecraft blocks, built with Blockyard. #Blockyard #Minecraft");
  await dialog.getByRole("checkbox", { name: "H Company logo" }).check();
  await dialog.getByRole("button", { name: "Generate GIF" }).click();
  const link = dialog.getByRole("link", { name: "Download GIF" });
  await expect(link).toBeVisible({ timeout: 240000 });

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
  const moving = frames.slice(1).filter((f) => f.pixels.some((p) => p !== f.transparentIndex));
  expect(moving.length).toBeGreaterThan(frames.length / 2);

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
  await dialog.getByRole("button", { name: "Copy caption" }).click();
  await dialog.getByRole("button", { name: "Share…" }).click();
  expect(await page.evaluate(() => (window as unknown as { shared: object }).shared)).toEqual({
    name: "Little Hut-build.gif",
    type: "image/gif",
    text: expect.stringContaining("HOLO4"),
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("slider", { name: "Step" })).toHaveValue("0");
  expect(errors).toEqual([]);
});
