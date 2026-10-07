import { expect, test } from "@playwright/test";
import { model, site } from "./fixtures";
import { platform } from "./platform";

test.use({ viewport: { width: 390, height: 844 } });

test("on a phone the model fills the screen under a chat sheet that peeks, expands and drags back", async ({
  page,
}, testInfo) => {
  await site(page);
  const agp = await platform(page);
  const hut = model();
  agp.session("phone", "idle");
  agp.say("phone", "A little hut");
  agp.share("phone", hut);
  agp.answer("phone", "The hut is ready.");
  await page.goto("/?build=phone");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);

  const sheet = page.locator("aside.sheet");
  const log = page.locator(".chat-log");
  expect((await page.locator(".viewer").boundingBox())!.height).toBeGreaterThan(844 * 0.75);
  await expect(page.getByPlaceholder("Ask for a change")).toBeInViewport();
  await expect(log).toBeHidden();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeInViewport();
  await expect(page.locator(".timeline")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const badge = (await page.getByLabel("Model: Holo4 27B", { exact: true }).boundingBox())!;
  const send = (await page.getByRole("button", { name: "Send", exact: true }).boundingBox())!;
  const placeholderEnd = await page.getByPlaceholder("Ask for a change").evaluate((area: HTMLTextAreaElement) => {
    const style = getComputedStyle(area);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = style.font;
    return area.getBoundingClientRect().left + parseFloat(style.paddingLeft) + ctx.measureText(area.placeholder).width;
  });
  expect(badge.x).toBeGreaterThan(placeholderEnd);
  expect(badge.x + badge.width).toBeLessThanOrEqual(send.x);
  await page.screenshot({ path: testInfo.outputPath("phone-peek.png") });

  await page.locator(".sheet-handle").click();
  await expect(sheet).toHaveAttribute("data-detent", "half");
  await expect(log).toContainText("The hut is ready.");
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(sheet.locator(".code")).toContainText("Cube");
  await page.getByRole("tab", { name: "Blocks", exact: true }).click();
  await expect(sheet.locator(".parts")).toContainText("24 blocks");
  await expect(page.locator(".viewer canvas")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-blocks.png") });

  const handle = (await page.locator(".sheet-handle").boundingBox())!;
  const x = handle.x + handle.width / 2;
  await page.mouse.move(x, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(x, 820, { steps: 6 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute("data-detent", "peek");
  await expect(page.getByPlaceholder("Ask for a change")).toBeInViewport();
  await page.getByPlaceholder("Ask for a change").fill("Make it taller");
  await expect(page.getByLabel("Model: Holo4 27B", { exact: true })).toBeHidden();
});
