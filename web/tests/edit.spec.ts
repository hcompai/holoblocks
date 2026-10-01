import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Model } from "../src/model";
import { applyEdits, EDITED_STEP, validEdits } from "../src/voxelEdits";
import { model, site } from "./fixtures";
import { platform } from "./platform";

/** Every block the boxes leave, by "x,y,z". */
function cells({ blocks, boxes }: Pick<Model, "blocks" | "boxes">): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < boxes.length; i += 8) {
    const [x0, y0, z0, x1, y1, z1, block] = boxes.slice(i, i + 7);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          if (blocks[block] === "air") out.delete(`${x},${y},${z}`);
          else out.set(`${x},${y},${z}`, blocks[block]);
        }
  }
  return out;
}

test("edits replay in order into a last step of their own, clearing with air, ignoring cells off the site", () => {
  const hut = model();
  expect(applyEdits(hut, [])).toBe(hut);
  const edited = applyEdits(hut, [
    { kind: "set", cells: [[0, 0, 0]], block: "gold_block" },
    {
      kind: "move",
      cells: [
        [1, 2, 1],
        [2, 2, 1],
        [9, 9, 9],
      ],
      by: [0, 1, 0],
    },
    { kind: "duplicate", cells: [[0, 0, 0]], by: [5, 0, 0] },
    {
      kind: "set",
      cells: [
        [3, 0, 3],
        [99, 0, 0],
      ],
      block: "air",
    },
  ]);
  expect(edited.boxes.slice(0, hut.boxes.length)).toEqual(hut.boxes);
  expect(edited.steps.map((s) => s.title)).toEqual(["Floor", "Cube", EDITED_STEP]);
  expect(new Set(edited.boxes.slice(hut.boxes.length).filter((_, i) => i % 8 === 7))).toEqual(new Set([2]));
  const blocks = cells(edited);
  expect(blocks.size).toBe(24);
  expect([blocks.get("0,0,0"), blocks.get("5,0,0"), blocks.get("3,0,3")]).toEqual([
    "gold_block",
    "gold_block",
    undefined,
  ]);
  expect([blocks.get("1,2,1"), blocks.get("2,2,1"), blocks.get("1,3,1"), blocks.get("2,3,1")]).toEqual([
    undefined,
    undefined,
    "oak_planks",
    "oak_planks",
  ]);
});

test("only well-formed edits are accepted, stripped of anything else", () => {
  expect(validEdits([{ kind: "move", cells: [[0, 0, 0]], by: [1, 0, 0], note: "x" }])).toEqual([
    { kind: "move", cells: [[0, 0, 0]], by: [1, 0, 0] },
  ]);
  expect(validEdits([{ kind: "set", cells: [[1, 2, 3]], block: "oak_stairs[facing=east,half=top]" }])).toHaveLength(1);
  for (const bad of [
    null,
    {},
    [{ kind: "set", cells: [[0, 0]], block: "stone" }],
    [{ kind: "set", cells: [[0, 0, 0.5]], block: "stone" }],
    [{ kind: "set", cells: [[0, 0, 0]], block: "Stone!" }],
    [{ kind: "rotate", cells: [[0, 0, 0]], by: [1, 0, 0] }],
  ])
    expect(validEdits(bad)).toBeNull();
});

const hut = { ...model(), id: "hut", name: "Hut" };

async function open(page: Page) {
  await site(page, [hut]);
  await page.goto("/?showcase=hut");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const box = (await page.locator(".viewer-canvas").boundingBox())!;
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

const count = (page: Page) => page.locator("header .chip").first();
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Edit mode" });

test("edit mode selects the block under the pointer, and its edits persist in this browser", async ({ page }) => {
  const { cx, cy } = await open(page);
  await expect(count(page)).toHaveText("24 blocks");
  await expect(toolbar(page)).toContainText("Click a block to select it");
  await page.mouse.move(cx, cy);
  await expect(page.locator(".viewer-canvas")).toHaveCSS("cursor", "pointer");
  await page.mouse.click(cx, cy);
  const panel = page.getByRole("dialog", { name: "Selection" });
  await expect(panel).toContainText("oak planks");

  await page.keyboard.press("ArrowRight");
  await expect(toolbar(page)).toContainText("1 change");
  await panel.getByRole("button", { name: "Delete" }).click();
  await expect(panel).toBeHidden();
  await expect(count(page)).toHaveText("23 blocks");
  await expect(page.locator(".viewer")).not.toHaveAttribute("data-revision", hut.revision);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(count(page)).toHaveText("24 blocks");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(count(page)).toHaveText("23 blocks");

  await page.reload();
  await expect(count(page)).toHaveText("23 blocks");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(count(page)).toHaveText("24 blocks");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);
  expect(await page.evaluate(() => localStorage.getItem("blockyard.edits"))).toBe("{}");
});

test("Shift-drag selects the blocks seen in a box, ⌘D duplicates them beside it, right-click places a block", async ({
  page,
}) => {
  const { x, y, width, height, cx, cy } = await open(page);
  await page.keyboard.down("Shift");
  await page.mouse.move(x + 10, y + 10);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 });
  await expect(page.locator(".select-box")).toBeVisible();
  await page.mouse.move(x + width - 10, y + height - 10, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator(".select-box")).toBeHidden();
  const label = page.getByRole("dialog", { name: "Selection" }).locator("b");
  await expect(label).toHaveText(/^\d+ blocks$/);
  const seen = parseInt((await label.textContent())!);
  expect(seen).toBeGreaterThan(12);

  await page.keyboard.press("ControlOrMeta+d");
  await expect(count(page)).toHaveText(`${24 + seen} blocks`);
  await expect(label).toHaveText(`${seen} blocks`);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(count(page)).toHaveText("24 blocks");
  await expect(label).toBeHidden();

  await page.mouse.click(cx, cy, { button: "right" });
  await expect(count(page)).toHaveText("25 blocks");
  await expect(toolbar(page)).toContainText("1 change");
});

test("picking a block replaces the selection with it, the build's own blocks listed first", async ({ page }) => {
  const { cx, cy } = await open(page);
  await page.mouse.click(cx, cy);
  const panel = page.getByRole("dialog", { name: "Selection" });
  await expect(panel).toContainText("oak planks");
  await page.getByRole("button", { name: "Block in hand: stone" }).click();
  const list = page.getByRole("listbox", { name: "Blocks" });
  await expect(list.locator("section").first()).toContainText("In this build");
  await page.getByRole("searchbox", { name: "Search blocks" }).fill("gold block");
  await list.getByRole("option", { name: "gold block", exact: true }).click();
  await expect(list).toBeHidden();
  await expect(panel.locator("b")).toHaveText("gold block");
  await expect(page.getByRole("button", { name: "Block in hand: gold block" })).toBeVisible();

  await page.getByRole("button", { name: "Download" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Download .schem" }).click(),
  ]);
  expect(gunzipSync(readFileSync((await download.path())!)).includes("minecraft:gold_block")).toBe(true);
  await page.getByRole("tab", { name: "Blocks" }).click();
  await expect(page.getByRole("row", { name: /gold block/ })).toBeVisible();
});

test("edits wait while Holo builds, and edits on an earlier revision are offered to discard", async ({ page }) => {
  const edit = { kind: "set", cells: [[0, 0, 0]], block: "air" };
  await page.addInitScript(
    ([edit, revision]) =>
      localStorage.setItem(
        "blockyard.edits",
        JSON.stringify({ hut: { revision: "old", edits: [edit] }, live: { revision, edits: [edit] } }),
      ),
    [edit, hut.revision] as const,
  );
  await site(page, [hut]);
  const agp = await platform(page);
  agp.session("live");
  agp.share("live", hut);

  await page.goto("/?showcase=hut");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);
  const notice = page.locator(".edit-notice");
  await expect(notice).toContainText("1 edit was made on an earlier revision of this build.");
  await expect(count(page)).toHaveText("24 blocks");
  await notice.getByRole("button", { name: "Discard" }).click();
  await expect(notice).toBeHidden();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("blockyard.edits")))!)).not.toHaveProperty("hut");

  await page.goto("/?build=live");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);
  await expect(notice).toContainText("Your 1 edit is hidden while Holo builds.");
  await expect(count(page)).toHaveText("24 blocks");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
});
