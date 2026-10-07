import { expect, test, type Page } from "@playwright/test";
import { model, site } from "./fixtures";
import { platform } from "./platform";

const shown = (page: Page, revision: string) =>
  expect(page.locator(".viewer")).toHaveAttribute("data-revision", revision);

/** A build whose session shared a floor and cube, then the floor alone, then the floor again under a new name. */
async function built(page: Page) {
  const first = model("r1");
  const second = { ...model("r2"), steps: first.steps.slice(0, 1), boxes: first.boxes.slice(0, 8) };
  const { forks } = await site(page);
  const agp = await platform(page);
  agp.session("hut", "idle");
  agp.say("hut", "A little hut");
  agp.share("hut", first);
  agp.say("hut", "Only the floor");
  agp.share("hut", second);
  agp.share("hut", { ...second, name: "Floor" });
  agp.answer("hut", "Done.");
  return { forks, agp };
}

test("the history lists each model Holo shared; a past one opens read only, then Latest comes back", async ({
  page,
}) => {
  await built(page);
  await page.goto("/?build=hut");
  await shown(page, "r2");

  await page.locator(".history-tools").getByRole("button", { name: "History" }).click();
  const versions = page.getByRole("region", { name: "Version history" }).getByRole("button", { name: /^V\d/ });
  await expect(versions).toHaveText([/^V2 Latest1 step/, /^V1 2 steps/]);

  await versions.filter({ hasText: "V1" }).click();
  await shown(page, "r1");
  await expect(page).toHaveURL(/\?build=hut&version=1$/);
  await expect(page.locator(".preview-note")).toContainText("Previewing V1, read only");
  await expect(page.getByPlaceholder("Ask for a change")).toHaveCount(0);

  await page.locator(".preview-note").getByRole("button", { name: "Latest" }).click();
  await shown(page, "r2");
  await expect(page).toHaveURL(/\?build=hut$/);
  await expect(page.getByPlaceholder("Ask for a change")).toBeVisible();
});

test("a version's link opens it, and forking it copies that model with where it came from", async ({ page }) => {
  const { forks, agp } = await built(page);
  await page.goto("/?build=hut&version=1");
  await shown(page, "r1");
  await expect(page.locator(".preview-note")).toContainText("Previewing V1, read only");

  await page.locator(".preview-note").getByRole("button", { name: "Fork" }).click();
  await expect(page).toHaveURL(/\?fork=fork-[a-f0-9-]{36}$/);
  await shown(page, "r1");
  await expect(page.locator(".recovery-origin")).toHaveText("Fork of Floor · V1");
  const [fork] = forks.values();
  expect(fork.seed.origin).toEqual({ id: "hut", source: "session", name: "Floor", version: 1, revision: "r1" });
  expect(fork.seed.model.boxes).toEqual(model().boxes);
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
});
