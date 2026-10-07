# HoloBlocks internals

Setup, architecture, deploy and the toolkit. The [main README](../README.md) is the tour. Internal names stay
`blockyard`: the agent, the Vercel project, the toolkit and the environment variables.

- [Features in detail](#features-in-detail)
- [How it works](#how-it-works)
- [Run](#run)
- [Accounts and the public library](#accounts-and-the-public-library)
- [Where to change things](#where-to-change-things)
- [Showcases and deploy](#showcases-and-deploy)
- [Blocks](#blocks)
- [Tests](#tests)

## Features in detail

- **Chat** to describe a build, with photos if you like, or start from one of the ideas in one click. The request shows at once and the build opens as soon as its session exists. Holo writes a Python build script on a hosted Workstation, and every revision it shares appears in 3D. While the canvas is empty, the first four phases (reading, preparing blocks, references, naming) have pausable visuals: a subject sketch, real palette textures, photos as Holo opens or shares them, and the title once named. Selected photos also arrive through `share_files`; user attachments appear in the design board immediately. Building and checking stay in chat. New blocks reveal quickly in step and layer order, with a short settling motion; existing blocks stay in place. Block sounds are on by default: quiet synthesized pops with material-specific tones, limited to audible beats for dense fills. The speaker button mutes them and remembers the choice. Reduced motion shows the completed model immediately. The chat names the phase Holo is in; its steps fold under its next message.
- **Every block is checked** against a ~750-block palette and clipped to the 128x128 site, 100 blocks tall.
- **Replay** the steps, read each step's code and browse the blocks. **Share** holds the rest: publish, copy the link, a GIF of the build rising (made as the dialog opens, 8 to 30 seconds), a WorldEdit `.schem` or a PNG, and **Delete** for your own builds.
- **Edit** by hand: choose **Edit**, click a block, Shift-drag a box around the blocks you see, then move, replace or delete them, or right-click a face to place the block in hand; undo, redo and reset. Edits are saved in this browser per build and revision, and publishing includes them. The **?** button or key lists every shortcut.
- **Walk** through the build: choose **Walk**, click the model, then WASD and the mouse. Space jumps, Space twice flies, Esc leaves. Edit and Walk show once the build has blocks.
- **Publish** a build to the home page's Public builds, **fork** any build or any of its versions (a private copy, saved at once; Holo starts on its first message from an exact copy: the build's own script, or a replay of its blocks), **import** a model file, **copy** a link that previews the build, even on the sign-in page.
- **History** lists every model Holo shared in a build, numbered V1, V2…; picking one previews it read only (`?version=<n>` links to it), and **Fork** continues from it.
- **Rename** a build of yours from its title, or from the **…** on its card, which also publishes it, makes it private or deletes it.
- **Follow up** on a build for 10 minutes after it ends, or while Holo builds: a message reaches it at once and Holo folds it in at its next step, without stopping. Once its session ended, a change starts a copy under the same name. **Stop** (shown while the composer is empty) makes Holo wrap up with an answer, and the build stays open.

## How it works

```
browser: this web app                  Agents API (agp.eu.hcompany.ai)          Workstation
  start a session, send messages ───>  Holo (holo4-27b)    ──── shell ────>   blocks run, from the toolkit
  long-poll its events          <───   model.json.gz        <── share_files ──  model.json.gz
  answer `look` with a GPU render ──>  the image, as the tool result
```

- The app talks to the Agents API with the `hai-agents` SDK (`web/src/agent.ts`). A build is a session of the agent `blockyard`; the home page lists them, and the browser keeps each one's name, step count and thumbnail in localStorage.
- The first message attaches the toolkit, `web/public/blockyard.tgz`: the `blocks` CLI, its Python package, the palette and the showcases with their renders. Holo's first call runs `.blockyard/setup.sh`, which installs it; a second call waits for the first. `BLOCKYARD_MINUTES`, the session's time limit, starts the clock each `blocks run` reports: past 80%, Holo finishes the change in hand and answers.
- Holo writes `build.py` in plain Python: `step`, `fill`, `set`, `clear` to place blocks, WorldEdit-style patterns (`"70%stone_bricks,30%andesite"`) anywhere a block goes, and `get`, `replace`, `overlay` to rework what is placed. `blocks run` rebuilds the model from the first changed step, prints the problems by line, notes floating blocks and writes `model.json.gz`, with the script that rebuilt it. Holo shares it with `share_files`; the browser downloads it and shows it.
- `look` is a custom tool: any open HoloBlocks tab renders the shared revision on its GPU, off screen, and returns the image, whichever build it shows. A `look` waits for a tab, so while a build runs the tab asks before closing and keeps the screen awake (Screen Wake Lock, taken again when the tab comes back into view). If the Workstation fails, the session ends: Continue starts a new session with the same requests and photos, from the last shared model.

## Run

```bash
cd server && uv sync && cd ..
server/.venv/bin/python scripts/pack-toolkit.py        # web/public/blockyard.tgz
server/.venv/bin/blockyard-gallery web/public          # the showcases, into web/public/gallery
cd web && npm install
vercel link --yes --scope h-company --project blockyard && vercel env pull .env.local   # the server's secrets
npm run dev                                                                            # http://127.0.0.1:5173
```

Needs Node 20+. HoloBlocks is open to H Company: everything sits behind a sign-in with an `@hcompany.ai` Google account on the H portal.

With the dev server running, open `/dev/thinking.html` to try the thinking visuals without signing in. Change the request to try different subject sketches and material textures. **Replay photo arrivals** shows three credited sample references appearing one at a time; the naming stage reveals a sample title. Show the illustrative model and replay its placement at different speeds. Block sounds are on by default; the speaker button mutes them. This separate dev entry and its sample photos are not included in the production build.

## Accounts and the public library

```
browser ──same tab──▶ portal ──Google──▶ portal sets its access token cookie
portal ──redirect──▶ GET /api/session: who is it? mint a 30-day "HoloBlocks <email> <time>" key ──▶ back where the user was
browser ──key──▶ Agents API (Holo builds, sessions listed per user)
browser ──POST /api/builds (pass + key)──▶ snapshot of the session ──▶ Vercel Blob (public)
signed in ──GET /api/builds──▶ the public library
owner ──GET /api/builds?id=&file= (pass + key)──▶ Vercel Blob (private)
```

- `web/api/` holds the Vercel functions; `web/scripts/build-api.mjs` bundles them, and `npm run dev` serves them too. Deployed, `/?public=<id>` and `/?showcase=<id>` go to `/api/preview`: the app's page, with that build's name, step count, author and cover in its link preview. The sign-in page reads those tags back to show a signed-out visitor what was shared with them.
- The portal's cookie never reaches a local dev server, so there the portal sends a one-time code instead (PKCE, RFC 8252); it only redirects to `127.0.0.1`, where `localhost` forwards.
- Signing in again revokes the previous key. The key lives in the browser's local storage; the pass, signed with `BLOCKYARD_SECRET`, names its holder to the functions.
- Publishing copies the session's model (with this browser's edits, which drop its script), transcript and platform-hosted or embedded images, so they survive its session. External HTTPS photos remain links and depend on their original host; the server does not download them. The API key goes only to the Agents origin. Only its author can publish, unpublish, rename or delete a build; the emails in `BLOCKYARD_ADMINS` can take anyone's out of the public library, which makes it private for its owner. Publishing again deletes the private copy.
- A fork is private: `/api/forks` keeps its record, starting model and session claim under `forks/<owner>/<id>/` in the private Blob store. Its first message starts a session in the fork's group, which the fork records; it continues in that session only, claimed once. Library ids are global, so `fork-owners/<id>.json` (private store) claims each fork id for good for the first owner to save it.
- A name its owner gives a build is `names/<owner>/<id>.json` in the private store (`/api/names`), and renames its library entry too.
- An imported build has no session, so it lives only in the library: **Make private** copies its entry, model and cover into a separate private Blob store, then deletes the public copies. It stays listed for its owner (`GET /api/builds?mine=1`) and opens through an owner-authenticated file route (`GET /api/builds?id=&file=`) that is never cached; for anyone else its link stops working. **Delete** removes its entry and files.
- The Agents API cannot delete a session, so **Delete** on a session's build stops Holo if it is building, unpublishes it, and marks it in `deleted/<owner>/` (`/api/deleted`): the home page leaves it out on every device, though its `?build=` link still opens. Deleting a fork deletes its starting model, record and name, and marks the session it continued in.
- Server environment: `BLOCKYARD_SECRET`, `BLOCKYARD_ADMINS`, `BLOB_READ_WRITE_TOKEN` from the public `blockyard-library` Blob store, and `BLOCKYARD_PRIVATE_BLOB_READ_WRITE_TOKEN` from a **separate private** Blob store (the shorter `BLOCKYARD_PRIVATE_BLOB_TOKEN` is also accepted). Never reuse the public token. Without private storage, making private, forking and renaming return 503, and a build stays public.

### Migrating existing private builds

Create a private Blob store in Vercel and connect it to the project with the environment-variable prefix `BLOCKYARD_PRIVATE_BLOB`, which creates `BLOCKYARD_PRIVATE_BLOB_READ_WRITE_TOKEN`. Keep the public store and its token. Deploy the updated API first: the previous one cannot read the private store. Then, from `web/`:

```bash
vercel env pull --environment=production .env.migrate.local
node --env-file=.env.migrate.local scripts/migrate-private.mjs --dry-run   # counts them, changes nothing
node --env-file=.env.migrate.local scripts/migrate-private.mjs
rm .env.migrate.local
```

The migration copies each private entry left in the public store, with its model and cover, before deleting the public copies. It stops on failure; rerun it to finish, and a finished run moves nothing. It logs only the count, never models or tokens. Owner access also moves an entry left behind. The Blob CDN can keep serving a deleted public file for a few minutes, and copies already downloaded cannot be revoked.

## Where to change things

| To change | Edit |
| --- | --- |
| model, step and time budget, idle timeout, the `look` tool | `web/src/agent.ts` |
| how Holo builds: workflow, the build script API, when to stop | `agent/holo.md` |
| the build script functions | `server/blockyard/script.py` (document them in `agent/holo.md`) |
| the Workstation setup | `setup.sh`, then `scripts/pack-toolkit.py` |
| the ideas on the home page | `web/src/suggestions.ts` |
| the phases the chat names | `web/src/activity.ts` |

Try the toolkit by hand: in a folder with a `build.py`, run `<repo>/server/.venv/bin/blocks run` (`--help` lists the tools).

## Showcases and deploy

The steampunk manor, the gothic cathedral, Bag End and Caras Galadhon are build scripts in `agent/showcase`, on the
same calls as Holo's, each step told by the comment above it. Holo gets them in the toolkit with their renders, and
Bag End is printed in full in its prompt as the worked example.

```bash
scripts/deploy.sh --preview                   # or --prod
```

Every push to main that passes CI deploys to production (the `deploy` job in `.github/workflows/ci.yml`, secret
`VERCEL_TOKEN`); or deploy from a laptop as above. `deploy.sh` packs the toolkit, exports the showcases into
`web/public/gallery`, builds the app and its functions, screenshots each showcase as its thumbnail and deploys them to
the Vercel project `blockyard`. The bundle is public: it never carries an API key.

## Blocks

Textures are from [Faithful](https://faithfulpack.net/) (see `web/public/textures/LICENSE.txt`). Regenerate the
palette and texture sheet from a Faithful 32x pack and the matching vanilla client jar (for block models) with
`uv run scripts/palette.py <pack>/assets/minecraft/textures/block <jar>/assets/minecraft`.

## Tests

```bash
cd server && uv run pytest -q && uv run ruff check . && cd ..
cd web && npm ci && npx playwright install chromium && npm test && npm run build
```

The server tests run the toolkit offline. The browser tests mock the Agents API and the library and render real
geometry: a build that shares models and asks for renders, a new build with a photo, one-click ideas, a follow-up and
Stop, a message mid-build, deleting a build, a change to an ended build, the home page's builds, publishing, forks, history, renaming, the card menu, imports, link previews, sign-in, edits, walking,
the GIF export, recovery and the tab guard.
