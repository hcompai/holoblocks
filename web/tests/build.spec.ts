import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { model, site } from "./fixtures";
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
  const composer = page.getByPlaceholder("Describe what to build…");
  const prompt = "Le Mont-Saint-Michel à marée haute";
  await composer.fill(prompt);
  await page.locator('input[type="file"]').setInputFiles(PHOTO);
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
  const [first] = agp.posted("/messages");
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

  await page.getByPlaceholder("Describe how to change it…").fill("Add the causeway");
  await send.click();
  await expect.poll(() => agp.posted("/messages")).toHaveLength(2);
  expect(agp.posted("/messages")[1]).toMatchObject({ message: "Add the causeway", files: [] });

  agp.crash("new-build", "Session 27289a90 is not running (status: failed)");
  await expect(page.locator(".msg").last()).toHaveText(
    "The build stopped: Session 27289a90 is not running (status: failed)",
  );
});

test("the library lists my builds by the names Holo gave them, then the showcases, which download as .schem", async ({
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
  await page.getByRole("tab", { name: "Library" }).click();
  const cards = page.locator(".library button");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Hollowbough");
  await expect(cards.nth(0)).toContainText("7 steps");
  await expect(cards.nth(1)).toContainText("Hut");
  await cards.nth(1).click();
  await expect(page).toHaveURL(/\?showcase=hut$/);
  await shown(page, showcase.revision);
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByText("A showcase from the gallery.")).toBeVisible();

  await page.getByRole("button", { name: "Download" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Download .schem" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Hut.schem");
  const nbt = gunzipSync(readFileSync((await download.path())!));
  expect(nbt.subarray(0, 12).toString("latin1")).toBe("\x0a\x00\x09Schematic");
  expect(nbt.includes("minecraft:oak_planks")).toBe(true);
});
