import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Model } from "../src/model";
import { applyEdits, EDITED_STEP, validEdits } from "../src/voxelEdits";
import { model, shareMenu, site } from "./fixtures";
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

const count = (page: Page) => page.locator(".scrub-label span");
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Edit mode" });

test("edit mode selects the block under the pointer, and its edits persist in this browser", async ({ page }) => {
  const { cx, cy } = await open(page);
  await expect(count(page)).toHaveText(/^24 blocks ·/);
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
  await expect(count(page)).toHaveText(/^23 blocks ·/);
  await expect(page.locator(".viewer")).not.toHaveAttribute("data-revision", hut.revision);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(count(page)).toHaveText(/^24 blocks ·/);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(count(page)).toHaveText(/^23 blocks ·/);

  await page.reload();
  await expect(count(page)).toHaveText(/^23 blocks ·/);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(count(page)).toHaveText(/^24 blocks ·/);
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
  await expect(count(page)).toHaveText(new RegExp(`^${24 + seen} blocks ·`));
  await expect(label).toHaveText(`${seen} blocks`);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(count(page)).toHaveText(/^24 blocks ·/);
  await expect(label).toBeHidden();

  await page.mouse.click(cx, cy, { button: "right" });
  await expect(count(page)).toHaveText(/^25 blocks ·/);
  await expect(toolbar(page)).toContainText("1 change");
});

test("Shift-Option-drag selects every block in the box, the hidden ones too", async ({ page }) => {
  const { x, y, width, height } = await open(page);
  await page.keyboard.down("Shift");
  await page.keyboard.down("Alt");
  await page.mouse.move(x + 10, y + 10);
  await page.mouse.down();
  await page.mouse.move(x + width - 10, y + height - 10, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.keyboard.up("Shift");
  await expect(page.getByRole("dialog", { name: "Selection" }).locator("b")).toHaveText("24 blocks");
});

test("↑ ↓ lift and lower a block, W and S slide it along the view, as do the panel's buttons", async ({ page }) => {
  const { cx, cy } = await open(page);
  await page.mouse.click(cx, cy);
  const panel = page.getByRole("dialog", { name: "Selection" });
  await expect(panel).toContainText("oak planks");

  for (const key of ["ArrowUp", "ArrowDown", "w", "s", "ArrowLeft", "d"]) await page.keyboard.press(key);
  for (const name of ["Move up", "Move away", "Move closer"]) {
    await panel.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  }
  await expect(toolbar(page)).toContainText("9 changes");
  const moves = await page.evaluate(() =>
    Object.values(JSON.parse(localStorage.getItem("blockyard.edits")!) as Record<string, { edits: { by: number[] }[] }>)
      .flatMap((saved) => saved.edits)
      .map((edit) => edit.by),
  );
  const lift = moves.map(([x, y, z]) => (!x && !z ? Math.sign(y) : 0));
  expect(lift).toEqual([1, -1, 0, 0, 0, 0, 1, 0, 0]);
  for (const [x, y, z] of moves.filter((_, i) => !lift[i]))
    expect([y, Math.abs(x) + Math.abs(z) > 0]).toEqual([0, true]);
  const opposite = (v: number[]) => v.map((c) => -c + 0);
  expect(moves[3]).toEqual(opposite(moves[2]));
  expect(moves[7]).toEqual(moves[2]);
  expect(moves[8]).toEqual(moves[3]);
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

  const menu = await shareMenu(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    menu.getByRole("menuitem", { name: "Download .schem" }).click(),
  ]);
  expect(gunzipSync(readFileSync((await download.path())!)).includes("minecraft:gold_block")).toBe(true);
  await page.getByRole("tab", { name: "Blocks" }).click();
  await expect(page.getByRole("row", { name: /gold block/ })).toBeVisible();
});

test("edits wait while Holo builds, and edits on an earlier revision are offered to discard", async ({
  page,
}, testInfo) => {
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
  const editing = page.getByRole("button", { name: "Edit", exact: true });
  const hint = page.locator(".edit-availability");
  await expect(notice).toContainText("1 edit was made on an earlier revision of this build.");
  await expect(count(page)).toHaveText(/^24 blocks ·/);
  await expect(editing).toBeDisabled();
  await expect(editing).toHaveAccessibleDescription("Discard earlier edits to edit");
  await expect(hint).toBeVisible();
  await notice.getByRole("button", { name: "Discard" }).click();
  await expect(notice).toBeHidden();
  await expect(editing).toBeEnabled();
  await expect(hint).toHaveCount(0);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("blockyard.edits")))!)).not.toHaveProperty("hut");

  await page.goto("/?build=live");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);
  await expect(notice).toContainText("Your 1 edit is hidden while Holo builds.");
  await expect(count(page)).toHaveText(/^24 blocks ·/);
  await expect(editing).toBeDisabled();
  await expect(editing).toHaveAccessibleDescription("Edit after Holo stops");
  await expect(hint).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("edit-hint-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(hint).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("edit-hint-phone.png") });
  await page.getByRole("button", { name: "View controls" }).click();
  await expect(editing).toBeDisabled();
  await expect(editing).toHaveAccessibleDescription("Edit after Holo stops");

  agp.answer("live", "The hut is ready.");
  await expect(editing).toBeEnabled();
  await expect(hint).toHaveCount(0);
});

test("redo stays with the revision its edits were undone on", async ({ page }) => {
  const edit = { kind: "set", cells: [[0, 0, 0]], block: "air" };
  await page.addInitScript(
    ([edit, revision]) =>
      localStorage.setItem("blockyard.edits", JSON.stringify({ redo: { revision, edits: [edit] } })),
    [edit, hut.revision] as const,
  );
  await site(page);
  const agp = await platform(page);
  agp.session("redo", "idle");
  agp.say("redo", "A little hut");
  agp.share("redo", hut);
  agp.answer("redo", "The hut is ready.");
  await page.goto("/?build=redo");
  await expect(count(page)).toHaveText(/^23 blocks ·/);
  const editing = page.getByRole("button", { name: "Edit", exact: true });
  const redo = page.getByRole("button", { name: "Redo" });
  await editing.click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(count(page)).toHaveText(/^24 blocks ·/);
  await expect(redo).toBeEnabled();

  const taller = { ...model("0a1b2c3d4e5f"), boxes: [...hut.boxes, 0, 3, 0, 0, 3, 0, 1, 1] };
  agp.state("redo", "running");
  agp.share("redo", taller);
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", taller.revision);
  await expect(editing).toBeDisabled();
  agp.answer("redo", "Taller now.");
  await editing.click();
  await expect(redo).toBeDisabled();
  await expect(count(page)).toHaveText(/^25 blocks ·/);
});
