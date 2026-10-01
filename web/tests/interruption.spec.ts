import { expect, test } from "@playwright/test";
import { model, site } from "./fixtures";
import { platform } from "./platform";

test("the keep-open notice and close guard follow running builds through the library and stop when they finish", async ({
  page,
}) => {
  await site(page, [{ ...model(), id: "village", name: "Village" }]);
  const agp = await platform(page);
  agp.session("live");
  agp.say("live", "Build a hut");
  agp.share("live", model());
  await page.goto("/?build=live");
  const note = page.getByRole("note", { name: "Keep Blockyard open" });
  await expect(note).toContainText("sleeping your device can interrupt");
  await page.getByRole("button", { name: "Library" }).click();
  await expect(note).toBeVisible();
  await page.getByRole("region", { name: "Public" }).locator(".gallery-card").click();
  await expect(note).toBeVisible();
  const guarded = () =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await guarded()).toBe(true);
  agp.look("live", "away");
  await expect.poll(() => agp.posted("/tool_results").length).toBe(1);
  agp.answer("live", "Finished.");
  await expect(note).toHaveCount(0);
  expect(await guarded()).toBe(false);
});

test("a failed Workstation says so plainly, offers to continue, and keeps the raw error folded", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("failed", "failed");
  agp.sessions.get("failed")!.error = "CodeSandboxGoneError: Session example is not running (status: failed)";
  agp.say("failed", "A little hut");
  agp.share("failed", model());
  await page.goto("/?build=failed");
  await expect(page.locator(".msg.error")).toHaveText(
    "The building service stopped unexpectedly. You can continue below.",
  );
  await expect(page.getByRole("button", { name: "Continue from saved version" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remix a copy" })).toBeVisible();
  await expect(page.getByText(/CodeSandboxGoneError/)).toBeHidden();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.getByText(/CodeSandboxGoneError/)).toBeVisible();
  await page.screenshot({ path: "test-results/recovery.png" });
});

test("signing out during a build asks first", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("live");
  await page.goto("/?build=live");
  await expect(page.getByRole("note", { name: "Keep Blockyard open" })).toBeVisible();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
});
