import { expect, test, type Page } from "@playwright/test";
import type { Build } from "../src/model";
import { selectedArea } from "../src/selectedArea";
import type { Cell } from "../src/voxelEdits";
import { model, site } from "./fixtures";
import { platform } from "./platform";

const SCRIPT = '# Holo\'s own script\nstep("Floor")\nfill(0, 0, 0, 3, 0, 3, "stone")\n';

type Sent = { name: string; source: string }[];
const file = (files: Sent, name: string) =>
  Buffer.from(files.find((f) => f.name === name)!.source, "base64").toString();

async function selectCenter(page: Page) {
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model().revision);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const box = (await page.locator(".viewer-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("dialog", { name: "Selection", exact: true })).toContainText("oak planks");
}

test("the selected area is guidance, with its blocks, their box and the model they were picked on", async () => {
  const cells: { at: Cell; block: string }[] = [
    { at: [1, 2, 1], block: "oak_planks" },
    { at: [3, 0, 0], block: "stone" },
  ];
  const build: Build = { ...model(), id: "hut", boxes: [], status: "done", messages: [], open: true, script: SCRIPT };
  const files = selectedArea(build, cells);
  const area = JSON.parse(await files["selected-area.json"].text());
  expect(area).toMatchObject({ box: [1, 0, 0, 3, 2, 1], cells });
  expect(area.guidance).toContain("not a strict edit boundary");
  expect(await files["selected-area-model.py"].text()).toBe(SCRIPT);
});

test("Ask Holo sends the selected area through chat, including hand edits", async ({ page }, testInfo) => {
  await site(page);
  const agp = await platform(page);
  agp.session("selected", "idle");
  agp.say("selected", "A hut");
  agp.share("selected", { ...model(), script: SCRIPT });
  await page.goto("/?build=selected");
  await selectCenter(page);
  await page.keyboard.press("PageUp");
  await page.getByRole("button", { name: "Ask Holo" }).click();
  const prompt = page.getByRole("textbox", { name: "Prompt for selected area" });
  await expect(prompt).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Selected area", exact: true })).toContainText("1 block");
  await prompt.fill("Make this taller");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("toolbar", { name: "Edit mode" })).toContainText("1 change");
  await page.screenshot({ path: testInfo.outputPath("selected-area.png") });
  await prompt.press("Enter");
  await expect.poll(() => agp.posted("/messages")).toHaveLength(1);
  const sent = agp.posted("/messages")[0];
  expect(sent.message).toBe("Make this taller");
  const [edit] = await page.evaluate(() => JSON.parse(localStorage.getItem("blockyard.edits")!).selected.edits);
  const moved = edit.cells[0].map((c: number, i: number) => c + edit.by[i]);
  expect(JSON.parse(file(sent.files, "selected-area.json")).cells).toEqual([{ at: moved, block: "oak_planks" }]);
  const rebuilt = file(sent.files, "selected-area-model.py");
  expect(rebuilt).toContain('step("Edited by hand")');
  expect(rebuilt).not.toContain("Holo's own script");
  await expect(page.locator(".chat")).toContainText("Make this taller");
});

test("a failed send keeps the prompt, and closing it keeps the selection", async ({ page }, testInfo) => {
  await site(page);
  const agp = await platform(page);
  agp.session("retry-area", "idle");
  agp.share("retry-area", model());
  await page.goto("/?build=retry-area");
  await selectCenter(page);
  await page.getByRole("button", { name: "Ask Holo" }).click();
  const prompt = page.getByRole("textbox", { name: "Prompt for selected area" });
  await prompt.fill("Make this curved");
  await page.route("**/api/v2/sessions/retry-area/messages", (route) =>
    route.fulfill({ status: 503, json: { detail: "Unavailable" }, headers: { "access-control-allow-origin": "*" } }),
  );
  await page.getByRole("button", { name: "Send to Holo" }).click();
  await expect(page.getByRole("dialog", { name: "Selected area", exact: true }).getByRole("alert")).toBeVisible();
  await expect(prompt).toHaveValue("Make this curved");
  await page.getByRole("button", { name: "Close prompt" }).click();
  await expect(page.getByRole("dialog", { name: "Selection", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ask Holo" }).click();
  await expect(prompt).toHaveValue("Make this curved");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(prompt).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("selected-area-mobile.png") });
});

test("asking about a showcase's area starts a remix carrying the area", async ({ page }) => {
  await site(page, [{ ...model(), id: "hut", name: "Hut" }]);
  const agp = await platform(page);
  await page.goto("/?showcase=hut");
  await selectCenter(page);
  await page.getByRole("button", { name: "Ask Holo" }).click();
  await page.getByRole("textbox", { name: "Prompt for selected area" }).fill("Round this corner");
  await page.getByRole("button", { name: "Send to Holo" }).click();
  await expect(page).toHaveURL(/\?build=new-build$/);
  const [first] = agp.posted("/api/v2/sessions")[0].messages;
  expect(first.message).toBe("Round this corner");
  expect(first.files.map((f: { name: string }) => f.name)).toEqual([
    "blockyard.tgz",
    "selected-area.json",
    "selected-area-model.py",
    "blockyard-fork.json.gz",
    "remix.py",
  ]);
});
