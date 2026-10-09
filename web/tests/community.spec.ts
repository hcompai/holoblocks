import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Message, Model } from "../src/model";
import { cookie, HANDOFF, PENDING, setCookie } from "../src/signin";
import { ACCOUNT, model, shareMenu, site } from "./fixtures";
import { platform } from "./platform";

const BLOB = "https://blob.test";
const PORTAL = "https://portal.api.eu.hcompany.ai/api";

type Built = Model & { id: string; messages?: Message[] };

const shown = (page: Page, revision: string) =>
  expect(page.locator(".viewer")).toHaveAttribute("data-revision", revision);

const entry = (build: Built, author: string, owner: string) => ({
  id: build.id,
  name: build.name,
  prompt: build.name,
  steps: build.steps.length,
  author,
  owner,
  published: Math.floor(Date.now() / 1000) - 300,
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
          body: gzipSync(JSON.stringify({ status: "done", messages: [], ...build })),
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

test("a colleague's public build opens from the home page's public builds, under its author's name", async ({
  page,
}) => {
  const hut = { ...model(), id: "hut", name: "Ada's hut" };
  await site(page);
  await library(page, [entry(hut, "Ada Lovelace", "u-ada")], [hut]);
  await page.goto("/");

  const card = page.getByRole("region", { name: "Public builds" }).locator(".gallery-card");
  await expect(card).toContainText("by Ada Lovelace");
  await card.click();
  await expect(page).toHaveURL(/\?public=hut$/);
  await shown(page, hut.revision);
  await expect(page.locator(".gallery-note")).toHaveText(/^By Ada Lovelace · 2 steps · Fork to edit/);
  const menu = await shareMenu(page);
  await expect(menu.getByRole("menuitem", { name: /Publish/ })).toHaveCount(0);
});

for (const viewer of ["signed out", "a teammate"] as const) {
  test(`${viewer} opening the owner's link to a published fork sees the public build`, async ({ page }) => {
    const hut = { ...model(), id: "fork-hut", name: "Ada's hut" };
    await site(page, [], viewer === "signed out" ? null : ACCOUNT);
    await library(page, [entry(hut, "Ada Lovelace", "u-ada")], [hut]);
    await page.goto("/?fork=fork-hut");
    await expect(page).toHaveURL(/\?public=fork-hut$/);
    await shown(page, hut.revision);
  });
}

test("the user sets a display name from the account menu, and their public builds carry it at once", async ({
  page,
}) => {
  const hut = { ...model(), id: "hut", name: "Jane's hut" };
  await site(page);
  const published = [entry(hut, ACCOUNT.user.name, ACCOUNT.user.id)];
  await library(page, published, [hut]);
  await page.route("**/api/profile", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { name: published[0].author } });
    const { name } = route.request().postDataJSON();
    for (const p of published) p.author = name;
    return route.fulfill({ json: { name } });
  });
  await page.goto("/");

  const tile = page.getByRole("region", { name: "Public builds" }).locator(".gallery-card");
  await expect(tile).toContainText("by Jane Doe");
  const account = page.getByRole("button", { name: "Account" });
  await account.click();
  await page.getByRole("menuitem", { name: /Display name/ }).click();
  const field = page.getByRole("textbox", { name: "Display name" });
  await expect(field).toHaveValue("Jane Doe");
  await field.fill("Jane the Builder");
  await field.press("Enter");
  await expect(tile).toContainText("by Jane the Builder");
  await account.click();
  await expect(page.getByRole("menu")).toContainText("Jane the Builder");
});

test("home shows one row of my builds and ten rows of public ones, with more below on demand", async ({ page }) => {
  const builds = Array.from({ length: 80 }, (_, i) => ({ ...model(), id: `b${i}`, name: `Build ${i}` }));
  await site(page);
  await library(
    page,
    builds.map((b, i) => (i < 12 ? entry(b, ACCOUNT.user.name, ACCOUNT.user.id) : entry(b, "Ada Lovelace", "u-ada"))),
  );
  await page.goto("/");

  const yours = page.getByRole("region", { name: "Your builds" });
  const everyone = page.getByRole("region", { name: "Public builds" });
  await expect(everyone.locator(".gallery-card").first()).toBeVisible();
  const columns = await everyone
    .locator(".gallery-grid")
    .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  expect(columns).toBeGreaterThan(2);
  expect(columns).toBeLessThan(8);

  await expect(yours.locator(".gallery-card")).toHaveCount(columns);
  await yours.getByRole("button", { name: "Show all" }).click();
  await expect(yours.locator(".gallery-card")).toHaveCount(12);

  const more = everyone.getByRole("button", { name: "Show more builds" });
  await expect(everyone.locator(".gallery-card")).toHaveCount(columns * 10);
  await more.click();
  await expect(everyone.locator(".gallery-card")).toHaveCount(Math.min(80, columns * 20));
  if (columns * 20 < 80) await more.click();
  await expect(everyone.locator(".gallery-card")).toHaveCount(80);
  await expect(more).toHaveCount(0);
});

test("a public build shows no chat, even one its file still holds, and no author when it has no name", async ({
  page,
}) => {
  const messages: Message[] = [
    { role: "user", text: "A secret prompt", images: [] },
    { role: "assistant", text: "Built your hut.", images: [] },
  ];
  const hut = { ...model(), id: "hut", name: "A hut", messages };
  await site(page, [], null);
  await library(page, [entry(hut, "", "u-anon")], [hut]);
  await page.goto("/");
  const card = page.getByRole("region", { name: "Public builds" }).locator(".gallery-card");
  await expect(card.locator(".gallery-caption span")).toHaveText("5 minutes ago");
  await card.click();

  await shown(page, hut.revision);
  await expect(page.locator(".gallery-note")).toHaveText(/^Public build · 2 steps · Sign in to fork/);
  await expect(page.locator(".msg")).toHaveCount(0);
  await expect(page.locator("aside")).not.toContainText("secret");
});

test("a colleague's public build can be edited but not asked about", async ({ page }) => {
  const hut = { ...model(), id: "hut", name: "Ada's hut" };
  await site(page);
  await library(page, [entry(hut, "Ada Lovelace", "u-ada")], [hut]);
  await page.goto("/?public=hut");
  await shown(page, hut.revision);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const box = (await page.locator(".viewer-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("dialog", { name: "Selection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Holo" })).toHaveCount(0);
});

test("forking a public build saves a private copy at once; its first message starts Holo from a script of its boxes", async ({
  page,
}) => {
  const hut = { ...model(), id: "hut", name: "Ada's hut" };
  const { forks } = await site(page);
  const agp = await platform(page);
  await library(page, [entry(hut, "Ada Lovelace", "u-ada")], [hut]);
  await page.goto("/?public=hut");
  await shown(page, hut.revision);

  await page.locator(".gallery-note").getByRole("button", { name: "Fork" }).click();
  await expect(page).toHaveURL(/\?fork=fork-[a-f0-9-]{36}$/);
  await shown(page, hut.revision);
  await expect(page.locator(".aside-title")).toHaveText("Ada's hut · Fork");
  await expect(page.locator(".recovery-origin")).toHaveText("Fork of Ada's hut");
  const [fork] = forks.values();
  expect(fork.seed.origin).toMatchObject({ id: "hut", source: "public", revision: hut.revision });
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);

  await page.getByPlaceholder("Ask for a change").fill("Make it twice as tall");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => fork.sessionId).toBe("new-build");
  await expect(page).toHaveURL(new RegExp(`\\?fork=${fork.id}$`));
  const [created] = agp.posted("/api/v2/sessions");
  expect(created.group_id).toBe(fork.id);
  const [first] = created.messages;
  expect(first.message).toBe("Make it twice as tall");
  expect(first.files.map((f: { name: string }) => f.name)).toEqual([
    "blockyard.tgz",
    "blockyard-fork.json.gz",
    "remix.py",
  ]);
  expect(Buffer.from(first.files[2].source, "base64").toString()).toBe(
    'step("Floor")\nfill(0, 0, 0, 3, 0, 3, "stone")\nstep("Cube")\nfill(1, 1, 1, 2, 2, 2, "oak_planks")\n',
  );
  await expect(page.locator(".msg.user")).toHaveText(["Make it twice as tall"]);
  await shown(page, hut.revision);
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

test("the author publishes and makes a build private with one-click toggles", async ({ page }) => {
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

  await share.click();
  const visibility = page.getByRole("switch", { name: "Public", exact: true });
  await expect(visibility).not.toBeChecked();
  await visibility.click();
  await page.getByRole("dialog", { name: "Make it public" }).getByRole("button", { name: "Make it public" }).click();
  await expect(visibility).toBeChecked();
  await expect(page).toHaveURL(/\?build=mine$/);
  await share.click();
  await expect(menu).toContainText("In the public library");
  await expect(copyLink).toBeEnabled();
  await share.click();
  const post = calls.find((c) => c.method === "POST")!;
  expect(post.headers).toMatchObject({ authorization: `Bearer ${ACCOUNT.pass}`, "x-agents-key": ACCOUNT.key });
  expect(post.body).toEqual({ id: "mine", thumbnail: expect.stringMatching(/^data:image\/webp;base64,/), edits: null });

  const home = page.getByRole("button", { name: "HoloBlocks", exact: true });
  const mine = page.getByRole("region", { name: "Your builds" }).locator(".gallery-card");
  const everyone = page.getByRole("region", { name: "Public builds" }).locator(".gallery-card");
  await home.click();
  await expect(mine).toContainText("public");
  await expect(everyone).toContainText(`by ${ACCOUNT.user.name}`);
  await page.goBack();
  await shown(page, hut.revision);

  await visibility.click();
  await expect(visibility).not.toBeChecked();
  await expect(page).toHaveURL(/\?build=mine$/);
  await share.click();
  await expect(menu).toContainText("Private: not in the public library");
  await expect(copyLink).toBeDisabled();
  await share.click();
  expect(calls.find((c) => c.method === "DELETE")).toMatchObject({
    search: "?id=mine",
    headers: { authorization: `Bearer ${ACCOUNT.pass}`, "x-agents-key": ACCOUNT.key },
  });
  await home.click();
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

  await page.getByRole("switch", { name: "Public", exact: true }).click();
  await page.getByRole("dialog", { name: "Make it public" }).getByRole("button", { name: "Make it public" }).click();
  await expect.poll(() => calls.some((c) => c.method === "POST")).toBe(true);
  expect(calls.find((c) => c.method === "POST")!.body.edits).toEqual({ revision: hut.revision, edits });
});

/** The portal's Google sign-in, then /api/session handing over `handoff.value`; returns what they read. */
async function portal(page: Page, handoff: { value: object }) {
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
      headers: { location: back.back, "set-cookie": setCookie(HANDOFF, JSON.stringify(handoff.value), 60) },
    });
  });
  return { pending, challenges };
}

/** Requests a signed-out visitor must never make: the Agents API, and the library's signed-in routes. */
function signedInRequests(page: Page): string[] {
  const made: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      url.startsWith("https://agp.eu.hcompany.ai/") ||
      /\/api\/(names|forks|deleted|imports)/.test(url) ||
      url.includes("mine=1") ||
      request.headers()["x-agents-key"]
    )
      made.push(`${request.method()} ${url}`);
  });
  return made;
}

test("signed out, home lists the public builds and the showcases, which open read only", async ({ page }) => {
  const hut = { ...model(), id: "hut", name: "Ada's hut" };
  const tower = { ...model("f0e1d2c3b4a5"), id: "tower", name: "Tower" };
  await site(page, [tower], null);
  await library(page, [entry(hut, "Ada Lovelace", "u-ada")], [hut]);
  const made = signedInRequests(page);
  await page.goto("/");

  await expect(page.getByRole("region", { name: "Your builds" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import a build" })).toHaveCount(0);
  const cards = page.getByRole("region", { name: "Public builds" }).locator(".gallery-card");
  await expect(cards).toHaveText([/Ada's hut/, /Tower/]);
  await cards.filter({ hasText: "Tower" }).click();
  await expect(page).toHaveURL(/\?showcase=tower$/);
  await shown(page, tower.revision);
  await expect(page.locator(".gallery-note")).toHaveText(/^Showcase · Sign in to fork/);
  await page.locator(".gallery-note").getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in to build" })).toBeVisible();
  expect(made).toEqual([]);
});

test("signed out, a public build's link opens it in the viewer, exports and all, with no signed-in request", async ({
  page,
}) => {
  const hut = { ...model(), id: "hut", name: "Ada's hut" };
  await site(page, [], null);
  await library(page, [entry(hut, "Ada Lovelace", "u-ada")], [hut]);
  const made = signedInRequests(page);
  const errors: string[] = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?public=hut");

  await shown(page, hut.revision);
  await expect(page.locator(".gallery-note")).toHaveText(/^By Ada Lovelace · 2 steps · Sign in to fork/);
  const menu = await shareMenu(page);
  await expect(menu.getByRole("menuitem", { name: "Copy link" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "Download .schem" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: /Publish/ })).toHaveCount(0);
  expect(made).toEqual([]);
  expect(errors).toEqual([]);
});

test("no brand shows on home, its credits, a public build or the sign-in dialog, whose legal links open H's pages", async ({
  page,
}) => {
  const brands = /lego|duplo|minecraft|mojang|pick a brick/i;
  const hut = { ...model(), id: "hut", name: "Ada's hut" };
  await site(page, [], null);
  await library(page, [entry(hut, "Ada Lovelace", "u-ada")], [hut]);
  const opensInTab = async (link: ReturnType<Page["getByRole"]>, href: string) => {
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
  };
  await page.goto("/");

  await expect(page.locator(".gallery-card")).toHaveText([/Ada's hut/]);
  const meta = await page.locator("meta[content]").evaluateAll((tags) => tags.map((t) => t.getAttribute("content")));
  expect([await page.title(), ...meta, await page.locator("body").innerText()].join("\n")).not.toMatch(brands);
  const footer = page.locator("footer.site-footer");
  await opensInTab(footer.getByRole("link", { name: "Docs" }), "https://hub.hcompany.ai/");
  await opensInTab(footer.getByRole("link", { name: "H Platform" }), "https://platform.hcompany.ai");
  await opensInTab(footer.getByRole("link", { name: "Terms of Service" }), "https://www.hcompany.ai/terms-of-use");
  await opensInTab(footer.getByRole("link", { name: "Privacy Policy" }), "https://www.hcompany.ai/privacy-policy");
  await footer.getByRole("button", { name: "Credits" }).click();
  const credits = page.getByRole("dialog", { name: "Credits" });
  await opensInTab(credits.getByRole("link", { name: "Faithful 32x" }), "https://faithfulpack.net/");
  expect(await credits.innerText()).not.toMatch(brands);
  await credits.getByRole("button", { name: "Close" }).click();
  await expect(credits).toBeHidden();

  await page.goto("/?public=hut");
  await shown(page, hut.revision);
  expect(await page.locator("body").innerText()).not.toMatch(brands);
  await page.locator(".gallery-note").getByRole("button", { name: "Sign in" }).click();
  const signIn = page.getByRole("dialog", { name: "Sign in to build" });
  await expect(signIn).toContainText("By signing in you agree to the Terms and Privacy Policy.");
  await opensInTab(signIn.getByRole("link", { name: "Terms" }), "https://www.hcompany.ai/terms-of-use");
  await opensInTab(signIn.getByRole("link", { name: "Privacy Policy" }), "https://www.hcompany.ai/privacy-policy");
  expect(await signIn.innerText()).not.toMatch(brands);
  await signIn.getByRole("button", { name: "Close" }).click();
  await expect(await shareMenu(page)).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(brands);
});

test("signed out, sending a new build asks to sign in, and the prompt waits in the composer after it", async ({
  page,
}) => {
  await site(page, [], null);
  const handoff = { value: ACCOUNT };
  await portal(page, handoff);
  const made = signedInRequests(page);
  await page.goto("/");

  const composer = page.getByRole("textbox", { name: "Describe a new build" });
  const dialog = page.getByRole("dialog", { name: "Sign in to build" });
  await composer.fill("A windmill by a river");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(composer).toHaveValue("A windmill by a river");
  await page.getByRole("button", { name: "A hilltop castle" }).click();
  await expect(dialog).toBeVisible();
  await expect(composer).toHaveValue(/^A medieval castle crowning a rocky hill/);
  expect(made).toEqual([]);

  await dialog.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  await expect(composer).toHaveValue(/^A medieval castle crowning a rocky hill/);
  expect(made.filter((r) => r.startsWith("POST"))).toEqual([]);
});

test("signing in from the header comes back where the user left, or with why it failed", async ({ page, context }) => {
  const hut = { ...model(), id: "hut" };
  await site(page, [hut], null);
  const handoff: { value: object } = { value: { error: "The Google sign-in failed: try again." } };
  const { pending, challenges } = await portal(page, handoff);
  const signIn = page.locator("header").getByRole("button", { name: "Sign in" });
  const google = page.getByRole("button", { name: "Continue with Google" });

  await page.goto(`/?showcase=${hut.id}`);
  await shown(page, hut.revision);
  await signIn.click();
  await google.click();
  await expect(page.getByRole("dialog", { name: "Sign in to build" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("The Google sign-in failed: try again.");

  handoff.value = ACCOUNT;
  await google.click();
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`\\?showcase=${hut.id}$`));
  expect((await context.cookies()).map((c) => c.name)).not.toContain(HANDOFF);

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await signIn.click();
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
