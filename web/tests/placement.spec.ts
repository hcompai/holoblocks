import { expect, test } from "@playwright/test";
import { planPlacement, placedCount } from "../src/placement";
import { meshWorld, packBoxes, VoxelWorld } from "../src/voxels";
import type { Box, Palette } from "../src/model";
import type { UV } from "../src/atlas";
import { model, site } from "./fixtures";
import { platform } from "./platform";

for (const singleStep of [false, true]) {
  test(`replay starts empty and animates the first step (${singleStep ? "one step, Space" : "multiple steps, Play"})`, async ({
    page,
  }) => {
    const seed = model();
    const build = {
      ...seed,
      id: "replay",
      ...(singleStep ? { steps: seed.steps.slice(0, 1), boxes: seed.boxes.slice(0, 8) } : {}),
    };
    await site(page, [build]);
    await page.goto(`/?showcase=${build.id}`);
    const viewer = page.locator(".viewer");
    const slider = page.getByRole("slider", { name: "Step", exact: true });
    await expect(viewer).toHaveAttribute("data-revision", build.revision);
    await page.getByRole("button", { name: "0.5×", exact: true }).click();
    if (singleStep) {
      await page.locator(".scrub-label").click();
      await page.keyboard.press("Space");
    } else await page.getByTitle("Play", { exact: true }).click();
    await expect(slider).toHaveValue("-1");
    await page.getByTitle("Pause", { exact: true }).click();
    await expect(page.locator(".scrub-label")).toHaveText(`Empty canvas0 blocks · 0/${build.steps.length} steps`);
    await expect(slider).toHaveCSS("--fill", "0%");
    await page.waitForTimeout(150);
    await expect(slider).toHaveValue("-1");

    await page.getByTitle("Play", { exact: true }).click();
    await page.getByRole("button", { name: "Pause block placement", exact: true }).click();
    await expect(slider).toHaveValue("0");
    await expect(viewer).toHaveAttribute("data-placement-total", "16");
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.locator(".scrub-label b")).toHaveText("Finished model");
    await expect(slider).toHaveValue(String(build.steps.length - 1));
    await expect(slider).toHaveCSS("--fill", "100%");
    await expect(page.getByTitle("Play", { exact: true })).toBeEnabled();
  });
}

const palette: Palette = { stone: { tex: "stone" }, oak_planks: { tex: "oak_planks" } };
const box = (step: number, y0: number, y1 = y0, block = "stone"): Box => ({
  x0: 0,
  x1: 2,
  y0,
  y1,
  z0: 0,
  z1: 2,
  block,
  step,
});

test("placements resolve overwrites, preserve existing blocks, and wind through each layer in step order", () => {
  const old = new VoxelWorld(3, 4, 3, palette);
  old.apply(packBoxes([box(0, 0)]));
  const boxes = [box(0, 0), box(1, 1, 2), { ...box(2, 1, 1, "oak_planks"), x0: 1, x1: 1, z0: 1, z1: 1 }];
  const packed = packBoxes(boxes);
  const world = new VoxelWorld(3, 4, 3, palette);
  world.apply(packed);
  const plan = planPlacement(
    world,
    old,
    packed,
    Int32Array.from(boxes, (b) => b.step),
  );
  expect(plan.cells.length).toBe(18);
  expect([...plan.starts.slice(0, 9)]).toEqual(Array(9).fill(-1));
  expect([...plan.cells.slice(0, 6)]).toEqual([9, 10, 11, 14, 12, 15]);
  // The overwritten wood cell is placed once, during the step that owns it.
  expect(plan.cells.at(-1)).toBe(world.at(1, 1, 1));
  expect(plan.names[plan.blockIds.at(-1)!]).toBe("oak_planks");
  expect(new Set(plan.cells).size).toBe(plan.cells.length);
  expect(placedCount(plan, -1)).toBe(0);
  expect(placedCount(plan, plan.duration)).toBe(18);
  for (let i = 1; i < 17; i++) expect(plan.starts[plan.cells[i]]).toBeGreaterThan(plan.starts[plan.cells[i - 1]]);
});

test("temporary faces close the growing model and completed geometry keeps its own bounds", () => {
  const boxes = [box(0, 0, 2)];
  const packed = packBoxes(boxes);
  const world = new VoxelWorld(3, 4, 3, palette);
  world.apply(packed);
  const plan = planPlacement(world, null, packed, Int32Array.of(0));
  const tiles = new Map<string, UV>([["stone", [0, 0, 1, 1]]]);
  const meshes = meshWorld(world, tiles, plan);
  expect(meshes.some((mesh) => mesh.temporary)).toBe(true);
  expect(meshes.every((mesh) => mesh.placement?.length === (mesh.positions.length / 3) * 2)).toBe(true);
  for (const mesh of meshes.filter((mesh) => mesh.temporary)) {
    for (let i = 0; i < mesh.placement!.length; i += 2)
      expect(mesh.placement![i + 1]).toBeGreaterThan(mesh.placement![i]);
  }
  expect(meshWorld(world, tiles).some((mesh) => mesh.temporary || mesh.placement)).toBe(false);
});

test("large fills receive distinct block times without a long animation or argument overflow", () => {
  const world = new VoxelWorld(128, 8, 128, palette);
  const packed = packBoxes([{ ...box(0, 0, 7), x1: 127, z1: 127 }]);
  world.apply(packed);
  const plan = planPlacement(world, null, packed, Int32Array.of(0));
  expect(plan.cells.length).toBe(131_072);
  expect(plan.duration).toBeLessThan(2.4);
  expect(placedCount(plan, plan.duration / 2)).toBeGreaterThan(60_000);
  expect(placedCount(plan, plan.duration / 2)).toBeLessThan(90_000);
});

test("the live reveal can pause and skip, and the next revision animates only its changed blocks", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("placement");
  agp.say("placement", "A stone tower");
  await page.goto("/?build=placement");
  const tower = { ...model(), boxes: [0, 0, 0, 15, 0, 15, 0, 0, 5, 1, 5, 10, 12, 10, 1, 1] };
  agp.share("placement", tower);
  const viewer = page.locator(".viewer");
  await expect(viewer).toHaveAttribute("data-placing", "true");
  await page.getByRole("button", { name: "Pause block placement", exact: true }).click();
  const placed = await viewer.getAttribute("data-placed");
  await expect(viewer).toHaveAttribute("data-placed", placed!);
  await page.getByRole("button", { name: "Resume block placement", exact: true }).click();
  await expect.poll(async () => Number(await viewer.getAttribute("data-placed"))).toBeGreaterThan(Number(placed));
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(viewer).not.toHaveAttribute("data-placing", "true");

  const taller = { ...tower, revision: "higher", boxes: [...tower.boxes, 5, 13, 5, 10, 15, 10, 1, 1] };
  agp.share("placement", taller);
  await expect(viewer).toHaveAttribute("data-placing", "true");
  await expect(viewer).toHaveAttribute("data-placement-total", "108");
  await expect(viewer).not.toHaveAttribute("data-placing", "true");
  await expect(viewer).toHaveAttribute("data-revision", "higher");
});

test("reduced motion shows the finished model and sound defaults on with a remembered mute choice", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await site(page);
  const agp = await platform(page);
  agp.session("quiet-placement");
  agp.share("quiet-placement", model());
  await page.goto("/?build=quiet-placement");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", model().revision);
  await expect(page.locator(".placement-hud")).toHaveCount(0);
  const sound = page.getByRole("button", { name: "Mute block sounds", exact: true });
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await sound.click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Enable block sounds", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.getByRole("button", { name: "Enable block sounds", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mute block sounds", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
