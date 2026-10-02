import { expect, test } from "@playwright/test";
import { type Solid, Solids, WALK, Walker } from "../src/walker";
import { model, site } from "./fixtures";

const FRAME = 1 / 60;

for (const native of [true, false]) {
  test(`walk fullscreen fills the canvas and restores its layout (${native ? "native" : "embedded browser"})`, async ({
    page,
  }) => {
    if (!native) await page.addInitScript(() => Object.defineProperty(document, "fullscreenEnabled", { value: false }));
    const build = { ...model(), id: "fullscreen" };
    await site(page, [build]);
    await page.goto(`/?showcase=${build.id}`);
    const viewer = page.locator(".viewer");
    await expect(viewer).toHaveAttribute("data-revision", build.revision);
    const original = await viewer.boundingBox();
    const walk = page.getByRole("button", { name: "Walk", exact: true });
    await walk.click();
    await page.getByTitle("Enter fullscreen", { exact: true }).click();
    await expect(viewer).toHaveClass("viewer walk-fullscreen");
    if (native)
      await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("viewer"))).toBe(true);
    const viewport = await page.evaluate(() => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }));
    await expect.poll(() => viewer.boundingBox()).toEqual(viewport);
    await expect.poll(() => page.locator(".viewer-canvas canvas").boundingBox()).toEqual(viewport);
    if (!native) await page.screenshot({ path: test.info().outputPath("walk-fullscreen.png") });

    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await expect(viewer).toHaveClass("viewer");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect(walk).toHaveAttribute("aria-pressed", "true");

    await page.getByTitle("Enter fullscreen", { exact: true }).click();
    await page.getByRole("button", { name: "Leave walk mode", exact: true }).click();
    await expect(walk).toHaveAttribute("aria-pressed", "false");
    await expect(viewer).toHaveClass("viewer");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect.poll(() => viewer.boundingBox()).toEqual(original);

    await walk.click();
    await page.getByTitle("Enter fullscreen", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveClass("viewer");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  });
}
/** Heading along +x. */
const EAST = -Math.PI / 2;

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Solid => ({
  min: { x: x0, y: y0, z: z0 },
  max: { x: x1, y: y1, z: z1 },
});

/** A walker at `feet`, heading east among `boxes` on a ground at 0, driven by keys frame by frame. */
function world(boxes: Solid[], feet = { x: 0, y: 0, z: 0 }) {
  const walker = new Walker(feet);
  const solids = new Solids((x, y, z) =>
    boxes.filter(
      (b) => b.min.x < x + 1 && b.max.x > x && b.min.y < y + 1 && b.max.y > y && b.min.z < z + 1 && b.max.z > z,
    ),
  );
  let time = 0;
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += FRAME, time += FRAME * 1000) walker.step(FRAME, EAST, solids);
  };
  const hold = (seconds: number, ...codes: string[]) => {
    for (const code of codes) walker.press(code, time);
    run(seconds);
    for (const code of codes) walker.release(code);
  };
  return { walker, run, hold, tap: (code: string) => hold(0.1, code) };
}

test("the walker falls, walks onto a slab, jumps onto a block it walks into but not two, and slides along walls", () => {
  const { walker, run, hold } = world([box(2, 0, -5, 4, 0.5, 5), box(4, 0, -5, 6, 1.5, 5), box(6, 0, -5, 7, 3.5, 5)], {
    x: 0,
    y: 3,
    z: 0,
  });
  run(1);
  expect(walker.y).toBe(0);
  hold(3, "KeyW");
  expect(walker.y).toBe(1.5);
  expect(walker.x).toBeCloseTo(6 - WALK.radius);
  hold(0.5, "KeyW", "KeyA");
  expect(walker.x).toBeCloseTo(6 - WALK.radius);
  expect(walker.z).toBeLessThan(-1);
});

test("double-tapping Space flies: Space rises, Shift descends, walls still stop it; again drops", () => {
  const { walker, run, hold, tap } = world([box(2, 0, -5, 3, 100, 5)]);
  tap("Space");
  tap("Space");
  expect(walker.flying).toBe(true);
  run(0.5);
  const hover = walker.y;
  run(0.5);
  expect(walker.y).toBe(hover);
  hold(0.5, "Space");
  expect(walker.y).toBeGreaterThan(hover + 3);
  const high = walker.y;
  hold(0.2, "ShiftLeft");
  expect(walker.y).toBeLessThan(high - 1);
  hold(1, "KeyW");
  expect(walker.x).toBeCloseTo(2 - WALK.radius);
  tap("Space");
  tap("Space");
  expect(walker.flying).toBe(false);
  run(2);
  expect(walker.y).toBe(0);
});

test("a block showing up around the walker lifts it on top", () => {
  const { walker, run } = world([box(-1, 0, -1, 1, 1, 1)]);
  run(FRAME);
  expect(walker.y).toBe(1);
});

test("walk mode shows its controls, takes Space to fly, and Escape leaves it; ? lists every shortcut", async ({
  page,
}) => {
  const hut = { ...model(), id: "hut", name: "Hut" };
  await site(page, [hut]);
  await page.goto("/?showcase=hut");
  await expect(page.locator(".viewer")).toHaveAttribute("data-revision", hut.revision);

  const help = page.getByRole("dialog", { name: "Shortcuts" });
  await page.keyboard.press("?");
  await expect(help).toContainText("Place the block in hand on a face");
  await expect(help).toContainText("Release the mouse; again to stop walking");
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();

  const walk = page.getByRole("button", { name: "Walk", exact: true });
  await walk.click();
  await expect(walk).toHaveAttribute("aria-pressed", "true");
  const hud = page.locator(".walk-hud");
  await expect(hud).toContainText("Click to walk");
  await expect(hud).toContainText("Sprint");
  const flying = page.locator(".walk-flying");
  await expect(flying).toBeHidden();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect(flying).toBeVisible();
  expect(await page.locator(".timeline .play").getAttribute("title")).toBe("Play");
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect(flying).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(walk).toHaveAttribute("aria-pressed", "false");
  await expect(hud).toBeHidden();
});
