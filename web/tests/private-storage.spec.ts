import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { GET, PATCH } from "../api/builds";
import { pass, type User } from "../api/lib/account";
import { privateUrl } from "../api/lib/privateStore";
import { enter, find, migratePrivate, save, type Published } from "../api/lib/store";
import { blobStore } from "./blobStore";

process.env.BLOCKYARD_SECRET = "private-storage-test-secret";
const owner: User = { id: "private-owner", email: "owner@hcompany.ai", name: "Owner" };
const other: User = { id: "other", email: "other@hcompany.ai", name: "Other" };
const blob = blobStore();
const id = "import-private-test";
const model = gzipSync(JSON.stringify({ name: "Granite house", blocks: ["stone"], boxes: [0, 0, 0, 0, 0, 0, 0, 0] }));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6RkAAAAASUVORK5CYII=",
  "base64",
);
let published: Published;

const headers = (user: User) => ({
  Authorization: `Bearer ${pass(user, 4102444800, "synthetic-key")}`,
  "X-Agents-Key": "synthetic-key",
});
const api = (path: string, user?: User) =>
  GET(new Request(`http://blocks.test${path}`, user ? { headers: headers(user) } : {}));
const file = (name: string, user?: User) => api(privateUrl(id, name), user);
const patch = (value: boolean) =>
  PATCH(
    new Request("http://blocks.test/api/builds", {
      method: "PATCH",
      headers: { ...headers(owner), "Content-Type": "application/json" },
      body: JSON.stringify({ id, private: value }),
    }),
  );
const bytes = async (response: Response) => Buffer.from(await response.arrayBuffer());
/** Leave the build's entry on its owner's shelf in the public store, where private entries used to live. */
function shelve() {
  const entry = [...blob.objects.keys()].find((k) => k.startsWith("library/"))!;
  blob.objects.set(`private/${owner.id}/${id}/1.json`, blob.objects.get(entry)!);
  blob.objects.delete(entry);
}

test.beforeAll(() => blob.start());
test.afterAll(() => blob.stop());
test.beforeEach(async () => {
  blob.objects.clear();
  blob.privateObjects.clear();
  const build = await save(id, "build.json.gz", model, "application/gzip");
  const thumbnail = await save(id, "thumbnail.png", png, "image/png");
  published = {
    id,
    name: "Granite house",
    prompt: "",
    steps: 1,
    author: "Owner",
    owner: owner.id,
    published: 1,
    thumbnail,
    build,
  };
  await enter(published, [], [build, thumbnail]);
});

test("a private build leaves no public file and opens only for its owner", async () => {
  expect((await patch(true)).status).toBe(204);
  expect([...blob.objects.keys()]).toEqual([]);
  for (const url of [published.build, published.thumbnail!]) expect((await fetch(url)).status).toBe(404);
  expect(await find(id)).toBeNull();
  expect((await api(`/api/builds?id=${id}`, other)).status).toBe(404);
  expect((await file("build.json.gz")).status).toBe(401);
  for (const name of ["build.json.gz", "thumbnail"]) expect((await file(name, other)).status).toBe(404);
  const own = await file("build.json.gz", owner);
  expect(own.headers.get("cache-control")).toBe("private, no-store");
  expect(await bytes(own)).toEqual(model);
  expect(await bytes(await file("thumbnail", owner))).toEqual(png);
  expect((await file("../other.json", owner)).status).toBe(404);
  expect(await (await api("/api/builds?mine=1", owner)).json()).toMatchObject([
    { id, build: privateUrl(id, "build.json.gz"), thumbnail: privateUrl(id, "thumbnail") },
  ]);
});

test("making it public again restores its public files and leaves nothing private", async () => {
  await patch(true);
  expect((await patch(false)).status).toBe(204);
  expect(blob.privateObjects.size).toBe(0);
  const restored = (await find(id))!;
  expect(restored.build).toMatch(/\/builds\/import-private-test\/build\.json-\w+\.gz$/);
  expect(await bytes(await fetch(restored.build))).toEqual(model);
  expect(await bytes(await fetch(restored.thumbnail!))).toEqual(png);
  expect(blob.objects.size).toBe(3);
});

test("without a private store, making private refuses and keeps the build public", async () => {
  const token = process.env.BLOCKYARD_PRIVATE_BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOCKYARD_PRIVATE_BLOB_READ_WRITE_TOKEN;
  try {
    expect((await patch(true)).status).toBe(503);
  } finally {
    process.env.BLOCKYARD_PRIVATE_BLOB_READ_WRITE_TOKEN = token;
  }
  expect(await find(id)).not.toBeNull();
  expect((await fetch(published.build)).ok).toBe(true);
});

test("owner access moves a private entry left in the public store", async () => {
  shelve();
  expect((await (await api("/api/builds?mine=1", owner)).json()).map((p: Published) => p.id)).toEqual([id]);
  expect([...blob.objects.keys()]).toEqual([]);
  expect(await bytes(await file("build.json.gz", owner))).toEqual(model);
});

test("the migration counts on a dry run, then moves each entry once", async () => {
  shelve();
  const before = [...blob.objects.keys()];
  expect(await migratePrivate(true)).toBe(1);
  expect([...blob.objects.keys()]).toEqual(before);
  expect(blob.privateObjects.size).toBe(0);
  await import("../scripts/migrate-private.mjs");
  expect([...blob.objects.keys()]).toEqual([]);
  expect(await migratePrivate()).toBe(0);
  expect(await bytes(await file("build.json.gz", owner))).toEqual(model);
});
