"""Bag End, Under the Hill: Bilbo's round green door dug into a grassy hill, a great gnarled oak on top."""

import math
import random


# ---------------------------------------------------------------- tools
def noise(x, z, grain, seed=0):
    """Smooth value noise in -1..1 with bumps about `grain` blocks wide."""
    x, z = x / grain + seed * 17.3, z / grain + seed * 5.1
    i, j = math.floor(x), math.floor(z)
    u, v = (x - i) ** 2 * (3 - 2 * (x - i)), (z - j) ** 2 * (3 - 2 * (z - j))

    def h(a, b):
        return math.sin(a * 127.1 + b * 311.7) * 43758.5453 % 1 * 2 - 1

    back = h(i, j) + (h(i + 1, j) - h(i, j)) * u
    front = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * u
    return back + (front - back) * v


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def pick(options, t):
    """Pick from a light-to-dark list by t in 0..1."""
    return options[max(0, min(len(options) - 1, int(t * len(options))))]


# ---------------------------------------------------------------- the world as functions
CX = 64  # centre line of Bag End
FZ = 66  # plane of the facade (plaster face)
G = 10  # garden floor (top block); the facade stands from G+1
GARDEN_DEPTH = 15  # garden runs from FZ to FZ+GARDEN_DEPTH
ISLE = (64, 63, 60, 54)  # centre x, z and radii of the Shire's oval coast


WL, WR = 22, 20  # garden half widths west and east of the door at the facade
FACADE_TOP = G + 14


def garden_w(x, z, n=None):
    """Half width of a garden notch at row z on the side of x (opens toward the lane)."""
    n = n or NOTCHES[0]
    return (n["wl"] if x < n["cx"] else n["wr"]) + 0.45 * max(0, z - n["fz"])


def lane_z(x):
    return 97 + 3.0 * math.sin(x / 17.0) + 1.5 * math.sin(x / 7.3 + 1)


def rolling(x, z):
    """Gentle swells over the valley floor, lowest along the lane."""
    dl = abs(z - lane_z(x))
    return 8 + 0.05 * min(dl, 30) + 1.4 * noise(x, z, 34, 1) + 0.5 * noise(x, z, 14, 2)


def base(x, z):
    """The valley floor with the lane sunk into it."""
    return rolling(x, z) - 1.3 * smooth((3.5 - abs(z - lane_z(x))) / 1.5)


U = (64, 80, 46, 22, 36, 24, 16)  # centre x, z; radius x, back radius z, arm length; height at the back, on the arms
SUMMIT = (61, 55, 26, 16, 5)  # a low swell under the oak: x, z, rx, rz, height
MOUNDS = [
    (24, 78, 13, 11, 9),
    (104, 80, 13, 11, 9),
]  # the lesser hills of Bagshot Row on the arms: x, z, rx, rz, height


def dome(x, z, hx, hz, rx, rz, peak):
    d = min(1.0, math.hypot((x - hx) / rx, (z - hz) / rz) + 0.03 * noise(x, z, 15, 4))
    return peak * (math.cos(math.pi * d) + 1) / 2, d


def horseshoe(x, z):
    """Hills in a U: rising from the valley to a crest behind Bag End, arms running forward and sinking away."""
    ux, uz, rx, rzb, arm, back, side = U
    dx, dz = (x - ux) / rx, z - uz
    if dz < 0:
        r = math.hypot(dx, dz / rzb)
        peak = side + (back - side) * smooth(-dz / rzb)
    else:
        r = abs(dx)
        peak = side * (1 - smooth(dz / arm))
    rise = smooth((r - 0.35) / 0.65) if r < 1 else 1 - 0.6 * smooth((r - 1) / 2.5)
    return peak * rise


def hill(x, z):
    h = horseshoe(x, z) + dome(x, z, *SUMMIT)[0]
    for m in MOUNDS:
        h += dome(x, z, *m)[0]
    return h + 0.5 * noise(x, z, 9, 5) * min(1, h / 6)


def shore(x, z):
    """Blocks inland from the coast, negative past it: a smooth oval."""
    cx, cz, rx, rz = ISLE
    a = math.atan2(z - cz, x - cx)
    k = 1 + 0.025 * math.sin(3 * a + 1.3) + 0.02 * noise(40 * math.cos(a), 40 * math.sin(a), 9, 90)
    return (k - math.hypot((x - cx) / rx, (z - cz) / rz)) * min(rx, rz)


def uncut(x, z):
    """Everything eases down to a low rim at the coast."""
    e = shore(x, z)
    rim = 3.5 + 1.5 * noise(x, z, 9, 95)
    return rim + (base(x, z) - rim) * smooth(e / 16) + hill(x, z) * smooth(e / 14) - 1.5 * (1 - smooth(e / 4))


def notch(cx, fz, wl, wr, depth, height, g=None, gate=None):
    """A garden dug into a hillside: floor g, facade plane fz, a solid wall zone `height` tall behind it."""
    g = g if g is not None else round(base(cx, fz + depth)) + 1
    gate = cx if gate is None else gate
    return {"cx": cx, "fz": fz, "wl": wl, "wr": wr, "depth": depth, "g": g, "top": g + height, "gate": gate}


NOTCHES = [notch(CX, FZ, WL, WR, GARDEN_DEPTH, 14, G, gate=CX - 2)]
HOLES = [
    (24, 84, 2.6, "red_concrete"),
    (104, 86, 2.6, "yellow_concrete"),
]  # lesser hobbit holes: x, facade z, door r, door
for hx, hz, hr, _ in HOLES:
    NOTCHES.append(notch(hx, hz, 8, 8, 7, 10))


def reach(n, x):
    """Garden depth at column x: its front edge wanders, level only at the gate."""
    return n["depth"] + round(3.2 * noise(x, n["fz"], 8, 23) * smooth((abs(x - n["gate"]) - 1.5) / 5))


def in_notch(n, x, z):
    return n["fz"] < z <= n["fz"] + reach(n, x) and abs(x - n["cx"]) <= garden_w(x, z, n)


def near_garden(x, z, pad=3):
    return any(
        n["fz"] - pad <= z <= n["fz"] + reach(n, x) + pad and abs(x - n["cx"]) <= garden_w(x, z, n) + pad
        for n in NOTCHES
    )


def in_garden(x, z):
    return in_notch(NOTCHES[0], x, z)


def land(x, z):
    """The hill cut by each garden notch: its facade wall zone stays solid to the notch top, then banks back."""
    h = uncut(x, z)
    for n in NOTCHES:
        dx_out = max(0, abs(x - n["cx"]) - garden_w(x, z, n))
        dzb = max(0, n["fz"] + 1 - z)
        dz_front = max(0, z - n["fz"] - reach(n, x))
        outside = n["g"] + math.hypot(1.25 * dx_out, 5 * dzb, 1.4 * dz_front) + 0.8 * noise(x, z, 6, 6)
        cut = outside
        if dzb >= 1:
            inside = n["top"] + 1 + 2.5 * (dzb - 1)
            cut = max(outside, outside + (inside - outside) * smooth(1 - dx_out / 4))
        h = min(h, cut)
        if in_notch(n, x, z):
            h = n["g"]
    return max(1, round(h))


H = {(x, z): land(x, z) if shore(x, z) > 0 else 0 for x in range(128) for z in range(128)}
H0 = {(x, z): round(uncut(x, z)) for x in range(128) for z in range(128)}


def slope(x, z):
    around = [H.get((x + dx, z + dz), 0) for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1))]
    return max((abs(H[x, z] - h) for h in around if h), default=0)


def lane_dist(x, z):
    return abs(z - lane_z(x))


# The land as a height field: a horseshoe of smooth hills around an oval valley, its crest behind Bag End under a low
# swell for the oak, its arms running forward to hold the lesser holes of Bagshot Row, a garden notch dug into the
# slope for each hole, a sunken lane across the valley, all inside an oval coast the land eases down to.
step("The Hill and the Shire")
for (x, z), h in H.items():
    if not h:
        continue
    s = slope(x, z)
    fill(x, 0, z, x, max(0, h - 4 - s), z, "stone")
    fill(x, max(0, h - 3 - s), z, x, h - 1, z, "dirt")
    if lane_dist(x, z) < 2.2 + 0.6 * noise(x, z, 5, 9):
        set(x, h, z, "60%dirt_path,25%coarse_dirt,15%gravel")
    elif s >= 3 and noise(x, z, 5, 10) > 0.55:
        set(x, h, z, "60%coarse_dirt,40%dirt")
    elif s >= 2 or (s and hill(x, z) > 0.9):
        fill(x, max(0, h - s + 1), z, x, h, z, "moss_block")
    else:
        set(x, h, z, "grass_block")


# ---------------------------------------------------------------- facade parts
def disc(cx, cy, z, r0, r1, block, keep=lambda dx, dy: True):
    """Cells of the ring r0 < d <= r1 in the upright plane z around (cx, cy)."""
    n = int(r1) + 1
    for dx in range(-n, n + 1):
        for dy in range(-n, n + 1):
            d = math.hypot(dx, dy)
            if r0 < d <= r1 and keep(dx, dy):
                set(cx + dx, cy + dy, z, block if isinstance(block, str) else block(dx, dy))


BEAM = "dark_oak_log[axis=x]"
LEAVES = ["dark_oak_leaves", "oak_leaves", "oak_leaves", "azalea_leaves", "flowering_azalea_leaves"]


def arc(F, x):
    """Height of a facade's canopy lower edge over column x (fractional); sections: x0, x1, y0, y1, bulge, set back."""
    for x0, x1, y0, y1, bulge, _ in F["sections"]:
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0)
            return y0 + (y1 - y0) * t + bulge * 4 * t * (1 - t)
    return None


def face_z(F, x):
    """Plane of the plaster over column x: a section may cave back into the hill; a shared post stands on the front."""
    return F["fz"] - min(s[5] for s in F["sections"] if s[0] <= x <= s[1])


def shrub(cx, cz, g, r, h, seed):
    """A big bush heaped up from floor g: a lumpy dome of leaves, grown only into air."""
    n = int(r) + 1
    for dx in range(-n, n + 1):
        for dz in range(-n, n + 1):
            d = math.hypot(dx, dz) / r
            if d > 1:
                continue
            top = g + round(h * math.sqrt(1 - d * d) + 1.2 * noise(cx + dx, cz + dz, 2, seed))
            for y in range(g + 1, top + 1):
                if get(cx + dx, y, cz + dz) in ("air", "short_grass", "fern"):
                    t = (y - g) / (h + 1) + 0.35 * noise(cx + dx * 3, y * 3 + dz, 2, seed + 1)
                    set(cx + dx, y, cz + dz, pick(LEAVES, t))


def climber(F, x, y0, y1, seed):
    """Ivy up a post from y0 to y1 on the plaster either side: a ragged strip, thinning as it climbs."""
    z = face_z(F, x) + 1
    for y in range(y0, y1 + 1):
        w = 1.4 * (noise(x, y, 3, seed) + 1) / 2 + 0.6 * (1 - (y - y0) / max(1, y1 - y0))
        for dx in range(-1, 2):
            hugs = arc(F, x + dx) is None or face_z(F, x + dx) + 1 == z
            if hugs and abs(dx) <= w and noise(x + dx, y, 1.5, seed + 3) > 0 and get(x + dx, y, z) == "air":
                set(x + dx, y, z, pick(LEAVES, 0.3 + 0.5 * noise(x + dx, y * 2, 2, seed + 1)))


def plaster(x, y, g):
    t = (y - g) / 12 + 0.25 * noise(x, y * 3, 3, 11)
    return pick(["sandstone", "smooth_sandstone", "smooth_sandstone", "smooth_sandstone", "cut_sandstone"], t)


def brick(dx, dy):
    return "granite" if noise(dx * 3, dy * 3, 2, 12) > 0.55 else "bricks"


def fieldstone(dx, dy):
    return pick(["andesite", "stone", "cobblestone", "tuff"], (noise(dx * 3, dy * 3, 2, 15) + 1) / 2)


def canopy(F, x):
    """One column of an eyebrow canopy: fascia beam, planked soffit, sod banked back into the hill, and a shaggy turf
    lip spilling over the beam, held up on rafter ends, leaves dripping from it. Over a caved-back bay the soffit runs
    deeper, so the beam stays on the front line as a porch."""
    fz = F["fz"]
    yf = arc(F, x)
    yi = int(yf)
    half = yf - yi >= 0.5
    soffit = "spruce_slab[type=top]" if half else "spruce_planks"
    for z in range(face_z(F, x) + 1, fz + 3):
        set(x, yi, z, soffit)
    set(x, yi, fz + 3, "dark_oak_slab[type=top]" if half else BEAM)
    if not half:
        set(x, yi - 1, fz + 3, "spruce_stairs[half=top,facing=north]")
    for z, lift in ((fz + 3, 1), (fz + 2, 1), (fz + 1, 2), (fz, 3)):
        top = yi + lift if z > fz else max(H[x, z], yi + lift)
        if top > yi + 1:
            fill(x, yi + 1, z, x, top - 1, z, "dirt")
        set(x, top, z, "grass_block")
    n = noise(x, fz, 3, 16)
    set(x, yi + 1, fz + 4, "grass_block")
    if n > 0.2:
        set(x, yi + 1, fz + 5, pick(LEAVES, 0.4 + 0.4 * n))
    if n > 0.3:
        set(x, yi + 2, fz + 4, "flowering_azalea_leaves" if n > 0.5 else "azalea_leaves")
    if x % 3 == 0 and not half:
        set(x, yi, fz + 4, "spruce_stairs[half=top,facing=north]")
    elif noise(x, fz, 2, 17) > -0.1:
        drip = 1 + (noise(x, fz, 2, 18) > 0.35)
        fill(x, yi + 1 - drip, fz + 4, x, yi, fz + 4, pick(LEAVES, 0.2 + 0.4 * (n + 1) / 2))


def mossify(x0, y0, z0, x1, y1, z1):
    """Turn dirt and grass faces that look out into the air into moss, so banks read green from the side."""
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            for y in range(y0, y1 + 1):
                if get(x, y, z) in ("dirt", "grass_block") and any(
                    get(x + dx, y, z + dz) == "air" for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1))
                ):
                    set(x, y, z, "moss_block")


def post(F, x):
    """A dark oak post, knee braces either side curving into the soffit so each bay reads as an arch."""
    fz, g = face_z(F, x), F["g"]
    top = int(arc(F, x))
    set(x, g + 1, fz + 1, "cobblestone")
    fill(x, g + 2, fz + 1, x, top - 1, fz + 1, "dark_oak_log")
    set(x, top - 1, fz + 2, "dark_oak_stairs[half=top,facing=north]")
    for side, facing in ((-1, "east"), (1, "west")):
        xs = x + side
        if arc(F, xs) is None:
            continue
        ys = int(arc(F, xs))
        set(xs, ys - 1, fz + 1, f"dark_oak_stairs[half=top,facing={facing}]")
        if arc(F, xs + side) is not None:
            set(xs + side, int(arc(F, xs + side)) - 1, fz + 1, "dark_oak_slab[type=top]")


def round_window(F, cx, cy, r):
    fz = face_z(F, cx)
    disc(cx, cy, fz - 2, -1, r, "light_gray_stained_glass_pane")
    disc(cx, cy, fz - 3, -1, r, "bookshelf")
    set(cx, cy, fz - 3, "shroomlight")
    disc(cx, cy, fz, -1, r, "air")
    disc(cx, cy, fz - 1, -1, r, "air")
    disc(cx, cy, fz - 1, r, r + 1.0, F["frame"])
    disc(cx, cy, fz, r, r + 1.0, F["frame"])
    disc(cx, cy, fz, r + 1.0, r + 2.0, F["ring"], lambda dx, dy: dy >= -1)
    w = int(r)
    fill(cx - w, cy - w - 2, fz + 1, cx + w, cy - w - 2, fz + 1, "spruce_slab[type=top]")


def round_door(F):
    """A round door sunk two deep in a brick-lined reveal, its frame and brick ring on the face."""
    cx, cy, r, paint, edge = F["door"]
    fz, g = face_z(F, cx), F["g"]
    disc(cx, cy, fz, -1, r, "air")
    disc(cx, cy, fz - 1, -1, r, "air")
    disc(cx, cy, fz - 1, r, r + 1.1, F["ring"], lambda dx, dy: cy + dy > g)
    disc(cx, cy, fz - 2, -1, r, lambda dx, dy: edge if math.hypot(dx, dy) > r - 1 else paint)
    set(cx, cy, fz - 2, "gold_block")
    for dx in range(-int(r) + 1, int(r)):
        set(cx + dx, cy - int(r) - 1, fz - 1, "polished_andesite_slab[type=top]")
    disc(cx, cy, fz, r, r + 1.1, lambda dx, dy: f"stripped_spruce_log[axis={'y' if abs(dx) > abs(dy) else 'x'}]")
    disc(cx, cy, fz, r + 1.1, r + 2.5, F["ring"], lambda dx, dy: cy + dy > g)
    set(cx, cy + int(r + 1.8), fz, "chiseled_stone_bricks")
    w = int(r)
    for dx in range(-w, w + 1):
        for dz in (1, 2):
            if math.hypot(dx / (r + 0.2), dz / 2.4) <= 1:
                set(cx + dx, g + 1, fz + dz - 1 if dz == 1 else fz + 1, "polished_andesite_slab[type=bottom]")


def facade(F):
    """A hobbit-hole front dug into the hill: plaster between arched posts, bays caved back, eyebrow canopies under a
    turf lip, a round door and windows in deep reveals, big bushes heaped at the ends and ivy up the posts."""
    g, front, door_x, door_r = F["g"], F["fz"], F["door"][0], F["door"][2]
    x_lo, x_hi = F["sections"][0][0], F["sections"][-1][1]
    for x in range(x_lo, x_hi + 1):
        fz, top = face_z(F, x), int(arc(F, x))
        if fz < front:
            fill(x, g + 1, fz + 1, x, top - 1, front, "air")
            for z in range(fz + 1, front + 1):
                set(x, g, z, "polished_andesite" if abs(x - door_x) <= 2 else "grass_block")
        fill(x, g + 1, fz - 2, x, top + 1, fz - 1, "dirt")
        for y in range(g + 1, top):
            set(x, y, fz, plaster(x, y, g))
        set(x, g + 1, fz, "cobblestone" if noise(x, 0, 3, 13) > -0.2 else "mossy_cobblestone")
        for nx in (x - 1, x + 1):
            if arc(F, nx) is not None and face_z(F, nx) < fz:
                for z in range(face_z(F, nx) + 1, fz):
                    fill(x, g + 1, z, x, top - 1, z, "cobblestone")
                    for y in range(g + 2, top):
                        set(x, y, z, plaster(x, y, g))
    for x in range(x_lo, x_hi + 1):
        canopy(F, x)
    posts = sorted({s[0] for s in F["sections"]} | {s[1] for s in F["sections"]})
    for x in posts:
        post(F, x)
    round_door(F)
    for w in F["windows"]:
        round_window(F, *w)
    for x in posts:
        fz, top = face_z(F, x), int(arc(F, x))
        if abs(x - door_x) < door_r + 4:
            continue
        if x in (x_lo, x_hi):
            side = -1 if x == x_lo else 1
            shrub(x + 2 * side, fz + 2, g, 3.4, top - g - 3, x)
            shrub(x - 3 * side, fz + 2, g, 2.2, 2, x + 1)
        climber(F, x, g + 1, top - 1, x + 2)
    mossify(x_lo - 6, g + 5, front - 8, x_hi + 6, F["sections"][0][2] + 12, front + 5)


BAG_END = {
    "fz": FZ,
    "g": G,
    "ring": brick,
    "frame": "green_terracotta",
    "sections": [(CX - WL, 55, 18, 21, 1.6, 0), (55, 73, 21, 21, 4.3, 2), (73, CX + WR, 21, 18, 1.4, 0)],
    "door": (CX, 16, 4.3, "green_concrete", "green_terracotta"),
    "windows": [(49, 16, 2.6), (79, 16, 2.6)],
}

# Bag End's front: plaster between arched dark oak posts, the door bay caved back into the hill, eyebrow canopies whose
# turf spills over the edge onto rafter ends, the round green door sunk in its brick reveal, round windows glowing in
# a brick ring, and big bushes and ivy climbing the ends.
step("Bag End's facade")
facade(BAG_END)
for lx in (CX - 7, CX + 7):
    ly = int(arc(BAG_END, lx))
    set(lx, ly - 1, face_z(BAG_END, lx) + 2, "iron_chain")
    set(lx, ly - 2, face_z(BAG_END, lx) + 2, "lantern")


def little_hole(n, door_r, paint, window_side):
    """A lesser hobbit hole of Bagshot Row, built from the same parts as Bag End."""
    cx, fz, g = n["cx"], n["fz"], n["g"]
    w = n["wl"]
    cy = g + 1 + int(door_r + 1.0)
    peak = cy + int(door_r + 2.5) + 2
    F = {
        "fz": fz,
        "g": g,
        "ring": fieldstone if paint.startswith("red") else brick,
        "frame": "spruce_planks",
        "sections": [(cx - w, cx + w, peak - 3, peak - 3, 3.4, 0)],
        "door": (cx, cy, door_r, paint, paint.replace("concrete", "terracotta")),
        "windows": [(cx + window_side * 5, cy + 1, 1.5)],
    }
    facade(F)
    return F


# ---------------------------------------------------------------- the great oak
def bezier(p0, p1, p2, t):
    return tuple((1 - t) ** 2 * a + 2 * (1 - t) * t * b + t * t * c for a, b, c in zip(p0, p1, p2))


def log_axis(d):
    ax = max(range(3), key=lambda i: abs(d[i]))
    return "xyz"[ax]


def ball(p, r, block, only_air=True, squash=1.0):
    x0, y0, z0 = (round(c) for c in p)
    n = int(r) + 1
    for dx in range(-n, n + 1):
        for dy in range(-n, n + 1):
            for dz in range(-n, n + 1):
                if dx * dx + (dy / squash) ** 2 + dz * dz <= r * r:
                    x, y, z = x0 + dx, y0 + dy, z0 + dz
                    if (
                        0 <= x < 128
                        and 0 <= z < 128
                        and 0 <= y < 100
                        and (not only_air or get(x, y, z) in ("air", "short_grass"))
                    ):
                        set(x, y, z, block if isinstance(block, str) else block(dx, dy / squash, dz, r))


BARK = "dark_oak_log"


def limb(p0, p1, p2, r0, r1, bark=BARK):
    n = max(2, int(math.dist(p0, p2) * 2.2))
    for i in range(n + 1):
        t = i / n
        a, b = bezier(p0, p1, p2, max(0, t - 0.05)), bezier(p0, p1, p2, min(1, t + 0.05))
        axis = log_axis([b[k] - a[k] for k in range(3)])
        ball(bezier(p0, p1, p2, t), r0 + (r1 - r0) * t, f"{bark}[axis={axis}]", only_air=False)


def leaf(dx, dy, dz, r):
    """Leaf colour by height inside the clump: dark underneath, bright on top."""
    t = (dy / max(r, 1) + 1) / 2 + 0.25 * noise(dx * 2 + dz, dz * 2 - dy, 2.5, 14)
    return pick(["dark_oak_leaves", "oak_leaves", "oak_leaves", "oak_leaves", "azalea_leaves"], t)


def clump(p, r):
    """A lumpy leaf cloud: a few squashed balls around p."""
    ball(p, r, leaf, squash=0.7)
    for _ in range(3):
        q = (
            p[0] + random.uniform(-r, r) * 0.7,
            p[1] + random.uniform(-0.3, 0.6) * r,
            p[2] + random.uniform(-r, r) * 0.7,
        )
        ball(q, r * random.uniform(0.55, 0.8), leaf, squash=0.75)


def direction(az, elev):
    a, e = math.radians(az), math.radians(elev)
    return (math.cos(e) * math.cos(a), math.sin(e), math.cos(e) * math.sin(a))


def sweep(p, q, r0, r1, out=0.55, sag=0.25):
    """A limb from p to q that leaves p fairly flat and curls up toward q, like an oak bough."""
    mid = (
        p[0] + (q[0] - p[0]) * out + random.uniform(-1.5, 1.5),
        p[1] + (q[1] - p[1]) * sag,
        p[2] + (q[2] - p[2]) * out + random.uniform(-1.5, 1.5),
    )
    limb(p, mid, q, r0, r1)


def oak(tx, tz, rx=30, ry=17):
    base = H[tx, tz]
    fork = (tx + 1, base + 7, tz - 1)
    cy = base + 30  # centre of the crown's ellipsoid envelope
    # root flare running down into the hill
    for i in range(8):
        az = i * 45 + random.uniform(-15, 15)
        d = direction(az, 0)
        L = random.uniform(5, 9)
        ex, ez = round(tx + d[0] * L), round(tz + d[2] * L)
        while H[ex, ez] < base - 4 and L > 3.5:  # stop short of the steep bank over the facade
            L -= 1
            ex, ez = round(tx + d[0] * L), round(tz + d[2] * L)
        mx, mz = round(tx + d[0] * L * 0.55), round(tz + d[2] * L * 0.55)
        limb(
            (tx + d[0] * 1.5, base + 2.5, tz + d[2] * 1.5),
            (mx, min(base + 1.2, H[mx, mz] + 0.2), mz),
            (ex, H[ex, ez] - 0.5, ez),
            1.8,
            0.6,
        )
    # the trunk, flared at the foot
    limb((tx, base - 2, tz), (tx, base + 5, tz), fork, 3.6, 2.8)
    ball((tx, base + 0.5, tz), 4.2, f"{BARK}[axis=y]", only_air=False, squash=0.6)
    clumps = []
    n_limbs = 7
    for i in range(n_limbs):
        phi = 360 * i / n_limbs + random.uniform(-15, 15)
        a = math.radians(phi)
        reach = random.uniform(0.48, 0.62) * rx
        m = (tx + reach * math.cos(a), base + random.uniform(14, 19), tz + reach * math.sin(a))
        start = (fork[0], fork[1] - random.uniform(0, 3), fork[2])
        sweep(start, m, 1.9, 1.1, out=0.6, sag=0.15)  # bare, near-level boughs under the crown
        for j in range(random.choice((2, 3))):
            sphi = math.radians(phi + random.uniform(-28, 28))
            theta = math.radians(random.uniform(40, 100))  # from the crown's top
            k = random.uniform(0.55, 0.7)
            sp = (
                tx + k * rx * math.sin(theta) * math.cos(sphi),
                cy + k * ry * math.cos(theta),
                tz + k * rx * math.sin(theta) * math.sin(sphi),
            )
            sweep(m, sp, 1.1, 0.7, out=0.5, sag=0.35)
            clumps.append((sp, 4.2))
            for _ in range(random.choice((2, 3))):
                tphi = math.radians(math.degrees(sphi) + random.uniform(-22, 22))
                tth = max(5, min(118, math.degrees(theta) + random.uniform(-30, 28)))
                tth = math.radians(tth)
                kk = random.uniform(0.82, 0.97)
                tp = (
                    tx + kk * rx * math.sin(tth) * math.cos(tphi),
                    cy + kk * ry * math.cos(tth),
                    tz + kk * rx * math.sin(tth) * math.sin(tphi),
                )
                sweep(sp, tp, 0.9, 0.5, out=0.5, sag=0.4)
                clumps.append((tp, random.uniform(4.5, 5.8)))
    # a leader up the middle to fill the dome's crown
    top = (tx + random.uniform(-3, 3), cy + ry * 0.7, tz + random.uniform(-3, 3))
    sweep(fork, top, 1.6, 0.7, out=0.3, sag=0.6)
    clumps.append((top, 6.0))
    clumps.append(((tx, cy + ry * 0.35, tz), 7.0))
    for p, r in clumps:
        clump(p, r)
    return clumps


# The great oak on the crown of the Hill: a thick trunk splits into boughs that leave it flat and curl upward, under
# lumpy clouds of leaves darker underneath.
step("The great oak")
TREE = (60, 57)
oak(*TREE)


# ---------------------------------------------------------------- garden parts
GATE_Z = FZ + GARDEN_DEPTH
TRAIL = [(84, 96), (88, 88), (92, 79), (93, 70), (89, 61), (82, 54), (75, 51), (70, 52)]
PATH = [
    (CX, FZ + 2),
    (CX - 1, FZ + 7),
    (CX - 2, GATE_Z),
    (CX + 1, GATE_Z + 4),
    (CX - 3, GATE_Z + 8),
    (CX - 7, GATE_Z + 12),
    (CX - 6, 97),
]
FLOWERS = [
    "poppy",
    "cornflower",
    "oxeye_daisy",
    "allium",
    "red_tulip",
    "orange_tulip",
    "pink_tulip",
    "white_tulip",
    "azure_bluet",
    "dandelion",
]


def seg_dist(px, pz, a, b):
    ax, az = a
    bx, bz = b
    L2 = (bx - ax) ** 2 + (bz - az) ** 2
    t = max(0, min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / L2))
    return math.hypot(px - ax - t * (bx - ax), pz - az - t * (bz - az)), t


def poly_dist(pts, x, z):
    return min(seg_dist(x, z, pts[i], pts[i + 1])[0] for i in range(len(pts) - 1))


def edge_z(n, x):
    """Last garden row of notch n at column x, or None."""
    zs = [z for z in range(n["fz"] + 1, n["fz"] + n["depth"] + 4) if in_notch(n, x, z)]
    return max(zs) if zs else None


def flower_bed(x0, x1, z0, z1, g, seed):
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            if get(x, g + 1, z) != "air" or get(x, g, z) not in ("grass_block", "moss_block"):
                continue
            set(x, g, z, "podzol" if noise(x, z, 3, seed) > 0 else "grass_block")
            k = noise(x, z, 2.5, seed + 1)
            if k > 0.35:
                set(x, g + 1, z, "flowering_azalea_leaves" if noise(x, z, 4, seed + 2) > 0 else "azalea_leaves")
            elif random.random() < 0.8:
                set(x, g + 1, z, FLOWERS[int((noise(x, z, 3, seed + 3) + 1) * 5) % len(FLOWERS)])


def garden_front(n, gate_x, hedge_west=True, hedge_east=False):
    """The lane-side edge of a garden: a stone retaining wall where it stands proud, hedge or picket fence on top."""
    g = n["g"]
    for x in range(n["cx"] - 40, n["cx"] + 41):
        if not 0 <= x < 128:
            continue
        ez = edge_z(n, x)
        if ez is None or ez + 2 >= 128:
            continue
        low = min(H[x, ez + 1], H[x, ez + 2])
        if low < g:
            for y in range(low, g + 1):
                set(x, y, ez, "mossy_stone_bricks" if noise(x, y, 3, 20) > 0.1 else "stone_bricks")
            set(x, g, ez, "stone_brick_slab[type=top]" if x % 7 else "chiseled_stone_bricks")
        if abs(x - gate_x) <= 1:
            continue
        if (x < gate_x and hedge_west) or (x > gate_x and hedge_east):
            tall = 1 + (noise(x, 0, 4, 21) > -0.3) + (noise(x, 0, 9, 25) > 0.45)
            for y in range(g + 1, g + 1 + tall):
                set(x, y, ez - 1, pick(LEAVES, (y - g - 1) / 3 + 0.3 * noise(x, y, 3, 26)))
            if noise(x, 0, 5, 27) > 0.1:
                set(x, g + 1, ez - 2, pick(LEAVES, 0.2 + 0.4 * noise(x, 1, 3, 28)))
        elif noise(x, 0, 3, 24) < 0.5:
            post = noise(x, 0, 2, 29) > 0.45
            fill(
                x, g + 1, ez - 1, x, g + 1 + post, ez - 1, "spruce_fence" if noise(x, 0, 7, 30) > -0.4 else "oak_fence"
            )
            if noise(x, 0, 4, 31) > 0.35:
                set(x, g + 2 + post, ez - 1, pick(LEAVES, 0.5 + 0.3 * noise(x, 2, 3, 32)))
    gz = n["fz"] + n["depth"] - 1
    for gx in (gate_x - 2, gate_x + 2):
        fill(gx, g + 1, gz, gx, g + 2, gz, "spruce_log")
        set(gx, g + 3, gz, "lantern")


def lay_path(pts, n, width=1.6):
    """Gravel and flags from the door through the gate, then stone stairs down to the lane."""
    g, gate_z = n["g"], n["fz"] + n["depth"]
    top_y = {}
    for x in range(min(p[0] for p in pts) - 3, max(p[0] for p in pts) + 4):
        for z in range(n["fz"] + 1, min(127, max(p[1] for p in pts) + 2)):
            if not H[x, z] or poly_dist(pts, x, z) > width + 0.4 * noise(x, z, 3, 22):
                continue
            if z <= gate_z - 1:
                y = g
            else:
                y = max(H[x, z] - 1, round(g - (z - gate_z + 1) * 0.7)) if z < gate_z + 6 else H[x, z] - 1
            top_y[x, z] = y
    for (x, z), y in top_y.items():
        fill(x, y + 1, z, x, y + 3, z, "air")
        fill(x, max(0, y - 2), z, x, y, z, "dirt")
        ahead = top_y.get((x, z - 1))
        if z <= n["fz"] + 4:
            set(x, y, z, "polished_andesite" if (x + z) % 3 else "andesite")
        elif ahead is not None and ahead > y:
            set(x, y + 1, z, "stone_brick_stairs[facing=north]")
            set(x, y, z, "stone_bricks")
        else:
            set(
                x, y, z, "45%gravel,30%dirt_path,25%coarse_dirt" if z > gate_z else "50%dirt_path,30%gravel,20%andesite"
            )


# The front garden: flower beds under the windows, a bench, tubs by the door, a stone retaining wall with a hedge and
# a gate, and a gravel path stepping down to the lane.
step("Garden, gate and path")
BE = NOTCHES[0]
garden_front(BE, PATH[2][0])
lay_path(PATH, BE)
flower_bed(CX - WL + 1, CX - 6, FZ + 1, FZ + 2, G, 30)
flower_bed(CX + 6, CX + WR - 1, FZ + 1, FZ + 2, G, 31)
flower_bed(CX - WL + 2, CX - 10, GATE_Z - 3, GATE_Z - 2, G, 32)
# a bench under the west window, looking down the Hill
fill(47, G + 1, FZ + 1, 51, G + 1, FZ + 1, "spruce_stairs[facing=north]")
set(46, G + 1, FZ + 1, "spruce_trapdoor[open=true,facing=west]")
set(52, G + 1, FZ + 1, "spruce_trapdoor[open=true,facing=east]")
# tubs of azalea either side of the door, a log pile under the east window
for sx in (-6, 6):
    tz = face_z(BAG_END, CX + sx) + 1
    fill(CX + sx, G + 1, tz, CX + sx, G + 3, tz, "air")
    set(CX + sx, G + 1, tz, "barrel")
    set(CX + sx, G + 2, tz, "flowering_azalea_leaves" if sx < 0 else "azalea_leaves")
for x in range(77, 82):
    for y in range(G + 1, G + 3 + (1 if 78 <= x <= 80 else 0)):
        set(x, y, FZ + 1, "oak_log[axis=z]" if (x + y) % 3 else "birch_log[axis=z]")
    set(x, G + 3 + (1 if 78 <= x <= 80 else 0), FZ + 1, "spruce_slab[type=bottom]")


# Two lesser hobbit holes in the mounds, a red door and a yellow one, built from the same parts as Bag End, each with
# its own garden and path.
step("The lesser holes of Bagshot Row")
LITTLE = [little_hole(n, hr, paint, side) for n, (hx, hz, hr, paint), side in zip(NOTCHES[1:], HOLES, (1, -1))]
for n, side in zip(NOTCHES[1:], (1, -1)):
    cx, fz = n["cx"], n["fz"]
    pts = [(cx, fz + 2), (cx, fz + n["depth"]), (cx + side, round(lane_z(cx)))]
    garden_front(n, cx, hedge_west=side < 0, hedge_east=side > 0)
    lay_path(pts, n, 1.2)
    flower_bed(cx - n["wl"] + 1, cx - 4, fz + 1, fz + 2, n["g"], 40 + side)
    flower_bed(cx + 4, cx + n["wr"] - 1, fz + 1, fz + 2, n["g"], 42 + side)


# ---------------------------------------------------------------- the Shire around
def open_land(x, z):
    """Farmland: off the Hill and mounds, clear of the lane and every garden path."""
    h = H[x, z]
    return (
        hill(x, z) < 0.9
        and lane_dist(x, z) > 3.2
        and not near_garden(x, z, 5)
        and get(x, h, z) == "grass_block"
        and get(x, h + 1, z) == "air"
    )


def leaves_of(palette, seed=50):
    def f(dx, dy, dz, r):
        t = (dy / max(r, 1) + 1) / 2 + 0.25 * noise(dx * 2 + dz, dz * 2 - dy, 2.5, seed)
        return pick(palette, t)

    return f


TREE_KINDS = {
    "oak": ("oak_log", ["dark_oak_leaves", "oak_leaves", "oak_leaves", "azalea_leaves"]),
    "birch": ("birch_log", ["oak_leaves", "birch_leaves", "birch_leaves", "birch_leaves"]),
    "apple": ("oak_log", ["azalea_leaves", "flowering_azalea_leaves", "azalea_leaves", "flowering_azalea_leaves"]),
}


def small_tree(x, z, height, r, kind="oak"):
    """A field tree: a flared, leaning trunk forking into curved boughs, each under its own lumpy cloud, dark beneath."""
    bark, palette = TREE_KINDS[kind]
    fn = leaves_of(palette, 50 + len(kind))
    b = H[x, z]
    slim = kind == "birch"
    r0 = 0.5 if slim else 0.5 + 0.1 * height
    lean = random.uniform(0, math.tau)
    fork_y = b + height * random.uniform(0.45, 0.6)
    fork = (x + math.cos(lean) * height * 0.15, fork_y, z + math.sin(lean) * height * 0.15)
    limb((x, b - 1, z), (x, (b + fork_y) / 2, z), fork, r0, r0 * 0.7, bark)
    for i in range(0 if slim else 4):
        a = lean + i * math.pi / 2 + random.uniform(-0.5, 0.5)
        ex, ez = round(x + math.cos(a) * 2.6), round(z + math.sin(a) * 2.6)
        if H.get((ex, ez)):
            limb(
                (x, b + 1.2, z),
                (x + math.cos(a) * 1.6, b + 0.4, z + math.sin(a) * 1.6),
                (ex, H[ex, ez], ez),
                0.7,
                0.4,
                bark,
            )
    heads = [(fork[0], b + height + r * 0.2, fork[2])]
    boughs = 2 if slim else random.randint(3, 4)
    for i in range(boughs):
        a = lean + i * math.tau / boughs + random.uniform(-0.5, 0.5)
        reach_ = r * random.uniform(0.7, 1.05)
        tip = (fork[0] + math.cos(a) * reach_, b + height + random.uniform(-1.5, 1), fork[2] + math.sin(a) * reach_)
        mid = (
            fork[0] + math.cos(a) * reach_ * 0.6,
            fork_y + (tip[1] - fork_y) * 0.3,
            fork[2] + math.sin(a) * reach_ * 0.6,
        )
        limb(fork, mid, tip, max(0.5, r0 * 0.6), 0.45, bark)
        heads.append(tip)
    for p in heads:
        s = r * random.uniform(0.6, 0.8)
        ball(p, s, fn, squash=0.65)
        for _ in range(2):
            q = (
                p[0] + random.uniform(-s, s) * 0.8,
                p[1] + random.uniform(-0.4, 0.5) * s,
                p[2] + random.uniform(-s, s) * 0.8,
            )
            ball(q, s * random.uniform(0.5, 0.75), fn, squash=0.7)


def jittered(spacing, jitter):
    return [
        (gx + random.uniform(-jitter, jitter), gz + random.uniform(-jitter, jitter))
        for gx in range(-spacing // 2, 128 + spacing, spacing)
        for gz in range(-spacing // 2, 128 + spacing, spacing)
    ]


def field_of(x, z):
    """Nearest field seed (warped, so boundaries wander) and how far the cell is from the next field's edge."""
    wx, wz = x + 6 * noise(x, z, 15, 51), z + 6 * noise(x, z, 15, 52)
    d = sorted((math.hypot(wx - f[0], wz - f[1]), i) for i, f in enumerate(FIELDS))
    return d[0][1], d[1][0] - d[0][0]


def hedge(x, z, tall):
    h = H[x, z]
    for y in range(h + 1, h + 2 + tall):
        t = (y - h - 1) / 2 + 0.4 * noise(x, z * 2 + y, 3, 53)
        set(x, y, z, pick(["dark_oak_leaves", "oak_leaves", "oak_leaves", "azalea_leaves"], t))


def crop_row(x, z, f, kind, crop):
    """Fields in rows along the field's own direction: furrows of coarse dirt between the crop."""
    h = H[x, z]
    a = f[3]
    u = x * math.cos(a) + z * math.sin(a)
    furrow = math.floor(u) % 3 == 0
    if kind == "wheat":
        set(x, h, z, "coarse_dirt" if furrow else "dirt")
        if not furrow:
            set(x, h + 1, z, "hay_block")
    elif kind == "plough":
        set(x, h, z, "coarse_dirt" if furrow else ("podzol" if noise(x, z, 4, 54) > 0.3 else "dirt"))
    elif kind == "veg":
        set(x, h, z, "coarse_dirt" if furrow else "dirt")
        if not furrow and random.random() < (0.9 if crop in ("fern", "azalea_leaves") else 0.4):
            set(x, h + 1, z, crop)


def in_view(x, z):
    """In the wedge of land looking at a hobbit hole's door, kept clear of trees."""
    return any(
        abs(x - n["cx"]) < (n["wl"] + n["wr"]) / 2 + 3 + 0.35 * (z - n["fz"]) and z > n["fz"] - 4 for n in NOTCHES
    )


# Fields around the Hill in wandering patches of wheat, ploughland, vegetables, pasture and orchard, rows following
# each field's own direction, hedgerows and trees along their edges.
step("Fields and hedgerows of the Shire")
FIELD_KINDS = ["wheat", "wheat", "plough", "veg", "pasture", "pasture", "orchard"]
FIELDS = [
    (
        sx,
        sz,
        random.choice(FIELD_KINDS),
        random.uniform(0, math.pi),
        random.choice(["fern", "pumpkin", "melon", "azalea_leaves"]),
    )
    for sx, sz in jittered(26, 8)
]
hedge_cells = []
for x in range(128):
    for z in range(128):
        if not open_land(x, z):
            continue
        i, gap = field_of(x, z)
        f = FIELDS[i]
        lane_hedge = lane_dist(x, z) < 4.4 and noise(x, 0, 5, 55) > -0.55
        if gap < 1.25 or lane_hedge:
            hedge(x, z, 1 if noise(x, z, 6, 56) > 0.1 else 0)
            hedge_cells.append((x, z))
        elif gap > 2.4 and f[2] in ("wheat", "plough", "veg"):
            crop_row(x, z, f, f[2], f[4])
        elif f[2] == "orchard" and gap > 4:
            a = f[3]
            u, v = x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a)
            if round(u) % 7 == 0 and round(v) % 7 == 0 and not in_view(x, z):
                small_tree(x, z, random.randint(3, 4), random.uniform(2.2, 2.8), "apple")
        elif f[2] == "pasture" and gap > 4 and random.random() < 0.004:
            fill(x, H[x, z] + 1, z, x, H[x, z] + random.choice((1, 1, 2)), z, "hay_block")
# trees stand along the hedgerows, never too close together
trees = []
random.shuffle(hedge_cells)
for x, z in hedge_cells:
    if (
        3 <= x <= 124
        and 3 <= z <= 124
        and not in_view(x, z)
        and all(math.hypot(x - a, z - b) > 11 for a, b in trees)
        and random.random() < 0.08
    ):
        trees.append((x, z))
        small_tree(x, z, random.randint(6, 9), random.uniform(3.2, 4.4), random.choice(["oak", "oak", "birch"]))
    elif random.random() < 0.04 and not in_view(x, z):
        big_bush(x, z, random.uniform(2.0, 3.2))


# ---------------------------------------------------------------- growth on the Hill
BUSH = leaves_of(["dark_oak_leaves", "oak_leaves", "oak_leaves", "azalea_leaves", "flowering_azalea_leaves"], 70)


def bush(x, z, r):
    ball((x, H[x, z] + r * 0.35, z), r, BUSH, squash=0.65)


def big_bush(x, z, r):
    """A sprawling bush of a few overlapping lobes, heaped where they meet."""
    for _ in range(random.randint(3, 5)):
        px, pz = x + random.uniform(-r, r) * 0.7, z + random.uniform(-r, r) * 0.7
        cell = (round(px), round(pz))
        if H.get(cell):
            s = r * random.uniform(0.55, 0.85)
            ball((px, H[cell] + s * 0.45, pz), s, BUSH, squash=0.7)


def chimney(x, z, w, tall):
    """A brick chimney rising out of the turf: a cobble collar, a corbelled cornice and two pots."""
    cells = [(x + dx, z + dz) for dx in range(w) for dz in range(w)]
    top = max(H[c] for c in cells) + tall
    for dx in range(-1, w + 1):
        for dz in range(-1, w + 1):
            cx_, cz_ = x + dx, z + dz
            set(cx_, H[cx_, cz_], cz_, "mossy_cobblestone" if (dx + dz) % 2 else "cobblestone")
    for cx_, cz_ in cells:
        fill(cx_, H[cx_, cz_] - 3, cz_, cx_, top, cz_, "bricks" if noise(cx_, cz_, 2, 71) < 0.5 else "granite")
        set(cx_, top - 2, cz_, "stone_bricks")
    mx, mz = x + (w - 1) / 2, z + (w - 1) / 2
    for dx in range(-1, w + 1):
        for dz in range(-1, w + 1):
            if 0 <= dx < w and 0 <= dz < w:
                continue
            ox, oz = x + dx - mx, z + dz - mz
            face = ("east" if ox < 0 else "west") if abs(ox) >= abs(oz) else ("south" if oz < 0 else "north")
            set(x + dx, top, z + dz, f"stone_brick_stairs[half=top,facing={face}]")
    set(x, top + 1, z, "brick_wall")
    if w > 1:
        set(x + w - 1, top + 1, z + w - 1, "brick_wall")


def meadow(x, z):
    """Long grass, ferns and drifts of wildflowers: thick on the Hill, thinner on the flats and in the gardens."""
    h = H[x, z]
    if get(x, h, z) not in ("grass_block", "moss_block") or get(x, h + 1, z) != "air":
        return
    on_hill = hill(x, z) > 0.9
    garden = any(in_notch(n, x, z) for n in NOTCHES)
    density = (0.45 if on_hill else 0.22) + 0.3 * noise(x, z, 9, 60)
    if garden:
        density = 0.3
    if noise(x, z, 5, 62) > 0.5 and random.random() < 0.55:
        set(x, h + 1, z, FLOWERS[int((noise(x, z, 13, 63) + 1) * 7) % len(FLOWERS)])
    elif random.random() < density:
        set(x, h + 1, z, "fern" if on_hill and not garden and noise(x, z, 6, 61) > 0.25 else "short_grass")


# Brick chimneys rising out of the turf above each hole, bushes scattered over the Hill, and long grass, ferns and
# drifts of wildflowers.
step("Long grass, bushes and chimneys")
chimney(76, 60, 2, 4)
for n, side in zip(NOTCHES[1:], (1, -1)):
    chimney(n["cx"] - 5 * side, n["fz"] - 6, 2, 3)
placed = 0
for _ in range(1600):
    x, z = random.randint(2, 125), random.randint(2, 125)
    k = hill(x, z)
    if k < 1.0 or near_garden(x, z, 2) or poly_dist(TRAIL, x, z) < 3:
        continue
    if math.hypot(x - TREE[0], z - TREE[1]) < 8 or get(x, H[x, z], z) not in ("grass_block", "moss_block"):
        continue
    if random.random() < 0.3 * (1.2 - k / 40):
        if random.random() < 0.35:
            big_bush(x, z, random.uniform(2.4, 4.0))
        else:
            bush(x, z, random.uniform(1.3, 2.6))
        placed += 1
# bushes heaped along the banks either side of each garden
for n in NOTCHES:
    for side in (-1, 1):
        for i in range(4 if n is NOTCHES[0] else 2):
            x = n["cx"] + side * round(garden_w(n["cx"] + side, n["fz"] + 2 + i * 3, n) + random.uniform(2, 4))
            z = n["fz"] + 1 + i * 3 + random.randint(0, 2)
            if 0 <= x < 128 and H.get((x, z)):
                big_bush(x, z, random.uniform(2.2, 3.4))
    for cx_ in (n["cx"] - n["wl"] + 3, n["cx"] + n["wr"] - 3):
        ez = edge_z(n, cx_)
        if ez is not None:
            big_bush(cx_, ez - 3, random.uniform(2.0, 2.6))
# a few trees on the Hill's lower slopes and the mounds, clear of the doors, the trail and the oak
hill_trees = []
for _ in range(600):
    x, z = random.randint(4, 123), random.randint(4, 123)
    k = hill(x, z)
    if not 2.5 < k < 28 or in_view(x, z) or poly_dist(TRAIL, x, z) < 5 or math.hypot(x - TREE[0], z - TREE[1]) < 26:
        continue
    if get(x, H[x, z], z) not in ("grass_block", "moss_block") or any(
        math.hypot(x - a, z - b) < 13 for a, b in hill_trees
    ):
        continue
    hill_trees.append((x, z))
    small_tree(x, z, random.randint(5, 8), random.uniform(2.8, 4.0), random.choice(["oak", "oak", "birch", "apple"]))
    if len(hill_trees) >= 14:
        break
# greenery spilling over the top of each facade, leaving the door clear
for n in NOTCHES:
    x = n["cx"] - n["wl"] + 1
    while x < n["cx"] + n["wr"]:
        if abs(x - n["cx"]) > 4:
            z = n["fz"] - random.randint(1, 3)
            bush(x, z, random.uniform(1.4, 2.1))
            placed += 1
        x += random.randint(3, 6)
for x in range(128):
    for z in range(128):
        meadow(x, z)


# ---------------------------------------------------------------- the path up to the oak


def trail(pts, width=1.3):
    """A footpath worn a block into the turf, climbing with the land; steps where it rises."""
    cells = {}
    for x in range(min(p[0] for p in pts) - 3, max(p[0] for p in pts) + 4):
        for z in range(min(p[1] for p in pts) - 3, max(p[1] for p in pts) + 4):
            d = poly_dist(pts, x, z)
            if d <= width + 0.5 * noise(x, z, 3, 80) and not any(in_notch(n, x, z) for n in NOTCHES):
                cells[x, z] = H[x, z] - 1
    for (x, z), h in cells.items():
        fill(x, h + 1, z, x, h + 3, z, "air")
        set(x, h, z, "50%dirt_path,30%coarse_dirt,20%gravel")
        ups = [(dx, dz) for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)) if cells.get((x + dx, z + dz)) == h + 1]
        if len(ups) == 1:
            face = {(1, 0): "east", (-1, 0): "west", (0, 1): "south", (0, -1): "north"}[ups[0]]
            set(x, h + 1, z, f"spruce_stairs[facing={face}]")
    return cells


def bench(x, z, facing="south"):
    """A plank bench looking out over the Shire, with a lantern post beside it."""
    h = H[x, z]
    back = {"south": "north", "north": "south", "east": "west", "west": "east"}[facing]
    ax, az = (1, 0) if facing in ("south", "north") else (0, 1)  # the bench runs across its facing
    ends = ("west", "east") if ax else ("north", "south")
    for k in range(-2, 4):
        bx, bz = x + k * ax, z + k * az
        fill(bx, h + 1, bz, bx, h + 3, bz, "air")
        fill(bx, min(H[bx, bz], h) - 1, bz, bx, h, bz, "70%mossy_cobblestone,30%cobblestone")
        set(bx, h, bz, "50%dirt_path,50%coarse_dirt")
    for k in range(-1, 2):
        set(x + k * ax, h + 1, z + k * az, f"spruce_stairs[facing={back}]")
    set(x - 2 * ax, h + 1, z - 2 * az, f"spruce_trapdoor[open=true,facing={ends[0]}]")
    set(x + 2 * ax, h + 1, z + 2 * az, f"spruce_trapdoor[open=true,facing={ends[1]}]")
    fill(x + 3 * ax, h + 1, z + 3 * az, x + 3 * ax, h + 2, z + 3 * az, "spruce_fence")
    set(x + 3 * ax, h + 3, z + 3 * az, "lantern")


# A trail worn a block into the turf, winding up the Hill to the oak, with steps where it climbs and a bench under
# the tree.
step("A path up to the oak")
trail(TRAIL)
bench(70, 57, "east")


# ---------------------------------------------------------------- life along the lane
def sheep(x, z, along_x, grazing):
    """A woolly sheep on fence-post legs; the head down in the grass when grazing."""
    h = H[x, z]
    ax, az = (1, 0) if along_x else (0, 1)
    px, pz = az, ax  # across the body
    for k in (-2, 2):
        for s_ in (-1, 1):
            fill(
                x + k * ax + s_ * px,
                h + 1,
                z + k * az + s_ * pz,
                x + k * ax + s_ * px,
                h + 1,
                z + k * az + s_ * pz,
                "dark_oak_fence",
            )
    for k in range(-2, 3):
        for s_ in (-1, 0, 1):
            bx, bz = x + k * ax + s_ * px, z + k * az + s_ * pz
            set(bx, h + 2, bz, "white_wool")
            if not (abs(k) == 2 and s_ != 0):
                set(bx, h + 3, bz, "white_wool")
    for k in (-1, 0, 1):
        set(x + k * ax, h + 4, z + k * az, "white_wool")
    hx, hz = x + 3 * ax, z + 3 * az
    if grazing:
        set(hx, h + 2, hz, "black_wool")
        set(hx, h + 1, hz, "black_wool")
    else:
        set(hx, h + 3, hz, "black_wool")
        set(hx + ax, h + 3, hz + az, "black_wool")
        set(hx, h + 4, hz, "white_wool")


def signpost(x, z, arrows):
    """A fence post with plank arrows pointing the ways."""
    h = H[x, z]
    fill(x, h + 1, z, x, h + 4, z, "air")
    fill(x, h + 1, z, x, h + 3, z, "spruce_fence")
    for dy, (dx, dz) in enumerate(arrows):
        face = "north" if dx else "west"
        set(x + dx, h + 2 + dy, z + dz, f"spruce_trapdoor[open=true,facing={face}]")


# Sheep grazing in the pastures and a signpost by the lane.
step("Sheep and a signpost")
flock = []
for z_lo, z_hi, count in ((100, 122, 6), (5, 40, 4)):  # most graze in front of the Hill, a few behind
    placed = 0
    for _ in range(3000):
        x, z = random.randint(5, 122), random.randint(z_lo, z_hi)
        if not open_land(x, z):
            continue
        i, gap = field_of(x, z)
        if FIELDS[i][2] != "pasture" or gap < 5 or any(math.hypot(x - a, z - b) < 7 for a, b in flock):
            continue
        flock.append((x, z))
        sheep(x, z, random.random() < 0.5, random.random() < 0.6)
        placed += 1
        if placed >= count:
            break
signpost(81, 90, [(1, 0), (-1, 0)])
