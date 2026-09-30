"""Overgrown Steampunk Manor, 64 blocks tall: a steep copper roof, timber-framed plaster and smoking chimneys."""


def ring(x0, y, z0, x1, z1, stairs, corner, extra=""):
    """A course of outward stairs around a rectangle, with `corner` blocks at the corners."""
    fill(x0 + 1, y, z0, x1 - 1, y, z0, f"{stairs}[facing=south{extra}]")
    fill(x0 + 1, y, z1, x1 - 1, y, z1, f"{stairs}[facing=north{extra}]")
    fill(x0, y, z0 + 1, x0, y, z1 - 1, f"{stairs}[facing=east{extra}]")
    fill(x1, y, z0 + 1, x1, y, z1 - 1, f"{stairs}[facing=west{extra}]")
    for x, z in ((x0, z0), (x1, z0), (x0, z1), (x1, z1)):
        set(x, y, z, corner)


def window(x, y, z, w, h, dx, dz, pane="glass_pane"):
    """A w by h window in a wall, lit from behind: (dx, dz) points into the house."""
    fill(x, y, z, x + (0 if dx else w - 1), y + h - 1, z + (0 if dz else w - 1), pane)
    fill(x + dx, y, z + dz, x + dx + (0 if dx else w - 1), y + h - 1, z + dz + (0 if dz else w - 1), "shroomlight")


# A tight blackstone plate with a slab lip, a deepslate podium for the house, and steps up to the door.
step("Stone plate and podium")
fill(17, 1, 20, 47, 1, 44, "polished_blackstone_bricks")
fill(16, 1, 21, 16, 1, 43, "polished_blackstone_brick_slab")
fill(48, 1, 21, 48, 1, 43, "polished_blackstone_brick_slab")
fill(18, 1, 19, 46, 1, 19, "polished_blackstone_brick_slab")
fill(18, 1, 45, 46, 1, 45, "polished_blackstone_brick_slab")
for x in range(18, 47, 2):
    for z in range(21, 44, 2):
        if (x + z) % 4 == 0:
            set(x, 1, z, "deepslate_tiles")
fill(23, 2, 26, 41, 2, 40, "deepslate_bricks")
fill(29, 2, 41, 35, 2, 41, "deepslate_brick_stairs[facing=north]")
fill(28, 2, 41, 28, 2, 42, "cobbled_deepslate_wall")
fill(36, 2, 41, 36, 2, 42, "cobbled_deepslate_wall")
set(28, 3, 42, "lantern")
set(36, 3, 42, "lantern")
for x, z in ((29, 43), (35, 43), (31, 43), (33, 43)):
    set(x, 1, z, "polished_andesite")

# Brick base and plaster walls in a dark oak frame, glowing windows, the front door with hanging lamps.
step("Ground floor")
fill(24, 3, 27, 40, 7, 39, "bricks", "walls")
fill(24, 5, 27, 40, 7, 39, "smooth_sandstone", "walls")
for x in (24, 28, 32, 36, 40):
    fill(x, 3, 39, x, 7, 39, "dark_oak_log")
    fill(x, 3, 27, x, 7, 27, "dark_oak_log")
for z in (27, 31, 35, 39):
    fill(24, 3, z, 24, 7, z, "dark_oak_log")
    fill(40, 3, z, 40, 7, z, "dark_oak_log")
fill(25, 5, 39, 39, 5, 39, "dark_oak_planks")
fill(25, 5, 27, 39, 5, 27, "dark_oak_planks")
fill(24, 5, 28, 24, 5, 38, "dark_oak_planks")
fill(40, 5, 28, 40, 5, 38, "dark_oak_planks")
for x in (26, 30, 34, 38):
    window(x, 6, 39, 1, 2, 0, -1)
for x in (26, 38):
    fill(x, 3, 39, x, 4, 39, "iron_bars")
for z in (29, 33, 37):
    window(40, 6, z, 1, 2, -1, 0)
    window(24, 6, z, 1, 2, 1, 0)
for x in (30, 34):
    fill(x, 3, 27, x, 4, 27, "iron_bars")
fill(31, 3, 39, 33, 4, 39, "dark_oak_planks")
set(32, 3, 39, "dark_oak_door[facing=south]")
set(31, 4, 40, "lantern")
set(33, 4, 40, "lantern")
set(31, 5, 40, "iron_chain")
set(33, 5, 40, "iron_chain")
fill(31, 5, 39, 33, 5, 39, "dark_oak_stairs[facing=north,half=top]")
fill(25, 3, 40, 27, 3, 40, "brick_wall")
fill(37, 3, 40, 39, 3, 40, "brick_wall")
fill(25, 4, 40, 27, 4, 40, "flowering_azalea_leaves")
fill(37, 4, 40, 39, 4, 40, "azalea_leaves")
fill(25, 3, 26, 39, 3, 26, "brick_slab")
fill(41, 3, 28, 41, 3, 38, "brick_slab")
fill(23, 3, 28, 23, 3, 38, "brick_slab")

# The upper floor steps out on oak corbels: plaster panels, a timber grid, paired windows with flower boxes.
step("Jettied upper floor")
fill(23, 8, 26, 41, 8, 40, "dark_oak_planks")
ring(23, 7, 26, 41, 40, "dark_oak_stairs", "dark_oak_planks", ",half=top")
fill(23, 9, 26, 41, 13, 40, "smooth_sandstone", "walls")
for x in (23, 27, 32, 37, 41):
    fill(x, 9, 40, x, 13, 40, "dark_oak_log")
    fill(x, 9, 26, x, 13, 26, "dark_oak_log")
for z in (26, 30, 33, 36, 40):
    fill(23, 9, z, 23, 13, z, "dark_oak_log")
    fill(41, 9, z, 41, 13, z, "dark_oak_log")
fill(24, 13, 40, 40, 13, 40, "stripped_dark_oak_log[axis=x]")
fill(24, 13, 26, 40, 13, 26, "stripped_dark_oak_log[axis=x]")
fill(23, 13, 27, 23, 13, 39, "stripped_dark_oak_log[axis=z]")
fill(41, 13, 27, 41, 13, 39, "stripped_dark_oak_log[axis=z]")
for x in (24, 29, 34, 39):
    window(x, 10, 40, 2, 2, 0, -1)
    fill(x, 8, 41, x + 1, 8, 41, "dark_oak_slab[type=top]")
    fill(x, 9, 41, x + 1, 9, 41, "azalea_leaves" if x % 2 else "flowering_azalea_leaves")
for x in (25, 29, 35):
    window(x, 10, 26, 2, 2, 0, 1)
for z in (28, 31, 34, 37):
    window(23, 10, z, 2, 2, 1, 0)
    window(41, 10, z, 2, 2, -1, 0)
for x, z in ((24, 27), (40, 27), (24, 39), (40, 39)):
    set(x, 9, z, "dark_oak_slab[type=top]")
fill(22, 9, 41, 22, 13, 41, "end_rod")
fill(42, 9, 41, 42, 13, 41, "end_rod")
set(22, 8, 41, "copper_lantern")
set(42, 8, 41, "copper_lantern")

# A steep oxidized copper roof, two blocks up per course, with blackstone gable trim and plaster gable ends
# framed in dark oak.
step("Copper roof")
for i in range(8):
    y, zn, zs = 13 + 2 * i, 25 + i, 41 - i
    fill(23, y, zn, 41, y, zn, "oxidized_cut_copper")
    fill(23, y, zs, 41, y, zs, "oxidized_cut_copper")
    fill(23, y + 1, zn, 41, y + 1, zn, "oxidized_cut_copper_stairs[facing=south]")
    fill(23, y + 1, zs, 41, y + 1, zs, "oxidized_cut_copper_stairs[facing=north]")
    for x in (22, 42):
        fill(x, y, zn, x, y, zn, "polished_blackstone_bricks")
        fill(x, y, zs, x, y, zs, "polished_blackstone_bricks")
        set(x, y + 1, zn, "polished_blackstone_brick_stairs[facing=south]")
        set(x, y + 1, zs, "polished_blackstone_brick_stairs[facing=north]")
    if zn + 1 <= zs - 1:
        fill(23, y if i else y + 1, zn + 1, 23, y + 1, zs - 1, "smooth_sandstone")
        fill(41, y if i else y + 1, zn + 1, 41, y + 1, zs - 1, "smooth_sandstone")
for x0, x1, i, south in (
    (25, 26, 2, True),
    (31, 32, 4, True),
    (38, 39, 1, True),
    (24, 24, 5, True),
    (35, 36, 6, False),
    (28, 29, 3, False),
    (40, 41, 5, False),
    (33, 33, 0, False),
):
    y = 13 + 2 * i
    z = 41 - i if south else 25 + i
    fill(x0, y, z, x1, y, z, "weathered_cut_copper")
    fill(x0, y + 1, z, x1, y + 1, z, f"weathered_cut_copper_stairs[facing={'north' if south else 'south'}]")
fill(22, 29, 33, 42, 29, 33, "oxidized_cut_copper")
fill(22, 30, 33, 42, 30, 33, "polished_blackstone_brick_slab")
for x in (23, 41):
    fill(x, 14, 33, x, 28, 33, "dark_oak_log")
    fill(x, 14, 29, x, 22, 29, "dark_oak_log")
    fill(x, 14, 37, x, 22, 37, "dark_oak_log")
    fill(x, 18, 30, x, 18, 36, "dark_oak_planks")
    fill(x, 23, 31, x, 23, 35, "dark_oak_planks")
for x, dx in ((23, 1), (41, -1)):
    window(x, 15, 31, 2, 2, dx, 0)
    window(x, 15, 34, 2, 2, dx, 0)
    window(x, 20, 32, 1, 2, dx, 0)
    window(x, 20, 34, 1, 2, dx, 0)
set(23, 25, 33, "yellow_stained_glass_pane")
set(41, 25, 33, "yellow_stained_glass_pane")
set(24, 25, 33, "shroomlight")
set(40, 25, 33, "shroomlight")

# Two copper-capped dormers on the front slope, hanging lanterns along the eaves, and leaf clumps taking root
# on the roof.
step("Dormers and eaves")
for x in (27, 35):
    fill(x, 16, 38, x + 2, 16, 40, "dark_oak_planks")
    fill(x, 17, 39, x + 2, 19, 40, "smooth_sandstone", "walls")
    fill(x, 17, 40, x, 19, 40, "dark_oak_log")
    fill(x + 2, 17, 40, x + 2, 19, 40, "dark_oak_log")
    window(x + 1, 17, 40, 1, 2, 0, -1, "orange_stained_glass_pane")
    fill(x - 1, 20, 40, x + 3, 20, 40, "weathered_cut_copper_stairs[facing=north]")
    fill(x - 1, 20, 38, x + 3, 20, 39, "weathered_copper")
    fill(x, 21, 38, x + 2, 21, 39, "weathered_cut_copper_stairs[facing=north]")
    fill(x, 22, 37, x + 2, 22, 38, "weathered_cut_copper_slab")
    set(x + 1, 20, 41, "lantern")
for x in (25, 39):
    set(x, 12, 41, "iron_chain")
    set(x, 11, 41, "lantern")
for x in (27, 33):
    set(x, 12, 25, "iron_chain")
    set(x, 11, 25, "lantern")
for x, y, z, w in (
    (24, 15, 40, 2),
    (32, 17, 39, 2),
    (38, 15, 41, 1),
    (30, 21, 37, 2),
    (26, 19, 38, 1),
    (36, 23, 36, 2),
    (29, 15, 27, 2),
    (37, 17, 28, 1),
    (33, 19, 29, 2),
    (26, 21, 30, 2),
    (39, 21, 30, 2),
    (23, 23, 35, 2),
    (40, 25, 34, 1),
    (28, 25, 32, 2),
    (24, 13, 42, 2),
    (40, 13, 42, 1),
):
    fill(x, y, z, x + w - 1, y, z, "oak_leaves" if (x + z) % 3 else "azalea_leaves")
for x, y, z in (
    (25, 16, 40),
    (33, 18, 39),
    (31, 22, 37),
    (37, 24, 36),
    (30, 16, 27),
    (34, 20, 29),
    (27, 22, 30),
    (24, 24, 35),
):
    set(x, y, z, "moss_block")
fill(30, 27, 32, 34, 27, 32, "moss_block")
fill(31, 27, 34, 33, 27, 34, "moss_block")
fill(26, 29, 33, 28, 30, 33, "azalea_leaves")
fill(36, 29, 33, 37, 30, 33, "oak_leaves")

# A tall square turret on the north-east corner: deepslate base, brick band, plaster, and a copper pyramid roof
# with its own stack.
step("Corner turret")
fill(39, 2, 21, 45, 6, 27, "deepslate_bricks", "walls")
fill(39, 7, 21, 45, 8, 27, "bricks", "walls")
fill(39, 9, 21, 45, 17, 27, "smooth_sandstone", "walls")
fill(39, 18, 21, 45, 18, 27, "dark_oak_planks", "walls")
fill(39, 19, 21, 45, 22, 27, "bricks", "walls")
for x, z in ((39, 21), (45, 21), (39, 27), (45, 27)):
    fill(x, 2, z, x, 22, z, "polished_basalt")
for x, z in ((42, 21), (42, 27), (39, 24), (45, 24)):
    fill(x, 9, z, x, 17, z, "dark_oak_log")
fill(40, 13, 21, 44, 13, 21, "dark_oak_planks")
fill(40, 13, 27, 44, 13, 27, "dark_oak_planks")
fill(39, 13, 22, 39, 13, 26, "dark_oak_planks")
fill(45, 13, 22, 45, 13, 26, "dark_oak_planks")
window(45, 10, 23, 1, 2, -1, 0)
window(45, 10, 25, 1, 2, -1, 0)
window(45, 15, 24, 1, 2, -1, 0)
window(43, 10, 21, 1, 2, 0, 1)
window(41, 10, 21, 1, 2, 0, 1)
window(42, 15, 21, 1, 2, 0, 1)
window(45, 20, 24, 1, 2, -1, 0, "orange_stained_glass_pane")
window(42, 20, 21, 1, 2, 0, 1, "orange_stained_glass_pane")
fill(40, 5, 20, 44, 5, 20, "deepslate_brick_slab[type=top]")
fill(46, 5, 22, 46, 5, 26, "deepslate_brick_slab[type=top]")
ring(38, 23, 20, 46, 28, "oxidized_cut_copper_stairs", "polished_blackstone_bricks")
fill(39, 23, 21, 45, 23, 27, "oxidized_cut_copper")
for i in range(3):
    y, x0, z0, x1, z1 = 24 + 2 * i, 39 + i, 21 + i, 45 - i, 27 - i
    copper = "weathered" if i == 1 else "oxidized"
    fill(x0, y, z0, x1, y, z1, f"{copper}_cut_copper")
    ring(x0, y + 1, z0, x1, z1, f"{copper}_cut_copper_stairs", f"{copper}_cut_copper")
    fill(x0 + 1, y + 1, z0 + 1, x1 - 1, y + 1, z1 - 1, f"{copper}_cut_copper")
set(42, 30, 24, "oxidized_cut_copper")
set(42, 31, 24, "polished_blackstone_brick_wall")
fill(42, 32, 24, 42, 34, 24, "lightning_rod")
set(42, 35, 24, "copper_lantern")
fill(45, 20, 21, 45, 33, 21, "polished_blackstone_bricks")
set(45, 34, 21, "cobbled_deepslate_wall")
set(45, 35, 21, "copper_lantern")

# A stepped deepslate wing on the west, half swallowed by leaves and moss, with lantern posts on its ledges.
step("Overgrown west wing")
fill(17, 2, 28, 23, 5, 40, "deepslate_bricks")
fill(18, 6, 29, 23, 8, 39, "cobbled_deepslate")
fill(20, 9, 30, 22, 11, 38, "deepslate_bricks")
fill(21, 12, 31, 22, 13, 37, "cobbled_deepslate")
fill(17, 2, 28, 17, 5, 40, "deepslate_tiles")
fill(17, 2, 28, 23, 5, 28, "deepslate_tiles")
fill(17, 2, 40, 23, 5, 40, "deepslate_tiles")
fill(17, 6, 29, 17, 6, 39, "deepslate_tile_slab")
fill(18, 9, 30, 19, 9, 38, "cobbled_deepslate_slab")
fill(20, 12, 31, 20, 12, 37, "deepslate_brick_slab")
for x, y, z in (
    (17, 6, 30),
    (18, 6, 31),
    (17, 7, 34),
    (18, 6, 36),
    (17, 6, 39),
    (19, 9, 32),
    (20, 9, 36),
    (18, 9, 37),
    (21, 12, 33),
    (21, 14, 32),
    (22, 14, 35),
    (21, 12, 37),
    (19, 6, 33),
    (20, 7, 34),
    (16, 2, 30),
    (16, 2, 37),
):
    fill(x, y, z, x + 1, y, z + 1, "oak_leaves" if y % 2 else "azalea_leaves")
for x, y, z in ((18, 6, 33), (20, 9, 31), (21, 12, 36), (18, 6, 38), (20, 9, 34), (16, 2, 34)):
    set(x, y, z, "moss_block")
for x, y, z in ((17, 6, 28), (17, 6, 40), (19, 9, 30), (19, 9, 38), (20, 12, 31)):
    fill(x, y, z, x, y + 1, z, "dark_oak_fence")
    set(x, y + 2, z, "lantern")
for z in (31, 35):
    fill(17, 3, z, 17, 4, z, "iron_bars")
fill(20, 14, 34, 20, 20, 34, "polished_blackstone_bricks")
set(20, 21, 34, "cobbled_deepslate_wall")
set(20, 22, 34, "lantern")
fill(21, 13, 34, 22, 13, 34, "copper_block")
set(23, 13, 34, "copper_grate")

# Blackstone chimney stacks punch through the roof, capped with lantern crowns, and puffs of smoke drift up.
step("Chimneys and smoke")


def stack(x0, z0, x1, z1, y0, y1):
    """A chimney from y0 to y1 with a tiled cap, a lantern crown and a few puffs of smoke."""
    fill(x0, y0, z0, x1, y1, z1, "polished_blackstone_bricks")
    fill(x0, y1 + 1, z0, x1, y1 + 1, z1, "deepslate_tiles")
    fill(x0, y1 + 2, z0, x1, y1 + 2, z1, "cobbled_deepslate_wall")
    set(x0, y1 + 3, z0, "copper_lantern")
    for dx, dy, dz, block in ((0, 5, 0, "white_wool"), (1, 6, 0, "white_wool"), (0, 8, 1, "light_gray_wool")):
        set(x0 + dx, y1 + dy, z0 + dz, block)


stack(25, 30, 26, 31, 9, 33)
stack(37, 35, 37, 35, 14, 28)
stack(30, 28, 30, 28, 14, 27)
stack(34, 37, 34, 37, 20, 27)
fill(25, 36, 30, 26, 36, 31, "copper_lantern")

# Copper pipes climb the walls, end rods carry lamps along the corners, and chains hang lanterns under the jetty.
step("Pipes, rods and lamps")
fill(42, 2, 30, 42, 12, 30, "copper_block")
set(42, 8, 30, "copper_grate")
set(42, 13, 30, "cut_copper_stairs[facing=west,half=top]")
fill(43, 2, 30, 44, 2, 30, "copper_block")
set(44, 3, 30, "lightning_rod")
fill(28, 2, 25, 28, 11, 25, "exposed_copper")
set(28, 7, 25, "exposed_copper_grate")
set(28, 12, 25, "exposed_lightning_rod")
fill(42, 15, 36, 42, 15, 38, "weathered_copper")
fill(42, 14, 36, 42, 14, 36, "weathered_copper")
set(42, 16, 38, "weathered_lightning_rod")
for x in (24, 28, 36, 40):
    set(x, 6, 40, "iron_chain")
    set(x, 5, 40, "lantern")
for x, z in ((46, 20), (46, 28)):
    fill(x, 2, z, x, 9, z, "end_rod")
    set(x, 10, z, "copper_lantern")
fill(38, 2, 41, 38, 4, 41, "end_rod")
set(38, 5, 41, "copper_lantern")
fill(26, 2, 41, 26, 4, 41, "end_rod")
set(26, 5, 41, "copper_lantern")
for x, z in ((19, 42), (45, 42), (19, 22)):
    fill(x, 2, z, x, 2, z, "moss_block")
    set(x, 3, z, "azalea_leaves")
fill(18, 2, 43, 21, 2, 43, "flowering_azalea_leaves")
fill(43, 2, 43, 46, 2, 43, "azalea_leaves")
for x, z in ((20, 24), (44, 33), (23, 43), (42, 43), (38, 43)):
    set(x, 2, z, "fern")
    set(x + 1, 2, z, "short_grass")
set(30, 2, 43, "poppy")
set(34, 2, 43, "dandelion")
set(46, 2, 30, "cornflower")
set(44, 2, 38, "barrel")
set(44, 3, 38, "barrel")
set(45, 2, 38, "cauldron")
set(44, 2, 39, "barrel")
