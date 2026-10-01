import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import type { Model } from "../src/model";
import { ACCOUNT, model, shareMenu, site } from "./fixtures";

const BLOB = "https://blob.test";

/** The library API holding one imported build of the signed-in user's, with PATCH, ?mine=1 and DELETE. */
async function library(page: Page, build: Model & { id: string }) {
  const entries = [
    {
      id: build.id,
      name: build.name,
      prompt: "",
      steps: build.steps.length,
      author: ACCOUNT.user.name,
      owner: ACCOUNT.user.id,
      published: 1,
      thumbnail: null,
      build: `${BLOB}/builds/${build.id}/build.json.gz`,
      private: false,
    },
  ];
  const calls: { method: string; search: string; body: unknown; auth: string | undefined }[] = [];
  await page.route(`${BLOB}/**`, (route) =>
    entries.length
      ? route.fulfill({
          headers: { "access-control-allow-origin": "*" },
          body: gzipSync(JSON.stringify({ ...build, status: "done", messages: [] })),
        })
      : route.fulfill({ status: 404 }),
  );
  await page.route("**/api/builds*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({
      method,
      search: url.search.replace(/[?&]t=\d+/, ""),
      body: method === "PATCH" ? request.postDataJSON() : null,
      auth: request.headers().authorization,
    });
    if (method === "PATCH") {
      const { id, private: hidden } = request.postDataJSON();
      entries.find((e) => e.id === id)!.private = hidden;
      return route.fulfill({ status: 204 });
    }
    if (method === "DELETE") {
      entries.splice(0, entries.length);
      return route.fulfill({ status: 204 });
    }
    const id = url.searchParams.get("id");
    if (url.searchParams.has("mine")) return route.fulfill({ json: entries.filter((e) => e.private) });
    if (id) {
      const entry = entries.find((e) => e.id === id && (!e.private || request.headers().authorization));
      return entry ? route.fulfill({ json: entry }) : route.fulfill({ status: 404, json: { error: "Not public." } });
    }
    return route.fulfill({ json: entries.filter((e) => !e.private) });
  });
  return calls;
}

test("an imported build goes private and stays under the user's builds, goes public again, then is deleted after a confirmation", async ({
  page,
}) => {
  const build = { ...model(), id: "import-1", name: "Granite house" };
  await site(page);
  const calls = await library(page, build);
  await page.goto("/?public=import-1");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", build.revision);

  const menu = page.getByRole("menu");
  await (await shareMenu(page)).getByRole("menuitem", { name: "Make private…" }).click();
  const confirm = page.getByRole("dialog", { name: "Make private" });
  await expect(confirm).toContainText("stays under Your builds for you alone");
  await confirm.getByRole("button", { name: "Make private" }).click();
  await shareMenu(page);
  await expect(menu.getByRole("menuitem", { name: "Publish to the library…" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
    body: { id: "import-1", private: true },
    auth: `Bearer ${ACCOUNT.pass}`,
  });
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);

  const mine = page.getByRole("region", { name: "Your builds" }).locator(".gallery-card");
  await page.getByRole("button", { name: "HoloBlocks", exact: true }).click();
  await expect(mine).toContainText("private");
  await expect(page.getByRole("region", { name: "Public builds" }).locator(".gallery-card")).toHaveCount(0);
  await mine.click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", build.revision);

  await (await shareMenu(page)).getByRole("menuitem", { name: "Publish to the library…" }).click();
  await page.getByRole("dialog", { name: "Publish" }).getByRole("button", { name: "Publish" }).click();
  await shareMenu(page);
  await expect(menu).toContainText("In the public library");
  await expect(menu.getByRole("menuitem", { name: "Copy link" })).toBeEnabled();
  expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
    { id: "import-1", private: true },
    { id: "import-1", private: false },
  ]);

  await menu.getByRole("menuitem", { name: "Delete…" }).click();
  const remove = page.getByRole("dialog", { name: "Delete" });
  await expect(remove).toContainText("Delete Granite house?");
  await remove.getByRole("button", { name: "Cancel" }).click();
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await (await shareMenu(page)).getByRole("menuitem", { name: "Delete…" }).click();
  await remove.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ search: "?id=import-1" });
  await expect(mine).toHaveCount(0);
});
