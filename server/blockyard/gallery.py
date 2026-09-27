"""Export builds as a static, read-only gallery: `blockyard-gallery SITE_DIR [BUILD_ID...]`."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from blockyard import blocks
from blockyard.builders.showcases import SHOWCASES
from blockyard.model import Build
from blockyard.session import Store
from blockyard.world import World

URL = "/gallery"


def export(store: Store, ids: list[str], site: Path) -> Path:
    """Write every file the viewer reads for these builds under `site/gallery`; returns that folder."""
    out = site / URL.strip("/")
    shutil.rmtree(out, ignore_errors=True)
    for folder in ("builds", "images/small", "thumbnails"):
        (out / folder).mkdir(parents=True, exist_ok=True)
    summaries = []
    for build in (_load(store, i) for i in ids):
        for message in build.messages:
            message.images = [_image(store, url, out) for url in message.images]
        (out / "builds" / f"{build.id}.json").write_text(build.model_dump_json())
        (out / "builds" / f"{build.id}.schem").write_bytes(World.of(build).schematic())
        thumbnail = store.thumbnail(build.id)
        if thumbnail.exists():
            shutil.copy(thumbnail, out / "thumbnails" / f"{build.id}.png")
        else:
            print(
                f"warning: no thumbnail for {build.name} ({build.id}); open it once in the local app", file=sys.stderr
            )
        summaries.append(build.summary() | {"thumbnail": store.thumbnail_version(build.id)})
    (out / "builds.json").write_text(json.dumps(summaries))
    shutil.copy(blocks.PALETTE_PATH, out / "blocks.json")
    return out


def showcase_ids(store: Store) -> list[str]:
    """The latest finished run of each showcase, in showcase order."""
    latest = {b.builder: b.id for b in sorted(store.all(), key=lambda b: b.created) if b.status == "done"}
    return [latest[s.key] for s in SHOWCASES if s.key in latest]


def default_ids(store: Store) -> list[str]:
    """The showcases, then the builds listed in `data/gallery.txt` (one id per line)."""
    listed = store.root.parent / "gallery.txt"
    return showcase_ids(store) + (listed.read_text().split() if listed.exists() else [])


def _load(store: Store, build_id: str) -> Build:
    build = store.load(build_id)
    if build is None:
        raise SystemExit(f"no build {build_id} in {store.root}")
    if build.status == "building":
        raise SystemExit(f"build {build_id} is still running")
    return build


def _image(store: Store, url: str, out: Path) -> str:
    name = url.rsplit("/", 1)[-1]
    shutil.copy(store.images / name, out / "images" / name)
    shutil.copy(store.small_image(name), out / "images" / "small" / f"{name}.webp")
    return f"{URL}/images/{name}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path, help="static site folder; the gallery goes in its gallery/ subfolder")
    parser.add_argument(
        "ids", nargs="*", help="build ids in gallery order (default: the showcases, then data/gallery.txt)"
    )
    args = parser.parse_args()
    store = Store()
    ids = args.ids or default_ids(store)
    if not ids:
        raise SystemExit("nothing to export: run a showcase in the local app first")
    out = export(store, ids, args.site)
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"Exported {len(ids)} builds to {out} ({size / 1e6:.1f} MB)")
