import * as THREE from "three";
import type { BlockInfo, Box, Palette, Tex } from "./api";
import { type Atlas, texKey } from "./atlas";

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

  apply(boxes: Box[], maxStep = Infinity) {
    for (const b of boxes) {
      if (b.step > maxStep) continue;
      const id = this.id(b.block);
      const x0 = Math.max(b.x0, 0), x1 = Math.min(b.x1, this.width - 1);
      const y0 = Math.max(b.y0, 0), y1 = Math.min(b.y1, this.height - 1);
      const z0 = Math.max(b.z0, 0), z1 = Math.min(b.z1, this.depth - 1);
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) this.ids.fill(id, this.at(x0, y, z), this.at(x1, y, z) + 1);
    }
  }

  /** Block counts by name above the ground layer. */
  counts(): Map<string, number> {
    const out = new Map<string, number>();
    for (let i = this.at(0, 1, 0); i < this.ids.length; i++) {
      const id = this.ids[i];
      if (!id) continue;
      const name = this.states[id].name;
      out.set(name, (out.get(name) ?? 0) + 1);
    }
    return out;
  }

  /** Bounding box of everything above the ground layer, or null. */
  bounds(): THREE.Box3 | null {
    const lo = [this.width, this.height, this.depth];
    const hi = [-1, -1, -1];
    for (let y = 1; y < this.height; y++)
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
    return new THREE.Box3(new THREE.Vector3(lo[0], lo[1], lo[2]), new THREE.Vector3(hi[0] + 1, hi[1] + 1, hi[2] + 1));
  }
}

type Dir = 0 | 1 | 2 | 3 | 4 | 5; // +x -x +y -y +z -z
const NORMALS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
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
  ((s.info.shape ?? "cube") === "cube" || s.info.shape === "log" || (s.info.shape === "slab" && s.props.type === "double"));

const connects = (s: State, kinds: string[]) => isFullOpaque(s) || (s !== AIR && kinds.includes(s.info.shape ?? "cube"));

function faceTex(state: State, dir: Dir): Tex {
  const tex = state.info.tex;
  if (typeof tex === "string" || Array.isArray(tex)) return tex;
  if (state.info.shape === "door") return (state.props.half === "upper" ? tex.top : tex.bottom) ?? tex.side ?? "";
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
      return s.props.type === "top" ? [[0, 8, 0, 16, 16, 16]] : s.props.type === "double" ? [FULL] : [[0, 0, 0, 16, 8, 16]];
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
      return [[5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]];
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
    default:
      return [s.info.liquid ? [0, 0, 0, 16, 14, 16] : FULL];
  }
}

class Buffers {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  quad(p: number[][], n: [number, number, number], uv: number[][], brightness: number[]) {
    const base = this.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      this.positions.push(...p[i]);
      this.normals.push(...n);
      this.uvs.push(...uv[i]);
      this.colors.push(brightness[i], brightness[i], brightness[i]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    return g;
  }
}

export interface Materials {
  opaque: THREE.Material;
  cutout: THREE.Material;
  transparent: THREE.Material;
}

export function makeMaterials(atlas: Atlas): Materials {
  const map = atlas.texture;
  return {
    opaque: new THREE.MeshLambertMaterial({ map, vertexColors: true }),
    cutout: new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
    transparent: new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }),
  };
}

/** One mesh per material kind for everything in the world. */
export function buildMeshes(world: VoxelWorld, atlas: Atlas, materials: Materials): THREE.Group {
  const buffers = { opaque: new Buffers(), cutout: new Buffers(), transparent: new Buffers() };
  const { width, height, depth } = world;

  const occluder = (x: number, y: number, z: number) => (isFullOpaque(world.get(x, y, z)) ? 1 : 0);

  const emit = (
    kind: keyof Materials,
    s: State,
    x: number,
    y: number,
    z: number,
    box: Box16,
    dir: Dir,
    ao: boolean,
  ) => {
    const [ax, ay, az, bx, by, bz] = box.map((v) => v / 16);
    const lo = [x + ax, y + ay, z + az];
    const hi = [x + bx, y + by, z + bz];
    const n = NORMALS[dir];
    const { u, v } = TANGENTS[dir];
    const origin = [0, 1, 2].map((k) => (n[k] > 0 ? hi[k] : n[k] < 0 ? lo[k] : u[k] < 0 || v[k] < 0 ? hi[k] : lo[k]));
    const size = [0, 1, 2].map((k) => hi[k] - lo[k]);
    const uLen = Math.abs(u[0] * size[0] + u[1] * size[1] + u[2] * size[2]);
    const vLen = Math.abs(v[0] * size[0] + v[1] * size[1] + v[2] * size[2]);
    const p0 = origin;
    const p1 = origin.map((c, k) => c + u[k] * uLen);
    const p2 = origin.map((c, k) => c + u[k] * uLen + v[k] * vLen);
    const p3 = origin.map((c, k) => c + v[k] * vLen);
    const frac = (axis: [number, number, number], p: number[]) => {
      const k = axis.findIndex((c) => c !== 0);
      const cell = [x, y, z][k];
      return axis[k] > 0 ? p[k] - cell : cell + 1 - p[k];
    };
    const [tu0, tv0, tu1, tv1] = atlas.uv(texKey(faceTex(s, dir)));
    let fu0 = frac(u, p0), fu1 = frac(u, p1), fv0 = frac(v, p0), fv1 = frac(v, p3);
    if (s.info.shape === "rod") [fu0, fu1, fv0, fv1] = [0, 0.25, 0, 1];
    const U = (f: number) => tu0 + (tu1 - tu0) * f;
    const V = (f: number) => tv0 + (tv1 - tv0) * f;
    const uv = [[U(fu0), V(fv0)], [U(fu1), V(fv0)], [U(fu1), V(fv1)], [U(fu0), V(fv1)]];
    const shade = SHADE[dir];
    let brightness = [shade, shade, shade, shade];
    if (ao) {
      const nx = x + n[0], ny = y + n[1], nz = z + n[2];
      brightness = [p0, p1, p2, p3].map((p) => {
        const d = [0, 1, 2].map((k) => (p[k] === lo[k] ? -1 : 1));
        const s1 = occluder(nx + (u[0] ? d[0] : 0), ny + (u[1] ? d[1] : 0), nz + (u[2] ? d[2] : 0));
        const s2 = occluder(nx + (v[0] ? d[0] : 0), ny + (v[1] ? d[1] : 0), nz + (v[2] ? d[2] : 0));
        const c = occluder(nx + (n[0] ? 0 : d[0]), ny + (n[1] ? 0 : d[1]), nz + (n[2] ? 0 : d[2]));
        return shade * AO_LEVELS[s1 && s2 ? 0 : 3 - (s1 + s2 + c)];
      });
    }
    buffers[kind].quad([p0, p1, p2, p3], n, uv, brightness);
  };

  const cross = (kind: keyof Materials, s: State, x: number, y: number, z: number) => {
    const [tu0, tv0, tu1, tv1] = atlas.uv(texKey(faceTex(s, 4)));
    const uv = [[tu0, tv0], [tu1, tv0], [tu1, tv1], [tu0, tv1]];
    const b = [0.9, 0.9, 0.9, 0.9];
    buffers[kind].quad([[x, y, z], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z]], [0.7, 0, -0.7], uv, b);
    buffers[kind].quad([[x + 1, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x + 1, y + 1, z]], [-0.7, 0, -0.7], uv, b);
  };

  for (let y = 0; y < height; y++)
    for (let z = 0; z < depth; z++)
      for (let x = 0; x < width; x++) {
        const s = world.states[world.ids[world.at(x, y, z)]];
        if (s === AIR) continue;
        const kind: keyof Materials = s.info.transparent ? "transparent" : s.info.cutout ? "cutout" : "opaque";
        const shape = s.info.shape ?? "cube";
        if (shape === "cross") {
          cross(kind, s, x, y, z);
          continue;
        }
        const boxes = shapeBoxes(world, s, x, y, z);
        const full = boxes.length === 1 && boxes[0] === FULL;
        for (const box of boxes)
          for (let dir = 0 as Dir; dir < 6; dir++) {
            const n = NORMALS[dir];
            const neighbour = world.get(x + n[0], y + n[1], z + n[2]);
            const flush = box[FACE_EDGE[dir]] === (dir % 2 === 0 ? 16 : 0);
            const same = neighbour.name === s.name && (s.info.transparent || s.info.cutout);
            if (flush && (isFullOpaque(neighbour) || same)) continue;
            emit(kind, s, x, y, z, box, dir as Dir, full);
          }
      }

  const group = new THREE.Group();
  for (const kind of ["opaque", "cutout", "transparent"] as const) {
    if (!buffers[kind].indices.length) continue;
    const mesh = new THREE.Mesh(buffers[kind].geometry(), materials[kind]);
    mesh.renderOrder = kind === "transparent" ? 2 : kind === "cutout" ? 1 : 0;
    group.add(mesh);
  }
  return group;
}
