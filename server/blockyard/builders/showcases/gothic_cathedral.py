"""Showcase: a dark gothic cathedral with flying buttresses, rose windows, gargoyles and two openwork stone spires."""

from blockyard.builders.scripted import Showcase

HELPERS = """
const LIGHT = "sea_lantern";
const BASE = "deepslate_bricks";
const CARVED = "chiseled_polished_blackstone";
const BACK = "polished_blackstone";
const SPIKE = "iron_chain";
const glass = (color) => `${color}_stained_glass_pane`;
let MIRROR = false;
const mx = (x) => (MIRROR ? 64 - x : x);
const mb = (b) => (MIRROR ? b.replace(/facing=(east|west)/, (_, f) => `facing=${f === "east" ? "west" : "east"}`) : b);
const F = (x0, y0, z0, x1, y1, z1, b, mode = "solid") => fill(mx(x0), y0, z0, mx(x1), y1, z1, mb(b), mode);
const S = (x, y, z, b) => set(mx(x), y, z, mb(b));
const both = (build) => { build(); MIRROR = true; build(); MIRROR = false; };
const hash = (x, y, z) => {
  let h = Math.imul(x + 101, 73856093) ^ Math.imul(y + 211, 19349663) ^ Math.imul(z + 307, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const brick = (x, y, z) => {
  const r = hash(mx(x), y, z);
  return r < 0.12 ? "deepslate_tiles" : r < 0.18 ? "cracked_deepslate_tiles" : r < 0.23 ? "polished_blackstone_bricks"
    : r < 0.28 ? "cobbled_deepslate" : null;
};
const kind = (x, y, z) => (hash(z + 7, y, mx(x)) < 0.15 ? "polished_blackstone_brick" : "deepslate_brick");
const stair = (x, y, z, facing, top = false) => `${kind(x, y, z)}_stairs[facing=${facing}${top ? ",half=top" : ""}]`;
const post = (x, y, z) => `${kind(x, y, z)}_wall`;
const stone = (x0, y0, z0, x1, y1, z1, mode = "solid") => {
  F(x0, y0, z0, x1, y1, z1, BASE, mode);
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      if (x === x0 || x === x1 || z === z0 || z === z1)
        for (let y = y0; y <= y1; y++) {
          const b = brick(x, y, z);
          if (b) S(x, y, z, b);
        }
};
const ring = (x0, y, z0, x1, z1, stairs, corner, extra = "") => {
  F(x0 + 1, y, z0, x1 - 1, y, z0, `${stairs}[facing=south${extra}]`);
  F(x0 + 1, y, z1, x1 - 1, y, z1, `${stairs}[facing=north${extra}]`);
  F(x0, y, z0 + 1, x0, y, z1 - 1, `${stairs}[facing=east${extra}]`);
  F(x1, y, z0 + 1, x1, y, z1 - 1, `${stairs}[facing=west${extra}]`);
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) S(x, y, z, corner);
};
const pinnacle = (x, y, z, h = 3, wings = true) => {
  S(x, y, z, CARVED);
  for (let k = 1; k <= h; k++) S(x, y + k, z, post(x, y + k, z));
  if (wings)
    for (const [dx, dz, facing] of [[-1, 0, "east"], [1, 0, "west"], [0, -1, "south"], [0, 1, "north"]])
      S(x + dx, y + 1, z + dz, stair(x + dx, y + 1, z + dz, facing));
  F(x, y + h + 1, z, x, y + h + 2, z, SPIKE);
};
const faceX = (x, inward) => ({
  at: (u, d) => [x + d * inward, u], lo: "north", hi: "south", out: inward > 0 ? "west" : "east", in: inward > 0 ? "east" : "west",
});
const faceZ = (z, inward) => ({
  at: (u, d) => [u, z + d * inward], lo: "west", hi: "east", out: inward > 0 ? "north" : "south", in: inward > 0 ? "south" : "north",
});
const box = (f, u0, u1, y0, y1, b, d = 0) => {
  const [xa, za] = f.at(u0, d), [xb, zb] = f.at(u1, d);
  F(xa, y0, za, xb, y1, zb, b);
};
const rock = (f, u0, u1, y0, y1, d0 = 0, d1 = d0) => {
  const [xa, za] = f.at(u0, d0), [xb, zb] = f.at(u1, d1);
  stone(Math.min(xa, xb), y0, Math.min(za, zb), Math.max(xa, xb), y1, Math.max(za, zb));
};
const cell = (f, u, y, d, b) => {
  const [x, z] = f.at(u, d);
  S(x, y, z, typeof b === "string" ? b : b(x, y, z));
};
const shaft = (f, u, y0, y1, d = -1) => { for (let y = y0; y <= y1; y++) cell(f, u, y, d, post); };
const ribs = (f, us, y0, y1, d = -1) => { for (const u of us) shaft(f, u, y0, y1, d); };
const course = (f, u0, u1, y, top = true, d = -1) => {
  for (let u = u0; u <= u1; u++) cell(f, u, y, d, (x, y, z) => stair(x, y, z, f.in, top));
};
const gargoyle = (f, u, y, d = -1) => {
  cell(f, u, y, d, CARVED);
  cell(f, u, y, d - 1, (x, y, z) => stair(x, y, z, f.out));
  cell(f, u, y - 1, d, (x, y, z) => stair(x, y, z, f.in, true));
};
const tip = (w, h, i) => h - 1 + Math.min(i, w - 1 - i);
const shape = (f, u0, y0, w, h, b, d = 0) => {
  for (let i = 0; i < w; i++) box(f, u0 + i, u0 + i, y0, y0 + tip(w, h, i), b, d);
};
const archway = (f, u0, y0, w, h, d = 0) => {
  shape(f, u0, y0, w, h, "air", d);
  const mid = (w - 1) / 2;
  for (let i = 0; i < w; i++)
    if (i !== mid) cell(f, u0 + i, y0 + tip(w, h, i), d, (x, y, z) => stair(x, y, z, i < mid ? f.lo : f.hi, true));
};
const hood = (f, u0, y0, w, h, spike = false) => {
  const mid = (w - 1) / 2;
  for (let i = 0; i < w; i++)
    cell(f, u0 + i, y0 + tip(w, h, i) + 1, -1, i === mid ? post : (x, y, z) => stair(x, y, z, i < mid ? f.hi : f.lo));
  if (spike) cell(f, u0 + mid, y0 + tip(w, h, mid) + 2, -1, SPIKE);
};
const lancet = (f, u0, y0, w, h, pane, sill = true) => {
  box(f, u0 - 1, u0 + w, y0 - 1, y0 + tip(w, h, (w - 1) / 2) + 1, BASE, 1);
  shape(f, u0, y0, w, h, "air");
  shape(f, u0, y0, w, h, pane, 1);
  shape(f, u0, y0, w, h, LIGHT, 2);
  if (sill) for (let u = u0; u < u0 + w; u++) cell(f, u, y0 - 1, -1, (x, y, z) => stair(x, y, z, f.in));
  hood(f, u0, y0, w, h);
};
const niche = (f, u, y0, h, sill = true) => {
  box(f, u, u, y0, y0 + h - 1, "air");
  box(f, u, u, y0, y0 + h - 1, BACK, 1);
  cell(f, u, y0 + h, 0, (x, y, z) => stair(x, y, z, f.in, true));
  if (sill) cell(f, u, y0 - 1, -1, (x, y, z) => stair(x, y, z, f.in));
};
const blind = (f, u0, y0, h) => {
  shape(f, u0, y0, 3, h, BACK, 1);
  archway(f, u0, y0, 3, h);
  shaft(f, u0 + 1, y0, y0 + h - 2, 0);
  hood(f, u0, y0, 3, h);
};
const buttress = (f, u, y0, stages) => {
  let y = y0;
  for (const [top, depth] of stages) {
    rock(f, u, u, y, top, -depth, -1);
    cell(f, u, top + 1, -depth, (x, y, z) => stair(x, y, z, f.in));
    y = top + 1;
  }
};
const rose = (f, cu, cy, r) => {
  const n = Math.ceil(r + 0.5);
  for (let du = -n; du <= n; du++)
    for (let dy = -n; dy <= n; dy++) {
      const d = Math.hypot(du, dy), u = cu + du, y = cy + dy;
      if (d > r + 0.5) continue;
      if (d > r - 0.5) { box(f, u, u, y, y, CARVED); box(f, u, u, y, y, BASE, 1); continue; }
      const petal = Math.floor((Math.atan2(dy, du) + Math.PI) / (Math.PI / 4)) % 2;
      const spoke = d > 1.5 && (du === 0 || dy === 0 || Math.abs(du) === Math.abs(dy));
      if (spoke) cell(f, u, y, 0, post); else box(f, u, u, y, y, "air");
      box(f, u, u, y, y, d < 1 ? glass("yellow") : d < 2.5 ? glass("red") : glass(petal ? "blue" : "purple"), 1);
      box(f, u, u, y, y, LIGHT, 2);
    }
};
"""

STEPS = [
    (
        "Cathedral close",
        "A paved close of polished andesite with a stone grid, a slab lip, a processional path, lamp posts and two cypresses.",
        """
fill(12, 1, 5, 52, 1, 57, "polished_andesite");
for (let x = 12; x <= 52; x += 4) fill(x, 1, 5, x, 1, 57, "stone_bricks");
for (let z = 5; z <= 57; z += 4) fill(12, 1, z, 52, 1, z, "stone_bricks");
fill(11, 1, 6, 11, 1, 56, "stone_brick_slab"); fill(53, 1, 6, 53, 1, 56, "stone_brick_slab");
fill(13, 1, 4, 51, 1, 4, "stone_brick_slab"); fill(13, 1, 58, 51, 1, 58, "stone_brick_slab");
fill(29, 1, 53, 35, 1, 57, "smooth_stone");
for (const x of [13, 51]) for (const z of [10, 20, 40, 50]) { fill(x, 2, z, x, 3, z, "polished_blackstone_brick_wall"); set(x, 4, z, "lantern"); }
for (const x of [27, 37]) { fill(x, 2, 57, x, 4, 57, "polished_blackstone_brick_wall"); set(x, 5, 57, "lantern"); }
for (const x of [15, 49]) {
  fill(x, 2, 55, x, 5, 55, "spruce_log");
  fill(x - 1, 3, 54, x + 1, 7, 56, "spruce_leaves");
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { set(x + dx, 3, 55 + dz, "air"); set(x + dx, 7, 55 + dz, "air"); }
  fill(x, 8, 55, x, 10, 55, "spruce_leaves");
}
""",
    ),
    (
        "Nave and aisles",
        (
            "A dark stone nave over low side aisles: recessed lancets with sills and gabled hoods, corbel tables "
            "under the eaves, blind niches, wall shafts between the clerestory bays and gargoyles at every shaft."
        ),
        HELPERS
        + """
stone(26, 2, 16, 38, 24, 48, "walls");
both(() => {
  const aisle = faceX(21, 1), clere = faceX(26, 1);
  for (const [z0, z1, bays, niches, shafts] of [[16, 25, [18, 22], [], [17, 21, 25]], [35, 46, [37, 41], [36, 45], [36, 40, 44]]]) {
    const za = z0 === 16 ? 15 : z0;
    stone(21, 2, z0, 25, 11, z1, "walls");
    course(aisle, z0, z1, 2, false);
    course(aisle, z0, z1, 10);
    bays.forEach((z, i) => {
      lancet(aisle, z, 4, 3, 5, glass("red"));
      lancet(clere, z, 18, 3, 4, glass(i ? "purple" : "blue"), false);
    });
    for (const z of niches) niche(aisle, z, 4, 5);
    F(20, 11, za, 20, 11, z1, "polished_tuff_stairs[facing=east]");
    for (let i = 0; i < 5; i++) {
      if (i) F(21 + i, 12, za, 21 + i, 11 + i, z1, "polished_tuff");
      for (let z = za; z <= z1; z++) S(21 + i, 12 + i, z, `${hash(mx(21 + i), 12 + i, z) < 0.3 ? "tuff_brick" : "polished_tuff"}_stairs[facing=east]`);
    }
    course(clere, z0, z1, 17, false);
    course(clere, z0, z1, 24);
    for (const z of shafts) { shaft(clere, z, 18, 23); gargoyle(clere, z, 23); }
  }
  const end = faceZ(16, 1);
  course(end, 21, 25, 2, false);
  course(end, 21, 25, 10);
  blind(end, 22, 4, 5);
});
""",
    ),
    (
        "Transept and rose windows",
        (
            "The transept arms end in spiky gabled fronts: a stepped porch, a traceried rose between wall shafts, "
            "a gable lancet between niches, pinnacled copings, and turrets with slit windows, gargoyles and crocketed spires."
        ),
        HELPERS
        + """
stone(14, 2, 26, 50, 24, 34, "walls");
both(() => {
  for (let i = 0; i < 5; i++) stone(14, 25 + 2 * i, 26 + i, 14, 26 + 2 * i, 34 - i);
  const end = faceX(14, 1);
  rose(end, 30, 17, 3.5);
  ribs(end, [27, 33], 13, 21);
  course(end, 27, 33, 12);
  course(end, 27, 33, 24);
  rock(end, 27, 33, 2, 6, -1);
  for (let j = 0; j < 3; j++) {
    cell(end, 27 + j, 7 + j, -1, (x, y, z) => stair(x, y, z, end.hi));
    cell(end, 33 - j, 7 + j, -1, (x, y, z) => stair(x, y, z, end.lo));
    rock(end, 28 + j, 32 - j, 7 + j, 7 + j, -1);
  }
  S(13, 10, 30, CARVED);
  S(13, 11, 30, post(13, 11, 30));
  archway(end, 28, 2, 5, 5, -1);
  for (const z of [27, 33]) { buttress(end, z, 2, [[5, 2]]); pinnacle(12, 7, z, 1, false); }
  archway(end, 29, 2, 3, 4);
  box(end, 29, 31, 2, 2, "dark_oak_door[facing=west]", 1);
  box(end, 29, 31, 3, 3, "dark_oak_door[facing=west,half=upper]", 1);
  box(end, 29, 31, 4, 6, "polished_tuff", 1);
  cell(end, 30, 5, 1, CARVED);
  lancet(end, 30, 27, 1, 3, glass("yellow"));
  for (const z of [28, 32]) niche(end, z, 26, 3);
  for (let i = 2; i < 5; i++)
    for (const [z, facing] of [[25 + i, "south"], [35 - i, "north"]]) {
      S(13, 25 + 2 * i, z, BASE);
      S(13, 26 + 2 * i, z, stair(13, 26 + 2 * i, z, facing));
      if (i % 2 === 0) { S(13, 27 + 2 * i, z, post(13, 27 + 2 * i, z)); S(13, 28 + 2 * i, z, SPIKE); }
    }
  for (const [z, inward] of [[26, 1], [34, -1]]) {
    const side = faceZ(z, inward);
    course(side, 16, 20, 2, false);
    course(side, 16, 20, 15);
    course(side, 16, 24, 24);
    ribs(side, [16], 3, 14);
    ribs(side, [16, 20], 16, 23);
    lancet(side, 17, 4, 3, 9, glass("blue"));
    blind(side, 17, 17, 5);
    lancet(side, 22, 18, 3, 4, glass("purple"));
  }
  for (const [z0, outer] of [[24, faceZ(24, 1)], [34, faceZ(36, -1)]]) {
    stone(13, 2, z0, 15, 28, z0 + 2);
    for (const [f, c] of [[faceX(13, 1), z0 + 1], [outer, 14]]) {
      course(f, c - 1, c + 1, 2, false);
      course(f, c - 1, c + 1, 12);
      course(f, c - 1, c + 1, 24);
      niche(f, c, 5, 5);
      box(f, c, c, 15, 20, "iron_bars");
      box(f, c, c, 15, 20, BACK, 1);
      niche(f, c, 25, 2, false);
      gargoyle(f, c - 1, 23);
    }
    ring(13, 29, z0, 15, z0 + 2, "deepslate_brick_stairs", "deepslate_brick_wall");
    S(14, 29, z0 + 1, CARVED);
    for (let y = 30; y <= 37; y++) S(14, y, z0 + 1, post(14, y, z0 + 1));
    for (const y of [31, 34])
      for (const [dx, dz, facing] of [[-1, 0, "east"], [1, 0, "west"], [0, -1, "south"], [0, 1, "north"]])
        S(14 + dx, y, z0 + 1 + dz, stair(14 + dx, y, z0 + 1 + dz, facing));
    F(14, 38, z0 + 1, 14, 39, z0 + 1, SPIKE);
  }
});
""",
    ),
    (
        "Apse and chevet",
        (
            "A rounded apse closes the east end: recessed lancets over blind arcades, moulded courses, gargoyles, "
            "and radiating buttresses that step down into a ring of tall pinnacles."
        ),
        HELPERS
        + """
const toward = (x, z) => (Math.abs(x - 32) > Math.abs(z - 16) ? (x < 32 ? "east" : "west") : "south");
const away = (x, z) => (Math.abs(x - 32) > Math.abs(z - 16) ? (x < 32 ? "west" : "east") : "north");
for (let x = 24; x <= 40; x++)
  for (let z = 8; z <= 16; z++) {
    const d = Math.hypot(x - 32, z - 16);
    if (d > 5 && d <= 6.5) stone(x, 2, z, x, 24, z);
    if (d > 6.5 && d <= 7.5 && z <= 15 && x >= 26 && x <= 38) {
      S(x, 2, z, stair(x, 2, z, toward(x, z)));
      S(x, 11, z, stair(x, 11, z, toward(x, z), true));
      S(x, 24, z, stair(x, 24, z, toward(x, z), true));
    }
  }
const apse = faceZ(10, 1);
lancet(apse, 31, 12, 3, 9, glass("blue"));
blind(apse, 31, 3, 6);
both(() => {
  lancet(faceX(26, 1), 14, 12, 1, 9, glass("red"));
  F(28, 12, 12, 28, 21, 12, glass("purple"));
  F(29, 12, 13, 29, 21, 13, LIGHT);
  F(28, 3, 12, 28, 8, 12, "air");
  F(29, 3, 13, 29, 8, 13, BACK);
});
for (const deg of [45, 135]) {
  const a = (deg * Math.PI) / 180, at = (t) => [Math.round(32 + t * Math.cos(a)), Math.round(16 - t * Math.sin(a))];
  const [x0, z0] = at(7), [x1, z1] = at(8);
  set(x0, 22, z0, CARVED);
  set(x0, 21, z0, stair(x0, 21, z0, toward(x0, z0), true));
  set(x1, 22, z1, stair(x1, 22, z1, away(x1, z1)));
}
for (const deg of [22.5, 67.5, 112.5, 157.5]) {
  const a = (deg * Math.PI) / 180;
  const tops = new Map();
  for (let t = 7; t <= 10; t += 0.5) {
    const key = `${Math.round(32 + t * Math.cos(a))},${Math.round(16 - t * Math.sin(a))}`;
    tops.set(key, Math.max(tops.get(key) ?? 0, Math.round(19 - (t - 7) * 3)));
  }
  for (const [key, top] of tops) {
    const [x, z] = key.split(",").map(Number);
    stone(x, 2, z, x, top, z);
    set(x, top + 1, z, stair(x, top + 1, z, toward(x, z)));
  }
  for (const [t, h] of [[8.5, 4], [10, 2]]) {
    const [px, pz] = [Math.round(32 + t * Math.cos(a)), Math.round(16 - t * Math.sin(a))];
    pinnacle(px, tops.get(`${px},${pz}`) + 1, pz, h, false);
  }
}
""",
    ),
    (
        "Flying buttresses",
        (
            "Stepped buttress piers stand clear of the aisles, each with a gargoyle, a crocketed pinnacle and "
            "a slender arch, pierced by little colonnettes, thrown up to the nave wall."
        ),
        HELPERS
        + """
both(() => {
  for (const z of [17, 21, 40, 44]) {
    stone(17, 2, z, 20, 4, z);
    S(17, 5, z, stair(17, 5, z, "east"));
    stone(18, 5, z, 20, 9, z);
    S(18, 10, z, stair(18, 10, z, "east"));
    stone(19, 10, z, 20, 14, z);
    gargoyle(faceX(18, 1), z, 8);
    S(20, 15, z, stair(20, 15, z, "east"));
    pinnacle(19, 15, z, 4);
    for (let k = 0; k < 5; k++) {
      S(21 + k, 15 + k, z, stair(21 + k, 15 + k, z, "west", true));
      S(21 + k, 16 + k, z, stair(21 + k, 16 + k, z, "east"));
    }
    for (const k of [1, 3]) for (let y = 13 + k; y <= 14 + k; y++) S(21 + k, y, z, post(21 + k, y, z));
  }
});
""",
    ),
    (
        "Roofs",
        (
            "Steep lead-grey tuff roofs over nave and transept, behind a pierced parapet bristling with pinnacles, "
            "with gabled dormers, dark ridge cresting and a conical apse roof."
        ),
        HELPERS
        + """
const tile = (x, y, z) => (hash(z, y, mx(x) * 3) < 0.3 ? "tuff_bricks" : "polished_tuff");
const slate = (x, y, z, facing) => `${hash(mx(x), z, y) < 0.3 ? "tuff_brick" : "polished_tuff"}_stairs[facing=${facing}]`;
const slope = (x0, y, z0, x1, z1, facing) => {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      S(x, y, z, tile(x, y, z));
      S(x, y + 1, z, slate(x, y + 1, z, facing));
    }
};
const dormer = (c) => {
  stone(27, 29, c - 1, 28, 32, c + 1);
  F(27, 33, c - 1, 29, 33, c - 1, "polished_tuff_stairs[facing=south]");
  F(27, 33, c + 1, 29, 33, c + 1, "polished_tuff_stairs[facing=north]");
  F(27, 33, c, 29, 33, c, "polished_tuff");
  S(27, 33, c, CARVED);
  S(27, 34, c, post(27, 34, c));
  S(27, 35, c, SPIKE);
  F(27, 30, c, 27, 31, c, glass("yellow"));
  F(28, 30, c, 28, 31, c, LIGHT);
  S(26, 29, c, stair(26, 29, c, "east"));
};
both(() => {
  for (const [z0, z1] of [[16, 25], [35, 46]]) {
    F(26, 25, z0, 26, 26, z1, BASE);
    for (let z = z0; z <= z1; z++) S(25, 25, z, post(25, 25, z));
  }
  for (const z of [17, 21, 38, 42, 46]) pinnacle(25, 25, z, 2, false);
  for (const z of [19, 23, 40, 44]) { S(25, 25, z, CARVED); S(25, 26, z, SPIKE); }
  for (let i = 1; i < 7; i++) slope(25 + i, 25 + 2 * i, 16, 25 + i, 48, "east");
  dormer(20);
  dormer(41);
});
fill(32, 39, 16, 32, 39, 48, "polished_tuff");
fill(32, 40, 16, 32, 40, 48, "polished_blackstone_brick_wall");
for (const z of [18, 22, 26, 34, 38, 42, 46]) set(32, 41, z, SPIKE);
for (let i = 0; i < 5; i++) {
  const y = 25 + 2 * i;
  slope(15, y, 25 + i, 49, 25 + i, "south");
  slope(15, y, 35 - i, 49, 35 - i, "north");
  both(() => {
    for (const [z, facing] of [[25 + i, "south"], [35 - i, "north"]]) { S(14, y, z, BASE); S(14, y + 1, z, stair(14, y + 1, z, facing)); }
  });
}
fill(15, 35, 30, 49, 35, 30, "polished_tuff");
fill(15, 36, 30, 49, 36, 30, "polished_blackstone_brick_wall");
both(() => { S(14, 35, 30, BASE); pinnacle(14, 36, 30, 2, false); });
for (let k = 0; k < 7; k++) {
  const r = 7.5 - k, y = 25 + 2 * k;
  for (let x = 24; x <= 40; x++)
    for (let z = 8; z <= 15; z++) {
      const dx = x - 32, dz = z - 16, d = Math.hypot(dx, dz);
      if (d > r || d <= r - 1) continue;
      const facing = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? "east" : "west") : "south";
      set(x, y, z, tile(x, y, z));
      set(x, y + 1, z, slate(x, y + 1, z, facing));
    }
}
pinnacle(32, 39, 15, 2, false);
""",
    ),
    (
        "West front",
        (
            "The west front: a deep porch of three stepped pointed arches under a pinnacled gable, a gallery of "
            "niches and colonnettes, a great traceried rose between wall shafts, and a steep spiky gable."
        ),
        HELPERS
        + """
stone(27, 2, 48, 37, 24, 52);
for (let x = 27; x <= 37; x++) {
  const top = 25 + 2 * (7 - Math.abs(x - 32));
  stone(x, 25, 49, x, top + 1, 52);
  if (x !== 32) for (let z = 49; z <= 53; z++) S(x, top + 2, z, stair(x, top + 2, z, x < 32 ? "east" : "west"));
}
for (const x of [28, 30, 34, 36]) { const top = 25 + 2 * (7 - Math.abs(x - 32)); set(x, top + 3, 53, post(x, top + 3, 53)); set(x, top + 4, 53, SPIKE); }
fill(32, 41, 49, 32, 41, 52, CARVED);
pinnacle(32, 41, 51, 3, false);
const front = faceZ(52, -1);
course(front, 27, 37, 14);
for (const u of [28, 30, 34, 36]) niche(front, u, 15, 2, false);
ribs(front, [27, 29, 35, 37], 15, 16);
course(front, 27, 37, 17);
ribs(front, [27, 37], 18, 29);
rock(front, 27, 37, 2, 9, -2, -1);
for (let j = 0; j < 5; j++) {
  for (const d of [-2, -1]) {
    cell(front, 27 + j, 10 + j, d, (x, y, z) => stair(x, y, z, front.hi));
    cell(front, 37 - j, 10 + j, d, (x, y, z) => stair(x, y, z, front.lo));
  }
  rock(front, 28 + j, 36 - j, 10 + j, 10 + j, -2, -1);
}
set(32, 15, 53, CARVED);
pinnacle(32, 15, 54, 2, false);
for (const x of [27, 37]) pinnacle(x, 10, 54, 3, false);
ribs(front, [28, 36], 2, 9, -3);
archway(front, 29, 2, 7, 5, -2);
archway(front, 30, 2, 5, 5, -1);
archway(front, 31, 2, 3, 4);
box(front, 31, 33, 2, 2, "dark_oak_door[facing=south]", 1);
box(front, 31, 33, 3, 3, "dark_oak_door[facing=south,half=upper]", 1);
box(front, 31, 33, 4, 6, "polished_tuff", 1);
cell(front, 32, 5, 1, CARVED);
rose(front, 32, 23, 4.5);
lancet(front, 31, 30, 3, 4, glass("yellow"));
for (const u of [29, 35]) niche(front, u, 30, 3);
niche(front, 32, 37, 2);
""",
    ),
    (
        "Twin towers and spires",
        (
            "Two towers climb in four stages between stepped, ribbed angle buttresses with gargoyles: a portal "
            "under niches, tall lancets, louvred belfries and an openwork lantern, then a pinnacled parapet and a "
            "crocketed, pierced stone spire."
        ),
        HELPERS
        + """
const spire = (cx, cz, y0, y1, r0) => {
  const od = (dx, dz) => Math.max(Math.abs(dx), Math.abs(dz), (Math.abs(dx) + Math.abs(dz)) * 0.72);
  const rad = (y) => (r0 * (y1 - y)) / (y1 - y0);
  const inside = (dx, dz, y) => y <= y1 && od(dx, dz) <= rad(y);
  const n = Math.ceil(r0);
  for (let y = y0; y <= y1; y++)
    for (let dx = -n; dx <= n; dx++)
      for (let dz = -n; dz <= n; dz++) {
        if (!inside(dx, dz, y)) continue;
        const x = cx + dx, z = cz + dz;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => !inside(dx + a, dz + b, y));
        const capped = !inside(dx, dz, y + 1);
        if (!edge.length && !capped) continue;
        if (!dx && !dz) { S(x, y, z, capped || rad(y) < 1.2 ? post(x, y, z) : BASE); continue; }
        if (capped) {
          S(x, y, z, stair(x, y, z, Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? "west" : "east") : dz > 0 ? "north" : "south"));
          if (Math.abs(dx) === Math.abs(dz)) S(x, y + 1, z, SPIKE);
          continue;
        }
        const open = Math.abs(dx) !== Math.abs(dz) && (y - y0) % 5 >= 1 && (y - y0) % 5 <= 3 && rad(y) > 1.6;
        S(x, y, z, open ? "iron_bars" : hash(mx(x), y, z) < 0.3 ? "polished_blackstone_bricks" : "deepslate_tiles");
        if ((y - y0) % 3 === 0 && Math.abs(dx) === Math.abs(dz))
          for (const [a, b] of edge) S(x + a, y, z + b, post(x + a, y, z + b));
      }
  F(cx, y1 + 1, cz, cx, y1 + 3, cz, SPIKE);
};
both(() => {
  stone(20, 2, 47, 26, 56, 53, "walls");
  F(22, 28, 49, 24, 39, 51, BACK);
  const front = faceZ(53, -1), west = faceX(20, 1), north = faceZ(47, 1), east = faceX(26, -1);
  for (const [f, u] of [[front, 20], [front, 26], [west, 53], [west, 47]]) {
    buttress(f, u, 2, [[13, 3], [30, 2], [54, 1]]);
    shaft(f, u, 15, 28, -3);
    shaft(f, u, 32, 50, -2);
    gargoyle(f, u, 29, -3);
    gargoyle(f, u, 52, -2);
  }
  archway(front, 22, 2, 3, 4);
  box(front, 22, 24, 2, 3, "dark_oak_planks", 1);
  box(front, 23, 23, 2, 2, "dark_oak_door[facing=south]", 1);
  box(front, 23, 23, 3, 3, "dark_oak_door[facing=south,half=upper]", 1);
  box(front, 22, 24, 4, 6, "polished_tuff", 1);
  hood(front, 22, 2, 3, 4);
  course(front, 21, 25, 8, false);
  for (const u of [21, 23, 25]) niche(front, u, 9, 3, false);
  course(west, 48, 52, 2, false);
  blind(west, 49, 4, 7);
  for (const [f, c, y0] of [[front, 23, 15], [west, 50, 15], [north, 23, 17], [east, 50, 32]]) ribs(f, [c - 2, c + 2], y0, 54);
  for (const [f, c] of [[front, 23], [west, 50]]) course(f, c - 2, c + 2, 14);
  for (const [f, c, pane] of [[front, 23, "blue"], [west, 50, "red"], [north, 23, "red"]]) {
    lancet(f, c - 1, 17, 3, 7, glass(pane));
    course(f, c - 2, c + 2, 27);
  }
  for (const [f, c] of [[front, 23], [west, 50], [north, 23], [east, 50]]) {
    archway(f, c - 1, 29, 3, 8);
    shape(f, c - 1, 29, 3, 8, "dark_oak_trapdoor[half=top]", 1);
    shaft(f, c, 29, 35, 0);
    hood(f, c - 1, 29, 3, 8);
    course(f, c - 2, c + 2, 40);
    archway(f, c - 1, 42, 3, 10);
    shape(f, c - 1, 42, 3, 10, "iron_bars", 1);
    shaft(f, c, 42, 50, 0);
    hood(f, c - 1, 42, 3, 10, true);
    course(f, c - 2, c + 2, 55);
  }
  ring(19, 56, 46, 27, 54, "deepslate_brick_stairs", BASE, ",half=top");
  stone(19, 57, 46, 27, 57, 54);
  F(19, 58, 46, 27, 58, 54, "polished_blackstone_brick_wall", "walls");
  for (const [x, z] of [[19, 46], [27, 46], [19, 54], [27, 54]]) {
    S(x, 58, z, CARVED);
    for (let y = 59; y <= 66; y++) S(x, y, z, post(x, y, z));
    F(x, 67, z, x, 69, z, SPIKE);
  }
  for (const [x, z] of [[23, 46], [23, 54], [19, 50], [27, 50]]) pinnacle(x, 58, z, 3, false);
  spire(23, 50, 58, 90, 3.4);
});
""",
    ),
    (
        "Crossing spire and lanterns",
        "A slender openwork stone flèche rises over the crossing among its own pinnacles, and lanterns hang in the porches.",
        HELPERS
        + """
stone(31, 37, 29, 33, 39, 31);
for (let y = 40; y <= 46; y++) {
  for (const [x, z] of [[31, 29], [33, 29], [31, 31], [33, 31]]) set(x, y, z, post(x, y, z));
  for (const [x, z] of [[32, 29], [32, 31], [31, 30], [33, 30]]) set(x, y, z, y < 45 ? "iron_bars" : BASE);
}
set(32, 44, 30, LIGHT);
ring(31, 47, 29, 33, 31, "deepslate_brick_stairs", CARVED);
for (let y = 47; y <= 62; y++) set(32, y, 30, y % 3 ? post(32, y, 30) : CARVED);
for (const y of [50, 54, 58])
  for (const [dx, dz, facing] of [[-1, 0, "east"], [1, 0, "west"], [0, -1, "south"], [0, 1, "north"]])
    set(32 + dx, y, 30 + dz, stair(32 + dx, y, 30 + dz, facing));
fill(32, 63, 30, 32, 66, 30, SPIKE);
for (const [x, z] of [[31, 29], [33, 29], [31, 31], [33, 31]]) fill(x, 48, z, x, 49, z, SPIKE);
set(32, 9, 54, "iron_chain");
set(32, 8, 54, "lantern");
both(() => {
  for (const x of [21, 25]) { F(x, 10, 54, x, 13, 54, "iron_chain"); S(x, 9, 54, "lantern"); }
  S(13, 8, 30, "iron_chain");
  S(13, 7, 30, "lantern");
});
""",
    ),
]

SHOWCASE = Showcase(
    key="gothic-cathedral",
    name="Gothic Cathedral",
    label="Showcase: gothic cathedral",
    intro=(
        "Scripted showcase: a dark gothic cathedral with flying buttresses, rose windows, gargoyles and "
        "two openwork stone spires, built one step at a time."
    ),
    steps=STEPS,
    ground=False,
    height=96,
)
