import { expect, test } from "@playwright/test";
import { model, site } from "./fixtures";
import { platform } from "./platform";

test("a live model stays framed when Reduce Motion skips the follow camera", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await site(page);
  const agp = await platform(page);
  const slab = { ...model("red"), blocks: ["red_wool"], boxes: [0, 0, 0, 15, 5, 15, 0, 0] };
  agp.session("framing");
  agp.say("framing", "A red slab");
  agp.share("framing", slab);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/?build=framing");
    await expect(page.locator(".viewer")).toHaveAttribute("data-revision", slab.revision);
    await expect(page.getByRole("button", { name: "Follow build", exact: true, includeHidden: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const png = await page.locator(".viewer-canvas canvas").screenshot();
    const bounds = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width,
        right = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > pixels[i + 1] + 20 && pixels[i] > pixels[i + 2] + 20) {
          left = Math.min(left, (i / 4) % canvas.width);
          right = Math.max(right, (i / 4) % canvas.width);
        }
      }
      return { width: (right - left) / canvas.width, center: (left + right) / 2 / canvas.width };
    }, png.toString("base64"));
    expect(bounds.width).toBeGreaterThan(0.3);
    expect(bounds.center).toBeGreaterThan(0.35);
    expect(bounds.center).toBeLessThan(0.65);
  }
});
