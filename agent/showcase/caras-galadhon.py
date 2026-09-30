"""Caras Galadhon: the elven city of Lothlorien, flets and stairs in gold mallorn trees on a hill ringed by a green
wall and a moat."""

import math
import random

W, TOP = 112, 99


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
    return options[max(0, min(len(options) - 1, int(t * len(options))))]


def inward(dx, dz):
    """The side facing back toward a centre from an offset (dx, dz): roof stairs face it."""
    if abs(dx) >= abs(dz):
        return "west" if dx > 0 else "east"
    return "north" if dz > 0 else "south"


def bezier(p0, p1, p2, t):
    return tuple((1 - t) ** 2 * a + 2 * (1 - t) * t * b + t * t * c for a, b, c in zip(p0, p1, p2))


def put(canvas, x, y, z, block, over=True):
    if 0 <= x < W and 0 <= z < W and 0 <= y <= TOP and (over or (x, y, z) not in canvas):
        canvas[x, y, z] = block


def paint(canvas):
    """Draw a {(x, y, z): block} canvas as one fill per vertical run of the same block."""
    columns = {}
    for (x, y, z), block in canvas.items():
        columns.setdefault((x, z), []).append((y, block))
    for (x, z), cells in columns.items():
        cells.sort()
        start, block = cells[0]
        last = start
        for y, b in cells[1:]:
            if y != last + 1 or b != block:
                fill(x, start, z, x, last, z, block)
                start, block = y, b
            last = y
        fill(x, start, z, x, last, z, block)


# ---------------------------------------------------------------- the land
C = (56, 58)  # the hill's crown, where the great mallorn stands
WALL_R, FOSSE_R, WATER = 28.5, 34.5, 3
GATE = 3  # half-width of the gap in the wall on the south side


def reach(x, z):
    """Blocks inside the forest's edge, negative past it: a lobed oval, never the site's square."""
    a = math.atan2(z - 56, x - 56)
    k = (
        1
        + 0.06 * math.sin(3 * a + 0.7)
        + 0.04 * math.sin(5 * a + 2.1)
        + 0.05 * noise(30 * math.cos(a), 30 * math.sin(a), 7, 3)
    )
    return (k - math.hypot((x - 56) / 51, (z - 56) / 49)) * 50


def centre_d(x, z):
    return math.hypot(x - C[0], z - C[1])


def in_gate(x, z):
    return z > C[1] and abs(x - C[0]) <= GATE


def land(x, z):
    d = centre_d(x, z)
    h = 7 + 2.5 * noise(x, z, 16, 1) + noise(x, z, 6, 2)
    h += 11 * (math.cos(math.pi * min(1.0, max(0.0, d - 6) / 21)) + 1) / 2
    if not in_gate(x, z):
        h += 5 * smooth(1 - abs(d - WALL_R) / 2.6)
    h -= 6.5 * smooth(1 - abs(d - FOSSE_R) / 3.4)
    h -= 3 * (1 - smooth(reach(x, z) / 6))
    return max(1, round(h))


H = {(x, z): land(x, z) for x in range(W) for z in range(W) if reach(x, z) > 0}


def slope(x, z):
    return max(abs(H[x, z] - H.get((x + dx, z + dz), H[x, z])) for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)))


# ---------------------------------------------------------------- mallorns
BARK = "pale_oak_wood"  # the mallorns' dark grey bole
WHITE = "stripped_pale_oak_wood"  # the elves' pale woodwork
GOLD = [
    "45%honeycomb_block,35%horn_coral_block,20%orange_terracotta",
    "50%horn_coral_block,30%honeycomb_block,20%yellow_concrete_powder",
    "50%horn_coral_block,40%yellow_concrete_powder,10%honeycomb_block",
]


def puff(canvas, cx, cy, cz, r, squash):
    """One lumpy ball of leaves, amber underneath and bright gold on top; it leaves wood in the canvas alone."""
    n = int(r * 1.25) + 1
    cx, cz = round(cx), round(cz)
    for dx in range(-n, n + 1):
        for dz in range(-n, n + 1):
            x, z = cx + dx, cz + dz
            rx = r * (1 + 0.22 * noise(x, z + cy, 2.5, 5))
            rr = rx * rx - dx * dx - dz * dz
            if rr < 0:
                continue
            s = math.sqrt(rr) * squash
            lo, hi = round(cy - s * 0.8), round(cy + s + 0.8 * noise(x, z, 2, 6))
            lean = 0.2 * noise(x, z, 3, 7)
            for y in range(lo, hi + 1):
                put(canvas, x, y, z, pick(GOLD, (y - lo) / (hi - lo + 1) + lean), over=False)


def blob(canvas, cx, cy, cz, r, squash=0.55):
    """A cloud of gold leaves: a big lumpy puff with smaller ones heaped around and on top of it."""
    puff(canvas, cx, cy, cz, r, squash)
    for _ in range(3):
        a = random.uniform(0, math.tau)
        k = random.uniform(0.45, 0.75) * r
        puff(
            canvas,
            cx + k * math.cos(a),
            cy + random.uniform(0, 0.45) * r,
            cz + k * math.sin(a),
            r * random.uniform(0.5, 0.7),
            squash,
        )


def limb(canvas, p0, p1, p2, r0, r1, block=BARK):
    n = max(2, int(math.dist(p0, p2) * 2))
    for i in range(n + 1):
        t = i / n
        x, y, z = bezier(p0, p1, p2, t)
        r = r0 + (r1 - r0) * t
        k = int(r) + 1
        for dx in range(-k, k + 1):
            for dy in range(-k, k + 1):
                for dz in range(-k, k + 1):
                    if dx * dx + dy * dy + dz * dz <= r * r + 0.3:
                        put(canvas, round(x) + dx, round(y) + dy, round(z) + dz, block)


class Mallorn:
    """A mallorn: a smooth grey bole flaring into roots, tiers of boughs spreading high up, a gold cloud crown."""

    def __init__(self, tx, tz, height, r0, crown, low=0.5):
        self.x, self.z, self.r0, self.height, self.crown = tx, tz, r0, height, crown
        self.tips = []
        self.base = H[tx, tz]
        self.top = self.base + height
        wood, leaves = {}, {}
        n = int(r0 + 3)
        for dx in range(-n, n + 1):
            for dz in range(-n, n + 1):
                d = math.hypot(dx, dz)
                ys = [y for y in range(self.base - 3, self.top + 1) if self.radius(y) >= d]
                for y in ys:
                    put(wood, tx + dx, y, tz + dz, BARK)
        for i in range(6):
            a = math.radians(i * 60 + random.uniform(-20, 20))
            L = r0 + random.uniform(4, 7)
            ex, ez = round(tx + L * math.cos(a)), round(tz + L * math.sin(a))
            end = (ex, H.get((ex, ez), self.base) - 1, ez)
            mid = (tx + 0.6 * L * math.cos(a), self.base + 0.5, tz + 0.6 * L * math.sin(a))
            limb(wood, (tx + r0 * math.cos(a), self.base + 3, tz + r0 * math.sin(a)), mid, end, 0.9, 0.4)
        y = self.base + round(low * height)
        tier = 0
        while y < self.top - 2:
            f = (y - self.base) / height
            for k in range(4):
                a = math.radians(tier * 47 + k * 90 + random.uniform(-25, 25))
                L = crown * (1.1 - 0.7 * (f - low) / (1 - low)) * random.uniform(0.8, 1.0)
                start = (tx, y, tz)
                end = (tx + L * math.cos(a), y + 0.4 * L, tz + L * math.sin(a))
                mid = (tx + 0.55 * L * math.cos(a), y + 0.08 * L, tz + 0.55 * L * math.sin(a))
                limb(wood, start, mid, end, max(0.6, r0 * 0.3), 0.5)
                blob(leaves, *end, crown * 0.5)
                self.tips.append(end)
                blob(leaves, *bezier(start, mid, end, 0.65), crown * 0.38)
            y += max(4, round(height * 0.09))
            tier += 1
        blob(leaves, tx, self.top + 2, tz, crown * 0.75, squash=0.5)
        self.wood, self.leaves = wood, leaves

    def radius(self, y):
        t = max(0.0, (y - self.base) / self.height)
        return self.r0 * (1 - 0.6 * t) + 1.6 * math.exp(-(y - self.base) / 2.5)

    def draw(self):
        for key in self.wood:
            self.leaves.pop(key, None)
        paint(self.wood)
        paint(self.leaves)


# ---------------------------------------------------------------- the elves' work
def flet(tree, y, R, lamps=6):
    """A talan: a round pale deck around the trunk on radial beams and curved braces, a rail at the rim, blue and
    gold lanterns hung beneath."""
    tx, tz, hole = tree.x, tree.z, tree.radius(y) + 0.4
    n = int(R) + 1
    for dx in range(-n, n + 1):
        for dz in range(-n, n + 1):
            d = math.hypot(dx, dz)
            if hole < d <= R:
                fill(tx + dx, y + 1, tz + dz, tx + dx, y + 6, tz + dz, "air")
                set(tx + dx, y, tz + dz, "pale_oak_planks")
                if d > R - 1:
                    post = round(math.degrees(math.atan2(dz, dx)) * R / 40) % 3 == 0
                    fill(tx + dx, y + 1, tz + dz, tx + dx, y + (2 if post else 1), tz + dz, "pale_oak_fence")
                    if post:
                        set(tx + dx, y + 3, tz + dz, "end_rod")
                    set(tx + dx, y - 1, tz + dz, f"pale_oak_stairs[half=top,facing={inward(dx, dz)}]")
    brace = {}
    for i in range(6):
        a = math.radians(i * 60 + 15)
        c, s = math.cos(a), math.sin(a)
        for r in range(round(hole), round(R)):
            put(brace, round(tx + r * c), y - 1, round(tz + r * s), WHITE)
        limb(
            brace,
            (tx + hole * c, y - 6, tz + hole * s),
            (tx + 0.55 * R * c, y - 4, tz + 0.55 * R * s),
            (tx + (R - 1.5) * c, y - 1, tz + (R - 1.5) * s),
            0.3,
            0.3,
            WHITE,
        )
    paint(brace)
    for i in range(lamps):
        a = math.radians(i * 360 / lamps + 45)
        x, z = round(tx + (R - 1.5) * math.cos(a)), round(tz + (R - 1.5) * math.sin(a))
        set(x, y - 1, z, "iron_chain")
        set(x, y - 2, z, "soul_lantern" if i % 2 else "lantern")


def spiral(tree, y0, y1, a):
    """Treads winding up round the trunk from y0 to the deck at y1 under a white arcade: a slender post with a
    glowing finial every few blocks, a lintel between, a blue lamp in every other bay, the arcade ducking under
    the deck as it arrives. Returns the angle it ends at."""
    bay = 0
    for y in range(y0, y1):
        R = tree.radius(y) + 1.0
        step = 1.7 / R
        room = min(5, y1 - y - 2)
        for k in range(2):
            aa = a + step * k / 2
            c, s = math.cos(aa), math.sin(aa)
            for w in (0, 1):
                wx, wz = round(tree.x + (R + w) * c), round(tree.z + (R + w) * s)
                fill(wx, y + 1, wz, wx, y + 3, wz, "air")
                set(wx, y, wz, "pale_oak_slab[type=top]")
            ox, oz = round(tree.x + (R + 2) * c), round(tree.z + (R + 2) * s)
            set(ox, y, oz, "pale_oak_planks")
            set(ox, y + 1, oz, "pale_oak_fence")
            if room >= 3:
                if bay % 3 == 0:
                    fill(ox, y + 1, oz, ox, y + room, oz, "pale_oak_fence")
                    set(ox, y + room + 1, oz, "end_rod")
                else:
                    set(ox, y + room, oz, "pale_oak_slab[type=top]")
                    if bay % 6 == 1:
                        set(ox, y + room - 1, oz, "soul_lantern")
            bay += 1
        a += step
    R = tree.radius(y1) + 1
    for back in range(4):
        aa = a - back * 1.7 / R
        for w in (0, 1, 2):
            set(round(tree.x + (R + w) * math.cos(aa)), y1, round(tree.z + (R + w) * math.sin(aa)), "air")
    return a


def pod(cx, y, cz, R, h, door=None, ribs=10, hole=0.0):
    """An elven hall: a pointed dome of white ribs, bands and pale glass on a round floor, lamps inside, a finial on
    top, an arched doorway facing angle `door`; it wraps a trunk of radius `hole` when it stands around one."""
    rho = (R * R + h * h) / (2 * R)

    def radius(dy):
        return math.sqrt(max(0.0, rho * rho - dy * dy)) - (rho - R)

    for dy in range(h + 1):
        r, inner = radius(dy), min(radius(dy) - 1.0, radius(dy + 1) - 0.6)
        n = int(r) + 1
        for dx in range(-n, n + 1):
            for dz in range(-n, n + 1):
                d = math.hypot(dx, dz)
                if (hole and d <= hole + 0.4) or d > r + 0.2:
                    continue
                if d <= inner:
                    set(cx + dx, y - 1 if dy == 0 else y + dy, cz + dz, "pale_oak_planks" if dy == 0 else "air")
                    continue
                ang = math.atan2(dz, dx)
                rib = abs((ang * ribs / (2 * math.pi)) % 1 - 0.5) > 0.42
                gap = abs((ang - door + math.pi) % (2 * math.pi) - math.pi) if door is not None else 9
                if gap * max(r, 1) < 1.6 and dy <= 3:
                    block = "air"
                elif rib or dy % 5 == 0:
                    block = WHITE
                else:
                    block = "white_stained_glass_pane"
                set(cx + dx, y + dy, cz + dz, block)
    n = int(R) + 2
    for dx in range(-n, n + 1):
        for dz in range(-n, n + 1):
            if R - 0.6 < math.hypot(dx, dz) <= R + 0.6:
                set(cx + dx, y - 1, cz + dz, f"pale_oak_stairs[half=top,facing={inward(dx, dz)}]")
    if door is not None:
        for side in (-1, 1):
            a = door + side * 2.2 / R
            set(round(cx + (R + 1) * math.cos(a)), y, round(cz + (R + 1) * math.sin(a)), "soul_lantern")
    fill(cx, y + h + 1, cz, cx, y + h + 2, cz, "end_rod")
    for i in range(4):
        a = math.radians(i * 90 + 45)
        lx, lz = round(cx + (hole + 1.2) * math.cos(a)), round(cz + (hole + 1.2) * math.sin(a))
        set(lx, y, lz, "pearlescent_froglight" if hole else "sea_lantern")


def bridge(a, b, sag):
    """A hanging walkway from point a to point b: a continuous deck of slabs and planks sagging in the middle, rails
    along both sides, a post with a glowing finial and a lamp every few blocks, the leaves cut back above it."""
    (x0, y0, z0), (x1, y1, z1) = a, b
    L = math.hypot(x1 - x0, z1 - z0)
    ux, uz = (x1 - x0) / L, (z1 - z0) / L
    for x in range(math.floor(min(x0, x1)) - 3, math.ceil(max(x0, x1)) + 4):
        for z in range(math.floor(min(z0, z1)) - 3, math.ceil(max(z0, z1)) + 4):
            along = (x - x0) * ux + (z - z0) * uz
            off = abs((z - z0) * ux - (x - x0) * uz)
            if not 0 <= along <= L or off > 2.2:
                continue
            t = along / L
            yf = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t)
            y = math.floor(yf)
            fill(x, y + 1, z, x, y + 5, z, "air")
            set(x, y, z, "pale_oak_slab[type=top]" if yf - y >= 0.5 else "pale_oak_slab")
            if off > 1.3:
                post = round(along) % 5 == 2
                fill(x, y + 1, z, x, y + (2 if post else 1), z, "pale_oak_fence")
                if post:
                    set(x, y + 3, z, "end_rod")
                    set(x, y - 1, z, "iron_chain")
                    set(x, y - 2, z, "soul_lantern")


def lamp(x, y, z, arms=((1, 0), (-1, 0))):
    """An elven lamp post standing on the ground at (x, y, z): a white stone foot, a slender post, arms hung with
    lanterns, a glowing finial."""
    set(x, y + 1, z, "chiseled_quartz_block")
    fill(x, y + 2, z, x, y + 5, z, "pale_oak_fence")
    set(x, y + 6, z, WHITE)
    set(x, y + 7, z, "end_rod")
    for dx, dz in arms:
        set(x + dx, y + 6, z + dz, "pale_oak_fence")
        set(x + dx, y + 5, z + dz, "soul_lantern")


def lancet(hw, rise):
    """The height of a pointed arch's underside across its span, from -hw to hw, `rise` at the apex."""
    R = (hw * hw + rise * rise) / (2 * hw)
    return {u: round(math.sqrt(max(0.0, R * R - (abs(u) + R - hw) ** 2))) for u in range(-hw, hw + 1)}


def hang(x, y, z, drop):
    """A lantern hung on a chain `drop` blocks below whatever is overhead at (x, y, z)."""
    fill(x, y - drop + 1, z, x, y, z, "iron_chain")
    set(x, y - drop, z, "soul_lantern" if (x + z) % 2 else "lantern")


def facing(tree, other):
    return math.atan2(other.z - tree.z, other.x - tree.x)


def rim(tree, R, angle):
    return tree.x + (R - 1) * math.cos(angle), tree.z + (R - 1) * math.sin(angle)


# ---------------------------------------------------------------- the plan
# The land: a forest floor ending in a wandering edge, rising to a round hill; around the hill a green wall and,
# outside it, a moat of still water, broken only on the south where the gate stands.
step("Land, wall and moat")
for (x, z), h in H.items():
    if h >= 4:
        fill(x, 0, z, x, h - 4, z, "stone")
    fill(x, max(0, h - 3), z, x, h - 1, z, "dirt")
    if h < WATER:
        set(x, h, z, "clay" if noise(x, z, 4, 6) > 0 else "gravel")
        fill(x, h + 1, z, x, WATER, z, "water")
    elif slope(x, z) >= 3:
        set(x, h, z, "moss_block")
    else:
        set(x, h, z, "grass_block")

# The great mallorn on the hill's crown, the tallest tree in the wood; six more stand in a ring on the hill, and the
# gold wood fills the land beyond the moat.
step("Mallorns")
great = Mallorn(C[0], C[1], 68, 5.0, 15, low=0.6)
great.draw()
ring = []
for i in range(6):
    a = math.radians(i * 60 + random.uniform(-8, 8))
    x, z = round(C[0] + 24 * math.cos(a)), round(C[1] + 24 * math.sin(a))
    ring.append(Mallorn(x, z, random.randint(44, 52), 2.4, 9, low=0.62))
    ring[-1].draw()
wood = []
for _ in range(3000):
    x, z = random.randint(3, W - 4), random.randint(3, W - 4)
    if (x, z) not in H or reach(x, z) < 6 or centre_d(x, z) < FOSSE_R + 5 or H[x, z] <= WATER:
        continue
    if z > C[1] and abs(math.degrees(math.atan2(z - C[1], x - C[0])) - 90) < 38:
        continue
    if any(math.hypot(x - t.x, z - t.z) < 11 for t in wood):
        continue
    wood.append(Mallorn(x, z, random.randint(26, 40), random.uniform(1.4, 2.0), random.uniform(6, 8)))
    wood[-1].draw()
    if len(wood) >= 34:
        break

# Flets climb the great tree, and a stair under a white arcade winds up its trunk from the roots to each deck in turn;
# the second deck carries two small halls, the top one Galadriel's hall, a glowing pointed dome around the trunk.
step("Great tree: flets, stair and halls")
decks = [(14, 9, 8), (28, 12, 10), (42, 10, 8), (54, 11, 10)]
angle = math.radians(90)
below = great.base
for rise, R, lamps in decks:
    y = great.base + rise
    flet(great, y, R, lamps)
    angle = spiral(great, below + 1, y, angle)
    below = y
hall_y = great.base + decks[1][0] + 1
for a in (math.radians(20), math.radians(200)):
    pod(round(C[0] + 9.3 * math.cos(a)), hall_y, round(C[1] + 9.3 * math.sin(a)), 2.3, 7, door=a + math.pi)
top_y = great.base + decks[-1][0] + 1
pod(C[0], top_y, C[1], 8.5, 14, door=math.radians(90), ribs=16, hole=great.radius(top_y))

# The ring trees each carry a low deck reached by their own arcaded stair, and a small hall around the trunk
# level with the great tree's second deck; a few trees of the outer wood hold a deck and a lamp-lit hall.
step("Ring trees: decks and halls")
bridge_y = great.base + decks[1][0]
for t in ring:
    flet(t, bridge_y, 6)
    pod(t.x, bridge_y + 1, t.z, 4.5, 8, door=facing(t, great), ribs=8, hole=t.radius(bridge_y + 1))
    flet(t, t.base + 12, 5, lamps=4)
    spiral(t, t.base + 1, t.base + 12, facing(t, great) + math.pi / 2)
for t in wood[::3]:
    y = t.base + round(t.height * 0.55)
    flet(t, y, 5, lamps=3)
    pod(t.x, y + 1, t.z, 3.5, 6, door=facing(t, great), ribs=6, hole=t.radius(y + 1))

# Hanging bridges run from the great tree's second deck out to the hall doors of every tree of the ring.
step("Hanging bridges")
for t in ring:
    ax, az = rim(great, 12, facing(great, t))
    bx, bz = rim(t, 6, facing(t, great))
    bridge((ax, bridge_y, az), (bx, bridge_y, bz), sag=2.0)

# Two halls stand among the roots on the hill, doors to the path, where the stair begins.
step("Halls among the roots")
for a in (math.radians(45), math.radians(135)):
    hx, hz = round(C[0] + 12 * math.cos(a)), round(C[1] + 12 * math.sin(a))
    pod(hx, H[hx, hz] + 1, hz, 3.6, 10, door=math.radians(90))

# The gate: a pointed arch of white stone in the wall's gap, lamps on its shoulders; outside it a white bridge ramps
# over the moat on an arch, parapets capped and lit; a bordered white path winds up the hill to the roots of the
# great tree, lamp posts along it, and a lane runs on south through the wood.
step("Gate, bridge and paths")
gate_z = C[1] + round(WALL_R)
spring = H[C[0], gate_z] + 7
arch = lancet(GATE + 1, 5)
for u, v in arch.items():
    for z in (gate_z, gate_z + 1):
        x = C[0] + u
        if abs(u) == GATE + 1:
            fill(x, H[x, z] - 1, z, x, spring + 1, z, "quartz_pillar")
            continue
        fill(x, spring + v, z, x, spring + v + 1, z, "quartz_bricks")
        set(x, spring + v + 2, z, "smooth_quartz_slab")
set(C[0], spring + arch[0] + 1, gate_z, "chiseled_quartz_block")
fill(C[0], spring + arch[0] + 3, gate_z, C[0], spring + arch[0] + 4, gate_z, "end_rod")
hang(C[0], spring + arch[0] - 1, gate_z, 2)
for x in (C[0] - GATE - 1, C[0] + GATE + 1):
    for z in (gate_z, gate_z + 1):
        set(x, spring + 2, z, "chiseled_quartz_block")
    set(x, spring + 3, gate_z, "end_rod")
    lamp(x + (2 if x > C[0] else -2), H[x, gate_z + 2], gate_z + 2, arms=())
gz0, gz1 = gate_z + 2, C[1] + round(FOSSE_R) + 5
h0, h1 = H[C[0], gz0], H[C[0], gz1]
for z in range(gz0, gz1 + 1):
    t = (z - gz0) / (gz1 - gz0)
    yf = h0 + (h1 - h0) * t + 2.5 * math.sin(math.pi * t)
    y = math.floor(yf)
    soffit = y - 1 - round(4 * math.sin(math.pi * t))
    for x in range(C[0] - 3, C[0] + 4):
        g = H.get((x, z), 0)
        if max(g + 1, soffit) <= y - 1:
            fill(x, max(g + 1, soffit), z, x, y - 1, z, "quartz_bricks")
        set(x, y, z, "smooth_quartz")
        fill(x, y + 1, z, x, y + 4, z, "air")
        if yf - y >= 0.5 and abs(x - C[0]) < 3:
            set(x, y + 1, z, "smooth_quartz_slab")
        if abs(x - C[0]) == 3:
            set(x, y + 1, z, "quartz_bricks")
            set(x, y + 2, z, "quartz_slab")
            if (z - gz0) % 4 == 0:
                set(x, y + 2, z, "chiseled_quartz_block")
                set(x, y + 3, z, "end_rod")
        if soffit > g + 1 and abs(x - C[0]) == 3 and (z - gz0) % 4 == 2:
            hang(x, soffit - 1, z, 2)
for z in range(C[1] + 6, W):
    if gz0 <= z <= gz1:
        continue
    px = round(C[0] + (3 * math.sin((z - C[1]) / 5) if z < gate_z else 0))
    for dx in range(-2, 3):
        x = px + dx
        if (x, z) in H and H[x, z] > WATER:
            edge = abs(dx) == 2
            set(
                x,
                H[x, z],
                z,
                "polished_diorite" if edge else pick(["calcite", "diorite", "calcite"], (noise(x, z, 3, 7) + 1) / 2),
            )
            fill(x, H[x, z] + 1, z, x, H[x, z] + 3, z, "air")
    side = 3 if (z // 7) % 2 else -3
    if z % 7 == 0 and (px + side, z) in H and not gate_z - 1 <= z <= gate_z + 2:
        lamp(px + side, H[px + side, z], z, arms=((-side // 3, 0),))
for a in range(0, 360, 30):
    x, z = round(C[0] + 9 * math.cos(math.radians(a))), round(C[1] + 9 * math.sin(math.radians(a)))
    if 60 < a < 120:
        continue
    lamp(x, H[x, z], z, arms=())

# Galadriel's Mirror: a sunken dell on the hill ringed with white stone, steps down into it, a silver basin of water
# on a pedestal, lamps round the rim and niphredil in the moss.
step("The Mirror of Galadriel")
mx, mz = round(C[0] + 15 * math.cos(math.radians(-60))), round(C[1] + 15 * math.sin(math.radians(-60)))
floor_y = H[mx, mz] - 2
for dx in range(-6, 7):
    for dz in range(-6, 7):
        d = math.hypot(dx, dz)
        x, z = mx + dx, mz + dz
        if d <= 4.6:
            if H[x, z] + 2 > floor_y:
                fill(x, floor_y + 1, z, x, H[x, z] + 2, z, "air")
            set(x, floor_y, z, "moss_block" if noise(x, z, 2, 9) > -0.2 else "polished_diorite")
        elif d <= 5.6:
            top = max(H[x, z], floor_y + 1)
            fill(x, floor_y, z, x, top, z, "polished_diorite")
            set(x, top + 1, z, "polished_diorite_slab")
for k in range(3):
    fill(mx - 1, floor_y + 1 + k, mz + 5 + k, mx + 1, floor_y + 1 + k, mz + 5 + k, "quartz_stairs[facing=south]")
    fill(mx - 1, floor_y + 2 + k, mz + 5 + k, mx + 1, floor_y + 4 + k, mz + 5 + k, "air")
fill(mx, floor_y + 1, mz, mx, floor_y + 2, mz, "quartz_pillar")
fill(mx - 1, floor_y + 3, mz - 1, mx + 1, floor_y + 3, mz + 1, "smooth_quartz")
for dx in (-1, 0, 1):
    for dz in (-1, 0, 1):
        set(mx + dx, floor_y + 4, mz + dz, "water" if dx == dz == 0 else "quartz_slab")
for a in (45, 135, 225, 315):
    x, z = round(mx + 5 * math.cos(math.radians(a))), round(mz + 5 * math.sin(math.radians(a)))
    lamp(x, max(H[x, z], floor_y + 1) + 1, z, arms=())
for _ in range(14):
    a, r = random.uniform(0, math.tau), random.uniform(1.8, 4.2)
    set(round(mx + r * math.cos(a)), floor_y + 1, round(mz + r * math.sin(a)), "lily_of_the_valley")

# The forest floor: elanor and niphredil in the grass, ferns and firefly bushes in the shade, gold leaves fallen
# under the crowns, mushrooms at the roots, mossy boulders in the wood, reeds and lily pads on the moat.
step("The forest floor")
trees = [great, *ring, *wood]
for (x, z), h in H.items():
    if h <= WATER or get(x, h, z) != "grass_block" or get(x, h + 1, z) != "air":
        continue
    shaded = any(math.hypot(x - t.x, z - t.z) < t.crown for t in trees)
    r = random.random()
    wild = (noise(x, z, 9, 11) + 1) / 2
    if shaded and r < 0.16:
        set(x, h + 1, z, "orange_carpet" if noise(x, z, 3, 12) > 0 else "yellow_carpet")
    elif r < 0.05 * wild + 0.16:
        set(x, h + 1, z, "golden_dandelion" if r < 0.19 else "lily_of_the_valley")
    elif r < 0.24 + 0.1 * wild:
        set(x, h + 1, z, "firefly_bush" if shaded and r < 0.26 else "fern")
    elif r < 0.42 + 0.1 * wild:
        set(x, h + 1, z, "short_grass")
    elif r < 0.45 + 0.05 * wild:
        set(x, h + 1, z, "tall_grass")
    elif r < 0.46:
        set(x, h + 1, z, "flowering_azalea" if r < 0.455 else "azalea")
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if H.get((x + dx, z + dz), 99) < WATER and h <= WATER + 1 and random.random() < 0.35:
            fill(x, h + 1, z, x, h + random.randint(1, 3), z, "sugar_cane")
            break
for (x, z), h in H.items():
    if h < WATER and get(x, WATER + 1, z) == "air" and random.random() < 0.06:
        set(x, WATER + 1, z, "lily_pad")
for t in trees:
    for _ in range(round(t.r0 * 2)):
        a, r = random.uniform(0, math.tau), t.r0 + random.uniform(2, 4.5)
        x, z = round(t.x + r * math.cos(a)), round(t.z + r * math.sin(a))
        if (x, z) in H and get(x, H[x, z] + 1, z) in ("air", "short_grass", "orange_carpet", "yellow_carpet"):
            set(x, H[x, z] + 1, z, random.choice(("brown_mushroom", "red_mushroom", "fern")))
for _ in range(16):
    x, z = random.randint(8, W - 9), random.randint(8, W - 9)
    if (x, z) not in H or centre_d(x, z) < FOSSE_R + 4 or H[x, z] <= WATER:
        continue
    r = random.uniform(1.2, 2.3)
    for dx in range(-3, 4):
        for dz in range(-3, 4):
            if (x + dx, z + dz) in H and math.hypot(dx, dz) <= r:
                top = H[x + dx, z + dz] + round(r * 0.8 - 0.5 * math.hypot(dx, dz))
                fill(x + dx, H[x + dx, z + dz], z + dz, x + dx, top, z + dz, "70%mossy_cobblestone,30%andesite")
                set(x + dx, top + 1, z + dz, "moss_carpet")

# Lanterns hang on chains beneath the gold clouds, many small lights up in the crowns.
step("Lights in the crowns")
for t in trees:
    for x, y, z in t.tips:
        x, y, z = round(x), round(y), round(z)
        if random.random() > 0.55:
            continue
        while y > t.base and get(x, y, z) != "air":
            y -= 1
        if y > t.base + 6 and get(x, y + 1, z) != "air":
            hang(x, y, z, random.randint(1, 3))
