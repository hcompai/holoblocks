import { expect, test } from "@playwright/test";
import { model, site } from "./fixtures";
import { platform } from "./platform";

test("a running build guards the tab and keeps the screen awake through the library, and lets go when it finishes", async ({
  page,
}) => {
  await site(page, [{ ...model(), id: "village", name: "Village" }]);
  const agp = await platform(page);
  agp.session("live");
  agp.say("live", "Build a hut");
  agp.share("live", model());
  await page.addInitScript(() => {
    const w = window as unknown as { locks: { released: boolean }[] };
    w.locks = [];
    Object.defineProperty(navigator, "wakeLock", {
      value: {
        request: async () => {
          const lock = { released: false, release: async () => void (lock.released = true) };
          w.locks.push(lock);
          return lock;
        },
      },
    });
  });
  const awake = () =>
    page.evaluate(
      () => (window as unknown as { locks: { released: boolean }[] }).locks.filter((l) => !l.released).length,
    );
  const guarded = () =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  await page.goto("/?build=live");
  await expect.poll(guarded).toBe(true);
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("region", { name: "Public" }).locator(".gallery-card").click();
  await expect(page).toHaveURL(/village/);
  expect(await guarded()).toBe(true);
  expect(await awake()).toBe(1);
  agp.look("live", "away");
  await expect.poll(() => agp.posted("/tool_results").length).toBe(1);
  agp.answer("live", "Finished.");
  await expect.poll(guarded).toBe(false);
  expect(await awake()).toBe(0);
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
  await expect(page.getByRole("textbox", { name: "Change this build" })).toBeVisible();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  let asked = false;
  page.once("dialog", (dialog) => {
    asked = true;
    void dialog.dismiss();
  });
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect.poll(() => asked).toBe(true);
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
});
