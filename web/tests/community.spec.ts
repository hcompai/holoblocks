import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Model } from "../src/model";
import { cookie, HANDOFF, PENDING, setCookie } from "../src/signin";
import { ACCOUNT, model, shareMenu, site } from "./fixtures";
import { platform } from "./platform";

const BLOB = "https://blob.test";
const PORTAL = "https://portal.api.eu.hcompany.ai/api";

type Built = Model & { id: string };

const shown = (page: Page, revision: string) =>
  expect(page.locator(".viewer")).toHaveAttribute("data-revision", revision);

const entry = (build: Built, author: string, owner: string) => ({
  id: build.id,
  name: build.name,
  prompt: build.name,
  steps: build.steps.length,
  author,
  owner,
  published: 1,
  thumbnail: null,
  build: `${BLOB}/builds/${build.id}/build.json.gz`,
});

interface Call {
  method: string;
  search: string;
  headers: Record<string, string>;
  body: any;
}

/** The public library API, holding `published`; publishing adds the signed-in user's build to it. */
async function library(page: Page, published: ReturnType<typeof entry>[], builds: Built[] = []) {
  const calls: Call[] = [];
  await page.route(`${BLOB}/**`, (route) => {
    const build = builds.find((b) => route.request().url() === `${BLOB}/builds/${b.id}/build.json.gz`);
    return build
      ? route.fulfill({
          headers: { "access-control-allow-origin": "*" },
          body: gzipSync(JSON.stringify({ ...build, status: "done", messages: [] })),
        })
      : route.fulfill({ status: 404 });
  });
  await page.route("**/api/builds*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({
      method,
      search: url.search,
      headers: request.headers(),
      body: method === "POST" ? request.postDataJSON() : null,
    });
    const id = url.searchParams.get("id");
    if (method === "POST") {
      const build = builds.find((b) => b.id === request.postDataJSON().id)!;
      published.unshift(entry(build, ACCOUNT.user.name, ACCOUNT.user.id));
      return route.fulfill({ status: 201, json: published[0] });
    }
    if (method === "DELETE") {
      published.splice(
        published.findIndex((p) => p.id === id),
        1,
      );
      return route.fulfill({ status: 204 });
    }
    if (url.searchParams.has("mine")) return route.fulfill({ json: [] });
    const one = published.find((p) => p.id === id);
    if (id) return one ? route.fulfill({ json: one }) : route.fulfill({ status: 404, json: { error: "Not public." } });
    return route.fulfill({ json: published });
  });
  return calls;
}

test("a colleague's public build opens from the library's Public section, under its author's name", async ({
  page,
}) => {
  const hut = { ...model(), id: "hut", name: "Ada's hut" };
  await site(page);
  await library(page, [entry(hut, "Ada Lovelace", "u-ada")], [hut]);
  await page.goto("/");

  await page.getByRole("button", { name: "Library" }).click();
  await expect(page).toHaveURL(/\?library$/);
  const card = page.getByRole("region", { name: "Public" }).locator(".gallery-card");
  await expect(card).toContainText("by Ada Lovelace");
  await card.click();
  await expect(page).toHaveURL(/\?public=hut$/);
  await shown(page, hut.revision);
  await expect(page.locator(".gallery-note")).toHaveText(/^Shared by Ada Lovelace: remix it to make your own\./);
  const menu = await shareMenu(page);
  await expect(menu.getByRole("menuitem", { name: /Publish/ })).toHaveCount(0);
});

test("a remix of a public build starts a private session from a script rebuilding each of its boxes, step by step", async ({
  page,
}) => {
  const hut = { ...model(), id: "hut", name: "Ada's hut" };
  await site(page);
  const agp = await platform(page);
  await library(page, [entry(hut, "Ada Lovelace", "u-ada")], [hut]);
  await page.goto("/?public=hut");
  await shown(page, hut.revision);

  await page.locator(".gallery-note").getByRole("button", { name: "Remix" }).click();
  await page.getByPlaceholder("What should Holo change?").fill("Make it twice as tall");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\?build=new-build$/);
  await expect(page.locator(".aside-title")).toHaveText("Ada's hut remix");
  const [first] = agp.posted("/api/v2/sessions")[0].messages;
  expect(first.message).toBe("Make it twice as tall");
  expect(first.files.map((f: { name: string }) => f.name)).toEqual(["blockyard.tgz", "remix.py"]);
  expect(Buffer.from(first.files[1].source, "base64").toString()).toBe(
    'step("Floor")\nfill(0, 0, 0, 3, 0, 3, "stone")\nstep("Cube")\nfill(1, 1, 1, 2, 2, 2, "oak_planks")\n',
  );
});

test("a public build's link copies to the clipboard", async ({ page, context }) => {
  const hut = { ...model(), id: "hut", name: "Ada's hut" };
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await site(page);
  await library(page, [entry(hut, "Ada Lovelace", "u-ada")], [hut]);
  await page.goto("/?public=hut");
  await shown(page, hut.revision);

  const menu = await shareMenu(page);
  await menu.getByRole("menuitem", { name: "Copy link" }).click();
  await expect(menu.getByRole("menuitem", { name: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/?public=hut`);
});

test("the author publishes a build after a confirmation, stays on it, then makes it private after another", async ({
  page,
}) => {
  const hut = model();
  await site(page);
  const agp = await platform(page);
  agp.session("mine");
  agp.say("mine", "A little hut");
  agp.share("mine", hut);
  agp.answer("mine", "Built.");
  const calls = await library(page, [], [{ ...hut, id: "mine" }]);
  await page.goto("/?build=mine");
  await shown(page, hut.revision);
  const share = page.getByRole("button", { name: "Share", exact: true });
  const menu = page.getByRole("menu");
  const copyLink = menu.getByRole("menuitem", { name: "Copy link" });
  await share.click();
  await expect(menu).toContainText("Private: not in the public library");
  await expect(copyLink).toBeDisabled();

  const publishing = page.getByRole("dialog", { name: "Publish" });
  await menu.getByRole("menuitem", { name: "Publish to the library…" }).click();
  await expect(publishing).toContainText("the chat, and the photos you attached");
  await publishing.getByRole("button", { name: "Publish" }).click();
  await expect(publishing).toBeHidden();
  await expect(page).toHaveURL(/\?build=mine$/);
  await share.click();
  await expect(menu).toContainText("In the public library");
  await expect(copyLink).toBeEnabled();
  await share.click();
  const post = calls.find((c) => c.method === "POST")!;
  expect(post.headers).toMatchObject({ authorization: `Bearer ${ACCOUNT.pass}`, "x-agents-key": ACCOUNT.key });
  expect(post.body).toEqual({ id: "mine", thumbnail: expect.stringMatching(/^data:image\/webp;base64,/), edits: null });

  const shelf = page.getByRole("button", { name: "Library" });
  const mine = page.getByRole("region", { name: "Mine" }).locator(".gallery-card");
  const everyone = page.getByRole("region", { name: "Public" }).locator(".gallery-card");
  await shelf.click();
  await expect(mine).toContainText("public");
  await expect(everyone).toContainText(`by ${ACCOUNT.user.name}`);
  await shelf.click();

  const confirm = page.getByRole("dialog", { name: "Make private" });
  const unpublish = menu.getByRole("menuitem", { name: "Make private…" });
  await share.click();
  await unpublish.click();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await share.click();
  await unpublish.click();
  await confirm.getByRole("button", { name: "Make private" }).click();
  await expect(page).toHaveURL(/\?build=mine$/);
  await share.click();
  await expect(menu).toContainText("Private: not in the public library");
  await expect(copyLink).toBeDisabled();
  await share.click();
  expect(calls.find((c) => c.method === "DELETE")).toMatchObject({
    search: "?id=mine",
    headers: { authorization: `Bearer ${ACCOUNT.pass}`, "x-agents-key": ACCOUNT.key },
  });
  await shelf.click();
  await expect(everyone).toHaveCount(0);
  await expect(mine).not.toContainText("public");
});

test("a hand-edited build publishes with its edits, for the server to apply", async ({ page }) => {
  const hut = model();
  await site(page);
  const agp = await platform(page);
  agp.session("mine");
  agp.share("mine", hut);
  agp.answer("mine", "Built.");
  const calls = await library(page, [], [{ ...hut, id: "mine" }]);
  const edits = [{ kind: "set", cells: [[0, 1, 0]], block: "gold_block" }];
  await page.addInitScript(
    ([revision, edits]) => localStorage.setItem("blockyard.edits", JSON.stringify({ mine: { revision, edits } })),
    [hut.revision, edits] as const,
  );
  await page.goto("/?build=mine");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", new RegExp(`^${hut.revision}-`));

  await (await shareMenu(page)).getByRole("menuitem", { name: "Publish to the library…" }).click();
  await page.getByRole("dialog", { name: "Publish" }).getByRole("button", { name: "Publish" }).click();
  await expect.poll(() => calls.some((c) => c.method === "POST")).toBe(true);
  expect(calls.find((c) => c.method === "POST")!.body.edits).toEqual({ revision: hut.revision, edits });
});

test("signed out, only the sign-in page shows; Google brings the user back signed in where they left", async ({
  page,
  context,
}) => {
  const hut = { ...model(), id: "hut" };
  await site(page, [hut], null);
  let handoff: object = { error: "HoloBlocks is open to H Company accounts." };
  const pending: { verifier: string }[] = [];
  const challenges: (string | null)[] = [];
  await page.route(`${PORTAL}/auth/authorize?*`, (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    challenges.push(url.searchParams.get("code_challenge"));
    // Playwright routes no request that follows a redirect, so this portal navigates on instead.
    const next = JSON.stringify(url.searchParams.get("redirect_uri"));
    return route.fulfill({ contentType: "text/html", body: `<script>location.replace(${next})</script>` });
  });
  await page.route("**/api/session", async (route) => {
    const back = JSON.parse(cookie(await route.request().headerValue("cookie"), PENDING)!);
    pending.push(back);
    return route.fulfill({
      status: 303,
      headers: { location: back.back, "set-cookie": setCookie(HANDOFF, JSON.stringify(handoff), 60) },
    });
  });
  const google = page.getByRole("button", { name: "Continue with Google" });

  await page.goto(`/?showcase=${hut.id}`);
  await expect(page.getByRole("heading", { name: "HoloBlocks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Library" })).toHaveCount(0);
  await google.click();
  await expect(page.getByRole("alert")).toHaveText("HoloBlocks is open to H Company accounts.");

  handoff = ACCOUNT;
  await google.click();
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`\\?showcase=${hut.id}$`));
  expect((await context.cookies()).map((c) => c.name)).not.toContain(HANDOFF);

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await google.click();
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  const verifier = expect.stringMatching(/^[\w-]{43}$/);
  expect(pending).toEqual([
    { previous: null, back: `/?showcase=${hut.id}`, verifier },
    { previous: null, back: `/?showcase=${hut.id}`, verifier },
    { previous: ACCOUNT.keyId, back: `/?showcase=${hut.id}`, verifier },
  ]);
  expect(challenges).toEqual(pending.map((p) => createHash("sha256").update(p.verifier).digest("base64url")));
});
