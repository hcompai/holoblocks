<h1 align="center">
  <img src="web/public/logo.png" alt="" width="64" align="absmiddle" hspace="8" />
  HoloBlocks
</h1>

<p align="center"><b>Tell Holo what you'd like to build, watch it rise block by block, then walk through it or export it.</b><br />The block twin of <a href="https://github.com/hcompai/brickyard">HoloBricks</a>.</p>

![HoloBlocks showing the gothic cathedral](docs/holoblocks.jpg)

<table align="center">
  <tr>
    <td align="center"><img src="docs/gallery/steampunk-manor.png" width="180" alt="" /><br />Steampunk manor · 64²</td>
    <td align="center"><img src="docs/gallery/gothic-cathedral.png" width="180" alt="" /><br />Gothic cathedral · 64²</td>
    <td align="center"><img src="docs/gallery/bag-end.png" width="180" alt="" /><br />Bag End · 128²</td>
    <td align="center"><img src="docs/gallery/caras-galadhon.png" width="180" alt="" /><br />Caras Galadhon · 112²</td>
  </tr>
</table>

## What you can do

| | |
| --- | --- |
| **Describe** | Type an idea or drop in a photo, and Holo builds it in 3D while you watch. |
| **Trust** | Every block comes from a ~750-block palette, on a 128×128 site. |
| **Replay** | Scrub back through the steps, read each step's code, or share the build as a GIF. |
| **Tweak** | Move, replace and place blocks, or walk through the build. |
| **Export** | Download a WorldEdit `.schem` and paste it into your world. |
| **Share** | Publish a build so anyone can open it, and fork it into their own once signed in. |

## How it works

```
 you ── idea ──▶  Holo  (H Agents API)  ── blocks run ──▶  Workstation
  ▲                 │                                         │
  └── 3D model ◀────┴─────────────── model.json.gz ◀──────────┘
```

Your browser renders every revision and shows it to Holo, so keep the tab open while it builds.

## Run it

Live at [blocks.hcompany.ai](https://blocks.hcompany.ai): anyone can browse the public builds and showcases, and anyone can sign in with an H account to build. Setup, deploy, tests and the toolkit are in [docs/README.md](docs/README.md).

## Run it yourself

You need Node 20+, [uv](https://docs.astral.sh/uv/) and an H account from
[platform.hcompany.ai](https://platform.hcompany.ai): signing in mints the Agents API key Holo builds with.

```bash
git clone <this repo> holoblocks && cd holoblocks
cd server && uv sync && cd ..
server/.venv/bin/python scripts/pack-toolkit.py               # the toolkit Holo installs on its Workstation
server/.venv/bin/blockyard-gallery web/public                 # the showcases
cd web && npm install
echo "BLOCKYARD_SECRET=$(openssl rand -hex 32)" > .env.local  # signs the sign-in pass
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) (not `localhost`) and sign in. Publishing, forks and renames also
need the Blob tokens listed in [docs/README.md](docs/README.md#accounts-and-the-public-library). To try the `blocks`
CLI by hand, `sh setup.sh <build dir>` puts it on your PATH (it may ask for sudo) and links the showcases into that
folder.
