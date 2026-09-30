"""Build the showcases into the static gallery the web app serves: `blockyard-gallery SITE_DIR`."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from blockyard.showcases import SHOWCASES, told
from blockyard.workbench import Workbench
from blockyard.workspace import Workspace, bundle

URL = "gallery"


def export(site: Path) -> Path:
    """Write every showcase under `site/gallery`, keeping its thumbnails; returns that folder."""
    out = site / URL
    shutil.rmtree(out / "builds", ignore_errors=True)
    (out / "builds").mkdir(parents=True)
    summaries = []
    for showcase in SHOWCASES:
        build = showcase.build()
        messages = [
            {"role": "assistant", "text": text, "images": []}
            for text in [showcase.intro, *map(told, build.steps), f"Done: {Workbench(Workspace(build)).summary()}"]
        ]
        model = bundle(build) | {"status": "done", "messages": messages}
        (out / "builds" / f"{showcase.key}.json").write_text(json.dumps(model, separators=(",", ":")))
        summaries.append(
            {
                "id": showcase.key,
                "name": build.name,
                "prompt": showcase.intro,
                "revision": model["revision"],
                "steps": len(build.steps),
                "width": build.width,
                "depth": build.depth,
            }
        )
    (out / "builds.json").write_text(json.dumps(summaries))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path, help="static site folder; the gallery goes in its gallery/ subfolder")
    out = export(parser.parse_args().site)
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"Exported {len(SHOWCASES)} showcases to {out} ({size / 1e6:.1f} MB)")
