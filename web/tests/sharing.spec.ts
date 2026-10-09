import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { model, site } from "./fixtures";

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

async function openShowcase(page: Page) {
  const hut = { ...model(), id: "hut" };
  await site(page, [hut]);
  await page.goto("/?showcase=hut");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  return hut;
}

test("image sharing prepares a PNG, handles cancellation and retains a download fallback", async ({ page }, info) => {
  await page.addInitScript(() => {
    (window as any).shared = [];
    (window as any).shareFailure = "";
    Object.defineProperty(navigator, "canShare", { value: () => true });
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        if ((window as any).shareFailure) throw new DOMException("Test", (window as any).shareFailure);
        (window as any).shared.push({ name: data.files![0].name, type: data.files![0].type });
      },
    });
  });
  const hut = await openShowcase(page);
  await expect(page.getByRole("menuitem").first()).toHaveText("GIF");
  await page.getByRole("menuitem", { name: "Image", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share image", exact: true });
  await expect(dialog.getByRole("img", { name: hut.name, exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Share…", exact: true }).click();
  expect(await page.evaluate(() => (window as any).shared[0])).toEqual({ type: "image/png", name: `${hut.name}.png` });
  await page.evaluate(() => {
    (window as any).shareFailure = "AbortError";
  });
  await dialog.getByRole("button", { name: "Share…", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).shareFailure = "NotAllowedError";
  });
  await dialog.getByRole("button", { name: "Share…", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Save the image instead");
  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Save image", exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe(`${hut.name}.png`);
  expect((await readFile(await saved.path())).subarray(1, 4).toString()).toBe("PNG");
  await page.screenshot({ path: info.outputPath("mobile-share.png") });
});

test("phone GIF uses a square frame and the native sheet with a save fallback", async ({ page }, info) => {
  test.setTimeout(300000);
  await page.addInitScript(() => {
    (window as any).gifShare = null;
    Object.defineProperty(navigator, "canShare", { value: () => true });
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        if ((window as any).shareFailure) throw new DOMException("Test", (window as any).shareFailure);
        (window as any).gifShare = { type: data.files![0].type };
      },
    });
  });
  await openShowcase(page);
  await page.getByRole("menuitem", { name: "GIF", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share the build", exact: true });
  await expect(
    dialog.getByRole("radiogroup", { name: "Format", exact: true }).getByRole("radio", { name: "1:1" }),
  ).toHaveAttribute("aria-checked", "true");
  const share = dialog.getByRole("button", { name: "Share…", exact: true });
  await expect(share).toBeVisible({ timeout: 240000 });
  await expect(dialog.getByRole("button", { name: "Post on X", exact: true })).toHaveClass("film-primary");
  await expect(share).toHaveClass("film-secondary");
  await share.click();
  expect(await page.evaluate(() => (window as any).gifShare)).toEqual({ type: "image/gif" });
  await page.evaluate(() => {
    (window as any).shareFailure = "AbortError";
  });
  await share.click();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).shareFailure = "NotAllowedError";
  });
  await share.click();
  await expect(dialog.getByRole("status")).toContainText("Download the GIF");
  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download", exact: true }).click();
  const bytes = await readFile(await (await download).path());
  expect(bytes.subarray(0, 6).toString()).toBe("GIF89a");
  expect([bytes.readUInt16LE(6), bytes.readUInt16LE(8)]).toEqual([640, 640]);
  await page.screenshot({ path: info.outputPath("mobile-gif.png") });
});

for (const support of ["no-files", "no-share"] as const) {
  test(`image sharing falls back to saving when the browser has ${support}`, async ({ page }) => {
    await page.addInitScript((support) => {
      Object.defineProperty(navigator, "canShare", { value: () => support !== "no-files" });
      Object.defineProperty(navigator, "share", { value: support === "no-share" ? undefined : async () => {} });
    }, support);
    await openShowcase(page);
    await page.getByRole("menuitem", { name: "Image", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Share image", exact: true });
    await expect(dialog.getByRole("link", { name: "Save image", exact: true })).toHaveClass("film-primary");
    await expect(dialog.getByRole("button", { name: "Share…", exact: true })).toHaveCount(0);
  });
}
