import { type BlockInfo, type Box, type Palette, type Tex, texKey } from "./model";
import type { UV } from "./atlas";
import type { Solid } from "./walker";
import { type PlacementPlan, SETTLE_SECONDS } from "./placement";

export interface State {
  name: string;
  props: Record<string, string>;
  info: BlockInfo;
}

const AIR: State = { name: "air", props: {}, info: { tex: "" } };

export function parseState(text: string, palette: Palette): State {
  const m = /^([a-z0-9_]+)(?:\[(.*)\])?$/.exec(text);
  if (!m) return AIR;
  const props: Record<string, string> = {};
  for (const pair of (m[2] ?? "").split(",").filter(Boolean)) {
    const [k, v] = pair.split("=");
    props[k] = v;
  }
  const info = palette[m[1]];
  return info ? { name: m[1], props, info } : AIR;
}

/** The blocks a build's boxes resolve to, up to and including a step. */
export class VoxelWorld {
  ids: Uint16Array;
  states: State[] = [AIR];
  private index = new Map<string, number>([["air", 0]]);

  constructor(
    readonly width: number,
    readonly height: number,
    readonly depth: number,
    private palette: Palette,
  ) {
    this.ids = new Uint16Array(width * height * depth);
  }

  private id(block: string): number {
    let id = this.index.get(block);
    if (id === undefined) {
      id = this.states.length;
      this.states.push(parseState(block, this.palette));
      this.index.set(block, id);
    }
    return id;
  }

  at(x: number, y: number, z: number): number {
    return (y * this.depth + z) * this.width + x;
  }

  get(x: number, y: number, z: number): State {
    if (x < 0 || y < 0 || z < 0 || x >= this.width || y >= this.height || z >= this.depth) return AIR;
    return this.states[this.ids[this.at(x, y, z)]];
  }

  apply({ blocks, boxes }: PackedBoxes) {
    const ids = blocks.map((block) => this.id(block));
    for (let i = 0; i < boxes.length; i += 7) {
      const id = ids[boxes[i + 6]];
      const x0 = Math.max(boxes[i], 0),
        x1 = Math.min(boxes[i + 3], this.width - 1);
      const y0 = Math.max(boxes[i + 1], 0),
        y1 = Math.min(boxes[i + 4], this.height - 1);
      const z0 = Math.max(boxes[i + 2], 0),
        z1 = Math.min(boxes[i + 5], this.depth - 1);
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) this.ids.fill(id, this.at(x0, y, z), this.at(x1, y, z) + 1);
    }
  }

  /** Block counts by name. */
  counts(): Map<string, number> {
    const out = new Map<string, number>();
    for (let i = 0; i < this.ids.length; i++) {
      const id = this.ids[i];
      if (!id) continue;
      const name = this.states[id].name;
      out.set(name, (out.get(name) ?? 0) + 1);
    }
    return out;
  }

  /** Bounding box of every block as [x0, y0, z0, x1, y1, z1], or null. */
  bounds(): number[] | null {
    const lo = [this.width, this.height, this.depth];
    const hi = [-1, -1, -1];
    for (let y = 0; y < this.height; y++)
      for (let z = 0; z < this.depth; z++)
        for (let x = 0; x < this.width; x++) {
          if (!this.ids[this.at(x, y, z)]) continue;
          if (x < lo[0]) lo[0] = x;
          if (y < lo[1]) lo[1] = y;
          if (z < lo[2]) lo[2] = z;
          if (x > hi[0]) hi[0] = x;
          if (y > hi[1]) hi[1] = y;
          if (z > hi[2]) hi[2] = z;
        }
    if (hi[0] < 0) return null;
    return [lo[0], lo[1], lo[2], hi[0] + 1, hi[1] + 1, hi[2] + 1];
  }
}

/** Boxes as block names and [x0, y0, z0, x1, y1, z1, block index] runs, cheap to hand to a worker. */
export interface PackedBoxes {
  blocks: string[];
  boxes: Int32Array<ArrayBuffer>;
}

export function packBoxes(boxes: Box[], maxStep = Infinity): PackedBoxes {
  const index = new Map<string, number>();
  const flat = new Int32Array(boxes.length * 7);
  let n = 0;
  for (const b of boxes) {
    if (b.step > maxStep) continue;
    let i = index.get(b.block);
    if (i === undefined) index.set(b.block, (i = index.size));
    flat.set([b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, i], n);
    n += 7;
  }
  return { blocks: [...index.keys()], boxes: flat.subarray(0, n) };
}

type Dir = 0 | 1 | 2 | 3 | 4 | 5; // +x -x +y -y +z -z
const NORMALS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const TANGENTS: { u: [number, number, number]; v: [number, number, number] }[] = [
  { u: [0, 0, -1], v: [0, 1, 0] },
  { u: [0, 0, 1], v: [0, 1, 0] },
  { u: [1, 0, 0], v: [0, 0, -1] },
  { u: [1, 0, 0], v: [0, 0, 1] },
  { u: [1, 0, 0], v: [0, 1, 0] },
  { u: [-1, 0, 0], v: [0, 1, 0] },
];
const SHADE = [0.92, 0.92, 1.0, 0.8, 0.96, 0.96];
/** Which box coordinate lies on the cell boundary for each face direction. */
const FACE_EDGE = [3, 0, 4, 1, 5, 2];
const AO_LEVELS = [0.58, 0.72, 0.86, 1.0];

type Box16 = [number, number, number, number, number, number];
const FULL: Box16 = [0, 0, 0, 16, 16, 16];

const isFullOpaque = (s: State) =>
  s !== AIR &&
  !s.info.transparent &&
  !s.info.cutout &&
  !s.info.liquid &&
  ((s.info.shape ?? "cube") === "cube" ||
    s.info.shape === "log" ||
    (s.info.shape === "slab" && s.props.type === "double"));

const connects = (s: State, kinds: string[]) =>
  isFullOpaque(s) || (s !== AIR && kinds.includes(s.info.shape ?? "cube"));

function faceTex(state: State, dir: Dir): Tex {
  const tex = state.info.tex;
  if (typeof tex === "string" || Array.isArray(tex)) return tex;
  if (state.info.shape === "door" || state.info.shape === "tall_cross")
    return (state.props.half === "upper" ? tex.top : tex.bottom) ?? tex.side ?? "";
  let axisDir = dir;
  if (state.info.shape === "log") {
    const axis = state.props.axis ?? "y";
    const along = axis === "x" ? dir <= 1 : axis === "z" ? dir >= 4 : dir === 2 || dir === 3;
    axisDir = along ? 2 : 0;
  }
  if (axisDir === 2) return tex.top ?? tex.side ?? "";
  if (axisDir === 3) return tex.bottom ?? tex.top ?? tex.side ?? "";
  return tex.side ?? tex.top ?? "";
}

function shapeBoxes(world: VoxelWorld, s: State, x: number, y: number, z: number): Box16[] {
  const shape = s.info.shape ?? "cube";
  const n = (dx: number, dz: number) => world.get(x + dx, y, z + dz);
  switch (shape) {
    case "slab":
      return s.props.type === "top"
        ? [[0, 8, 0, 16, 16, 16]]
        : s.props.type === "double"
          ? [FULL]
          : [[0, 0, 0, 16, 8, 16]];
    case "stairs": {
      const top = s.props.half === "top";
      const base: Box16 = top ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
      const [ry0, ry1] = top ? [0, 8] : [8, 16];
      const riser: Record<string, Box16> = {
        north: [0, ry0, 0, 16, ry1, 8],
        south: [0, ry0, 8, 16, ry1, 16],
        east: [8, ry0, 0, 16, ry1, 16],
        west: [0, ry0, 0, 8, ry1, 16],
      };
      return [base, riser[s.props.facing ?? "north"]];
    }
    case "fence": {
      const out: Box16[] = [[6, 0, 6, 10, 16, 10]];
      if (connects(n(0, -1), ["fence"])) out.push([7, 6, 0, 9, 9, 6], [7, 12, 0, 9, 15, 6]);
      if (connects(n(0, 1), ["fence"])) out.push([7, 6, 10, 9, 9, 16], [7, 12, 10, 9, 15, 16]);
      if (connects(n(-1, 0), ["fence"])) out.push([0, 6, 7, 6, 9, 9], [0, 12, 7, 6, 15, 9]);
      if (connects(n(1, 0), ["fence"])) out.push([10, 6, 7, 16, 9, 9], [10, 12, 7, 16, 15, 9]);
      return out;
    }
    case "wall": {
      const out: Box16[] = [[4, 0, 4, 12, 16, 12]];
      if (connects(n(0, -1), ["wall", "fence"])) out.push([5, 0, 0, 11, 14, 4]);
      if (connects(n(0, 1), ["wall", "fence"])) out.push([5, 0, 12, 11, 14, 16]);
      if (connects(n(-1, 0), ["wall", "fence"])) out.push([0, 0, 5, 4, 14, 11]);
      if (connects(n(1, 0), ["wall", "fence"])) out.push([12, 0, 5, 16, 14, 11]);
      return out;
    }
    case "pane": {
      const out: Box16[] = [[7, 0, 7, 9, 16, 9]];
      if (connects(n(0, -1), ["pane"])) out.push([7, 0, 0, 9, 16, 7]);
      if (connects(n(0, 1), ["pane"])) out.push([7, 0, 9, 9, 16, 16]);
      if (connects(n(-1, 0), ["pane"])) out.push([0, 0, 7, 7, 16, 9]);
      if (connects(n(1, 0), ["pane"])) out.push([9, 0, 7, 16, 16, 9]);
      return out;
    }
    case "torch":
      return [[7, 0, 7, 9, 10, 9]];
    case "lantern":
      return [
        [5, 0, 5, 11, 7, 11],
        [6, 7, 6, 10, 9, 10],
      ];
    case "carpet":
      return [[0, 0, 0, 16, 1, 16]];
    case "rod":
      return [[6, 0, 6, 10, 16, 10]];
    case "trapdoor": {
      if (s.props.open === "true") {
        const plates: Record<string, Box16> = {
          north: [0, 0, 13, 16, 16, 16],
          south: [0, 0, 0, 16, 16, 3],
          east: [0, 0, 0, 3, 16, 16],
          west: [13, 0, 0, 16, 16, 16],
        };
        return [plates[s.props.facing ?? "north"]];
      }
      return s.props.half === "top" ? [[0, 13, 0, 16, 16, 16]] : [[0, 0, 0, 16, 3, 16]];
    }
    case "door": {
      const panels: Record<string, Box16> = {
        north: [0, 0, 13, 16, 16, 16],
        south: [0, 0, 0, 16, 16, 3],
        east: [0, 0, 0, 3, 16, 16],
        west: [13, 0, 0, 16, 16, 16],
      };
      return [panels[s.props.facing ?? "north"]];
    }
    case "ladder": {
      const rungs: Record<string, Box16> = {
        north: [0, 0, 15, 16, 16, 16],
        south: [0, 0, 0, 16, 16, 1],
        east: [0, 0, 0, 1, 16, 16],
        west: [15, 0, 0, 16, 16, 16],
      };
      return [rungs[s.props.facing ?? "north"]];
    }
    case "face": {
      const sheets: Record<string, Box16> = {
        north: [0, 0, 0, 16, 16, 1],
        south: [0, 0, 15, 16, 16, 16],
        west: [0, 0, 0, 1, 16, 16],
        east: [15, 0, 0, 16, 16, 16],
        up: [0, 15, 0, 16, 16, 16],
        down: [0, 0, 0, 16, 1, 16],
      };
      const out = Object.keys(sheets)
        .filter((side) => s.props[side] === "true")
        .map((side) => sheets[side]);
      return out.length ? out : [sheets.north];
    }
    default:
      return [s.info.liquid ? [0, 0, 0, 16, 14, 16] : FULL];
  }
}

/** Shapes walked through: plants, flames, vines, doors and ladders; liquids too. */
const PASSABLE = new Set(["cross", "tall_cross", "torch", "face", "door", "ladder"]);
/** Shapes that stand a block and a half tall to a walker, so it cannot jump over them. */
const RAISED = new Set(["fence", "wall"]);

/** What a walker bumps into in the cell (x, y, z), in blocks. */
export function collision(world: VoxelWorld, x: number, y: number, z: number): Solid[] {
  const s = world.get(x, y, z);
  const shape = s.info.shape ?? "cube";
  if (s === AIR || s.info.liquid || PASSABLE.has(shape)) return [];
  const top = RAISED.has(shape) ? 24 : null;
  return shapeBoxes(world, s, x, y, z).map(([x0, y0, z0, x1, y1, z1]) => ({
    min: { x: x + x0 / 16, y: y + y0 / 16, z: z + z0 / 16 },
    max: { x: x + x1 / 16, y: y + (top ?? y1) / 16, z: z + z1 / 16 },
  }));
}

export type Vec3 = [number, number, number];

/** A block a ray hit, or the ground under the site (y -1), and the outward normal of the face it entered by. */
export interface Hit {
  cell: Vec3;
  normal: Vec3;
  ground: boolean;
}

/** The first block a ray from `origin` along `direction` hits, else where it meets the ground inside the site. */
export function raycast(world: VoxelWorld, origin: Vec3, direction: Vec3): Hit | null {
  const size = [world.width, world.height, world.depth];
  let [near, far, axis] = [0, Infinity, -1];
  for (let k = 0; k < 3; k++) {
    if (!direction[k]) {
      if (origin[k] < 0 || origin[k] > size[k]) return ground(world, origin, direction);
      continue;
    }
    const a = -origin[k] / direction[k];
    const b = (size[k] - origin[k]) / direction[k];
    if (Math.min(a, b) > near) [near, axis] = [Math.min(a, b), k];
    far = Math.min(far, Math.max(a, b));
  }
  if (near > far) return ground(world, origin, direction);
  const step = direction.map(Math.sign);
  const cell = [0, 1, 2].map((k) =>
    Math.min(Math.max(Math.floor(origin[k] + direction[k] * near), 0), size[k] - 1),
  ) as Vec3;
  const next = [0, 1, 2].map((k) =>
    step[k] ? (cell[k] + (step[k] > 0 ? 1 : 0) - origin[k]) / direction[k] : Infinity,
  );
  const delta = direction.map((d) => (d ? Math.abs(1 / d) : Infinity));
  if (axis < 0) axis = [0, 1, 2].reduce((a, k) => (Math.abs(direction[k]) > Math.abs(direction[a]) ? k : a));
  for (;;) {
    if (world.ids[world.at(...cell)]) {
      const normal: Vec3 = [0, 0, 0];
      normal[axis] = -step[axis];
      return { cell, normal, ground: false };
    }
    axis = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : next[1] < next[2] ? 1 : 2;
    if (next[axis] > far) return ground(world, origin, direction);
    cell[axis] += step[axis];
    next[axis] += delta[axis];
  }
}

function ground(world: VoxelWorld, origin: Vec3, direction: Vec3): Hit | null {
  if (origin[1] <= 0 || direction[1] >= 0) return null;
  const t = -origin[1] / direction[1];
  const x = Math.floor(origin[0] + direction[0] * t);
  const z = Math.floor(origin[2] + direction[2] * t);
  if (x < 0 || z < 0 || x >= world.width || z >= world.depth) return null;
  return { cell: [x, -1, z], normal: [0, 1, 0], ground: true };
}

const INITIAL_VERTICES = 4096;

class Buffers {
  positions = new Float32Array(3 * INITIAL_VERTICES);
  normals = new Float32Array(3 * INITIAL_VERTICES);
  uvs = new Float32Array(2 * INITIAL_VERTICES);
  colors = new Float32Array(3 * INITIAL_VERTICES);
  indices = new Uint32Array((6 * INITIAL_VERTICES) / 4);
  vertices = 0;
  quads = 0;
  placement: Float32Array<ArrayBuffer> | undefined;

  constructor(animated = false) {
    if (animated) this.placement = new Float32Array(2 * INITIAL_VERTICES);
  }

  /** Appends a quad from its corners `p` and texture coordinates `uv`, flattened, facing `n`, with corner brightness `b`. */
  quad(
    p: ArrayLike<number>,
    n: ArrayLike<number>,
    uv: ArrayLike<number>,
    b: ArrayLike<number>,
    start = -1,
    until = -1,
  ) {
    if (3 * (this.vertices + 4) > this.positions.length) this.grow();
    const base = this.vertices;
    for (let i = 0; i < 4; i++) {
      const v = base + i;
      for (let k = 0; k < 3; k++) {
        this.positions[3 * v + k] = p[3 * i + k];
        this.normals[3 * v + k] = n[k];
        this.colors[3 * v + k] = b[i];
      }
      this.uvs[2 * v] = uv[2 * i];
      this.uvs[2 * v + 1] = uv[2 * i + 1];
      if (this.placement) {
        this.placement[2 * v] = start;
        this.placement[2 * v + 1] = until;
      }
    }
    const q = 6 * this.quads;
    this.indices[q] = this.indices[q + 3] = base;
    this.indices[q + 1] = base + 1;
    this.indices[q + 2] = this.indices[q + 4] = base + 2;
    this.indices[q + 5] = base + 3;
    this.vertices += 4;
    this.quads++;
  }

  private grow() {
    const grown = <T extends Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>>(a: T, make: (n: number) => T) => {
      const b = make(2 * a.length);
      b.set(a);
      return b;
    };
    const float = (n: number) => new Float32Array(n);
    this.positions = grown(this.positions, float);
    this.normals = grown(this.normals, float);
    this.uvs = grown(this.uvs, float);
    this.colors = grown(this.colors, float);
    this.indices = grown(this.indices, (n) => new Uint32Array(n));
    if (this.placement) this.placement = grown(this.placement, float);
  }

  data(kind: Kind): MeshData {
    const n = this.vertices;
    return {
      kind,
      positions: this.positions.slice(0, 3 * n),
      normals: this.normals.slice(0, 3 * n),
      uvs: this.uvs.slice(0, 2 * n),
      colors: this.colors.slice(0, 3 * n),
      indices: this.indices.slice(0, 6 * this.quads),
      ...(this.placement && { placement: this.placement.slice(0, 2 * n) }),
    };
  }
}

export type Kind = "opaque" | "cutout" | "transparent";

/** One material kind's vertex attributes and triangles. */
export interface MeshData {
  kind: Kind;
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
  colors: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  placement?: Float32Array<ArrayBuffer>;
  /** Faces exposed only while their neighbouring block is on its way. */
  temporary?: boolean;
}

const CROSS_NORMALS = [
  [0.7, 0, -0.7],
  [-0.7, 0, -0.7],
];

/** One mesh per material kind for everything in the world, textured from the atlas `uvs`. */
export function meshWorld(world: VoxelWorld, uvs: Map<string, UV>, plan?: PlacementPlan): MeshData[] {
  const buffers = { opaque: new Buffers(!!plan), cutout: new Buffers(!!plan), transparent: new Buffers(!!plan) };
  const caps = { opaque: new Buffers(!!plan), cutout: new Buffers(!!plan), transparent: new Buffers(!!plan) };
  let start = -1,
    until = -1,
    capQuads = 0;
  const { width, height, depth, ids, states } = world;
  const firstTile = uvs.values().next().value!;
  const opaque = Uint8Array.from(states, (s) => (isFullOpaque(s) ? 1 : 0));
  const tiles = states.map((s) => NORMALS.map((_, dir) => uvs.get(texKey(faceTex(s, dir as Dir))) ?? firstTile));
  const inside = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < width && y < height && z < depth;
  const occluder = (x: number, y: number, z: number) => (inside(x, y, z) ? opaque[ids[world.at(x, y, z)]] : 0);

  const cell = new Float64Array(3);
  const lo = new Float64Array(3);
  const hi = new Float64Array(3);
  const corners = new Float64Array(12);
  const uv = new Float64Array(8);
  const brightness = new Float64Array(4);
  const frac = (axis: number[], corner: number) => {
    const k = axis[0] ? 0 : axis[1] ? 1 : 2;
    const p = corners[3 * corner + k];
    return axis[k] > 0 ? p - cell[k] : cell[k] + 1 - p;
  };

  const emit = (buffer: Buffers, s: State, tile: UV, box: Box16, dir: Dir, ao: boolean) => {
    for (let k = 0; k < 3; k++) {
      lo[k] = cell[k] + box[k] / 16;
      hi[k] = cell[k] + box[k + 3] / 16;
    }
    const n = NORMALS[dir];
    const { u, v } = TANGENTS[dir];
    const uLen = Math.abs(u[0] * (hi[0] - lo[0]) + u[1] * (hi[1] - lo[1]) + u[2] * (hi[2] - lo[2]));
    const vLen = Math.abs(v[0] * (hi[0] - lo[0]) + v[1] * (hi[1] - lo[1]) + v[2] * (hi[2] - lo[2]));
    for (let k = 0; k < 3; k++) {
      const o = n[k] > 0 ? hi[k] : n[k] < 0 ? lo[k] : u[k] < 0 || v[k] < 0 ? hi[k] : lo[k];
      corners[k] = o;
      corners[3 + k] = o + u[k] * uLen;
      corners[6 + k] = o + u[k] * uLen + v[k] * vLen;
      corners[9 + k] = o + v[k] * vLen;
    }
    const rod = s.info.shape === "rod";
    const fu0 = rod ? 0 : frac(u, 0);
    const fu1 = rod ? 0.25 : frac(u, 1);
    const fv0 = rod ? 0 : frac(v, 0);
    const fv1 = rod ? 1 : frac(v, 3);
    const U = (f: number) => tile[0] + (tile[2] - tile[0]) * f;
    const V = (f: number) => tile[1] + (tile[3] - tile[1]) * f;
    uv[0] = U(fu0);
    uv[1] = V(fv0);
    uv[2] = U(fu1);
    uv[3] = V(fv0);
    uv[4] = U(fu1);
    uv[5] = V(fv1);
    uv[6] = U(fu0);
    uv[7] = V(fv1);
    const shade = SHADE[dir];
    brightness.fill(shade);
    if (ao) {
      const nx = cell[0] + n[0],
        ny = cell[1] + n[1],
        nz = cell[2] + n[2];
      for (let i = 0; i < 4; i++) {
        const d0 = corners[3 * i] === lo[0] ? -1 : 1;
        const d1 = corners[3 * i + 1] === lo[1] ? -1 : 1;
        const d2 = corners[3 * i + 2] === lo[2] ? -1 : 1;
        const s1 = occluder(nx + (u[0] ? d0 : 0), ny + (u[1] ? d1 : 0), nz + (u[2] ? d2 : 0));
        const s2 = occluder(nx + (v[0] ? d0 : 0), ny + (v[1] ? d1 : 0), nz + (v[2] ? d2 : 0));
        const c = occluder(nx + (n[0] ? 0 : d0), ny + (n[1] ? 0 : d1), nz + (n[2] ? 0 : d2));
        brightness[i] = shade * AO_LEVELS[s1 && s2 ? 0 : 3 - (s1 + s2 + c)];
      }
    }
    buffer.quad(corners, n, uv, brightness, start, until);
  };

  const cross = (buffer: Buffers, tile: UV, x: number, y: number, z: number) => {
    uv.set([tile[0], tile[1], tile[2], tile[1], tile[2], tile[3], tile[0], tile[3]]);
    brightness.fill(0.9);
    corners.set([x, y, z, x + 1, y, z + 1, x + 1, y + 1, z + 1, x, y + 1, z]);
    buffer.quad(corners, CROSS_NORMALS[0], uv, brightness, start);
    corners.set([x + 1, y, z, x, y, z + 1, x, y + 1, z + 1, x + 1, y + 1, z]);
    buffer.quad(corners, CROSS_NORMALS[1], uv, brightness, start);
  };

  for (let y = 0; y < height; y++)
    for (let z = 0; z < depth; z++)
      for (let x = 0; x < width; x++) {
        const id = ids[world.at(x, y, z)];
        const s = states[id];
        if (s === AIR) continue;
        start = plan?.starts[world.at(x, y, z)] ?? -1;
        until = -1;
        const kind = s.info.transparent ? "transparent" : s.info.cutout ? "cutout" : "opaque";
        const buffer = buffers[kind];
        const shape = s.info.shape ?? "cube";
        if (shape === "cross" || shape === "tall_cross") {
          cross(buffer, tiles[id][4], x, y, z);
          continue;
        }
        cell[0] = x;
        cell[1] = y;
        cell[2] = z;
        const boxes = shapeBoxes(world, s, x, y, z);
        const full = boxes.length === 1 && boxes[0] === FULL;
        const mergesSame = s.info.transparent || s.info.cutout;
        for (const box of boxes)
          for (let dir = 0 as Dir; dir < 6; dir++) {
            const n = NORMALS[dir];
            const nx = x + n[0],
              ny = y + n[1],
              nz = z + n[2];
            const neighbour = inside(nx, ny, nz) ? ids[world.at(nx, ny, nz)] : 0;
            const flush = box[FACE_EDGE[dir]] === (dir % 2 === 0 ? 16 : 0);
            if (flush && (opaque[neighbour] || (mergesSame && states[neighbour].name === s.name))) {
              const next = plan && inside(nx, ny, nz) ? plan.starts[world.at(nx, ny, nz)] : -1;
              // Bound transient geometry for large solid fills; all exposed blocks retain their own timing.
              if (
                next !== undefined &&
                next >= 0 &&
                next > start &&
                capQuads < 250_000 &&
                (plan!.cells.length < 80_000 || dir === 2)
              ) {
                until = next + SETTLE_SECONDS;
                emit(caps[kind], s, tiles[id][dir], box, dir, false);
                capQuads++;
                until = -1;
              }
              continue;
            }
            emit(buffer, s, tiles[id][dir], box, dir as Dir, full);
          }
      }

  const kinds = ["opaque", "cutout", "transparent"] as const;
  return [
    ...kinds.filter((kind) => buffers[kind].quads).map((kind) => buffers[kind].data(kind)),
    ...kinds.filter((kind) => caps[kind].quads).map((kind) => ({ ...caps[kind].data(kind), temporary: true })),
  ];
}

/** Of the meshes' vertices, those ending a run along x, y and z: they include every corner of the convex hull, so any view that fits them fits the model. */
export function outline(meshes: MeshData[]): Float32Array<ArrayBuffer> {
  let points = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0));
  let n = 0;
  for (const m of meshes) {
    points.set(m.positions, n);
    n += m.positions.length;
  }
  for (const axis of [1, 0, 2]) points = runEnds(points, axis);
  return points;
}

/** Points that are the lowest or highest along `axis` among those sharing their other two coordinates, all multiples of 1/16. */
function runEnds(points: Float32Array<ArrayBuffer>, axis: number): Float32Array<ArrayBuffer> {
  const [a, b] = [0, 1, 2].filter((k) => k !== axis);
  const ends = new Map<number, [number, number]>();
  for (let i = 0; i < points.length; i += 3) {
    const key = Math.round(points[i + a] * 16) * 65536 + Math.round(points[i + b] * 16);
    const run = ends.get(key);
    if (!run) ends.set(key, [i, i]);
    else if (points[i + axis] < points[run[0] + axis]) run[0] = i;
    else if (points[i + axis] > points[run[1] + axis]) run[1] = i;
  }
  const out = new Float32Array(6 * ends.size);
  let n = 0;
  for (const [low, high] of ends.values())
    for (const i of low === high ? [low] : [low, high]) {
      out.set(points.subarray(i, i + 3), n);
      n += 3;
    }
  return out.slice(0, n);
}
