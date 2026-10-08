interface Point {
  x: number;
  y: number;
  z: number;
}

/** An axis-aligned box in blocks, y up, such as a block's shape. */
export interface Solid {
  min: Point;
  max: Point;
}

type Axis = keyof Point;
type Control = "forward" | "back" | "left" | "right" | "jump" | "down";

/** Walking through the build like a Minecraft player, in blocks and seconds. */
export const WALK = {
  eye: 1.62,
  /** The body: `height` tall from the feet and `radius` from its middle to each side. */
  height: 1.8,
  radius: 0.3,
  /** The highest ledge walked onto: a slab or a stair, never a full block. */
  step: 0.6,
  /** The highest ledge jumped onto by walking into it. */
  autoJump: 1,
  jump: 1.25,
  gravity: 28,
  speed: 4.3,
  sprint: 1.3,
  fly: 2.5,
  /** Seconds to reach the speed the keys ask for: on the ground or flying, then in the air. */
  grip: 0.06,
  drift: 0.3,
  /** Seconds the view takes to catch up with a step up. */
  climb: 0.08,
  doubleTapMs: 300,
  pointerSpeed: 2,
  /** Radians the view stops short of straight up or down, where its heading would be lost. */
  tilt: 0.02,
};

const KEYS = new Map<string, Control>([
  ["KeyW", "forward"],
  ["ArrowUp", "forward"],
  ["KeyS", "back"],
  ["ArrowDown", "back"],
  ["KeyA", "left"],
  ["ArrowLeft", "left"],
  ["KeyD", "right"],
  ["ArrowRight", "right"],
  ["Space", "jump"],
  ["ShiftLeft", "down"],
  ["ShiftRight", "down"],
]);

const AXES = ["x", "y", "z"] as const;
/** Faces this close count as touching, not overlapping, whatever the rounding. */
const EPS = 1e-3;
/** Speeds and offsets this close to their target snap to it. */
const SNAP = 0.01;

/** Whether `a` and `b` overlap on every axis but `skip`. */
function overlaps(a: Solid, b: Solid, skip?: Axis): boolean {
  return AXES.every((axis) => axis === skip || (a.min[axis] < b.max[axis] - EPS && a.max[axis] > b.min[axis] + EPS));
}

/** How far `body` can move along `axis`, up to `distance`, before it touches one of `solids`. */
function clip(body: Solid, solids: Solid[], axis: Axis, distance: number): number {
  for (const solid of solids) {
    if (!overlaps(body, solid, axis)) continue;
    if (distance > 0 && solid.min[axis] >= body.max[axis] - EPS)
      distance = Math.min(distance, solid.min[axis] - body.max[axis]);
    else if (distance < 0 && solid.max[axis] <= body.min[axis] + EPS)
      distance = Math.max(distance, solid.max[axis] - body.min[axis]);
  }
  return distance;
}

function shift(body: Solid, axis: Axis, distance: number) {
  body.min[axis] += distance;
  body.max[axis] += distance;
}

/** Move `body` by `by`, vertically first, each axis stopping at the first solid; how far it went. */
function slide(body: Solid, by: Point, solids: Solid[]): Point {
  const moved = { x: 0, y: 0, z: 0 };
  for (const axis of ["y", "x", "z"] as const) {
    moved[axis] = clip(body, solids, axis, by[axis]);
    shift(body, axis, moved[axis]);
  }
  return moved;
}

const across = (p: Point) => p.x ** 2 + p.z ** 2;

/** Ease `value` toward `target` by the fraction `ease`, landing on it once close. */
const approach = (value: number, target: number, ease: number) =>
  Math.abs(target - value) < SNAP ? target : value + (target - value) * ease;

/** The solids to collide with, looked up by the block cells an area covers, over a floor at `ground`. */
export class Solids {
  private floor: Solid;

  constructor(
    private cell: (x: number, y: number, z: number) => readonly Solid[],
    ground = 0,
  ) {
    this.floor = { min: { x: -Infinity, y: -Infinity, z: -Infinity }, max: { x: Infinity, y: ground, z: Infinity } };
  }

  /** The floor and the solids of every cell `area` touches. */
  near(area: Solid): Solid[] {
    const found = [this.floor];
    for (let y = Math.floor(area.min.y); y <= Math.floor(area.max.y); y++)
      for (let z = Math.floor(area.min.z); z <= Math.floor(area.max.z); z++)
        for (let x = Math.floor(area.min.x); x <= Math.floor(area.max.x); x++) found.push(...this.cell(x, y, z));
    return found;
  }
}

/** A body that walks, jumps and flies through `Solids`, driven by the keys held and moved frame by frame. */
export class Walker {
  /** The feet: the middle of the body's bottom. */
  x: number;
  y: number;
  z: number;
  flying = false;
  private velocity = { x: 0, y: 0, z: 0 };
  private grounded = false;
  private sprinting = false;
  /** Space went down since the last frame, however briefly, or the body walked into a block it can jump onto. */
  private jumped = false;
  /** How far the view trails below the eye after a step up. */
  private lag = 0;
  private held = new Set<string>();
  private tapped = new Map<Control, number>();

  constructor(
    feet: Point,
    private onFly: (flying: boolean) => void = () => {},
  ) {
    ({ x: this.x, y: this.y, z: this.z } = feet);
  }

  get eye(): number {
    return this.y + WALK.eye - this.lag;
  }

  /** Press the key `code` at `time` milliseconds; false for keys walking does not use. */
  press(code: string, time: number): boolean {
    const control = KEYS.get(code);
    if (!control) return false;
    if (this.held.has(code)) return true;
    this.held.add(code);
    const double = time - (this.tapped.get(control) ?? -Infinity) < WALK.doubleTapMs;
    if (double) this.tapped.delete(control);
    else this.tapped.set(control, time);
    if (control === "jump") this.jumped = true;
    if (double && control === "jump") this.fly(!this.flying);
    if (double && control === "forward") this.sprinting = true;
    return true;
  }

  release(code: string) {
    this.held.delete(code);
    if (!this.pressed("forward")) this.sprinting = false;
  }

  releaseAll() {
    this.held.clear();
    this.sprinting = false;
  }

  /** Move for `seconds`, heading `yaw` radians about y from looking along -z. */
  step(seconds: number, yaw: number, solids: Solids) {
    this.unstick(solids);
    const forward = this.pressed("forward") - this.pressed("back");
    const right = this.pressed("right") - this.pressed("left");
    const speed =
      (WALK.speed * (this.flying ? WALK.fly : 1) * (this.sprinting ? WALK.sprint : 1)) /
      (Math.hypot(forward, right) || 1);
    const [sin, cos] = [Math.sin(yaw), Math.cos(yaw)];
    const ease = 1 - Math.exp(-seconds / (this.grounded || this.flying ? WALK.grip : WALK.drift));
    const v = this.velocity;
    v.x = approach(v.x, (right * cos - forward * sin) * speed, ease);
    v.z = approach(v.z, (-right * sin - forward * cos) * speed, ease);
    if (this.flying) v.y = approach(v.y, (this.pressed("jump") - this.pressed("down")) * WALK.speed * WALK.fly, ease);
    else {
      if (this.grounded && (this.jumped || this.pressed("jump"))) v.y = Math.sqrt(2 * WALK.gravity * WALK.jump);
      v.y -= WALK.gravity * seconds;
    }
    this.jumped = false;
    this.lag = approach(this.lag, 0, 1 - Math.exp(-seconds / WALK.climb));
    this.move({ x: v.x * seconds, y: v.y * seconds, z: v.z * seconds }, solids);
  }

  private pressed(control: Control): number {
    return [...this.held].some((code) => KEYS.get(code) === control) ? 1 : 0;
  }

  private fly(flying: boolean) {
    if (flying === this.flying) return;
    this.flying = flying;
    this.velocity.y = 0;
    this.onFly(flying);
  }

  private body(): Solid {
    const { radius: r, height } = WALK;
    return {
      min: { x: this.x - r, y: this.y, z: this.z - r },
      max: { x: this.x + r, y: this.y + height, z: this.z + r },
    };
  }

  /** Rise out of any solid the body is inside, onto the free space above it. */
  private unstick(solids: Solids) {
    for (;;) {
      const body = this.body();
      const inside = solids.near(body).filter((solid) => overlaps(body, solid));
      if (!inside.length) return;
      this.y = Math.max(...inside.map((solid) => solid.max.y));
      this.velocity.y = 0;
    }
  }

  /** The body raised by up to `height`, how far it rose, and how far it then slides across by `by`. */
  private raised(by: Point, height: number, near: Solid[]) {
    const body = this.body();
    const up = clip(body, near, "y", height);
    shift(body, "y", up);
    return { body, up, moved: slide(body, { x: by.x, y: 0, z: by.z }, near) };
  }

  /** Slide by `by` against the solids; on the ground, step onto a low ledge, or jump onto a block, when that goes further. */
  private move(by: Point, solids: Solids) {
    const body = this.body();
    const reach = { x: Math.abs(by.x), y: Math.abs(by.y) + WALK.autoJump, z: Math.abs(by.z) };
    const near = solids.near({
      min: { x: body.min.x - reach.x, y: body.min.y - reach.y, z: body.min.z - reach.z },
      max: { x: body.max.x + reach.x, y: body.max.y + reach.y, z: body.max.z + reach.z },
    });
    let moved = slide(body, by, near);
    let landed = by.y < 0 && moved.y > by.y;
    if ((this.grounded || landed) && (moved.x !== by.x || moved.z !== by.z)) {
      const step = this.raised(by, WALK.step, near);
      const down = clip(step.body, near, "y", -step.up);
      if (across(step.moved) > across(moved)) {
        moved = { x: step.moved.x, y: step.up + down, z: step.moved.z };
        landed = down > -step.up;
        this.lag = Math.min(this.lag + moved.y, WALK.step);
      } else if (!this.flying && across(this.raised(by, WALK.autoJump, near).moved) > across(moved)) {
        this.jumped = true;
      }
    }
    this.x += moved.x;
    this.y += moved.y;
    this.z += moved.z;
    const v = this.velocity;
    if (moved.x !== by.x) v.x = 0;
    if (moved.z !== by.z) v.z = 0;
    if (moved.y !== by.y) v.y = 0;
    this.grounded = landed;
    if (landed) this.fly(false);
  }
}
