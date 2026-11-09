import { expect, test, type Page } from "@playwright/test";
import { model, site } from "./fixtures";
import { platform } from "./platform";

async function hut(page: Page) {
  const mocked = await site(page);
  const agp = await platform(page);
  agp.session("hut", "idle");
  agp.say("hut", "A little hut");
  agp.share("hut", model());
  agp.answer("hut", "Built.");
  return mocked;
}

const mine = (page: Page) => page.getByRole("region", { name: "Your builds" }).locator(".tile-owned");

test("Your builds lists the user's own sessions, never a teammate's", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  for (const [id, teammate] of [
    ["hut", false],
    ["theirs", true],
  ] as const) {
    agp.session(id, "idle", { teammate });
    agp.say(id, "A little hut");
    agp.share(id, model());
    agp.answer(id, "Built.");
  }
  await page.goto("/");
  await expect(mine(page)).toHaveCount(1);
});

test("the owner renames a build from its title or its card, and the name sticks", async ({ page }) => {
  const { names } = await hut(page);
  await page.goto("/?build=hut");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model().revision);

  await page.getByRole("button", { name: "Rename Little Hut" }).click();
  await page.getByRole("textbox", { name: "Build name" }).fill("  Red hut ");
  await page.keyboard.press("Enter");
  await expect(page.locator(".aside-title")).toHaveText("Red hut");
  expect(names.get("hut")).toMatchObject({ name: "Red hut" });
  await page.reload();
  await expect(page.locator(".aside-title")).toHaveText("Red hut");

  await page.getByRole("button", { name: "HoloBlocks", exact: true }).click();
  await expect(mine(page)).toContainText("Red hut");
  await page.getByRole("button", { name: "Rename, publish or delete Red hut" }).click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByRole("textbox", { name: "New name" }).fill("Blue hut");
  await page.getByRole("form", { name: "Rename" }).getByRole("button", { name: "Rename" }).click();
  await expect(mine(page)).toContainText("Blue hut");
  expect(names.get("hut")).toMatchObject({ name: "Blue hut" });
});

test("a card's menu publishes the owner's build, makes it private and deletes it, each after a confirmation", async ({
  page,
}) => {
  const { deleted } = await hut(page);
  const published: { id: string }[] = [];
  const calls: string[] = [];
  await page.route("**/api/builds*", (route) => {
    const request = route.request();
    const id = new URL(request.url()).searchParams.get("id");
    calls.push(`${request.method()} ${id ?? request.postDataJSON()?.id ?? ""}`);
    if (request.method() === "POST") {
      const entry = {
        id: request.postDataJSON().id,
        name: "A little hut",
        prompt: "A little hut",
        steps: 2,
        author: "Jane Doe",
        owner: "u-jane",
        published: 1,
        thumbnail: null,
        build: "https://blob.test/hut.json.gz",
      };
      published.push(entry);
      return route.fulfill({ status: 201, json: entry });
    }
    if (request.method() === "DELETE") {
      published.splice(0, published.length);
      return route.fulfill({ status: 204 });
    }
    return id ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: published });
  });
  await page.goto("/");
  await expect(mine(page)).toHaveCount(1);
  const menu = mine(page).getByRole("button", { name: /^Rename, publish or delete / });

  await menu.click();
  await page.getByRole("menuitem", { name: "Publish…" }).click();
  await page.getByRole("dialog", { name: "Publish" }).getByRole("button", { name: "Publish" }).click();
  await expect(mine(page)).toContainText("public");
  expect(calls).toContain("POST hut");

  await menu.click();
  await page.getByRole("menuitem", { name: "Make private…" }).click();
  await page.getByRole("dialog", { name: "Make private" }).getByRole("button", { name: "Make private" }).click();
  await expect(mine(page)).not.toContainText("public");
  expect(calls).toContain("DELETE hut");

  await menu.click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const remove = page.getByRole("dialog", { name: "Delete" });
  await expect(remove).toContainText("Its chat stays on H's platform");
  await remove.getByRole("button", { name: "Delete" }).click();
  await expect(mine(page)).toHaveCount(0);
  expect(deleted).toEqual(["hut"]);
});
