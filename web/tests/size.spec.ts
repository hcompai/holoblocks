import { expect, test } from "@playwright/test";
import { model, site } from "./fixtures";
import { platform } from "./platform";

test("model size counts the blocks the whole build spans, fixed during replay, following revisions", async ({
  page,
}, testInfo) => {
  await site(page);
  const agp = await platform(page);
  agp.session("size");
  agp.say("size", "A little hut");
  const hut = model();
  agp.share("size", hut);
  await page.goto("/?build=size");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);
  const size = page.getByLabel("Model size", { exact: true });
  await expect(size.locator("dt")).toHaveText(["Height", "Width", "Depth"]);
  await expect(size.locator("dd")).toHaveText(["3 blocks · 3 m", "4 blocks · 4 m", "4 blocks · 4 m"]);
  await page.screenshot({ path: testInfo.outputPath("model-size-desktop.png") });

  await page.getByRole("button", { name: "First step" }).click();
  await expect(page.getByRole("slider", { name: "Step" })).toHaveValue("0");
  await expect(size.locator("dd")).toHaveText(["3 blocks · 3 m", "4 blocks · 4 m", "4 blocks · 4 m"]);
  await page.getByRole("button", { name: "Last step" }).click();

  const pillar = [10, 0, 0, 10, 5, 0, 0, 1, 10, 3, 0, 10, 5, 0, 2, 1];
  const wider = { ...model("0a1b2c3d4e5f"), blocks: [...hut.blocks, "air"], boxes: [...hut.boxes, ...pillar] };
  agp.share("size", wider);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", wider.revision);
  await expect(size.locator("dd")).toHaveText(["3 blocks · 3 m", "11 blocks · 11 m", "4 blocks · 4 m"]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(size).toBeHidden();
  const controls = page.getByRole("button", { name: "View controls" });
  await controls.click();
  await expect(size).toBeInViewport({ ratio: 1 });
  await controls.click();
  await expect(size).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });

  agp.share("size", { ...model("0f0f0f0f0f0f"), blocks: [], boxes: [] });
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", "0f0f0f0f0f0f");
  await expect(size).toHaveCount(0);
});
