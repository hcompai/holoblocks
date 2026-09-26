"""What a builder agent needs to know to write a build script: the API, coordinates, recipes and blocks."""

from __future__ import annotations

from blockyard import blocks

COMMON_BLOCKS = [
    "stone_bricks",
    "mossy_stone_bricks",
    "cracked_stone_bricks",
    "chiseled_stone_bricks",
    "cobblestone",
    "andesite",
    "polished_andesite",
    "tuff_bricks",
    "polished_tuff",
    "calcite",
    "stone_brick_stairs",
    "stone_brick_slab",
    "stone_brick_wall",
    "cobblestone_wall",
    "deepslate_bricks",
    "deepslate_tiles",
    "cobbled_deepslate",
    "deepslate_tile_stairs",
    "deepslate_brick_wall",
    "polished_blackstone_bricks",
    "bricks",
    "brick_stairs",
    "brick_wall",
    "sandstone",
    "smooth_sandstone",
    "cut_sandstone",
    "quartz_block",
    "quartz_pillar",
    "quartz_stairs",
    "terracotta",
    "white_terracotta",
    "red_terracotta",
    "mud_bricks",
    "packed_mud",
    "oak_planks",
    "spruce_planks",
    "dark_oak_planks",
    "oak_log",
    "spruce_log",
    "dark_oak_log",
    "stripped_oak_log",
    "oak_stairs",
    "spruce_stairs",
    "dark_oak_stairs",
    "oak_slab",
    "spruce_slab",
    "oak_fence",
    "spruce_fence",
    "dark_oak_fence",
    "oak_door",
    "spruce_door",
    "oak_trapdoor",
    "spruce_trapdoor",
    "dark_oak_trapdoor",
    "glass",
    "glass_pane",
    "white_stained_glass_pane",
    "iron_bars",
    "iron_chain",
    "lantern",
    "torch",
    "end_rod",
    "sea_lantern",
    "shroomlight",
    "glowstone",
    "white_concrete",
    "red_concrete",
    "gray_concrete",
    "copper_block",
    "oxidized_copper",
    "cut_copper_stairs",
    "gold_block",
    "grass_block",
    "dirt",
    "dirt_path",
    "coarse_dirt",
    "gravel",
    "sand",
    "moss_block",
    "water",
    "snow_block",
    "hay_block",
    "oak_leaves",
    "spruce_leaves",
    "birch_leaves",
    "cherry_leaves",
    "azalea_leaves",
    "flowering_azalea_leaves",
    "short_grass",
    "fern",
    "sugar_cane",
    "poppy",
    "dandelion",
    "cornflower",
    "oxeye_daisy",
    "red_carpet",
    "barrel",
    "cauldron",
    "anvil",
    "bookshelf",
]

GUIDE = """# The build script

The site is {width}x{depth} and up to y={ymax}, and it starts empty: the land is part of the model. The script is plain Python (import random, math \
and the like work): constants, loops, and your own functions for every part that repeats (a window bay, a buttress, \
a lamp, a tree, a roof). Stack things on the heights your functions return, never on hand-counted ones. Boxes are \
inclusive: fill(10, 1, 10, 19, 8, 19, ...) is 10 x 8 x 10 blocks. Later calls overwrite earlier ones: fill a wall, \
then clear the doorway, then set the door.
- step(title): starts a manual step; the calls after it go into it. The user watches the steps appear one by one. \
`random` is seeded from the title at each step, so every run builds the same model and a change in one step never \
reshuffles the next.
- fill(x0, y0, z0, x1, y1, z1, block, mode="solid"): a box; mode "hollow" is a closed shell, "walls" the four sides only.
- set(x, y, z, block): one block. clear(x0, y0, z0, x1, y1, z1): empties a box (doorways, arches, courtyards, recesses).
- Any block can be a WorldEdit pattern, a weighted mix picked block by block: \
"70%stone_bricks,20%mossy_stone_bricks,10%cracked_stone_bricks". A pattern always picks the same block at the same place.
- get(x, y, z): the block the script has put there so far, "air" if none.
- replace(x0, y0, z0, x1, y1, z1, mask, block): like WorldEdit's //replace, every block in the box matching mask \
becomes block ("stone_bricks" matches any state, "dirt,gravel" either).
- overlay(x0, y0, z0, x1, y1, z1, block, on=""): like WorldEdit's //overlay, block goes in the open air on top of each \
column's highest block in the box, only where that block matches `on` if given; a pattern's "air" parts leave gaps.
- print() output comes back with the run.
Every other shape is your own code on these calls: the example below writes its roofs, round forms, trees, land and \
walls as plain functions, to copy, vary and outgrow.

Example: a hall with a tower, on a plinth that hugs its walls. Every wall is weathered, windows sit in recesses with \
sills and hoods and a lit room behind, buttresses step back as they rise, the ground is patchy with a wandering path \
and mounds, and no two trees match.
```python
import math
import random

WALL = "70%stone_bricks,9%mossy_stone_bricks,9%cracked_stone_bricks,6%andesite,6%tuff_bricks"
PLINTH = "75%cobblestone,25%mossy_cobblestone"


def top(x, z):
    return next((y for y in range({ymax}, -1, -1) if get(x, y, z) != "air"), -1)


def bay(x, z, y0, y1):
    fill(x - 1, y0 - 1, z - 1, x + 2, y1 + 1, z - 1, "polished_andesite")
    clear(x, y0, z, x + 1, y1, z)
    fill(x, y0, z - 1, x + 1, y1, z - 1, "glass_pane")
    fill(x, y0 - 1, z + 1, x + 1, y0 - 1, z + 1, "stone_brick_slab[type=top]")
    fill(x - 1, y1 + 1, z + 1, x + 2, y1 + 1, z + 1, "stone_brick_stairs[facing=north,half=top]")
    set(x, y0, z - 2, "sea_lantern")


def blob(cx, cy, cz, r, block):
    n = int(r) + 1
    for dx in range(-n, n + 1):
        for dy in range(max(-n, -cy), n + 1):
            for dz in range(-n, n + 1):
                if dx * dx + dy * dy + dz * dz <= r * r + r:
                    set(cx + dx, cy + dy, cz + dz, block)


def gable_roof(x0, z0, x1, z1, y, stairs, gable):
    slab = stairs.removesuffix("_stairs") + "_slab"
    for k in range(z1 - z0 + 3):
        near, far, level = z0 - 1 + k, z1 + 1 - k, y + k
        if near > far:
            return level - 1
        if near == far:
            fill(x0 - 1, level, near, x1 + 1, level, near, slab)
            return level
        fill(x0 - 1, level, near, x1 + 1, level, near, f"{{stairs}}[facing=south]")
        fill(x0 - 1, level, far, x1 + 1, level, far, f"{{stairs}}[facing=north]")
        if max(near + 1, z0) <= min(far - 1, z1):
            for x in (x0, x1):
                fill(x, level, max(near + 1, z0), x, level, min(far - 1, z1), gable)


def hip_roof(x0, z0, x1, z1, y, stairs):
    slab = stairs.removesuffix("_stairs") + "_slab"
    for k in range(max(x1 - x0, z1 - z0) + 3):
        a, b, c, d, level = x0 - 1 + k, x1 + 1 - k, z0 - 1 + k, z1 + 1 - k, y + k
        if a > b or c > d:
            return level - 1
        if a == b or c == d:
            fill(a, level, c, b, level, d, slab)
            return level
        fill(a, level, c, b, level, c, f"{{stairs}}[facing=south]")
        fill(a, level, d, b, level, d, f"{{stairs}}[facing=north]")
        if c + 1 <= d - 1:
            fill(a, level, c + 1, a, level, d - 1, f"{{stairs}}[facing=east]")
            fill(b, level, c + 1, b, level, d - 1, f"{{stairs}}[facing=west]")


def buttress(x, z, top):
    for depth, h in ((3, top // 3), (2, 2 * top // 3), (1, top)):
        fill(x, 1, z + 1, x, h, z + depth, "stone_bricks")
        set(x, h + 1, z + depth, "stone_brick_stairs[facing=north]")


def grove_tree(x, z, h, log="oak_log", leaves="oak_leaves"):
    y = top(x, z) + 1
    fill(x, y, z, x, y + h - 1, z, log)
    for _ in range(4):
        dx, dz = random.randint(-2, 2), random.randint(-2, 2)
        blob(x + dx, y + h - 1 - random.randint(0, 3), z + dz, random.choice((1.5, 2, 2.5)), leaves)
    set(x + 1, y + h - 4, z, log.replace("_log", "_log[axis=x]"))


def mound(cx, cz, r, h):
    lobes, phase = random.randint(2, 4), random.uniform(0, math.tau)
    for y in range(h + 1):
        reach = r * (1 - y / (h + 1)) + 1
        for x in range(int(cx - 1.15 * reach), int(cx + 1.15 * reach) + 1):
            for z in range(int(cz - 1.15 * reach), int(cz + 1.15 * reach) + 1):
                angle = math.atan2(z - cz, x - cx)
                if math.hypot(x - cx, z - cz) < reach * (1 + 0.15 * math.sin(lobes * angle + phase + y / 2)):
                    set(x, y, z, "grass_block")


def lamp(x, z, y=1):
    fill(x, y, z, x, y + 2, z, "cobblestone_wall")
    set(x, y + 3, z, "lantern")


step("Terrain")
mound(32, 34, 24, 0)
mound(15, 19, 10, 5)
mound(50, 20, 7, 3)
replace(0, 0, 0, {xmax}, {ymax}, {zmax}, "grass_block", "90%grass_block,4%coarse_dirt,3%moss_block,3%gravel")
x = 30
for z in range(44, 54):
    x += random.choice((-1, 0, 0, 1))
    fill(x, 0, z, x + 2, 0, z, "dirt_path")
for cx, cz, r in ((25, 50, 2.5), (40, 49, 2), (50, 38, 2)):
    blob(cx, 0, cz, r, "60%mossy_cobblestone,25%stone,15%andesite")

step("Hall")
fill(17, 1, 25, 46, 2, 42, PLINTH, "walls")
fill(18, 3, 26, 45, 12, 41, WALL, "walls")
for x in (20, 25, 37, 42):
    bay(x, 41, 5, 9)
for x in (18, 45):
    buttress(x, 41, 11)
fill(30, 1, 43, 33, 1, 43, "stone_brick_stairs[facing=north]")
fill(30, 2, 42, 33, 2, 42, "stone_brick_stairs[facing=north]")
clear(31, 3, 41, 32, 5, 41)
set(31, 3, 41, "spruce_door[facing=south]")
set(32, 3, 41, "spruce_door[facing=south]")
fill(30, 6, 42, 33, 6, 42, "spruce_stairs[facing=north,half=top]")
for x in (29, 34):
    lamp(x, 44)
fill(19, 7, 27, 44, 7, 39, "spruce_planks")
roof = gable_roof(18, 26, 45, 41, 13, "dark_oak_stairs", "spruce_planks")

step("Tower")
fill(20, 1, 20, 26, 36, 26, WALL, "walls")
for y in (15, 22, 29):
    bay(22, 26, y, y + 2)
fill(19, 33, 19, 27, 33, 27, "stone_brick_slab[type=top]")
fill(19, 34, 19, 27, 34, 27, "spruce_fence", "walls")
peak = hip_roof(20, 20, 26, 26, 37, "deepslate_tile_stairs")
fill(23, peak + 1, 23, 23, peak + 3, 23, "iron_chain")

step("Garden")
for x, z, kind, h in ((12, 30, "oak", 11), (51, 30, "birch", 13), (50, 44, "cherry", 8), (14, 44, "dark_oak", 9)):
    grove_tree(x, z, h, f"{{kind}}_log", f"{{kind}}_leaves")
overlay(0, 0, 0, {xmax}, {ymax}, {zmax}, "82%air,8%short_grass,4%fern,3%poppy,3%cornflower", on="grass_block")
```

# Coordinates
- x runs 0-{xmax} from west (left) to east (right), z runs 0-{zmax} from north (back) to south (front, the side the \
viewer faces), y is the height from 0. The land is yours to shape like the rest of the model: `mound` in the example lays it with \
an uneven edge, and water and paths sit in it.
- A door on a south wall stands at that wall's z with facing=south. Out of a south wall is +z, into it is -z.
- Blocks outside the site are cut off or skipped; unknown names are skipped with a "did you mean". Runs name every \
skipped call with the script line that made it.

# Block states
Add them in brackets: stairs [facing=north|south|east|west] (facing points to the tall back of the step; half=top \
hangs it upside down, for eaves, hoods, corbels and arches), slabs [type=bottom|top|double], logs [axis=x|y|z] for \
beams, doors [facing=south] (two blocks tall by themselves), trapdoors [open=true,facing=south] for shutters flat \
against a south face, [half=top] for a thin ledge. Fences, walls, panes and bars connect on their own; iron_chain \
and end_rod are thin vertical rods.

# Recipes
- Weathered wall: a pattern like `WALL` above, one block family in three or four variants. Moss or cracks on a \
finished part: `replace` its main block with a pattern of it and its weathered variants.
- Recessed window: `bay` above. The opening is cleared in the face, the pane sits one block in, a top slab is the \
sill, upside-down stairs are the hood, and a light block sits behind the glass.
- Pilasters: a column of *_wall blocks one block proud of the face between windows, capped with a slab.
- Cornice or string course: a row of upside-down stairs along the face at a floor line, the tall back against the wall.
- Stepped buttress: `buttress` above. Corner towers and chimney stacks step back the same way.
- Jettied upper floor: a row of upside-down stairs one block out at the floor line, then the upper walls built on it.
- Timber frame: white_terracotta or smooth_sandstone panels, dark_oak_log posts every 3 to 4 blocks, a plank belt \
[axis=x] or [axis=z] logs along each floor.
- Shutters: open trapdoors beside a window. Awning: a row of upside-down stairs or top slabs over a door.
- Balcony: a top-slab ledge one block out, a fence or wall railing on its edge, a lantern under it on an iron_chain.
- Arch: clear the opening, then an upside-down stair in each top corner, its tall back toward the jamb beside it \
(facing=west in the west corner, facing=east in the east corner).
- Round tower: a ring of blocks at each height (x, z with r - 1 < distance <= r, from math.hypot), window slots \
cleared at each storey, a cap of rings narrowing to a point and one block wider than the tower, a chain or end_rod \
finial.
- Stair railing: a *_wall or fence row along each open edge of a stair, a lamp post at the bottom.
- Planter: a *_wall rim with azalea_leaves or flowers on top; window boxes are a top slab with leaves above it.
- Trees: `grove_tree` above stands on `top(x, z)`, so it follows the land; vary species and heights. A cypress is a column of leaves 3 wide with \
the corners cleared and a 1-block tip.
- Terrain: `mound` above for the land (height 0) and for hills that climb toward the building; a `replace` of \
grass_block with a pattern for patches of coarse_dirt, moss_block and gravel; rock outcrops as `blob`s of a stone \
pattern half sunk in the land; a path that wanders; grass and flowers last, by `overlay` on grass_block.
- Pond: water set into the land, edged with sand, gravel or stone_brick_slab, reeds of sugar_cane, a stepping-stone path.
- Street lamp: `lamp` above. Hanging lamp: an iron_chain with a lantern under it, below an eave or an arch.

# Common blocks (`blocks find "<words>"` finds any other)
{blocks}"""


def guide(width: int = 64, depth: int = 64, height: int = 64) -> str:
    names = ", ".join(b for b in COMMON_BLOCKS if b in blocks.palette())
    return GUIDE.format(blocks=names, width=width, depth=depth, xmax=width - 1, zmax=depth - 1, ymax=height - 1)
