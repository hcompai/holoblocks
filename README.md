<h1 align="center">
  <img src="web/public/logo.png" alt="" width="64" align="absmiddle" hspace="8" />
  Blockyard
</h1>

<p align="center">Watch Holo build Minecraft models in code, step by step.<br />The Minecraft twin of <a href="https://github.com/hcompai/brickyard">Brickyard</a>.</p>

![Blockyard showing the gothic cathedral](docs/blockyard.jpg)

- **Chat** to describe a build, with photos if you like. Holo writes a Python build script on a hosted Workstation, and every revision it shares appears in 3D.
- **Every block is checked** against a ~750-block palette and clipped to the 128x128 site, 100 blocks tall.
- **Replay** the steps, read each step's code, browse the blocks, download a WorldEdit `.schem` or a PNG.
- **Follow up** on a finished build for an hour; **Stop** makes Holo wrap up with an answer, and the build stays open.

## How it works

```
browser: this web app                  Agents API (agp.eu.hcompany.ai)          Workstation
  start a session, send messages ───>  Holo (holo4-27b)    ──── shell ────>   blocks run, from the toolkit
  long-poll its events          <───   model.json.gz        <── share_files ──  model.json.gz
  answer `look` with a GPU render ──>  the image, as the tool result
```

- The app talks to the Agents API with the `hai-agents` SDK (`web/src/agent.ts`). A build is a session of the agent `blockyard`; the Library lists them, and the browser keeps each one's name, step count and thumbnail in localStorage.
- The first message attaches the toolkit, `web/public/blockyard.tgz`: the `blocks` CLI, its Python package, the palette and the showcases with their renders. Holo's first call runs `.blockyard/setup.sh`, which installs it.
- Holo writes `build.py` in plain Python: `step`, `fill`, `set`, `clear` to place blocks, WorldEdit-style patterns (`"70%stone_bricks,30%andesite"`) anywhere a block goes, and `get`, `replace`, `overlay` to rework what is placed. `blocks run` rebuilds the model from the first changed step, prints the problems by line, notes floating blocks and writes `model.json.gz`. Holo shares it with `share_files`; the browser downloads it and shows it.
- `look` is a custom tool: the browser renders the shared revision on your GPU and returns the image. Keep the tab open while Holo builds; it waits for the render.

## Run

```bash
cd server && uv sync && cd ..
server/.venv/bin/python scripts/pack-toolkit.py        # web/public/blockyard.tgz
server/.venv/bin/blockyard-gallery web/public          # the showcases, into web/public/gallery
cd web && npm install
VITE_HAI_API_KEY=$(grep '^HAI_API_KEY=' ~/code/hai/.env | cut -d= -f2- | tr -d '"') npm run dev   # http://localhost:5173
```

Needs Node 20+. Without `VITE_HAI_API_KEY`, the app shows the showcases only.

| To change | Edit |
| --- | --- |
| model, step and time budget, idle timeout, the `look` tool | `web/src/agent.ts` |
| how Holo builds: workflow, the build script API, when to stop | `agent/holo.md` |
| the build script functions | `server/blockyard/script.py` (document them in `agent/holo.md`) |
| the Workstation setup | `setup.sh`, then `scripts/pack-toolkit.py` |

Try the toolkit by hand: in a folder with a `build.py`, run `<repo>/server/.venv/bin/blocks run` (`--help` lists the tools).

## Showcases and deploy

The steampunk manor, the gothic cathedral, Bag End and Caras Galadhon are build scripts in `agent/showcase`, on the
same calls as Holo's, each step told by the comment above it. Holo gets them in the toolkit with their renders, and
Bag End is printed in full in its prompt as the worked example.

```bash
scripts/deploy.sh --preview                   # or --prod
```

`deploy.sh` packs the toolkit, exports the showcases into `web/public/gallery`, builds the app, screenshots each
showcase as its thumbnail and deploys it to the Vercel project `blockyard`. The bundle is public, so it is built
without an API key: the site shows the showcases, and building needs sign-in, which is not wired yet.

## Blocks

Textures are from [Faithful](https://faithfulpack.net/) (see `web/public/textures/LICENSE.txt`). Regenerate the
palette and texture sheet from a Faithful 32x pack and the matching vanilla client jar (for block models) with
`uv run scripts/palette.py <pack>/assets/minecraft/textures/block <jar>/assets/minecraft`.

## Tests

```bash
cd server && uv run pytest -q && uv run ruff check . && cd ..
cd web && npm ci && npx playwright install chromium && npm test && npm run build
```

The server tests run the toolkit offline. The browser tests mock the Agents API and render real geometry: a build that
shares models and asks for renders, a new build with a photo, a follow-up and Stop, the Library, a showcase and the
`.schem` download.
