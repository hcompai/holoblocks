import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { DELETE as unpublishBuild, GET as builds, POST as publishBuild } from "../api/builds";
import { POST as deleteBuild } from "../api/deleted";
import { GET as forks, PATCH as linkSession, POST as saveFork } from "../api/forks";
import { POST as importBuild } from "../api/imports";
import { pass, type User } from "../api/lib/account";
import { linkFork } from "../api/lib/forks";
import { projectName } from "../api/lib/names";
import { enter, find, findOwn, forgotten } from "../api/lib/store";
import { GET as names, PATCH as renameBuild } from "../api/names";
import { forkSeed } from "../src/forkModel";
import { blobStore } from "./blobStore";
import { model } from "./fixtures";

process.env.BLOCKYARD_SECRET = "forks-test-secret";
process.env.BLOCKYARD_ADMINS = "ada.admin@hcompany.ai";
const blob = blobStore();

const OWNER: User = { id: "u-owner", email: "olive.owner@hcompany.ai", name: "Olive Owner" };
const OTHER: User = { id: "u-other", email: "otto.other@hcompany.ai", name: "Otto Other" };
const ADMIN: User = { id: "u-admin", email: "ada.admin@hcompany.ai", name: "Ada Admin" };
/** The session the owner's Agents API key lists as theirs; nobody else's does. */
const RUN = "own-run";
const FORK = "fork-11111111-1111-4111-8111-111111111111";
const keyOf = (user: User) => `key-${user.id}`;

function call(user: User, method: string, path: string, data?: unknown) {
  return new Request(`http://blocks.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${pass(user, 4102444800, keyOf(user))}`, "X-Agents-Key": keyOf(user) },
    ...(data !== undefined && {
      body: data instanceof Uint8Array ? data : JSON.stringify(data),
    }),
  });
}
const gzipped = (value: unknown) => new Uint8Array(gzipSync(JSON.stringify(value)));
const seed = () =>
  forkSeed(
    model(),
    { id: RUN, source: "session", name: "Little Hut", version: 2, revision: model().revision },
    "Hut · Fork",
  );
const fork = (user = OWNER) => saveFork(call(user, "POST", "/api/forks", gzipped({ id: FORK, seed: seed() })));
const json = (response: Response) => response.json();

const realFetch = globalThis.fetch;
let agentCalls: string[] = [];
/** The fork the session says it was started on. */
let group: string | null = FORK;

test.beforeAll(async () => {
  await blob.start();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === blob.base) return realFetch(input, init);
    if (url.hostname !== "agp.eu.hcompany.ai") throw new Error(`Unexpected test request: ${url.origin}`);
    agentCalls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const key = new Headers(input instanceof Request ? input.headers : init?.headers).get("authorization");
    const item = { id: RUN, agent: "blockyard", status: "idle", created_at: "2026-01-01T00:00:00Z" };
    if (url.pathname === "/api/v2/sessions") {
      const items = key === `Bearer ${keyOf(OWNER)}` ? [item] : [];
      return Response.json({ items, total: items.length, page: 1 });
    }
    return Response.json({
      ...item,
      request: { agent: "blockyard", group_id: group, messages: [] },
      status: { status: "idle" },
    });
  };
});
test.beforeEach(() => {
  blob.objects.clear();
  agentCalls = [];
  group = FORK;
});
test.afterAll(async () => {
  globalThis.fetch = realFetch;
  await blob.stop();
});

test("a fork is saved at once for its owner alone, once per id, without starting Holo", async () => {
  const saved = await fork();
  expect(saved.status).toBe(201);
  const renamed = { id: FORK, seed: { ...seed(), model: { ...seed().model, name: "Not the saved copy" } } };
  expect(await json(await saveFork(call(OWNER, "POST", "/api/forks", gzipped(renamed))))).toMatchObject({
    name: "Hut · Fork",
  });
  expect(agentCalls).toEqual([]);

  expect(await json(await forks(call(OWNER, "GET", "/api/forks")))).toEqual([
    { id: FORK, name: "Hut · Fork", steps: 2, created: expect.any(Number), sessionId: null },
  ]);
  const opened = await json(await forks(call(OWNER, "GET", `/api/forks?id=${FORK}`)));
  expect(opened.seed.model).toMatchObject({ revision: model().revision, boxes: model().boxes });
  expect(opened.seed.origin).toEqual({
    id: RUN,
    source: "session",
    name: "Little Hut",
    version: 2,
    revision: model().revision,
  });

  expect(await json(await forks(call(OTHER, "GET", "/api/forks")))).toEqual([]);
  expect((await forks(call(OTHER, "GET", `/api/forks?id=${FORK}`))).status).toBe(404);
  expect(await json(await builds(new Request("http://blocks.test/api/builds")))).toEqual([]);
});

test("a fork continues in one session only: its owner's, started on it", async () => {
  await fork();
  const link = (user: User) => linkSession(call(user, "PATCH", "/api/forks", { id: FORK, sessionId: RUN }));

  expect((await link(OTHER)).status).toBe(403);
  group = null;
  expect((await link(OWNER)).status).toBe(400);
  group = FORK;
  expect((await link(OWNER)).status).toBe(204);
  expect(await json(await forks(call(OWNER, "GET", `/api/forks?id=${FORK}`)))).toMatchObject({ sessionId: RUN });
  await expect(linkFork(OWNER.id, FORK, "another-run")).rejects.toMatchObject({ status: 409 });
});

test("two sessions racing to continue a fork: one wins, the other is refused", async () => {
  await fork();
  const raced = await Promise.allSettled([linkFork(OWNER.id, FORK, "run-a"), linkFork(OWNER.id, FORK, "run-b")]);
  const won = raced.findIndex((r) => r.status === "fulfilled");
  expect(raced.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect(raced[1 - won]).toMatchObject({ reason: { status: 409 } });
  expect(await json(await forks(call(OWNER, "GET", `/api/forks?id=${FORK}`)))).toMatchObject({
    sessionId: won ? "run-b" : "run-a",
  });
});

test("a fork's id is its owner's alone: nobody else saves a fork under it, so its owner can always publish it", async () => {
  await fork();
  expect((await fork(OTHER)).status).toBe(409);
  expect(await json(await forks(call(OTHER, "GET", "/api/forks")))).toEqual([]);
  expect((await publishBuild(call(OWNER, "POST", "/api/builds", { id: FORK, thumbnail: null }))).status).toBe(201);
  expect(await find(FORK)).toMatchObject({ owner: OWNER.id, name: "Hut · Fork" });
});

test.describe("someone else's builds", () => {
  let imported = "";
  test.beforeEach(async () => {
    const upload = call(OWNER, "POST", "/api/imports", gzipped({ model: { ...model(), name: "Olive's house" } }));
    imported = (await json(await importBuild(upload))).id;
    await fork();
    await enter(
      {
        id: RUN,
        name: "Olive's tower",
        prompt: "",
        steps: 2,
        author: OWNER.name,
        owner: OWNER.id,
        published: 1,
        thumbnail: null,
        build: `${blob.base}/objects/builds/${RUN}/build.json.gz`,
      },
      [],
      [],
    );
  });

  for (const intruder of [OTHER, ADMIN])
    test(`${intruder.name} cannot rename, publish or delete them`, async () => {
      const untouched = new Map(blob.objects);
      for (const id of [imported, FORK, RUN])
        expect(
          (await renameBuild(call(intruder, "PATCH", "/api/names", { id, name: "Taken" }))).status,
        ).toBeGreaterThanOrEqual(403);
      expect((await publishBuild(call(intruder, "POST", "/api/builds", { id: RUN, thumbnail: null }))).status).toBe(
        403,
      );
      expect((await publishBuild(call(intruder, "POST", "/api/builds", { id: FORK, thumbnail: null }))).status).toBe(
        404,
      );
      for (const id of [imported, FORK])
        expect((await deleteBuild(call(intruder, "POST", "/api/deleted", { id }))).status).toBe(404);
      expect(blob.objects).toEqual(untouched);
    });

  test("an admin only hides one from the public library: it stays its owner's, with its files", async () => {
    const files = () => [...blob.objects.keys()].filter((p) => p.startsWith(`builds/${imported}/`));
    const before = files();
    const unpublish = (user: User) => unpublishBuild(call(user, "DELETE", `/api/builds?id=${imported}`));

    expect((await unpublish(OTHER)).status).toBe(403);
    expect((await unpublish(ADMIN)).status).toBe(204);
    expect(await find(imported)).toBeNull();
    expect(await findOwn(OWNER.id, imported)).toMatchObject({ owner: OWNER.id });
    expect(files()).toEqual(before);
    expect(
      (await json(await builds(call(OWNER, "GET", "/api/builds?mine=1")))).map((p: { id: string }) => p.id),
    ).toEqual([imported]);
    expect((await builds(new Request(`http://blocks.test/api/builds?id=${imported}`))).status).toBe(404);
  });

  test("its owner renames one everywhere: the name they gave it and its library entry", async () => {
    const rename = (name: string) => renameBuild(call(OWNER, "PATCH", "/api/names", { id: imported, name }));
    expect((await rename("\u0007")).status).toBe(400);
    expect((await rename("  Granite house  ")).status).toBe(200);
    expect(await find(imported)).toMatchObject({ name: "Granite house" });
    expect(await projectName(OWNER.id, imported)).toMatchObject({ name: "Granite house" });
    expect((await rename("Red tower")).status).toBe(200);
    expect(await json(await names(call(OWNER, "GET", "/api/names")))).toEqual([
      { id: imported, name: "Red tower", updated: expect.any(Number) },
    ]);
  });
});

test("deleting a fork deletes its starting model, record and name, and hides the session it continued in", async () => {
  await fork();
  await linkFork(OWNER.id, FORK, RUN);
  expect((await renameBuild(call(OWNER, "PATCH", "/api/names", { id: FORK, name: "Red hut" }))).status).toBe(200);
  expect([...blob.objects.keys()].filter((p) => p.includes(FORK))).toHaveLength(5);

  expect((await deleteBuild(call(OWNER, "POST", "/api/deleted", { id: FORK }))).status).toBe(204);
  expect([...blob.objects.keys()].filter((p) => p.includes(FORK))).toEqual([`fork-owners/${FORK}.json`]);
  expect(await forgotten(OWNER.id)).toEqual([RUN]);
});
