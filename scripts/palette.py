# /// script
# dependencies = ["pillow"]
# ///
"""Generate server/blockyard/blocks.json and a texture sheet of what it needs from a Faithful 32x resource pack.

    uv run scripts/palette.py path/to/faithful/assets/minecraft/textures/block path/to/client-jar/assets/minecraft

The hand-tagged blocks below come first; every other vanilla block whose model maps onto a known shape follows.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "server" / "blockyard" / "blocks.json"
TEXTURES = ROOT / "web" / "public" / "textures"
TILE = 32

COLORS = [
    "white", "light_gray", "gray", "black", "brown", "red", "orange", "yellow", "lime", "green", "cyan",
    "light_blue", "blue", "purple", "magenta", "pink",
]  # fmt: skip
WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "bamboo", "crimson", "warped"]
GRASS, FOLIAGE, WATER = "#79c05a", "#59ae30", "#3f76e4"

# name -> (texture, tags); a texture may be a dict of faces (top, bottom, side) or a base+overlay for tinted grass
PLAIN: dict[str, tuple] = {
    "stone": ("stone", "gray rock"),
    "cobblestone": ("cobblestone", "gray rock rustic"),
    "mossy_cobblestone": ("mossy_cobblestone", "gray green rock rustic"),
    "stone_bricks": ("stone_bricks", "gray brick wall castle"),
    "mossy_stone_bricks": ("mossy_stone_bricks", "gray green brick wall castle"),
    "cracked_stone_bricks": ("cracked_stone_bricks", "gray brick wall ruin"),
    "chiseled_stone_bricks": ("chiseled_stone_bricks", "gray brick ornament"),
    "smooth_stone": ("smooth_stone", "gray flat"),
    "andesite": ("andesite", "gray rock"),
    "polished_andesite": ("polished_andesite", "gray smooth"),
    "granite": ("granite", "pink red rock"),
    "polished_granite": ("polished_granite", "pink red smooth"),
    "diorite": ("diorite", "white rock"),
    "polished_diorite": ("polished_diorite", "white smooth"),
    "deepslate": ({"top": "deepslate_top", "side": "deepslate"}, "dark gray rock"),
    "cobbled_deepslate": ("cobbled_deepslate", "dark gray rock"),
    "polished_deepslate": ("polished_deepslate", "dark gray smooth"),
    "deepslate_bricks": ("deepslate_bricks", "dark gray brick castle"),
    "deepslate_tiles": ("deepslate_tiles", "dark gray tile roof"),
    "tuff": ("tuff", "gray rock"),
    "calcite": ("calcite", "white rock"),
    "dripstone_block": ("dripstone_block", "brown rock"),
    "blackstone": ("blackstone", "black rock"),
    "polished_blackstone": ("polished_blackstone", "black smooth"),
    "polished_blackstone_bricks": ("polished_blackstone_bricks", "black brick"),
    "bricks": ("bricks", "red brick wall"),
    "nether_bricks": ("nether_bricks", "dark red brick"),
    "red_nether_bricks": ("red_nether_bricks", "red brick"),
    "mud_bricks": ("mud_bricks", "brown brick adobe"),
    "packed_mud": ("packed_mud", "brown adobe"),
    "sandstone": ({"top": "sandstone_top", "bottom": "sandstone_bottom", "side": "sandstone"}, "yellow desert"),
    "smooth_sandstone": ("sandstone_top", "yellow desert smooth"),
    "cut_sandstone": ({"top": "sandstone_top", "bottom": "sandstone_bottom", "side": "cut_sandstone"}, "yellow desert"),
    "chiseled_sandstone": ({"top": "sandstone_top", "bottom": "sandstone_bottom", "side": "chiseled_sandstone"}, "yellow desert ornament"),
    "red_sandstone": ({"top": "red_sandstone_top", "bottom": "red_sandstone_bottom", "side": "red_sandstone"}, "orange desert"),
    "smooth_red_sandstone": ("red_sandstone_top", "orange desert smooth"),
    "quartz_block": ({"top": "quartz_block_top", "bottom": "quartz_block_bottom", "side": "quartz_block_side"}, "white smooth marble"),
    "smooth_quartz": ("quartz_block_bottom", "white smooth marble"),
    "quartz_bricks": ("quartz_bricks", "white brick marble"),
    "chiseled_quartz_block": ({"top": "chiseled_quartz_block_top", "bottom": "chiseled_quartz_block_top", "side": "chiseled_quartz_block"}, "white ornament marble"),
    "quartz_pillar": ({"top": "quartz_pillar_top", "bottom": "quartz_pillar_top", "side": "quartz_pillar"}, "white column marble"),
    "purpur_block": ("purpur_block", "purple"),
    "prismarine": ("prismarine", "teal sea"),
    "prismarine_bricks": ("prismarine_bricks", "teal sea brick"),
    "dark_prismarine": ("dark_prismarine", "dark teal sea"),
    "end_stone_bricks": ("end_stone_bricks", "pale yellow brick"),
    "obsidian": ("obsidian", "black purple"),
    "crying_obsidian": ("crying_obsidian", "black purple glow"),
    "netherrack": ("netherrack", "red"),
    "soul_sand": ("soul_sand", "brown"),
    "magma_block": ("magma", "orange glow lava"),
    "glowstone": ("glowstone", "yellow light glow lamp"),
    "sea_lantern": ("sea_lantern", "white light glow lamp"),
    "shroomlight": ("shroomlight", "orange light glow lamp"),
    "gold_block": ("gold_block", "yellow metal shiny"),
    "iron_block": ("iron_block", "white metal"),
    "diamond_block": ("diamond_block", "cyan gem shiny"),
    "emerald_block": ("emerald_block", "green gem shiny"),
    "lapis_block": ("lapis_block", "blue"),
    "redstone_block": ("redstone_block", "red"),
    "coal_block": ("coal_block", "black"),
    "copper_block": ("copper_block", "orange metal"),
    "exposed_copper": ("exposed_copper", "orange teal metal"),
    "weathered_copper": ("weathered_copper", "teal metal"),
    "oxidized_copper": ("oxidized_copper", "teal green metal roof"),
    "cut_copper": ("cut_copper", "orange metal"),
    "exposed_cut_copper": ("exposed_cut_copper", "orange teal metal"),
    "weathered_cut_copper": ("weathered_cut_copper", "teal metal"),
    "oxidized_cut_copper": ("oxidized_cut_copper", "teal green metal roof"),
    "chiseled_copper": ("chiseled_copper", "orange metal ornament"),
    "exposed_chiseled_copper": ("exposed_chiseled_copper", "orange teal metal ornament"),
    "weathered_chiseled_copper": ("weathered_chiseled_copper", "teal metal ornament"),
    "oxidized_chiseled_copper": ("oxidized_chiseled_copper", "teal green metal ornament"),
    "raw_copper_block": ("raw_copper_block", "orange rough metal ore"),
    "copper_bulb": ("copper_bulb_lit", "orange metal light lamp glow"),
    "exposed_copper_bulb": ("exposed_copper_bulb_lit", "teal metal light lamp glow"),
    "weathered_copper_bulb": ("weathered_copper_bulb_lit", "teal metal light lamp glow"),
    "oxidized_copper_bulb": ("oxidized_copper_bulb_lit", "green metal light lamp glow"),
    "tuff_bricks": ("tuff_bricks", "gray brick"),
    "polished_tuff": ("polished_tuff", "gray smooth"),
    "chiseled_tuff": ({"top": "chiseled_tuff_top", "side": "chiseled_tuff"}, "gray ornament"),
    "chiseled_tuff_bricks": ({"top": "chiseled_tuff_bricks_top", "side": "chiseled_tuff_bricks"}, "gray brick ornament"),
    "smooth_basalt": ("smooth_basalt", "dark gray smooth"),
    "gilded_blackstone": ("gilded_blackstone", "black gold ornament"),
    "chiseled_polished_blackstone": ("chiseled_polished_blackstone", "black ornament"),
    "cracked_polished_blackstone_bricks": ("cracked_polished_blackstone_bricks", "black brick ruin"),
    "cracked_deepslate_tiles": ("cracked_deepslate_tiles", "dark gray tile ruin"),
    "redstone_lamp": ("redstone_lamp_on", "yellow light lamp glow"),
    "barrel": ({"top": "barrel_top", "bottom": "barrel_bottom", "side": "barrel_side"}, "wood storage cask"),
    "furnace": ({"top": "furnace_top", "bottom": "furnace_top", "side": "furnace_front_on"}, "stone oven fire machine"),
    "blast_furnace": ({"top": "blast_furnace_top", "bottom": "blast_furnace_top", "side": "blast_furnace_front_on"}, "metal oven fire machine boiler"),
    "smoker": ({"top": "smoker_top", "bottom": "smoker_bottom", "side": "smoker_front_on"}, "wood oven fire machine"),
    "piston": ({"top": "piston_top", "bottom": "piston_bottom", "side": "piston_side"}, "machine mechanical"),
    "observer": ({"top": "observer_top", "bottom": "observer_top", "side": "observer_side"}, "machine mechanical"),
    "lodestone": ({"top": "lodestone_top", "bottom": "lodestone_top", "side": "lodestone_side"}, "metal machine"),
    "smithing_table": ({"top": "smithing_table_top", "bottom": "smithing_table_bottom", "side": "smithing_table_side"}, "workshop tools"),
    "cartography_table": ({"top": "cartography_table_top", "bottom": "dark_oak_planks", "side": "cartography_table_side1"}, "workshop maps"),
    "loom": ({"top": "loom_top", "bottom": "loom_bottom", "side": "loom_side"}, "workshop fabric"),
    "note_block": ("note_block", "wood music"),
    "jukebox": ({"top": "jukebox_top", "bottom": "jukebox_side", "side": "jukebox_side"}, "wood music"),
    "target": ({"top": "target_top", "bottom": "target_top", "side": "target_side"}, "red white circle"),
    "cauldron": ({"top": "cauldron_top", "bottom": "cauldron_bottom", "side": "cauldron_side"}, "iron pot"),
    "anvil": ({"top": "anvil_top", "bottom": "anvil", "side": "anvil"}, "iron workshop"),
    "honey_block": ({"top": "honey_block_top", "bottom": "honey_block_bottom", "side": "honey_block_side"}, "orange transparent"),
    "amethyst_block": ("amethyst_block", "purple gem"),
    "bone_block": ({"top": "bone_block_top", "side": "bone_block_side"}, "white column"),
    "honeycomb_block": ("honeycomb_block", "orange"),
    "grass_block": ({"top": ("grass_block_top", GRASS), "bottom": "dirt", "side": ("dirt", "grass_block_side_overlay", GRASS)}, "green ground lawn"),
    "dirt": ("dirt", "brown ground"),
    "coarse_dirt": ("coarse_dirt", "brown ground path"),
    "dirt_path": ({"top": "dirt_path_top", "bottom": "dirt", "side": "dirt_path_side"}, "brown ground path"),
    "mud": ("mud", "brown ground"),
    "moss_block": ("moss_block", "green ground"),
    "podzol": ({"top": "podzol_top", "bottom": "dirt", "side": "podzol_side"}, "brown ground forest"),
    "sand": ("sand", "yellow beach desert"),
    "red_sand": ("red_sand", "orange desert"),
    "gravel": ("gravel", "gray path"),
    "clay": ("clay", "gray"),
    "snow_block": ("snow", "white winter"),
    "ice": ("ice", "blue winter transparent"),
    "packed_ice": ("packed_ice", "blue winter"),
    "blue_ice": ("blue_ice", "blue winter"),
    "hay_block": ({"top": "hay_block_top", "side": "hay_block_side"}, "yellow farm straw thatch"),
    "bookshelf": ({"top": "oak_planks", "bottom": "oak_planks", "side": "bookshelf"}, "library books"),
    "melon": ({"top": "melon_top", "bottom": "melon_top", "side": "melon_side"}, "green farm"),
    "pumpkin": ({"top": "pumpkin_top", "bottom": "pumpkin_top", "side": "pumpkin_side"}, "orange farm"),
    "cactus": ({"top": "cactus_top", "bottom": "cactus_bottom", "side": "cactus_side"}, "green desert plant"),
    "sponge": ("sponge", "yellow"),
    "terracotta": ("terracotta", "orange brown clay roof"),
    "water": (("water_still", WATER), "blue liquid pond river sea"),
    "lava": ("lava_still", "orange liquid"),
    "glass": ("glass", "transparent window"),
    "tinted_glass": ("tinted_glass", "dark transparent window"),
}


def entry(tex, tags: str, **extra) -> dict:
    return {"tex": tex, "tags": tags, **extra}


def main(pack: Path, assets: Path) -> None:
    blocks: dict[str, dict] = {}
    for name, (tex, tags) in PLAIN.items():
        blocks[name] = entry(tex, tags)
    blocks["glass"]["transparent"] = True
    blocks["tinted_glass"]["transparent"] = True
    blocks["ice"]["transparent"] = True
    blocks["honey_block"]["transparent"] = True
    for ox in ("", "exposed_", "weathered_", "oxidized_"):
        tone = {"": "orange", "exposed_": "orange teal", "weathered_": "teal", "oxidized_": "green"}[ox]
        blocks[f"{ox}copper_grate"] = entry(f"{ox}copper_grate", f"{tone} metal mesh vent", cutout=True)
        blocks[f"{ox}copper_bars"] = entry(f"{ox}copper_bars", f"{tone} metal thin railing", shape="pane", cutout=True)
        blocks[f"{ox}copper_trapdoor"] = entry(f"{ox}copper_trapdoor", f"{tone} metal hatch plate thin", shape="trapdoor", cutout=True)
        blocks[f"{ox}copper_door"] = entry({"bottom": f"{ox}copper_door_bottom", "top": f"{ox}copper_door_top"}, f"{tone} metal entrance", shape="door", cutout=True)
        blocks[f"{ox}copper_lantern"] = entry(f"{ox}copper_lantern", f"{tone} light hanging small", shape="lantern", cutout=True)
        blocks[f"{ox}copper_chain"] = entry(f"{ox}copper_chain", f"{tone} metal chain hanging thin", shape="rod", cutout=True)
        blocks[f"{ox}lightning_rod"] = entry(f"{ox}lightning_rod", f"{tone} metal antenna pipe thin", shape="rod", cutout=True)
    blocks["iron_chain"] = entry("iron_chain", "metal chain hanging thin", shape="rod", cutout=True)
    blocks["end_rod"] = entry("end_rod", "white light pole thin glow", shape="rod", cutout=True)
    blocks["copper_torch"] = entry("copper_torch", "light fire small", shape="torch", cutout=True)
    blocks["basalt"] = entry({"top": "basalt_top", "side": "basalt_side"}, "dark gray column pillar", shape="log")
    blocks["polished_basalt"] = entry({"top": "polished_basalt_top", "side": "polished_basalt_side"}, "dark gray smooth column pillar", shape="log")
    blocks["water"]["transparent"] = True
    blocks["water"]["liquid"] = True
    blocks["lava"]["liquid"] = True
    for c in COLORS:
        blocks[f"{c}_wool"] = entry(f"{c}_wool", f"{c.replace('_', ' ')} soft fabric")
        blocks[f"{c}_concrete"] = entry(f"{c}_concrete", f"{c.replace('_', ' ')} smooth flat modern")
        blocks[f"{c}_terracotta"] = entry(f"{c}_terracotta", f"{c.replace('_', ' ')} clay muted")
        blocks[f"{c}_stained_glass"] = entry(f"{c}_stained_glass", f"{c.replace('_', ' ')} transparent window", transparent=True)
        blocks[f"{c}_stained_glass_pane"] = entry(f"{c}_stained_glass", f"{c.replace('_', ' ')} thin window", shape="pane", transparent=True)
        blocks[f"{c}_carpet"] = entry(f"{c}_wool", f"{c.replace('_', ' ')} rug floor thin", shape="carpet")
    blocks["glass_pane"] = entry("glass", "thin window", shape="pane", transparent=True)
    blocks["iron_bars"] = entry("iron_bars", "metal thin window prison", shape="pane", cutout=True)
    for w in WOODS:
        pretty = w.replace("_", " ")
        blocks[f"{w}_planks"] = entry(f"{w}_planks", f"{pretty} wood floor wall")
        blocks[f"{w}_stairs"] = entry(f"{w}_planks", f"{pretty} wood roof", shape="stairs")
        blocks[f"{w}_slab"] = entry(f"{w}_planks", f"{pretty} wood half", shape="slab")
        blocks[f"{w}_fence"] = entry(f"{w}_planks", f"{pretty} wood railing", shape="fence")
        if w not in ("crimson", "warped", "bamboo"):
            blocks[f"{w}_log"] = entry({"top": f"{w}_log_top", "side": f"{w}_log"}, f"{pretty} wood trunk tree pillar", shape="log")
            blocks[f"stripped_{w}_log"] = entry({"top": f"stripped_{w}_log_top", "side": f"stripped_{w}_log"}, f"{pretty} wood beam pillar", shape="log")
            blocks[f"{w}_door"] = entry({"bottom": f"{w}_door_bottom", "top": f"{w}_door_top"}, f"{pretty} wood entrance", shape="door", cutout=True)
            blocks[f"{w}_trapdoor"] = entry(f"{w}_trapdoor", f"{pretty} wood hatch plate thin", shape="trapdoor", cutout=True)
    blocks["iron_door"] = entry({"bottom": "iron_door_bottom", "top": "iron_door_top"}, "metal entrance", shape="door", cutout=True)
    for leaf in ("oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove"):
        blocks[f"{leaf}_leaves"] = entry((f"{leaf}_leaves", FOLIAGE), f"{leaf.replace('_', ' ')} tree green foliage", cutout=True)
    blocks["azalea_leaves"] = entry("azalea_leaves", "tree green foliage", cutout=True)
    blocks["flowering_azalea_leaves"] = entry("flowering_azalea_leaves", "tree pink foliage", cutout=True)
    blocks["cherry_leaves"] = entry("cherry_leaves", "tree pink foliage blossom", cutout=True)
    for stone in (
        "stone", "cobblestone", "mossy_cobblestone", "stone_brick", "mossy_stone_brick", "andesite", "polished_andesite",
        "granite", "polished_granite", "diorite", "polished_diorite", "cobbled_deepslate", "polished_deepslate",
        "deepslate_brick", "deepslate_tile", "blackstone", "polished_blackstone", "polished_blackstone_brick", "brick",
        "nether_brick", "red_nether_brick", "mud_brick", "sandstone", "smooth_sandstone", "red_sandstone",
        "smooth_red_sandstone", "quartz", "smooth_quartz", "purpur", "prismarine", "prismarine_brick", "dark_prismarine",
        "end_stone_brick", "cut_copper", "exposed_cut_copper", "weathered_cut_copper", "oxidized_cut_copper", "smooth_stone",
        "tuff", "tuff_brick", "polished_tuff", "smooth_basalt",
    ):  # fmt: skip
        base = {"stone_brick": "stone_bricks", "mossy_stone_brick": "mossy_stone_bricks", "deepslate_brick": "deepslate_bricks",
                "deepslate_tile": "deepslate_tiles", "polished_blackstone_brick": "polished_blackstone_bricks", "brick": "bricks",
                "nether_brick": "nether_bricks", "red_nether_brick": "red_nether_bricks", "mud_brick": "mud_bricks",
                "quartz": "quartz_block", "purpur": "purpur_block", "prismarine_brick": "prismarine_bricks",
                "end_stone_brick": "end_stone_bricks", "tuff_brick": "tuff_bricks"}.get(stone, stone)  # fmt: skip
        tex = blocks[base]["tex"]
        tags = blocks[base]["tags"]
        blocks[f"{stone}_stairs"] = entry(tex, f"{tags} roof steps", shape="stairs")
        blocks[f"{stone}_slab"] = entry(tex, f"{tags} half", shape="slab")
        if stone not in ("stone", "smooth_stone", "polished_andesite", "polished_granite", "polished_diorite", "quartz",
                         "smooth_quartz", "purpur", "smooth_sandstone", "smooth_red_sandstone", "cut_copper", "dark_prismarine",
                         "prismarine_brick", "polished_blackstone", "exposed_cut_copper", "weathered_cut_copper",
                         "oxidized_cut_copper", "smooth_basalt"):  # fmt: skip
            blocks[f"{stone}_wall"] = entry(tex, f"{tags} low fence parapet", shape="wall")
    for plant, tags in {
        "short_grass": (GRASS, "green plant lawn tuft"), "fern": (GRASS, "green plant forest"), "dead_bush": (None, "brown plant desert"),
        "dandelion": (None, "yellow flower"), "poppy": (None, "red flower"), "blue_orchid": (None, "blue flower"),
        "allium": (None, "purple flower"), "azure_bluet": (None, "white flower"), "red_tulip": (None, "red flower"),
        "orange_tulip": (None, "orange flower"), "white_tulip": (None, "white flower"), "pink_tulip": (None, "pink flower"),
        "oxeye_daisy": (None, "white flower"), "cornflower": (None, "blue flower"), "lily_of_the_valley": (None, "white flower"),
        "oak_sapling": (None, "small tree plant"), "spruce_sapling": (None, "small tree plant"), "birch_sapling": (None, "small tree plant"),
        "sugar_cane": (GRASS, "green plant reed water"), "cobweb": (None, "white spider ruin"),
    }.items():  # fmt: skip
        tint, words = tags
        blocks[plant] = entry((plant, tint) if tint else plant, words, shape="cross", cutout=True)
    blocks["torch"] = entry("torch", "light fire small", shape="torch", cutout=True)
    blocks["lantern"] = entry("lantern", "light hanging small", shape="lantern", cutout=True)
    blocks["soul_lantern"] = entry("soul_lantern", "blue light hanging small", shape="lantern", cutout=True)
    blocks["snow"] = entry("snow", "white winter thin layer", shape="carpet")
    blocks["ladder"] = entry("ladder", "wood climb", shape="ladder", cutout=True)
    for name, tags in {"vine": "green plant climbing ivy", "glow_lichen": "green plant climbing glow"}.items():
        blocks[name] = entry((name, FOLIAGE) if name == "vine" else name, tags, shape="face", cutout=True)
    for name, tags in {"tall_grass": "green plant lawn meadow", "large_fern": "green plant forest"}.items():
        blocks[name] = entry({"bottom": (f"{name}_bottom", GRASS), "top": (f"{name}_top", GRASS)}, tags, shape="tall_cross", cutout=True)
    for name, tags in {"rose_bush": "red flower", "lilac": "purple flower", "peony": "pink flower", "sunflower": "yellow flower"}.items():
        top = "sunflower_front" if name == "sunflower" else f"{name}_top"
        blocks[name] = entry({"bottom": f"{name}_bottom", "top": top}, f"{tags} tall bush", shape="tall_cross", cutout=True)

    skipped = add_vanilla(blocks, assets, pack)
    textures = set()
    for info in blocks.values():
        for t in faces(info["tex"]):
            textures.add(t)
    missing = [t for t in sorted(textures) if not (pack / f"{t}.png").exists()]
    if missing:
        sys.exit(f"missing textures in {pack}: {missing}")
    write_sheet(pack, sorted(textures))
    OUT.write_text(json.dumps(blocks, indent=0, sort_keys=True) + "\n")
    print(f"{len(blocks)} blocks, {len(textures)} textures; {len(skipped)} vanilla blocks with no matching shape:")
    print(" ".join(sorted(skipped)))


SHAPE_TAGS = {
    "stairs": "steps roof", "slab": "half", "fence": "railing", "wall": "low fence parapet", "pane": "thin window",
    "door": "entrance", "trapdoor": "hatch plate thin", "carpet": "rug floor thin", "lantern": "light hanging small",
    "torch": "light fire small", "rod": "thin pole", "cross": "plant", "tall_cross": "plant tall", "log": "pillar column",
    "face": "thin climbing cover", "ladder": "climb",
}  # fmt: skip
TINTS = {"birch_leaves": "#80a755", "spruce_leaves": "#619961", "vine": FOLIAGE, "lily_pad": "#208030"}
TINTS |= {f"{w}_leaves": FOLIAGE for w in ("oak", "jungle", "acacia", "dark_oak", "mangrove")}
SKIPPED_PREFIXES = ("waxed_", "infested_", "potted_", "structure_", "test_")


def add_vanilla(blocks: dict[str, dict], assets: Path, pack: Path) -> list[str]:
    """Add every vanilla block not in `blocks` whose model maps onto a shape; return the names of those that do not."""
    skipped = []
    for path in sorted((assets / "blockstates").glob("*.json")):
        name = path.stem
        if name in blocks or name.startswith(SKIPPED_PREFIXES):
            continue
        shape, tex = classify(assets, name, vanilla_models(json.loads(path.read_text()))) or (None, None)
        tex = tidy(tex)
        if not tex or any(not (pack / f"{t}.png").exists() for t in faces(tex)):
            skipped.append(name)
            continue
        extra: dict = {} if shape == "cube" else {"shape": shape}
        alphas = b"".join(Image.open(pack / f"{t}.png").convert("RGBA").getchannel("A").tobytes() for t in faces(tex))
        if sum(0 < a < 255 for a in alphas) > len(alphas) / 4:
            extra["transparent"] = True
        elif min(alphas) < 255:
            extra["cutout"] = True
        blocks[name] = entry(tex, SHAPE_TAGS.get(shape, ""), **extra)
    return skipped


def tidy(tex):
    """None if any face lacks a block texture; one texture if every face shares it; no bottom when it repeats the top."""
    if not isinstance(tex, dict):
        return tex if tex and (isinstance(tex, str) or tex[0]) else None
    if any(tidy(v) is None for v in tex.values()):
        return None
    if len({json.dumps(v) for v in tex.values()}) == 1:
        return next(iter(tex.values()))
    return {k: v for k, v in tex.items() if not (k == "bottom" and v == tex.get("top"))}


def vanilla_models(state: dict) -> list[tuple[str, str]]:
    """(variant key, model) pairs of a blockstate file; multipart parts have an empty key."""
    first = lambda apply: (apply[0] if isinstance(apply, list) else apply)["model"]
    if "variants" in state:
        return [(key, first(v)) for key, v in state["variants"].items()]
    return [("", first(part["apply"])) for part in state["multipart"]]


def model_chain(assets: Path, ref: str) -> tuple[list[str], dict]:
    """A model's own name then its parents', and its textures with the nearest definition winning."""
    chain, textures = [], {}
    while ref:
        ref = ref.removeprefix("minecraft:").removeprefix("block/")
        chain.append(ref)
        path = assets / "models" / "block" / f"{ref}.json"
        if not path.exists():
            break
        model = json.loads(path.read_text())
        textures = {**model.get("textures", {}), **textures}
        ref = model.get("parent", "")
    return chain, textures


def texture(textures: dict, key: str) -> str | None:
    value = textures.get(key)
    while True:
        if isinstance(value, dict):
            value = value.get("sprite")
        if not isinstance(value, str) or not value.startswith("#"):
            break
        value = textures.get(value[1:])
    if not isinstance(value, str):
        return None
    value = value.removeprefix("minecraft:")
    return value.removeprefix("block/") if value.startswith("block/") else None


def classify(assets: Path, name: str, variants: list[tuple[str, str]]) -> tuple[str, object] | None:
    """The shape and textures of a block from its lit, ripest or first model's template, or None when no shape matches."""
    lit = [model for key, model in variants if "lit=true" in key]
    ripe = variants[-1][1] if variants[0][0].startswith("age=") else None
    chain, t = model_chain(assets, (lit and lit[0]) or ripe or variants[0][1])
    halves = {key: model for key, model in variants if key in ("half=lower", "half=upper")}
    tint = TINTS.get(name) or (GRASS if "tinted_cross" in chain else None)
    tinted = lambda tex: (tex, tint) if tint and tex else tex
    faces_of = lambda **keys: {face: texture(t, key) for face, key in keys.items()}
    for base in chain:
        match base:
            case "vine" | "glow_lichen" | "sculk_vein" | "resin_clump":
                return "face", tinted(texture(t, next(k for k in t if k != "particle")))
            case "ladder":
                return "ladder", texture(t, "texture")
            case "cross" | "tinted_cross" | "template_seagrass" if len(halves) == 2:
                key = "texture" if base == "template_seagrass" else "cross"
                ends = {half: model_chain(assets, halves[f"half={half}"])[1] for half in ("lower", "upper")}
                return "tall_cross", {
                    "bottom": tinted(texture(ends["lower"], key)),
                    "top": tinted(texture(ends["upper"], key)),
                }
            case "cross" | "tinted_cross" | "cross_emissive":
                return "cross", tinted(texture(t, "cross"))
            case "template_seagrass" | "crop" | "coral_fan":
                return "cross", texture(t, {"template_seagrass": "texture", "crop": "crop", "coral_fan": "fan"}[base])
            case "cube_all" | "leaves":
                return "cube", tinted(texture(t, "all"))
            case "template_single_face" | "slime_block":
                return "cube", texture(t, "texture")
            case "template_glazed_terracotta":
                return "cube", texture(t, "pattern")
            case "template_azalea" | "mangrove_roots":
                return "cube", faces_of(top="top", side="side")
            case "dried_kelp_block":
                return "cube", faces_of(top="up", bottom="down", side="north")
            case "pressure_plate_up":
                return "carpet", texture(t, "texture")
            case "flowerbed_1":
                return "carpet", texture(t, "flowerbed")
            case "lily_pad":
                return "carpet", tinted(texture(t, "texture"))
            case (
                "cube_column"
                | "cube_column_horizontal"
                | "cube_column_uv_locked_x"
                | "cube_column_uv_locked_y"
                | "cube_column_uv_locked_z"
            ):
                shape = "log" if any("axis=" in key for key, _ in variants) else "cube"
                return shape, faces_of(top="end", side="side")
            case "cube_bottom_top":
                return "cube", faces_of(top="top", bottom="bottom", side="side")
            case "cube_top":
                return "cube", faces_of(top="top", side="side")
            case "orientable":
                return "cube", faces_of(top="top", bottom="top", side="front")
            case "orientable_with_bottom":
                return "cube", faces_of(top="top", bottom="bottom", side="front")
            case "cube":
                return "cube", faces_of(top="up", bottom="down", side="north")
            case "stairs" | "inner_stairs" | "outer_stairs":
                return "stairs", faces_of(top="top", bottom="bottom", side="side")
            case "slab":
                return "slab", faces_of(top="top", bottom="bottom", side="side")
            case "fence_post":
                return "fence", texture(t, "texture")
            case "template_wall_post":
                return "wall", texture(t, "wall")
            case "template_glass_pane_post":
                return "pane", texture(t, "pane")
            case "door_bottom_left" | "door_bottom_left_open" | "door_bottom_right" | "door_bottom_right_open":
                return "door", faces_of(bottom="bottom", top="top")
            case "template_trapdoor_bottom" | "template_orientable_trapdoor_bottom":
                return "trapdoor", texture(t, "texture")
            case "carpet":
                return "carpet", texture(t, "wool")
            case "template_lantern" | "template_hanging_lantern":
                return "lantern", texture(t, "lantern")
            case "template_torch" | "template_redstone_torch":
                return "torch", texture(t, "torch")
            case "template_chain":
                return "rod", texture(t, "all")
    return None


def write_sheet(pack: Path, names: list[str]) -> None:
    """Pack the first square frame of every texture into one sheet, so the browser loads a single image."""
    columns = math.ceil(math.sqrt(len(names)))
    sheet = Image.new("RGBA", (columns * TILE, math.ceil(len(names) / columns) * TILE))
    for i, name in enumerate(names):
        img = Image.open(pack / f"{name}.png").convert("RGBA")
        frame = img.crop((0, 0, img.width, img.width))
        if frame.width != TILE:
            frame = frame.resize((TILE, TILE), Image.Resampling.BOX if frame.width > TILE else Image.Resampling.NEAREST)
        sheet.paste(frame, ((i % columns) * TILE, (i // columns) * TILE))
    TEXTURES.mkdir(parents=True, exist_ok=True)
    for old in TEXTURES.glob("*.png"):
        old.unlink()
    sheet.save(TEXTURES / "sheet.png", optimize=True)
    (TEXTURES / "sheet.json").write_text(json.dumps({"tile": TILE, "columns": columns, "names": names}) + "\n")


def faces(tex) -> list[str]:
    if isinstance(tex, str):
        return [tex]
    if isinstance(tex, (list, tuple)):
        return [t for t in tex if isinstance(t, str) and not t.startswith("#")]
    return [t for face in tex.values() for t in faces(face)]


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
