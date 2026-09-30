"""Gothic Cathedral, 96 blocks tall: flying buttresses, rose windows, gargoyles and two openwork stone spires."""

import math
import re
from collections import namedtuple

LIGHT = "sea_lantern"
BASE = "deepslate_bricks"
CARVED = "chiseled_polished_blackstone"
BACK = "polished_blackstone"
SPIKE = "iron_chain"
ARMS = ((-1, 0, "east"), (1, 0, "west"), (0, -1, "south"), (0, 1, "north"))
MIRROR = False


def glass(color):
    return f"{color}_stained_glass_pane"


def mx(x):
    return 64 - x if MIRROR else x


def mb(block):
    if not MIRROR:
        return block
    return re.sub(r"facing=(east|west)", lambda m: "facing=" + ("west" if m[1] == "east" else "east"), block, count=1)


def F(x0, y0, z0, x1, y1, z1, block, mode="solid"):
    """fill, mirrored across x = 32 while inside both()."""
    fill(mx(x0), y0, z0, mx(x1), y1, z1, mb(block), mode)


def S(x, y, z, block):
    """set, mirrored across x = 32 while inside both()."""
    set(mx(x), y, z, mb(block))


def both(build, *args):
    """Build one half, then the same again mirrored across x = 32."""
    global MIRROR
    build(*args)
    MIRROR = True
    build(*args)
    MIRROR = False


def nearest(v):
    """Round to the nearest integer, halves up."""
    return math.floor(v + 0.5)


def noise(x, y, z):
    """A stable pseudo-random number in [0, 1) for a block position."""
    h = ((x + 101) * 73856093 ^ (y + 211) * 19349663 ^ (z + 307) * 83492791) & 0xFFFFFFFF
    h = (h ^ (h >> 15)) * 2246822519 & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 3266489917 & 0xFFFFFFFF
    return (h ^ (h >> 16)) / 2**32


def brick(x, y, z):
    """A weathered brick for about a quarter of wall blocks, None for the plain rest."""
    r = noise(mx(x), y, z)
    for limit, block in (
        (0.12, "deepslate_tiles"),
        (0.18, "cracked_deepslate_tiles"),
        (0.23, "polished_blackstone_bricks"),
        (0.28, "cobbled_deepslate"),
    ):
        if r < limit:
            return block
    return None


def kind(x, y, z):
    return "polished_blackstone_brick" if noise(z + 7, y, mx(x)) < 0.15 else "deepslate_brick"


def stair(x, y, z, facing, top=False):
    return f"{kind(x, y, z)}_stairs[facing={facing}{',half=top' if top else ''}]"


def post(x, y, z):
    return f"{kind(x, y, z)}_wall"


def stairs(facing, top=False):
    """A stair for cell(), its stone picked per position like stair()."""
    return lambda x, y, z: stair(x, y, z, facing, top)


def stone(x0, y0, z0, x1, y1, z1, mode="solid"):
    """Deepslate bricks, with weathered bricks scattered over the outer faces."""
    F(x0, y0, z0, x1, y1, z1, BASE, mode)
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            if x in (x0, x1) or z in (z0, z1):
                for y in range(y0, y1 + 1):
                    b = brick(x, y, z)
                    if b:
                        S(x, y, z, b)


def ring(x0, y, z0, x1, z1, stairs, corner, extra=""):
    """A course of outward stairs around a rectangle, with `corner` blocks at the corners."""
    F(x0 + 1, y, z0, x1 - 1, y, z0, f"{stairs}[facing=south{extra}]")
    F(x0 + 1, y, z1, x1 - 1, y, z1, f"{stairs}[facing=north{extra}]")
    F(x0, y, z0 + 1, x0, y, z1 - 1, f"{stairs}[facing=east{extra}]")
    F(x1, y, z0 + 1, x1, y, z1 - 1, f"{stairs}[facing=west{extra}]")
    for x, z in ((x0, z0), (x1, z0), (x0, z1), (x1, z1)):
        S(x, y, z, corner)


def pinnacle(x, y, z, h=3, wings=True):
    """A carved base, a shaft of h wall posts, optional stair crockets, and a chain spike."""
    S(x, y, z, CARVED)
    for k in range(1, h + 1):
        S(x, y + k, z, post(x, y + k, z))
    if wings:
        for dx, dz, facing in ARMS:
            S(x + dx, y + 1, z + dz, stair(x + dx, y + 1, z + dz, facing))
    F(x, y + h + 1, z, x, y + h + 2, z, SPIKE)


Face = namedtuple("Face", "at lo hi out into")
"""A wall plane: at(u, d) gives (x, z) for u along the wall and d blocks inward (negative is outside)."""


def face_x(x, inward):
    out, into = ("west", "east") if inward > 0 else ("east", "west")
    return Face(lambda u, d: (x + d * inward, u), "north", "south", out, into)


def face_z(z, inward):
    out, into = ("north", "south") if inward > 0 else ("south", "north")
    return Face(lambda u, d: (u, z + d * inward), "west", "east", out, into)


def box(f, u0, u1, y0, y1, block, d=0):
    xa, za = f.at(u0, d)
    xb, zb = f.at(u1, d)
    F(xa, y0, za, xb, y1, zb, block)


def rock(f, u0, u1, y0, y1, d0=0, d1=None):
    xa, za = f.at(u0, d0)
    xb, zb = f.at(u1, d0 if d1 is None else d1)
    stone(min(xa, xb), y0, min(za, zb), max(xa, xb), y1, max(za, zb))


def cell(f, u, y, d, block):
    """One block on a face; `block` is a name or a function of (x, y, z)."""
    x, z = f.at(u, d)
    S(x, y, z, block if isinstance(block, str) else block(x, y, z))


def shaft(f, u, y0, y1, d=-1):
    for y in range(y0, y1 + 1):
        cell(f, u, y, d, post)


def ribs(f, us, y0, y1, d=-1):
    for u in us:
        shaft(f, u, y0, y1, d)


def course(f, u0, u1, y, top=True, d=-1):
    """A moulding: a row of stairs standing out from the face."""
    for u in range(u0, u1 + 1):
        cell(f, u, y, d, stairs(f.into, top))


def gargoyle(f, u, y, d=-1):
    cell(f, u, y, d, CARVED)
    cell(f, u, y, d - 1, stairs(f.out))
    cell(f, u, y - 1, d, stairs(f.into, True))


def tip(w, h, i):
    """The top of column i of a pointed arch w wide whose sides are h tall."""
    return h - 1 + min(i, w - 1 - i)


def shape(f, u0, y0, w, h, block, d=0):
    for i in range(w):
        box(f, u0 + i, u0 + i, y0, y0 + tip(w, h, i), block, d)


def archway(f, u0, y0, w, h, d=0):
    """A pointed opening with upside-down stairs along its arch."""
    shape(f, u0, y0, w, h, "air", d)
    mid = (w - 1) // 2
    for i in range(w):
        if i != mid:
            cell(f, u0 + i, y0 + tip(w, h, i), d, stairs(f.lo if i < mid else f.hi, True))


def hood(f, u0, y0, w, h, spike=False):
    """A gabled hood of stairs over an arch, a post at its point."""
    mid = (w - 1) // 2
    for i in range(w):
        top = y0 + tip(w, h, i) + 1
        cell(f, u0 + i, top, -1, post if i == mid else stairs(f.hi if i < mid else f.lo))
    if spike:
        cell(f, u0 + mid, y0 + tip(w, h, mid) + 2, -1, SPIKE)


def lancet(f, u0, y0, w, h, pane, sill=True):
    """A recessed pointed window: stained glass lit from behind, a sill and a hood."""
    box(f, u0 - 1, u0 + w, y0 - 1, y0 + tip(w, h, (w - 1) // 2) + 1, BASE, 1)
    shape(f, u0, y0, w, h, "air")
    shape(f, u0, y0, w, h, pane, 1)
    shape(f, u0, y0, w, h, LIGHT, 2)
    if sill:
        for u in range(u0, u0 + w):
            cell(f, u, y0 - 1, -1, stairs(f.into))
    hood(f, u0, y0, w, h)


def niche(f, u, y0, h, sill=True):
    box(f, u, u, y0, y0 + h - 1, "air")
    box(f, u, u, y0, y0 + h - 1, BACK, 1)
    cell(f, u, y0 + h, 0, stairs(f.into, True))
    if sill:
        cell(f, u, y0 - 1, -1, stairs(f.into))


def blind(f, u0, y0, h):
    """A blind arch: a shallow pointed recess split by a colonnette."""
    shape(f, u0, y0, 3, h, BACK, 1)
    archway(f, u0, y0, 3, h)
    shaft(f, u0 + 1, y0, y0 + h - 2, 0)
    hood(f, u0, y0, 3, h)


def buttress(f, u, y0, stages):
    """A pier stepping back as it rises: each stage is (top, depth out from the wall)."""
    y = y0
    for top, depth in stages:
        rock(f, u, u, y, top, -depth, -1)
        cell(f, u, top + 1, -depth, stairs(f.into))
        y = top + 1


def rose(f, cu, cy, r):
    """A round traceried window of radius r: a carved rim, spokes, and rings of colored glass."""
    n = math.ceil(r + 0.5)
    for du in range(-n, n + 1):
        for dy in range(-n, n + 1):
            d, u, y = math.hypot(du, dy), cu + du, cy + dy
            if d > r + 0.5:
                continue
            if d > r - 0.5:
                box(f, u, u, y, y, CARVED)
                box(f, u, u, y, y, BASE, 1)
                continue
            petal = math.floor((math.atan2(dy, du) + math.pi) / (math.pi / 4)) % 2
            spoke = d > 1.5 and (du == 0 or dy == 0 or abs(du) == abs(dy))
            if spoke:
                cell(f, u, y, 0, post)
            else:
                box(f, u, u, y, y, "air")
            pane = "yellow" if d < 1 else "red" if d < 2.5 else "blue" if petal else "purple"
            box(f, u, u, y, y, glass(pane), 1)
            box(f, u, u, y, y, LIGHT, 2)


# A paved close of polished andesite with a stone grid, a slab lip, a processional path, lamp posts and two
# cypresses.
step("Cathedral close")
fill(12, 1, 5, 52, 1, 57, "polished_andesite")
for x in range(12, 53, 4):
    fill(x, 1, 5, x, 1, 57, "stone_bricks")
for z in range(5, 58, 4):
    fill(12, 1, z, 52, 1, z, "stone_bricks")
fill(11, 1, 6, 11, 1, 56, "stone_brick_slab")
fill(53, 1, 6, 53, 1, 56, "stone_brick_slab")
fill(13, 1, 4, 51, 1, 4, "stone_brick_slab")
fill(13, 1, 58, 51, 1, 58, "stone_brick_slab")
fill(29, 1, 53, 35, 1, 57, "smooth_stone")
for x in (13, 51):
    for z in (10, 20, 40, 50):
        fill(x, 2, z, x, 3, z, "polished_blackstone_brick_wall")
        set(x, 4, z, "lantern")
for x in (27, 37):
    fill(x, 2, 57, x, 4, 57, "polished_blackstone_brick_wall")
    set(x, 5, 57, "lantern")
for x in (15, 49):
    fill(x, 2, 55, x, 5, 55, "spruce_log")
    fill(x - 1, 3, 54, x + 1, 7, 56, "spruce_leaves")
    for dx, dz in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        set(x + dx, 3, 55 + dz, "air")
        set(x + dx, 7, 55 + dz, "air")
    fill(x, 8, 55, x, 10, 55, "spruce_leaves")

# A dark stone nave over low side aisles: recessed lancets with sills and gabled hoods, corbel tables under the
# eaves, blind niches, wall shafts between the clerestory bays and gargoyles at every shaft.
step("Nave and aisles")
stone(26, 2, 16, 38, 24, 48, "walls")


def aisles():
    aisle, clere = face_x(21, 1), face_x(26, 1)
    for z0, z1, bays, niches, shafts in (
        (16, 25, (18, 22), (), (17, 21, 25)),
        (35, 46, (37, 41), (36, 45), (36, 40, 44)),
    ):
        za = 15 if z0 == 16 else z0
        stone(21, 2, z0, 25, 11, z1, "walls")
        course(aisle, z0, z1, 2, False)
        course(aisle, z0, z1, 10)
        for i, z in enumerate(bays):
            lancet(aisle, z, 4, 3, 5, glass("red"))
            lancet(clere, z, 18, 3, 4, glass("purple" if i else "blue"), False)
        for z in niches:
            niche(aisle, z, 4, 5)
        F(20, 11, za, 20, 11, z1, "polished_tuff_stairs[facing=east]")
        for i in range(5):
            if i:
                F(21 + i, 12, za, 21 + i, 11 + i, z1, "polished_tuff")
            for z in range(za, z1 + 1):
                tuff = "tuff_brick" if noise(mx(21 + i), 12 + i, z) < 0.3 else "polished_tuff"
                S(21 + i, 12 + i, z, f"{tuff}_stairs[facing=east]")
        course(clere, z0, z1, 17, False)
        course(clere, z0, z1, 24)
        for z in shafts:
            shaft(clere, z, 18, 23)
            gargoyle(clere, z, 23)
    end = face_z(16, 1)
    course(end, 21, 25, 2, False)
    course(end, 21, 25, 10)
    blind(end, 22, 4, 5)


both(aisles)

# The transept arms end in spiky gabled fronts: a stepped porch, a traceried rose between wall shafts, a gable
# lancet between niches, pinnacled copings, and turrets with slit windows, gargoyles and crocketed spires.
step("Transept and rose windows")
stone(14, 2, 26, 50, 24, 34, "walls")


def transept_arm():
    for i in range(5):
        stone(14, 25 + 2 * i, 26 + i, 14, 26 + 2 * i, 34 - i)
    end = face_x(14, 1)
    rose(end, 30, 17, 3.5)
    ribs(end, (27, 33), 13, 21)
    course(end, 27, 33, 12)
    course(end, 27, 33, 24)
    rock(end, 27, 33, 2, 6, -1)
    for j in range(3):
        cell(end, 27 + j, 7 + j, -1, stairs(end.hi))
        cell(end, 33 - j, 7 + j, -1, stairs(end.lo))
        rock(end, 28 + j, 32 - j, 7 + j, 7 + j, -1)
    S(13, 10, 30, CARVED)
    S(13, 11, 30, post(13, 11, 30))
    archway(end, 28, 2, 5, 5, -1)
    for z in (27, 33):
        buttress(end, z, 2, ((5, 2),))
        pinnacle(12, 7, z, 1, False)
    archway(end, 29, 2, 3, 4)
    box(end, 29, 31, 2, 2, "dark_oak_door[facing=west]", 1)
    box(end, 29, 31, 3, 3, "dark_oak_door[facing=west,half=upper]", 1)
    box(end, 29, 31, 4, 6, "polished_tuff", 1)
    cell(end, 30, 5, 1, CARVED)
    lancet(end, 30, 27, 1, 3, glass("yellow"))
    for z in (28, 32):
        niche(end, z, 26, 3)
    for i in range(2, 5):
        for z, facing in ((25 + i, "south"), (35 - i, "north")):
            S(13, 25 + 2 * i, z, BASE)
            S(13, 26 + 2 * i, z, stair(13, 26 + 2 * i, z, facing))
            if i % 2 == 0:
                S(13, 27 + 2 * i, z, post(13, 27 + 2 * i, z))
                S(13, 28 + 2 * i, z, SPIKE)
    for z, inward in ((26, 1), (34, -1)):
        side = face_z(z, inward)
        course(side, 16, 20, 2, False)
        course(side, 16, 20, 15)
        course(side, 16, 24, 24)
        ribs(side, (16,), 3, 14)
        ribs(side, (16, 20), 16, 23)
        lancet(side, 17, 4, 3, 9, glass("blue"))
        blind(side, 17, 17, 5)
        lancet(side, 22, 18, 3, 4, glass("purple"))
    for z0, outer in ((24, face_z(24, 1)), (34, face_z(36, -1))):
        stone(13, 2, z0, 15, 28, z0 + 2)
        for f, c in ((face_x(13, 1), z0 + 1), (outer, 14)):
            course(f, c - 1, c + 1, 2, False)
            course(f, c - 1, c + 1, 12)
            course(f, c - 1, c + 1, 24)
            niche(f, c, 5, 5)
            box(f, c, c, 15, 20, "iron_bars")
            box(f, c, c, 15, 20, BACK, 1)
            niche(f, c, 25, 2, False)
            gargoyle(f, c - 1, 23)
        ring(13, 29, z0, 15, z0 + 2, "deepslate_brick_stairs", "deepslate_brick_wall")
        S(14, 29, z0 + 1, CARVED)
        for y in range(30, 38):
            S(14, y, z0 + 1, post(14, y, z0 + 1))
        for y in (31, 34):
            for dx, dz, facing in ARMS:
                S(14 + dx, y, z0 + 1 + dz, stair(14 + dx, y, z0 + 1 + dz, facing))
        F(14, 38, z0 + 1, 14, 39, z0 + 1, SPIKE)


both(transept_arm)

# A rounded apse closes the east end: recessed lancets over blind arcades, moulded courses, gargoyles, and
# radiating buttresses that step down into a ring of tall pinnacles.
step("Apse and chevet")


def toward(x, z):
    """The facing from (x, z) back toward the apse centre (32, 16)."""
    if abs(x - 32) > abs(z - 16):
        return "east" if x < 32 else "west"
    return "south"


def away(x, z):
    if abs(x - 32) > abs(z - 16):
        return "west" if x < 32 else "east"
    return "north"


def radial(deg, t):
    """The block t out from the apse centre at deg degrees, 0 pointing east and 90 north."""
    a = deg * math.pi / 180
    return nearest(32 + t * math.cos(a)), nearest(16 - t * math.sin(a))


for x in range(24, 41):
    for z in range(8, 17):
        d = math.hypot(x - 32, z - 16)
        if 5 < d <= 6.5:
            stone(x, 2, z, x, 24, z)
        if 6.5 < d <= 7.5 and z <= 15 and 26 <= x <= 38:
            set(x, 2, z, stair(x, 2, z, toward(x, z)))
            set(x, 11, z, stair(x, 11, z, toward(x, z), True))
            set(x, 24, z, stair(x, 24, z, toward(x, z), True))
apse = face_z(10, 1)
lancet(apse, 31, 12, 3, 9, glass("blue"))
blind(apse, 31, 3, 6)


def apse_flank():
    lancet(face_x(26, 1), 14, 12, 1, 9, glass("red"))
    F(28, 12, 12, 28, 21, 12, glass("purple"))
    F(29, 12, 13, 29, 21, 13, LIGHT)
    F(28, 3, 12, 28, 8, 12, "air")
    F(29, 3, 13, 29, 8, 13, BACK)


both(apse_flank)
for deg in (45, 135):
    x0, z0 = radial(deg, 7)
    x1, z1 = radial(deg, 8)
    set(x0, 22, z0, CARVED)
    set(x0, 21, z0, stair(x0, 21, z0, toward(x0, z0), True))
    set(x1, 22, z1, stair(x1, 22, z1, away(x1, z1)))
for deg in (22.5, 67.5, 112.5, 157.5):
    tops = {}
    for t in (7, 7.5, 8, 8.5, 9, 9.5, 10):
        at = radial(deg, t)
        tops[at] = max(tops.get(at, 0), nearest(19 - (t - 7) * 3))
    for (x, z), top in tops.items():
        stone(x, 2, z, x, top, z)
        set(x, top + 1, z, stair(x, top + 1, z, toward(x, z)))
    for t, h in ((8.5, 4), (10, 2)):
        x, z = radial(deg, t)
        pinnacle(x, tops[(x, z)] + 1, z, h, False)

# Stepped buttress piers stand clear of the aisles, each with a gargoyle, a crocketed pinnacle and a slender
# arch, pierced by little colonnettes, thrown up to the nave wall.
step("Flying buttresses")


def flyers():
    for z in (17, 21, 40, 44):
        stone(17, 2, z, 20, 4, z)
        S(17, 5, z, stair(17, 5, z, "east"))
        stone(18, 5, z, 20, 9, z)
        S(18, 10, z, stair(18, 10, z, "east"))
        stone(19, 10, z, 20, 14, z)
        gargoyle(face_x(18, 1), z, 8)
        S(20, 15, z, stair(20, 15, z, "east"))
        pinnacle(19, 15, z, 4)
        for k in range(5):
            S(21 + k, 15 + k, z, stair(21 + k, 15 + k, z, "west", True))
            S(21 + k, 16 + k, z, stair(21 + k, 16 + k, z, "east"))
        for k in (1, 3):
            for y in range(13 + k, 15 + k):
                S(21 + k, y, z, post(21 + k, y, z))


both(flyers)

# Steep lead-grey tuff roofs over nave and transept, behind a pierced parapet bristling with pinnacles, with
# gabled dormers, dark ridge cresting and a conical apse roof.
step("Roofs")


def tile(x, y, z):
    return "tuff_bricks" if noise(z, y, mx(x) * 3) < 0.3 else "polished_tuff"


def slate(x, y, z, facing):
    return f"{'tuff_brick' if noise(mx(x), z, y) < 0.3 else 'polished_tuff'}_stairs[facing={facing}]"


def slope(x0, y, z0, x1, z1, facing):
    """One course of roof: tiles with stairs on top, rising toward `facing`'s opposite."""
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            S(x, y, z, tile(x, y, z))
            S(x, y + 1, z, slate(x, y + 1, z, facing))


def dormer(c):
    stone(27, 29, c - 1, 28, 32, c + 1)
    F(27, 33, c - 1, 29, 33, c - 1, "polished_tuff_stairs[facing=south]")
    F(27, 33, c + 1, 29, 33, c + 1, "polished_tuff_stairs[facing=north]")
    F(27, 33, c, 29, 33, c, "polished_tuff")
    S(27, 33, c, CARVED)
    S(27, 34, c, post(27, 34, c))
    S(27, 35, c, SPIKE)
    F(27, 30, c, 27, 31, c, glass("yellow"))
    F(28, 30, c, 28, 31, c, LIGHT)
    S(26, 29, c, stair(26, 29, c, "east"))


def nave_roof():
    for z0, z1 in ((16, 25), (35, 46)):
        F(26, 25, z0, 26, 26, z1, BASE)
        for z in range(z0, z1 + 1):
            S(25, 25, z, post(25, 25, z))
    for z in (17, 21, 38, 42, 46):
        pinnacle(25, 25, z, 2, False)
    for z in (19, 23, 40, 44):
        S(25, 25, z, CARVED)
        S(25, 26, z, SPIKE)
    for i in range(1, 7):
        slope(25 + i, 25 + 2 * i, 16, 25 + i, 48, "east")
    dormer(20)
    dormer(41)


def gable_end(i):
    y = 25 + 2 * i
    for z, facing in ((25 + i, "south"), (35 - i, "north")):
        S(14, y, z, BASE)
        S(14, y + 1, z, stair(14, y + 1, z, facing))


def transept_ridge_end():
    S(14, 35, 30, BASE)
    pinnacle(14, 36, 30, 2, False)


both(nave_roof)
fill(32, 39, 16, 32, 39, 48, "polished_tuff")
fill(32, 40, 16, 32, 40, 48, "polished_blackstone_brick_wall")
for z in (18, 22, 26, 34, 38, 42, 46):
    set(32, 41, z, SPIKE)
for i in range(5):
    y = 25 + 2 * i
    slope(15, y, 25 + i, 49, 25 + i, "south")
    slope(15, y, 35 - i, 49, 35 - i, "north")
    both(gable_end, i)
fill(15, 35, 30, 49, 35, 30, "polished_tuff")
fill(15, 36, 30, 49, 36, 30, "polished_blackstone_brick_wall")
both(transept_ridge_end)
for k in range(7):
    r, y = 7.5 - k, 25 + 2 * k
    for x in range(24, 41):
        for z in range(8, 16):
            d = math.hypot(x - 32, z - 16)
            if d > r or d <= r - 1:
                continue
            set(x, y, z, tile(x, y, z))
            set(x, y + 1, z, slate(x, y + 1, z, toward(x, z)))
pinnacle(32, 39, 15, 2, False)

# The west front: a deep porch of three stepped pointed arches under a pinnacled gable, a gallery of niches and
# colonnettes, a great traceried rose between wall shafts, and a steep spiky gable.
step("West front")
stone(27, 2, 48, 37, 24, 52)
for x in range(27, 38):
    top = 25 + 2 * (7 - abs(x - 32))
    stone(x, 25, 49, x, top + 1, 52)
    if x != 32:
        for z in range(49, 54):
            set(x, top + 2, z, stair(x, top + 2, z, "east" if x < 32 else "west"))
for x in (28, 30, 34, 36):
    top = 25 + 2 * (7 - abs(x - 32))
    set(x, top + 3, 53, post(x, top + 3, 53))
    set(x, top + 4, 53, SPIKE)
fill(32, 41, 49, 32, 41, 52, CARVED)
pinnacle(32, 41, 51, 3, False)
front = face_z(52, -1)
course(front, 27, 37, 14)
for u in (28, 30, 34, 36):
    niche(front, u, 15, 2, False)
ribs(front, (27, 29, 35, 37), 15, 16)
course(front, 27, 37, 17)
ribs(front, (27, 37), 18, 29)
rock(front, 27, 37, 2, 9, -2, -1)
for j in range(5):
    for d in (-2, -1):
        cell(front, 27 + j, 10 + j, d, stairs(front.hi))
        cell(front, 37 - j, 10 + j, d, stairs(front.lo))
    rock(front, 28 + j, 36 - j, 10 + j, 10 + j, -2, -1)
set(32, 15, 53, CARVED)
pinnacle(32, 15, 54, 2, False)
for x in (27, 37):
    pinnacle(x, 10, 54, 3, False)
ribs(front, (28, 36), 2, 9, -3)
archway(front, 29, 2, 7, 5, -2)
archway(front, 30, 2, 5, 5, -1)
archway(front, 31, 2, 3, 4)
box(front, 31, 33, 2, 2, "dark_oak_door[facing=south]", 1)
box(front, 31, 33, 3, 3, "dark_oak_door[facing=south,half=upper]", 1)
box(front, 31, 33, 4, 6, "polished_tuff", 1)
cell(front, 32, 5, 1, CARVED)
rose(front, 32, 23, 4.5)
lancet(front, 31, 30, 3, 4, glass("yellow"))
for u in (29, 35):
    niche(front, u, 30, 3)
niche(front, 32, 37, 2)

# Two towers climb in four stages between stepped, ribbed angle buttresses with gargoyles: a portal under
# niches, tall lancets, louvred belfries and an openwork lantern, then a pinnacled parapet and a crocketed,
# pierced stone spire.
step("Twin towers and spires")


def spire(cx, cz, y0, y1, r0):
    """An octagonal spire narrowing from radius r0 at y0 to a point at y1: pierced bands, crockets, spikes."""

    def radius(y):
        return r0 * (y1 - y) / (y1 - y0)

    def inside(dx, dz, y):
        octagon = max(abs(dx), abs(dz), (abs(dx) + abs(dz)) * 0.72)
        return y <= y1 and octagon <= radius(y)

    n = math.ceil(r0)
    for y in range(y0, y1 + 1):
        for dx in range(-n, n + 1):
            for dz in range(-n, n + 1):
                if not inside(dx, dz, y):
                    continue
                x, z = cx + dx, cz + dz
                edge = [(a, b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)) if not inside(dx + a, dz + b, y)]
                capped = not inside(dx, dz, y + 1)
                if not edge and not capped:
                    continue
                if not dx and not dz:
                    S(x, y, z, post(x, y, z) if capped or radius(y) < 1.2 else BASE)
                    continue
                if capped:
                    if abs(dx) >= abs(dz):
                        facing = "west" if dx > 0 else "east"
                    else:
                        facing = "north" if dz > 0 else "south"
                    S(x, y, z, stair(x, y, z, facing))
                    if abs(dx) == abs(dz):
                        S(x, y + 1, z, SPIKE)
                    continue
                pierced = abs(dx) != abs(dz) and 1 <= (y - y0) % 5 <= 3 and radius(y) > 1.6
                if pierced:
                    S(x, y, z, "iron_bars")
                else:
                    S(x, y, z, "polished_blackstone_bricks" if noise(mx(x), y, z) < 0.3 else "deepslate_tiles")
                if (y - y0) % 3 == 0 and abs(dx) == abs(dz):
                    for a, b in edge:
                        S(x + a, y, z + b, post(x + a, y, z + b))
    F(cx, y1 + 1, cz, cx, y1 + 3, cz, SPIKE)


def tower():
    stone(20, 2, 47, 26, 56, 53, "walls")
    F(22, 28, 49, 24, 39, 51, BACK)
    front, west, north, east = face_z(53, -1), face_x(20, 1), face_z(47, 1), face_x(26, -1)
    for f, u in ((front, 20), (front, 26), (west, 53), (west, 47)):
        buttress(f, u, 2, ((13, 3), (30, 2), (54, 1)))
        shaft(f, u, 15, 28, -3)
        shaft(f, u, 32, 50, -2)
        gargoyle(f, u, 29, -3)
        gargoyle(f, u, 52, -2)
    archway(front, 22, 2, 3, 4)
    box(front, 22, 24, 2, 3, "dark_oak_planks", 1)
    box(front, 23, 23, 2, 2, "dark_oak_door[facing=south]", 1)
    box(front, 23, 23, 3, 3, "dark_oak_door[facing=south,half=upper]", 1)
    box(front, 22, 24, 4, 6, "polished_tuff", 1)
    hood(front, 22, 2, 3, 4)
    course(front, 21, 25, 8, False)
    for u in (21, 23, 25):
        niche(front, u, 9, 3, False)
    course(west, 48, 52, 2, False)
    blind(west, 49, 4, 7)
    for f, c, y0 in ((front, 23, 15), (west, 50, 15), (north, 23, 17), (east, 50, 32)):
        ribs(f, (c - 2, c + 2), y0, 54)
    for f, c in ((front, 23), (west, 50)):
        course(f, c - 2, c + 2, 14)
    for f, c, pane in ((front, 23, "blue"), (west, 50, "red"), (north, 23, "red")):
        lancet(f, c - 1, 17, 3, 7, glass(pane))
        course(f, c - 2, c + 2, 27)
    for f, c in ((front, 23), (west, 50), (north, 23), (east, 50)):
        archway(f, c - 1, 29, 3, 8)
        shape(f, c - 1, 29, 3, 8, "dark_oak_trapdoor[half=top]", 1)
        shaft(f, c, 29, 35, 0)
        hood(f, c - 1, 29, 3, 8)
        course(f, c - 2, c + 2, 40)
        archway(f, c - 1, 42, 3, 10)
        shape(f, c - 1, 42, 3, 10, "iron_bars", 1)
        shaft(f, c, 42, 50, 0)
        hood(f, c - 1, 42, 3, 10, True)
        course(f, c - 2, c + 2, 55)
    ring(19, 56, 46, 27, 54, "deepslate_brick_stairs", BASE, ",half=top")
    stone(19, 57, 46, 27, 57, 54)
    F(19, 58, 46, 27, 58, 54, "polished_blackstone_brick_wall", "walls")
    for x, z in ((19, 46), (27, 46), (19, 54), (27, 54)):
        S(x, 58, z, CARVED)
        for y in range(59, 67):
            S(x, y, z, post(x, y, z))
        F(x, 67, z, x, 69, z, SPIKE)
    for x, z in ((23, 46), (23, 54), (19, 50), (27, 50)):
        pinnacle(x, 58, z, 3, False)
    spire(23, 50, 58, 90, 3.4)


both(tower)

# A slender openwork stone flèche rises over the crossing among its own pinnacles, and lanterns hang in the
# porches.
step("Crossing spire and lanterns")
stone(31, 37, 29, 33, 39, 31)
for y in range(40, 47):
    for x, z in ((31, 29), (33, 29), (31, 31), (33, 31)):
        set(x, y, z, post(x, y, z))
    for x, z in ((32, 29), (32, 31), (31, 30), (33, 30)):
        set(x, y, z, "iron_bars" if y < 45 else BASE)
set(32, 44, 30, LIGHT)
ring(31, 47, 29, 33, 31, "deepslate_brick_stairs", CARVED)
for y in range(47, 63):
    set(32, y, 30, post(32, y, 30) if y % 3 else CARVED)
for y in (50, 54, 58):
    for dx, dz, facing in ARMS:
        set(32 + dx, y, 30 + dz, stair(32 + dx, y, 30 + dz, facing))
fill(32, 63, 30, 32, 66, 30, SPIKE)
for x, z in ((31, 29), (33, 29), (31, 31), (33, 31)):
    fill(x, 48, z, x, 49, z, SPIKE)
set(32, 9, 54, "iron_chain")
set(32, 8, 54, "lantern")


def porch_lanterns():
    for x in (21, 25):
        F(x, 10, 54, x, 13, 54, "iron_chain")
        S(x, 9, 54, "lantern")
    S(13, 8, 30, "iron_chain")
    S(13, 7, 30, "lantern")


both(porch_lanterns)
