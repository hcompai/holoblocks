import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import type { Model } from "../src/model";
import { ACCOUNT, model, shareMenu, site } from "./fixtures";

const BLOB = "https://blob.test";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6RkAAAAASUVORK5CYII=",
  "base64",
);

/** The library API holding one imported build of the signed-in user's, with PATCH, ?mine=1, DELETE and /api/deleted. */
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
      thumbnail: null as string | null,
      build: `${BLOB}/builds/${build.id}/build.json.gz`,
      private: false,
    },
  ];
  const calls: { method: string; path: string; search: string; body: unknown; auth: string | undefined }[] = [];
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
      path: url.pathname,
      search: url.search.replace(/[?&]t=\d+/, ""),
      body: method === "PATCH" ? request.postDataJSON() : null,
      auth: request.headers().authorization,
    });
    if (method === "PATCH") {
      const { id, private: hidden } = request.postDataJSON();
      const entry = entries.find((e) => e.id === id)!;
      entry.private = hidden;
      entry.thumbnail = hidden ? `/api/builds?id=${id}&file=thumbnail` : null;
      entry.build = hidden ? `/api/builds?id=${id}&file=build.json.gz` : `${BLOB}/builds/${id}/build.json.gz`;
      return route.fulfill({ status: 204 });
    }
    if (method === "DELETE") {
      entries.splice(0, entries.length);
      return route.fulfill({ status: 204 });
    }
    const id = url.searchParams.get("id");
    if (url.searchParams.has("file")) {
      if (!request.headers().authorization || !request.headers()["x-agents-key"]) return route.fulfill({ status: 401 });
      return url.searchParams.get("file") === "thumbnail"
        ? route.fulfill({ contentType: "image/png", body: PNG })
        : route.fulfill({ body: gzipSync(JSON.stringify({ ...build, status: "done", messages: [] })) });
    }
    if (url.searchParams.has("mine")) return route.fulfill({ json: entries.filter((e) => e.private) });
    if (id) {
      const entry = entries.find((e) => e.id === id && (!e.private || request.headers().authorization));
      return entry ? route.fulfill({ json: entry }) : route.fulfill({ status: 404, json: { error: "Not public." } });
    }
    return route.fulfill({ json: entries.filter((e) => !e.private) });
  });
  await page.route("**/api/deleted", (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fulfill({ json: [] });
    calls.push({
      method: "POST",
      path: "/api/deleted",
      search: "",
      body: request.postDataJSON(),
      auth: request.headers().authorization,
    });
    entries.splice(0, entries.length);
    return route.fulfill({ status: 204 });
  });
  return calls;
}

test("an imported build toggles private and public without losing it, then is deleted after a confirmation", async ({
  page,
}) => {
  const build = { ...model(), id: "import-1", name: "Granite house" };
  await site(page);
  const calls = await library(page, build);
  await page.goto("/?public=import-1");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", build.revision);

  const menu = page.getByRole("menu");
  const visibility = page.getByRole("switch", { name: "Public", exact: true });
  await expect(visibility).toBeChecked();
  await visibility.click();
  await expect(visibility).not.toBeChecked();
  expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
    body: { id: "import-1", private: true },
    auth: `Bearer ${ACCOUNT.pass}`,
  });
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);

  const mine = page.getByRole("region", { name: "Your builds" }).locator(".gallery-card");
  await page.getByRole("button", { name: "HoloBlocks", exact: true }).click();
  await expect(mine).toContainText("private");
  await expect(page.getByRole("region", { name: "Public builds" }).locator(".gallery-card")).toHaveCount(0);
  await expect(mine.locator("img")).toHaveAttribute("src", /^data:image\/png/);
  await mine.click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", build.revision);
  expect(calls.find((c) => c.search.includes("file=build.json.gz"))?.auth).toBe(`Bearer ${ACCOUNT.pass}`);

  await visibility.click();
  await expect(visibility).toBeChecked();
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
  expect(calls.some((c) => c.path === "/api/deleted")).toBe(false);
  await (await shareMenu(page)).getByRole("menuitem", { name: "Delete…" }).click();
  await remove.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(calls.filter((c) => c.path === "/api/deleted")).toMatchObject([
    { body: { id: "import-1" }, auth: `Bearer ${ACCOUNT.pass}` },
  ]);
  await expect(mine).toHaveCount(0);
});

test("visibility stays public after a failed save, prevents duplicate clicks, and retries", async ({
  page,
}, testInfo) => {
  const build = { ...model(), id: "import-1", name: "Granite house" };
  await site(page);
  await library(page, build);
  let requests = 0;
  let finish: (() => Promise<void>) | undefined;
  await page.route("**/api/builds*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    requests++;
    if (requests > 1) return route.fallback();
    await new Promise<void>((resolve) => {
      finish = async () => {
        await route.fulfill({ status: 503, json: { error: "Storage unavailable" } });
        resolve();
      };
    });
  });
  await page.goto("/?public=import-1");
  const visibility = page.getByRole("switch", { name: "Public", exact: true });
  await expect(visibility).toBeChecked();
  await visibility.click();
  await expect(visibility).toBeDisabled();
  await expect(visibility).toBeChecked();
  expect(requests).toBe(1);
  await finish!();
  await expect(page.getByRole("alert")).toContainText("Storage unavailable");
  await expect(visibility).toBeEnabled();
  await expect(visibility).toBeChecked();
  await visibility.click();
  await expect(visibility).not.toBeChecked();
  await expect(page.locator(".visibility-error")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(visibility).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("public-toggle-phone.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
