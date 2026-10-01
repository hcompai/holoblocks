import type { Page } from "@playwright/test";
import type { Message, Model } from "../src/model";

/** A 4x4 stone floor, then a 2x2x2 oak cube on it: 16 + 8 = 24 blocks in two steps. */
export function model(revision = "a1b2c3d4e5f6"): Model {
  return {
    name: "Little Hut",
    width: 16,
    depth: 16,
    height: 16,
    updated: 1,
    revision,
    steps: [
      { index: 0, title: "Floor", code: 'step("Floor")\nfill(0, 0, 0, 3, 0, 3, "stone")' },
      { index: 1, title: "Cube", code: 'step("Cube")\nfill(1, 1, 1, 2, 2, 2, "oak_planks")' },
    ],
    blocks: ["stone", "oak_planks"],
    boxes: [0, 0, 0, 3, 0, 3, 0, 0, 1, 1, 1, 2, 2, 2, 1, 1],
  };
}

export const ACCOUNT = {
  user: { id: "u-jane", email: "jane.doe@hcompany.ai", name: "Jane Doe" },
  key: "hk-test",
  keyId: "key-1",
  expires: 4102444800,
  pass: "pass-jane",
};

export async function signedIn(page: Page, account = ACCOUNT) {
  await page.addInitScript((a) => localStorage.setItem("blockyard.account", JSON.stringify(a)), account);
}

/** Serve the toolkit and these showcases as the static site would; the Agents API has no sessions and the public library is empty. `account` is signed in, if any. */
export async function site(
  page: Page,
  showcases: (Model & { id: string })[] = [],
  account: typeof ACCOUNT | null = ACCOUNT,
) {
  if (account) await signedIn(page, account);
  await page.route("https://agp.eu.hcompany.ai/**", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
      json: { items: [], total: 0, page: 1 },
    }),
  );
  await page.route("**/api/builds*", (route) =>
    new URL(route.request().url()).searchParams.has("id")
      ? route.fulfill({ status: 404, json: { error: "This build is not public." } })
      : route.fulfill({ json: [] }),
  );
  await page.route("**/blockyard.tgz", (route) => route.fulfill({ contentType: "application/gzip", body: "toolkit" }));
  await page.route("**/gallery/builds.json", (route) =>
    route.fulfill({
      json: showcases.map((s) => ({ id: s.id, name: s.name, prompt: "Showcase", revision: s.revision, steps: 2 })),
    }),
  );
  for (const s of showcases) {
    const messages: Message[] = [{ role: "assistant", text: "Scripted showcase.", images: [] }];
    await page.route(`**/gallery/builds/${s.id}.json`, (route) =>
      route.fulfill({ json: { ...s, status: "done", messages } }),
    );
  }
}

/** Opens the open build's Share menu. */
export async function shareMenu(page: Page) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  return page.getByRole("menu");
}
