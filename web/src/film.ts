import * as THREE from "three";
import { cameraBounds, planBuildCamera, sampleBuildCamera, type CameraLayer } from "./buildCamera";
import { type Build, PALETTE } from "./model";
import {
  filmSteps,
  frameCount,
  planFilm,
  rising,
  type FilmOptions,
  type FilmPlan,
  type FilmStep,
  type FilmStepBoxes,
} from "./filmPlan";
import { BlockScene, type Staged } from "./scene";
import { parseState } from "./voxels";

const FONT = '"Plus Jakarta Sans Variable", system-ui, sans-serif';
const INK = "#1c1c26";
const MUTED = "#5c5c6a";
const LOGO = "/logo.png";
const FOV = 30;
/** Past the sky dome, from anywhere a shot is taken. */
const FAR = 8000;
/** Share of the frame's height kept clear of the model for the caption. */
const CAPTION = 0.15;
const NAME_PX = 46;
const LOGO_PX = 64;
const MARGIN = 1.08;
const HERO_ANGLE = 40;
const ORBIT_DEGREES = 55;
const ELEVATION = { start: 38, end: 26 };
const LOOKAHEAD_S = 1.2;
const SMOOTH_S = 0.9;
/** The smallest framing, as a share of the finished build's, so the first blocks are not shot in macro. */
const CLOSEST = 0.42;
/** Hold a step's title on screen at least this long, so fast steps do not flicker. */
const CAPTION_MIN_S = 0.9;
const FADE_S = 0.25;
/** Lifts the rising cut just above a layer's top faces, so they are drawn once. */
const CUT = 0.001;
const CAP = "#6f5b49";

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
}

interface Film {
  options: FilmOptions;
  plan: FilmPlan;
  poses: Pose[];
  captions: FilmStep[];
}

function toward(azimuth: number, elevation: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuth);
  const e = THREE.MathUtils.degToRad(elevation);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

/** Evenly spread unit vectors, along which a hull keeps its farthest points. */
const HULL = Array.from({ length: 128 }, (_, i) => {
  const y = 1 - (2 * i + 1) / 128;
  const r = Math.sqrt(1 - y * y);
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(r * Math.cos(phi), y, r * Math.sin(phi));
});

/** The farthest corners of a growing set of boxes along each HULL direction: a cheap stand-in for its convex hull. */
class Hull {
  private reach = new Float64Array(HULL.length).fill(-Infinity);
  readonly points = HULL.map(() => new THREE.Vector3());
  readonly box = new THREE.Box3();

  add(box: THREE.Box3) {
    if (box.isEmpty()) return;
    this.box.union(box);
    const corner = new THREE.Vector3();
    for (let c = 0; c < 8; c++) {
      corner.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z);
      HULL.forEach((direction, k) => {
        const reach = corner.dot(direction);
        if (reach > this.reach[k]) {
          this.reach[k] = reach;
          this.points[k].copy(corner);
        }
      });
    }
  }
}

/**
 * The target and distance along `direction` that fit every point in a view with half-extents `tanX` and `tanY`
 * at unit depth, centering the points' silhouette.
 */
function fit(points: THREE.Vector3[], direction: THREE.Vector3, tanX: number, tanY: number) {
  const z = direction;
  const x = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  let [right, left, top, bottom] = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of points) {
    const [px, py, pz] = [p.dot(x), p.dot(y), p.dot(z)];
    right = Math.max(right, pz + px / tanX);
    left = Math.max(left, pz - px / tanX);
    top = Math.max(top, pz + py / tanY);
    bottom = Math.max(bottom, pz - py / tanY);
  }
  const target = new THREE.Vector3()
    .addScaledVector(x, (tanX * (right - left)) / 2)
    .addScaledVector(y, (tanY * (top - bottom)) / 2);
  return { target, distance: Math.max(right + left, top + bottom) / 2 };
}

/** A centered moving average over `radius` entries on each side, clamped at the ends. */
function smooth(values: number[], radius: number): number[] {
  const prefix = [0];
  for (const v of values) prefix.push(prefix[prefix.length - 1] + v);
  return values.map((_, i) => {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(values.length, i + radius + 1);
    return (prefix[hi] - prefix[lo]) / (hi - lo);
  });
}

/** Where a step's blocks lie on the site, cleared ones left out. */
function blockBounds(step: FilmStepBoxes, build: Build, air: (block: string) => boolean): THREE.Box3 {
  const box = new THREE.Box3();
  for (const b of step.boxes) {
    if (air(b.block)) continue;
    box.expandByPoint(new THREE.Vector3(Math.max(b.x0, 0), Math.max(b.y0, 0), Math.max(b.z0, 0)));
    box.expandByPoint(
      new THREE.Vector3(
        Math.min(b.x1 + 1, build.width),
        Math.min(b.y1 + 1, build.height),
        Math.min(b.z1 + 1, build.depth),
      ),
    );
  }
  return box;
}

/** Renders a build's film frame by frame, offline: frame `i` depends only on the build, the options and `i`. */
export class FilmRenderer {
  private scene: BlockScene;
  private ctx: CanvasRenderingContext2D;
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, FAR);
  private logo = new Image();
  private steps: FilmStepBoxes[];
  /** Each step's block bounds, in step order. */
  private boxes: THREE.Box3[];
  private solidBoxes: THREE.Box3[][];
  private final = new Hull();
  /** Keeps what lies below the rising cut, and what lies above it. */
  private cuts = [new THREE.Plane(new THREE.Vector3(0, -1, 0)), new THREE.Plane(new THREE.Vector3(0, 1, 0))];
  private clipped = new Map<THREE.Material, THREE.Material[]>();
  private cap = new THREE.MeshBasicMaterial({ color: CAP, side: THREE.BackSide, clippingPlanes: [this.cuts[0]] });
  /** Meshes of the build up to each step, by position in `steps`, while frames may need them. */
  private staged = new Map<number, Promise<Staged>>();
  private shown: Staged[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private film: Film | null = null;
  /** How many blocks the finished build holds, once prepared. */
  blocks = 0;

  constructor(
    private build: Build,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    this.scene = new BlockScene(document.createElement("div"), Promise.resolve(PALETTE));
    this.scene.setTheme("light");
    this.steps = filmSteps(build);
    const air = new Map<string, boolean>();
    const isAir = (block: string) => {
      let known = air.get(block);
      if (known === undefined) air.set(block, (known = parseState(block, PALETTE).name === "air"));
      return known;
    };
    this.boxes = this.steps.map((step) => blockBounds(step, build, isAir));
    this.solidBoxes = this.steps.map((step) =>
      step.boxes.flatMap((b) => {
        const { name, info } = parseState(b.block, PALETTE);
        if (
          name === "air" ||
          info.transparent ||
          info.cutout ||
          info.liquid ||
          !["cube", "log"].includes(info.shape ?? "cube")
        )
          return [];
        return [blockBounds({ ...step, boxes: [b] }, build, isAir)];
      }),
    );
    for (const box of this.boxes) this.final.add(box);
  }

  /** Mesh the finished build and load the overlay's logo and fonts; rejects when the build cannot be meshed. */
  async prepare() {
    if (this.final.box.isEmpty()) throw new Error("Nothing to film: the build has no blocks.");
    this.logo.src = LOGO;
    const [final] = await Promise.all([
      this.stagedStep(this.steps.length - 1),
      this.logo.decode(),
      document.fonts.load(`700 ${NAME_PX}px ${FONT}`),
      document.fonts.load(`600 26px ${FONT}`),
      document.fonts.load(`500 26px ${FONT}`),
    ]);
    this.blocks = final.blocks;
  }

  get frames(): number {
    return this.film ? frameCount(this.film.options) : 0;
  }

  configure(options: FilmOptions) {
    const plan = planFilm(this.build, options.seconds);
    const captions: FilmStep[] = [];
    for (const step of plan.steps) {
      const shown = captions[captions.length - 1];
      if (!shown || step.start - shown.start >= CAPTION_MIN_S) captions.push(step);
    }
    this.film = { options: { ...options }, plan, poses: this.track(options, plan), captions };
  }

  /** Draw frame `i` into the canvas, after the frames asked for before it. */
  render(i: number): Promise<HTMLCanvasElement> {
    const film = this.film!;
    return this.enqueue(() => this.draw(film, i).then(() => this.canvas));
  }

  pixels(i: number): Promise<ImageData> {
    const film = this.film!;
    return this.enqueue(async () => {
      await this.draw(film, i);
      return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** The build up to the step at `position`, meshed once while nearby frames need it. */
  private stagedStep(position: number): Promise<Staged> {
    let staged = this.staged.get(position);
    if (!staged) {
      staged = this.scene.stage(this.build, this.steps[position].index).then((s) => {
        if (!s) throw new Error("Could not mesh this build.");
        return s;
      });
      staged.catch(() => undefined);
      this.staged.set(position, staged);
    }
    return staged;
  }

  /** Free the meshes of every step but `keep`. */
  private release(keep: number[]) {
    for (const [position, staged] of this.staged) {
      if (keep.includes(position)) continue;
      this.staged.delete(position);
      staged.then(
        (s) => this.scene.unstage(s),
        () => undefined,
      );
    }
  }

  private async draw(film: Film, i: number) {
    const { options, plan, poses } = film;
    const { width, height, fps } = options;
    const time = i / fps;
    const { step, layers } = rising(plan, time);
    const planned = plan.steps[step];
    const whole = !planned || layers === planned.top - planned.bottom;
    const next = step + 1 < this.steps.length ? step + 1 : null;
    this.release([step - 1, step, ...(next === null ? [] : [next])]);
    const current = step >= 0 ? await this.stagedStep(step) : null;
    const before = !whole && step > 0 ? await this.stagedStep(step - 1) : null;
    if (next !== null) void this.stagedStep(next);

    for (const s of this.shown) s.group.visible = false;
    const cut = whole ? this.build.height + 1 : planned.bottom + layers;
    this.cuts[0].constant = cut + CUT;
    this.cuts[1].constant = -cut - CUT;
    this.shown = [current, before].filter((s) => s !== null);
    if (current) this.clip(current, 0, !whole);
    if (before) this.clip(before, 1);

    const pose = poses[i];
    const { camera } = this;
    camera.aspect = width / height;
    camera.near = pose.distance / 100;
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.setViewOffset(width, height, 0, (CAPTION * height) / 2, width, height);
    const shot = this.scene.shoot(camera, width, height);
    const share = whole ? 1 : layers / (planned.top - planned.bottom);
    const blocks = !current ? 0 : Math.round((before?.blocks ?? 0) * (1 - share) + current.blocks * share);
    this.overlay(film, time, shot, blocks);
  }

  /** Show `staged` cut by the plane at `side`: 0 keeps what lies below the cut, 1 what lies above; `capped` fills the cut. */
  private clip(staged: Staged, side: 0 | 1, capped = false) {
    staged.group.visible = true;
    for (const mesh of staged.group.children) {
      if (!(mesh instanceof THREE.Mesh)) continue;
      const source: THREE.Material = (mesh.userData.source ??= mesh.material);
      let pair = this.clipped.get(source);
      if (!pair) {
        pair = this.cuts.map((plane) => Object.assign(source.clone(), { clippingPlanes: [plane], clipShadows: true }));
        this.clipped.set(source, pair);
      }
      mesh.material = pair[side];
      if (source.transparent || source.alphaTest > 0) continue;
      // Hidden faces are never meshed, so a cut through solid blocks looks into a shell: its back faces fill it.
      if (!mesh.userData.cap) mesh.add((mesh.userData.cap = new THREE.Mesh(mesh.geometry, this.cap)));
      mesh.userData.cap.visible = capped;
    }
  }

  /** Degrees around the build: a slow orbit while it rises, then one full turn easing to rest on the hero angle. */
  private azimuth(plan: FilmPlan, time: number): number {
    const { assembled, hold } = plan;
    const orbit = ORBIT_DEGREES / assembled;
    const start = HERO_ANGLE - ORBIT_DEGREES - 360;
    if (time <= assembled) return start + orbit * time;
    const turntable = hold - assembled;
    const s = Math.min((time - assembled) / turntable, 1);
    // The orbit's speed fades out as (1 - s)², while a sin² surge makes up the rest of the turn.
    const surge = (2 * (360 - (orbit * turntable) / 3)) / turntable;
    const fading = (orbit * turntable * (1 - (1 - s) ** 3)) / 3;
    return start + ORBIT_DEGREES + fading + surge * turntable * (s / 2 - Math.sin(2 * Math.PI * s) / (4 * Math.PI));
  }

  /** Follow build holds each step still; alternative modes keep their chosen orbit or fixed view. */
  private track(options: FilmOptions, plan: FilmPlan): Pose[] {
    const { fps, width, height } = options;
    if (!options.camera || options.camera === "follow") {
      const layers: CameraLayer[] = [];
      for (const step of plan.steps) {
        const box = this.boxes[step.number - 1];
        if (box.isEmpty()) continue;
        for (let y = box.min.y; y < box.max.y; y++) {
          const layer = box.clone();
          layer.min.y = y;
          layer.max.y = Math.min(y + 1, box.max.y);
          const span = step.top - step.bottom;
          layers.push({
            step: step.index,
            start: step.start + ((y - step.bottom) / span) * (step.end - step.start),
            end: step.start + ((y + 1 - step.bottom) / span) * (step.end - step.start),
            bounds: cameraBounds(layer),
            solids: this.solidBoxes[step.number - 1].flatMap((solid) => {
              if (solid.min.y >= layer.max.y || solid.max.y <= layer.min.y || solid.isEmpty()) return [];
              const slice = solid.clone();
              slice.min.y = Math.max(slice.min.y, layer.min.y);
              slice.max.y = Math.min(slice.max.y, layer.max.y);
              return [cameraBounds(slice)];
            }),
          });
        }
      }
      const track = planBuildCamera(
        layers,
        null,
        { aspect: width / height, fov: FOV, caption: CAPTION },
        plan.assembled,
        plan.hold - plan.assembled,
      );
      if (track) return Array.from({ length: frameCount(options) }, (_, i) => sampleBuildCamera(track, i / fps));
    }
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const [tanX, tanY] = [(tan * width) / height, tan * (1 - CAPTION)];
    if (options.camera === "fixed") {
      const direction = toward(HERO_ANGLE, ELEVATION.end);
      const whole = fit(this.final.points, direction, tanX, tanY);
      const distance = whole.distance * MARGIN;
      const pose = {
        target: whole.target,
        position: whole.target.clone().addScaledVector(direction, distance),
        distance,
      };
      return Array.from({ length: frameCount(options) }, () => pose);
    }
    const built = new Hull();
    let included = 0;
    const raw = Array.from({ length: frameCount(options) }, (_, i) => {
      const time = i / fps;
      const progress = THREE.MathUtils.smootherstep(time, 0, plan.hold);
      const direction = toward(
        this.azimuth(plan, time),
        THREE.MathUtils.lerp(ELEVATION.start, ELEVATION.end, progress),
      );
      const whole = fit(this.final.points, direction, tanX, tanY);
      if (time + LOOKAHEAD_S >= plan.assembled) return { direction, ...whole };
      for (const count = rising(plan, time + LOOKAHEAD_S).step + 1; included < Math.max(count, 1); included++) {
        built.add(this.boxes[included]);
      }
      const part = fit(built.points, direction, tanX, tanY);
      return { direction, target: part.target, distance: Math.max(part.distance, CLOSEST * whole.distance) };
    });
    const radius = Math.round(SMOOTH_S * fps);
    const distances = smooth(
      raw.map((r) => r.distance * MARGIN),
      radius,
    );
    const [x, y, z] = (["x", "y", "z"] as const).map((axis) =>
      smooth(
        raw.map((r) => r.target[axis]),
        radius,
      ),
    );
    return raw.map((r, i) => {
      const target = new THREE.Vector3(x[i], y[i], z[i]);
      const position = target.clone().addScaledVector(r.direction, distances[i]);
      return { target, position, distance: distances[i] };
    });
  }

  /** A vignette, the logo when branded, the build's name over the current step, and how many blocks are in. */
  private overlay(film: Film, time: number, shot: HTMLCanvasElement, done: number) {
    const { width, height, branded } = film.options;
    const { plan, captions } = film;
    const { ctx } = this;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const unit = Math.min(width, height) / 1080;
    const margin = 72 * unit;
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.drawImage(shot, 0, 0, width, height);
    const [cx, cy] = [width / 2, height * 0.45];
    const vignette = ctx.createRadialGradient(
      cx,
      cy,
      Math.min(width, height) * 0.35,
      cx,
      cy,
      Math.hypot(width, height) * 0.6,
    );
    vignette.addColorStop(0, "rgba(20, 20, 40, 0)");
    vignette.addColorStop(1, "rgba(20, 20, 40, 0.1)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    if (branded) ctx.drawImage(this.logo, margin * 0.75, margin * 0.75, LOGO_PX * unit, LOGO_PX * unit);

    const total = this.blocks;
    const base = height - margin;
    ctx.font = `500 ${26 * unit}px ${FONT}`;
    ctx.fillStyle = MUTED;
    const unitLabel = total === 1 ? " block" : " blocks";
    const suffix = ctx.measureText(unitLabel).width;
    ctx.textAlign = "right";
    ctx.fillText(unitLabel, width - margin, base);
    ctx.fillStyle = INK;
    ctx.font = `600 ${26 * unit}px ${FONT}`;
    const counter = this.digits(done.toLocaleString("en-US"), width - margin - suffix, base) + suffix;
    const room = width - margin * 3 - counter;

    ctx.textAlign = "left";
    ctx.font = `700 ${NAME_PX * unit}px ${FONT}`;
    this.text(this.build.name, margin, base - 48 * unit, room);
    const assembled = plan.steps[plan.steps.length - 1].end;
    if (time < plan.steps[0].start || time >= assembled + FADE_S) return;
    let step = captions[0];
    for (const s of captions) if (s.start <= time) step = s;
    const fadeIn = (time - step.start) / FADE_S;
    const fadeOut = (assembled + FADE_S - time) / FADE_S;
    ctx.globalAlpha = THREE.MathUtils.clamp(Math.min(fadeIn, fadeOut), 0, 1);
    ctx.font = `500 ${26 * unit}px ${FONT}`;
    ctx.fillStyle = MUTED;
    this.text(step.title, margin, base, room);
    ctx.globalAlpha = 1;
  }

  /** Right-aligned at `right` with every digit in the same width, so a changing count does not jitter. */
  private digits(value: string, right: number, y: number): number {
    const { ctx } = this;
    const cell = ctx.measureText("0").width;
    const widths = [...value].map((c) => (c >= "0" && c <= "9" ? cell : ctx.measureText(c).width));
    const width = widths.reduce((a, b) => a + b, 0);
    ctx.textAlign = "center";
    let x = right - width;
    [...value].forEach((c, i) => {
      ctx.fillText(c, x + widths[i] / 2, y);
      x += widths[i];
    });
    return width;
  }

  private text(value: string, x: number, y: number, width: number) {
    let label = value;
    while (label.length && this.ctx.measureText(label).width > width) label = label.slice(0, -1);
    if (label !== value) label = `${label.slice(0, -1)}…`;
    this.ctx.fillText(label, x, y);
  }

  dispose() {
    this.release([]);
    for (const pair of this.clipped.values()) for (const material of pair) material.dispose();
    this.cap.dispose();
    this.scene.dispose();
  }
}
