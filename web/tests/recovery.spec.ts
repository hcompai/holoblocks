import { expect, test } from "@playwright/test";
import { model, site } from "./fixtures";
import { platform } from "./platform";

const SCRIPT = 'step("Floor")\nfill(0, 0, 0, 3, 0, 3, "stone")\nstep("Cube")\nfill(1, 1, 1, 2, 2, 2, "oak_planks")\n';
const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const named = (message: { files: { name: string }[] }) => message.files.map((f) => f.name);
const contents = (message: { files: { name: string; source: string }[] }, name: string) =>
  Buffer.from(message.files.find((f) => f.name === name)!.source, "base64").toString();

test("a stopped build continues in a new session from its last shared model, with its requests and photos; the original stays", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  const saved = { ...model(), script: SCRIPT };
  agp.session("failed", "failed");
  agp.say("failed", "Build a hut", [PHOTO]);
  agp.say("failed", "Make the roof red");
  agp.attach("failed", "remix.py", Buffer.from("old starting model"));
  agp.step("failed", "Adding the roof.", "PRIVATE_REASONING");
  agp.share("failed", saved);
  await page.goto("/?build=failed");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", saved.revision);
  const panel = page.getByRole("region", { name: "Build recovery" });
  await expect(panel).toContainText("This build stays as it is");
  await panel.getByRole("button", { name: "Continue from saved version" }).click();
  await expect(page).toHaveURL(/build=new-build$/);

  const [created] = agp.posted("/api/v2/sessions");
  expect(created.group_id).toBe("failed");
  expect(created.messages.map((m: { message: string }) => m.message)).toEqual([
    "Build a hut",
    "Make the roof red",
    expect.stringContaining("files/remix.py rebuilds its last shared model"),
  ]);
  expect(created.messages[0].images).toEqual([PHOTO]);
  expect(named(created.messages[0])).toEqual(["blockyard.tgz", "remix.py", "photo-1-1.png"]);
  expect(contents(created.messages[0], "remix.py")).toBe(SCRIPT);
  expect(JSON.stringify(created)).not.toContain("PRIVATE_REASONING");
  expect(agp.posted("/messages")).toHaveLength(0);

  await page.getByRole("link", { name: "Open original build" }).click();
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", saved.revision);
  await page.getByRole("button", { name: "Open recovery attempt" }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  expect(agp.posted("/api/v2/sessions")).toHaveLength(1);
  expect(agp.sessions.get("failed")!.status).toBe("failed");
});

test("a recovery whose creation response was lost is reopened, never started twice", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("failed", "failed");
  agp.say("failed", "Build a hut");
  agp.share("failed", model());
  agp.loseCreationResponse = true;
  await page.goto("/?build=failed");
  await page.getByRole("button", { name: "Continue from saved version" }).click();
  await expect(page.getByRole("alert")).toContainText("check Your builds on the home page");
  await page.reload();
  await page.getByRole("button", { name: "Continue from saved version" }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  expect(agp.posted("/api/v2/sessions")).toHaveLength(1);
  await expect(page.getByRole("link", { name: "Open original build" })).toBeVisible();
});

test("a build that stopped before sharing anything starts again from its requests; a refused start can be retried", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  agp.session("early", "failed");
  agp.say("early", "My original request", [PHOTO]);
  agp.refuse = [503];
  await page.goto("/?build=early");
  const retry = page.getByRole("button", { name: "Try again with same request" });
  await retry.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await retry.click();
  await expect(page).toHaveURL(/build=new-build$/);
  const created = agp.posted("/api/v2/sessions")[1];
  expect(created.messages).toHaveLength(1);
  expect(created.messages[0].message).toBe("My original request");
  expect(created.messages[0].images).toEqual([PHOTO]);
  expect(named(created.messages[0])).toEqual(["blockyard.tgz", "photo-1-1.png"]);
});

test("a remix that stopped before sharing anything starts again from its own starting model", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("remix", "failed");
  agp.say("remix", "Make it autumn");
  agp.attach("remix", "remix.py", Buffer.from(SCRIPT));
  await page.goto("/?build=remix");
  await page.getByRole("button", { name: "Try again with same request" }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  const [created] = agp.posted("/api/v2/sessions");
  expect(created.messages.map((m: { message: string }) => m.message)).toEqual(["Make it autumn"]);
  expect(contents(created.messages[0], "remix.py")).toBe(SCRIPT);
});

test("a missing photo or starting model starts nothing", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("photo", "failed");
  agp.say("photo", "Match this photo", [
    { type: "url", source: "https://agp.eu.hcompany.ai/files/missing", media_type: "image/jpeg" },
  ]);
  agp.session("remix", "failed");
  agp.say("remix", "Make it autumn");
  agp.files.delete(agp.attach("remix", "remix.py", Buffer.from(SCRIPT)));
  await page.goto("/?build=photo");
  await page.getByRole("button", { name: "Try again with same request" }).click();
  await expect(page.getByRole("alert")).toContainText("A photo could not be retrieved");
  await page.goto("/?build=remix");
  await page.getByRole("button", { name: "Try again with same request" }).click();
  await expect(page.getByRole("alert")).toContainText("The starting model could not be retrieved");
  expect(agp.posted("/api/v2/sessions")).toHaveLength(0);
});

test("recovery fetches external reference photos without the Agents key", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  const url = "https://images.example.org/reference.png";
  const requests: { authorization?: string }[] = [];
  await page.route(url, (route) => {
    requests.push({ authorization: route.request().headers().authorization });
    return route.fulfill({
      contentType: "image/png",
      body: Buffer.from(PHOTO.split(",")[1], "base64"),
      headers: { "access-control-allow-origin": "*" },
    });
  });
  agp.session("external-photo", "failed");
  agp.say("external-photo", "Build a hut", [{ type: "url", source: url }]);
  agp.share("external-photo", model());
  await page.goto("/?build=external-photo");
  await page.getByRole("button", { name: "Continue from saved version" }).click();
  await expect(page).toHaveURL(/build=new-build$/);
  expect(requests.length).toBeGreaterThanOrEqual(1);
  expect(requests.every((r) => !r.authorization)).toBe(true);
  const [created] = agp.posted("/api/v2/sessions");
  expect(created.messages[0].images).toEqual([PHOTO]);
});
