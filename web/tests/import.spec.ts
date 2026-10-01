import { expect, test } from "@playwright/test";
import { gunzipSync, gzipSync } from "node:zlib";
import { Refusal } from "../api/lib/http";
import { imported } from "../api/lib/imported";
import type { Shared } from "../src/model";
import { ACCOUNT, model, site } from "./fixtures";

const BLOB = "https://blob.test";

/** A published build's file: with its chat, whose images point wherever it came from. */
const exported = () => ({
  ...model(),
  name: "Stone hut",
  script: 'fill(0, 0, 0, 3, 0, 3, "stone")\n',
  status: "done",
  messages: [{ role: "user", text: "A stone hut", images: ["/gallery/images/1.png"] }],
});

test("an import is checked and rebuilt: recomputed revision, its steps and script, no images", () => {
  const given = exported();
  const build = imported({ ...given, revision: "forged" });
  expect(build.revision).toMatch(/^[0-9a-f]{64}$/);
  expect(build.revision).toBe(imported(given).revision);
  expect(build.boxes).toEqual(given.boxes);
  expect(build.steps.map((s) => s.title)).toEqual(["Floor", "Cube"]);
  expect(build.script).toBe(given.script);
  expect(build.messages).toEqual([{ role: "user", text: "A stone hut", images: [] }]);
});

for (const [why, damage, message] of [
  ["no blocks", (m: any) => ({ ...m, blocks: [] }), /no blocks/],
  ["an unknown block", (m: any) => ({ ...m, blocks: ["stone", "unobtainium"] }), /block 2/],
  ["a box off the site", (m: any) => ({ ...m, boxes: [0, 0, 0, 16, 0, 0, 0, 0] }), /box 1/],
  ["a block index past the list", (m: any) => ({ ...m, boxes: [0, 0, 0, 0, 0, 0, 5, 0] }), /box 1/],
  ["boxes not packed by eight", (m: any) => ({ ...m, boxes: [0, 0, 0] }), /eight numbers/],
  ["a site too large", (m: any) => ({ ...m, width: 1000 }), /width/],
] as const)
  test(`an import with ${why} is refused`, () => {
    const attempt = () => imported(damage(exported()));
    expect(attempt).toThrow(Refusal);
    expect(attempt).toThrow(message);
  });

test("Import a build uploads the file as the signed-in user after a confirmation, then shows it under Mine", async ({
  page,
}) => {
  await site(page);
  const listed: object[] = [];
  const stored = new Map<string, Shared>();
  const uploads: { headers: Record<string, string>; body: any }[] = [];
  await page.route(`${BLOB}/**`, (route) => {
    const build = stored.get(new URL(route.request().url()).pathname.split("/")[2]);
    return build
      ? route.fulfill({ headers: { "access-control-allow-origin": "*" }, body: gzipSync(JSON.stringify(build)) })
      : route.fulfill({ status: 404 });
  });
  await page.route("**/api/imports", async (route) => {
    const body = JSON.parse(gunzipSync(route.request().postDataBuffer()!).toString());
    uploads.push({ headers: route.request().headers(), body });
    const build = imported(body.model);
    stored.set("import-1", build);
    const entry = {
      id: "import-1",
      name: build.name,
      prompt: "",
      steps: build.steps.length,
      author: ACCOUNT.user.name,
      owner: ACCOUNT.user.id,
      published: 2,
      thumbnail: null,
      build: `${BLOB}/builds/import-1/build.json.gz`,
    };
    listed.unshift(entry);
    return route.fulfill({ status: 201, json: entry });
  });
  await page.route("**/api/builds*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has("mine")) return route.fulfill({ json: [] });
    const id = params.get("id");
    return route.fulfill({ json: id ? listed.find((e: any) => e.id === id) : listed });
  });
  await page.goto("/?library");

  const mine = page.getByRole("region", { name: "Mine" });
  const file = { name: "stone-hut.json", mimeType: "application/json" };
  await mine.getByLabel("Model file to import").setInputFiles({ ...file, buffer: Buffer.from("{}") });
  await expect(mine.getByRole("alert")).toContainText("not a Blockyard model");

  await mine
    .getByLabel("Model file to import")
    .setInputFiles({ ...file, buffer: gzipSync(JSON.stringify(exported())), name: "stone-hut.json.gz" });
  const confirm = mine.getByRole("dialog", { name: "Import a build" });
  await expect(confirm).toContainText("Import Stone hut (2 steps)? It will be public");
  await confirm.getByRole("button", { name: "Import" }).click();

  await expect(page).toHaveURL(/\?public=import-1$/);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", imported(exported()).revision);
  expect(uploads).toHaveLength(1);
  expect(uploads[0].headers).toMatchObject({ authorization: `Bearer ${ACCOUNT.pass}`, "x-agents-key": ACCOUNT.key });
  expect(uploads[0].body.thumbnail).toMatch(/^data:image\/webp;base64,/);

  await page.getByRole("button", { name: "Library" }).click();
  await expect(mine.locator(".gallery-card")).toContainText("Stone hut");
  await expect(mine.locator(".gallery-card")).toContainText("imported");
});
