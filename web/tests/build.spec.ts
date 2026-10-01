import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { model, shareMenu, site } from "./fixtures";
import { platform } from "./platform";

const PHOTO = {
  name: "reference.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64",
  ),
};

const shown = (page: Page, revision: string) =>
  expect(page.locator(".viewer")).toHaveAttribute("data-revision", revision);

test("a live build shows each shared model and answers `look` with a render of the latest revision", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  agp.session("live");
  agp.say("live", "A **hut**");
  agp.step("live", "The roof is **too flat**:\n\n- raise it\n- add eaves");
  agp.look("live", "early");
  await page.goto("/?build=live");

  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(1);
  expect(agp.posted("/tool_results")[0]).toMatchObject({
    kind: "error_event",
    tool_req: { id: "early" },
    error: expect.stringContaining("Nothing is shared yet"),
  });
  const holo = page.locator(".msg.assistant").first();
  await expect(holo.locator("strong")).toHaveText("too flat");
  await expect(holo.locator("li")).toHaveCount(2);

  const hut = model();
  agp.state("live", "running");
  agp.share("live", hut);
  agp.look("live", "steep", { pitch: 120 });
  await shown(page, hut.revision);
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(2);
  expect(agp.posted("/tool_results")[1]).toMatchObject({
    kind: "error_event",
    error: expect.stringContaining("`pitch` goes from 0 to 90"),
  });

  agp.state("live", "running");
  agp.look("live", "side", { angle: 90, box: [3, 3, 3, 0, 0, 0] });
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(3);
  const [caption, image] = agp.posted("/tool_results")[2].result;
  expect(caption).toBe(
    "Revision a1b2c3d4, 24 blocks. Close-up of x 0-3, y 0-3, z 0-3, showing only the blocks inside: " +
      "one view from 90 degrees around (right), 30 degrees up.",
  );
  expect(image).toMatch(/^data:image\/png;base64,/);

  await page.getByRole("button", { name: "First step" }).click();
  const smaller = { ...model("f0e1d2c3b4a5"), boxes: [0, 0, 0, 3, 0, 3, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1] };
  agp.state("live", "running");
  agp.share("live", smaller);
  agp.look("live", "again");
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(4);
  expect(agp.posted("/tool_results")[3].result[0]).toMatch(
    /^Revision f0e1d2c3, 17 blocks\. The render: 3\/4 front-right/,
  );
});

test("a new build sends the toolkit and the photos; Stop makes Holo answer and the build takes follow-ups", async ({
  page,
}) => {
  await site(page);
  const agp = await platform(page);
  agp.refuse = [503];
  await page.goto("/");
  const composer = page.getByPlaceholder("A castle on a cliff… or drop a photo");
  const prompt = "Le Mont-Saint-Michel à marée haute";
  await composer.fill(prompt);
  await page.getByLabel("Photos to attach").setInputFiles(PHOTO);
  const send = page.getByRole("button", { name: "Send", exact: true });
  await send.click();
  await expect(page.getByText("The platform is unavailable.")).toBeVisible();
  await expect(composer).toHaveValue(prompt);
  await expect(page.getByRole("img", { name: "Attached image 1" })).toBeVisible();

  await send.click();
  await expect(page).toHaveURL(/\?build=new-build$/);
  const [session] = agp.posted("/api/v2/sessions");
  expect(session.agent).toMatchObject({
    name: "blockyard",
    model: "holo4-27b",
    environments: [{ kind: "workstation", id: "blockyard" }],
  });
  expect(session.agent.tools.map((t: { name: string }) => t.name)).toEqual(["look"]);
  expect(session.agent.instructions).not.toMatch(/\{\{\w+\}\}/);
  expect(agp.posted("/messages")).toHaveLength(0);
  const [first] = session.messages;
  expect(first.message).toBe(prompt);
  expect(first.images).toEqual([expect.stringMatching(/^data:image\/png;base64,/)]);
  expect(first.files.map((f: { name: string }) => f.name)).toEqual([
    "blockyard.tgz",
    expect.stringMatching(/^photo-\w+-1\.png$/),
  ]);
  await expect(page.locator(".msg.user")).toHaveText(prompt);

  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await stop.click();
  await expect(stop).toBeDisabled();
  await expect.poll(() => agp.posted("/force_answer")).toHaveLength(1);
  agp.answer("new-build", "Stopped here: the abbey stands on the rock.");
  await expect(page.locator(".msg.assistant").last()).toHaveText("Stopped here: the abbey stands on the rock.");

  await page.getByPlaceholder("Ask for a change").fill("Add the causeway");
  await send.click();
  await expect.poll(() => agp.posted("/messages")).toHaveLength(1);
  expect(agp.posted("/messages")[0]).toMatchObject({ message: "Add the causeway", files: [] });

  agp.crash("new-build", "Session 27289a90 is not running (status: failed)");
  await expect(page.locator(".msg.error")).toHaveText(
    "The building service stopped unexpectedly. You can continue below.",
  );
  await expect(page.getByRole("button", { name: "Try again with same request" })).toBeVisible();
  await expect(page.getByPlaceholder("Ask for a change")).toHaveCount(0);
});

test("home shows my builds by the names Holo gave them; showcases under Public builds, which download as .schem", async ({
  page,
}) => {
  const showcase = { ...model(), id: "hut", name: "Hut" };
  await site(page, [showcase]);
  const agp = await platform(page);
  agp.session("mine", "idle");
  await page.addInitScript(() =>
    localStorage.setItem(
      "blockyard.library",
      JSON.stringify({ mine: { name: "Hollowbough", prompt: "A treehouse", steps: 7 } }),
    ),
  );
  await page.goto("/");
  const mine = page.getByRole("region", { name: "Your builds" }).locator(".gallery-card");
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText("Hollowbough");
  await expect(mine).toContainText("7 steps");
  const everyone = page.getByRole("region", { name: "Public builds" }).locator(".gallery-card");
  await expect(everyone).toHaveCount(1);
  await everyone.click();
  await expect(page).toHaveURL(/\?showcase=hut$/);
  await shown(page, showcase.revision);
  await expect(page.getByText("A showcase from the gallery: remix it to make your own.")).toBeVisible();

  const menu = await shareMenu(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    menu.getByRole("menuitem", { name: "Download .schem" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Hut.schem");
  const nbt = gunzipSync(readFileSync((await download.path())!));
  expect(nbt.subarray(0, 12).toString("latin1")).toBe("\x0a\x00\x09Schematic");
  expect(nbt.includes("minecraft:oak_planks")).toBe(true);
});

test("Holo's work shows as what it does now, then folds under its message", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  const run = { tool_name: "shell", args: { command: "blocks run" }, id: "run" };
  agp.session("work");
  agp.say("work", "A tower");
  agp.now += 1000;
  agp.step("work", "", "The walls need a first course.", [run]);
  await page.goto("/?build=work");
  const live = page.locator(".msg.live");
  await expect(live).toContainText("Placing blocks");

  agp.result("work", run);
  agp.step("work", "", "Now the roof.", [{ tool_name: "look", args: {}, id: "look" }]);
  await expect(live).toContainText("Checking every side");

  agp.now += 95_000;
  agp.step("work", "Built a tower.", "It stands.");
  agp.answer("work", "Built a tower.");
  const holo = page.locator(".msg.assistant");
  await expect(holo).toHaveCount(1);
  await expect(live).toHaveCount(0);
  await expect(holo.locator("summary")).toHaveText("Worked for 1m 36s");
  await holo.locator("summary").click();
  await expect(holo.locator(".work-steps")).toContainText("The walls need a first course.");
  await expect(holo.locator(".work-action")).toHaveText(["Building the model", "Looking at the model"]);
});

test("Holo keeps getting its renders while the user browses other builds", async ({ page }) => {
  const showcase = { ...model(), id: "hut", name: "Hut" };
  await site(page, [showcase]);
  const agp = await platform(page);
  const hut = model("0a1b2c3d4e5f");
  agp.session("live");
  agp.share("live", hut);
  await page.goto("/?build=live");
  await shown(page, hut.revision);
  await page.getByRole("button", { name: "HoloBlocks", exact: true }).click();
  await page.getByRole("region", { name: "Public builds" }).locator(".gallery-card").click();
  await shown(page, showcase.revision);

  agp.look("live", "away", { angle: 180 });
  await expect.poll(() => agp.posted("/tool_results")).toHaveLength(1);
  const [caption, image] = agp.posted("/tool_results")[0].result;
  expect(caption).toMatch(`Revision ${hut.revision.slice(0, 8)}`);
  expect(image).toMatch(/^data:image\/(png|jpeg);base64,/);
});

test("a lost connection says so until the platform answers again", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  const hut = model();
  agp.session("live");
  agp.share("live", hut);
  await page.goto("/?build=live");
  await shown(page, hut.revision);
  agp.offline = true;
  const lost = page.getByRole("status").filter({ hasText: "Reconnecting…" });
  await expect(lost).toBeVisible();
  agp.offline = false;
  await expect(lost).toHaveCount(0);
});

test("an idea starts in one click and shows at once under its short label", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  await page.goto("/");
  await page.getByRole("button", { name: "A hilltop castle" }).click();
  await expect(page.locator(".msg.user")).toHaveText("A hilltop castle");
  await expect(page.locator(".aside-title")).toHaveText("A hilltop castle");
  await expect(page).toHaveURL(/\?build=new-build$/);
  expect(agp.posted("/api/v2/sessions")[0].messages[0].message).toMatch(/^A medieval castle crowning a rocky hill/);
});

test("a build whose session ended takes a change as a copy, under the same name", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("ended");
  agp.say("ended", "A little hut");
  agp.share("ended", model());
  agp.answer("ended", "Built.");
  agp.sessions.get("ended")!.status = "completed";
  await page.goto("/?build=ended");
  await shown(page, model().revision);
  await expect(page.getByRole("region", { name: "Build recovery" })).toHaveCount(0);
  await page.getByPlaceholder("Ask for a change").fill("Add a chimney");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\?build=new-build$/);
  await expect(page.locator(".aside-title")).toHaveText("Little Hut");
  const [first] = agp.posted("/api/v2/sessions")[0].messages;
  expect(first.message).toBe("Add a chimney");
  expect(first.files.map((f: { name: string }) => f.name)).toEqual(["blockyard.tgz", "remix.py"]);
});
