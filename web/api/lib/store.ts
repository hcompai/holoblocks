import { del, list, type ListBlobResultBlob, put } from "@vercel/blob";
import { Refusal } from "./http";
import {
  privateConfigured,
  privateDelete,
  privateEntry,
  privateFiles,
  privateFolder,
  privatePrefix,
  privateRead,
  privateToken,
  privateUrl,
  privateWrite,
} from "./privateStore";

/** Library metadata: public files use Blob URLs under builds/<id>/; private files use owner-authenticated API URLs. */
export interface Published {
  id: string;
  name: string;
  prompt: string;
  steps: number;
  author: string;
  /** The author's portal user id. */
  owner: string;
  /** In seconds. */
  published: number;
  thumbnail: string | null;
  build: string;
}

type Pending = Published & { pending?: boolean };

export const ID = /^[\w-]{1,100}$/;
/** No path is ever written twice: the Blob CDN can serve a deleted path's 404, or an overwritten path's old content, for minutes. */
const PUBLIC = { access: "public", cacheControlMaxAge: 60 } as const;
const PARALLEL = 16;
/** A build's entries are `<shelf><id>/<milliseconds>.json`: the latest one counts. */
const LIBRARY = "library/";
/** Private entries left in the public store sit on their owner's shelf; owner access and `migratePrivate` move them. */
const shelf = privatePrefix;
const folder = (id: string) => `builds/${id}/`;
/** The platform keeps every session, so a deleted session's build is marked `<id>/<milliseconds>.json` here and hidden. */
const trash = (owner: string) => `deleted/${encodeURIComponent(owner)}/`;
const MODEL = "build.json.gz";
const COVER = "thumbnail";

async function listed(prefix: string) {
  const blobs = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  return blobs;
}

async function drop(prefix: string, keep?: string) {
  const urls = (await listed(prefix)).filter((b) => b.pathname !== keep).map((b) => b.url);
  if (urls.length) await del(urls);
}

/** Write one file of a build; returns its public URL. */
export async function save(id: string, name: string, data: Blob | Buffer, contentType: string): Promise<string> {
  return (await put(`${folder(id)}${name}`, data, { ...PUBLIC, addRandomSuffix: true, contentType })).url;
}

export const files = async (id: string) => (await listed(folder(id))).map((b) => b.url);

async function write(prefix: string, published: Published) {
  const path = `${prefix}${published.id}/${Date.now()}.json`;
  await put(path, JSON.stringify(published), { ...PUBLIC, addRandomSuffix: false, contentType: "application/json" });
  await drop(`${prefix}${published.id}/`, path);
}

/** The latest entry of each build on a shelf, or of build `id` alone, newest first. */
async function entries(prefix: string, id?: string): Promise<Published[]> {
  const latest = new Map<string, ListBlobResultBlob>();
  for (const blob of await listed(id ? `${prefix}${id}/` : prefix)) {
    const [build] = blob.pathname.slice(prefix.length).split("/");
    const seen = latest.get(build);
    if (!seen || blob.pathname > seen.pathname) latest.set(build, blob);
  }
  const blobs = [...latest.values()];
  const found: (Published | null)[] = [];
  for (let i = 0; i < blobs.length; i += PARALLEL)
    found.push(
      ...(await Promise.all(
        blobs.slice(i, i + PARALLEL).map(async (b) => {
          const response = await fetch(b.url);
          return response.ok ? ((await response.json()) as Published) : null;
        }),
      )),
    );
  return found.filter((p): p is Published => p !== null).sort((a, b) => b.published - a.published);
}

/** Put the build in the library, then delete any private copy and the files its previous publication used and this one does not. */
export async function enter(published: Published, before: string[], written: string[]) {
  await write(LIBRARY, published);
  await drop(`${shelf(published.owner)}${published.id}/`);
  if (privateConfigured()) await removePrivate(published.owner, published.id);
  const gone = before.filter((url) => !written.includes(url));
  if (gone.length) await del(gone);
}

/** A public build. */
export const find = async (id: string) => (await entries(LIBRARY, id))[0] ?? null;

/** Read private metadata only from the private store; an entry left on the public shelf moves there on owner access. */
async function ownPrivate(owner: string, id: string, migrateLegacy = true): Promise<Published | null> {
  if (privateConfigured()) {
    const response = await privateRead(privateEntry(owner, id));
    if (response) {
      const found: Pending = await response.json();
      if (found.owner !== owner || found.id !== id) throw new Error("Invalid private build owner");
      if (!found.pending) return found;
      await setPrivate(found, true);
      return ownPrivate(owner, id, false);
    }
  }
  if (!migrateLegacy) return null;
  const [legacy] = await entries(shelf(owner), id);
  if (!legacy) return null;
  if (legacy.owner !== owner || legacy.id !== id) throw new Error("Invalid legacy build owner");
  await setPrivate(legacy, true);
  return ownPrivate(owner, id, false);
}

/** A build of `owner`'s, public or private. */
export const findOwn = async (owner: string, id: string) => (await ownPrivate(owner, id)) ?? (await find(id));

/** The private builds of `owner`, newest first, with owner-authenticated file URLs. */
export async function privateOf(owner: string): Promise<Published[]> {
  for (const legacy of await entries(shelf(owner))) if (legacy.owner === owner) await setPrivate(legacy, true);
  if (!privateConfigured()) return [];
  const prefix = privatePrefix(owner);
  const ids = (await privateFiles(prefix))
    .map((b) => b.pathname.slice(prefix.length))
    .filter((name) => name.endsWith(".json") && !name.includes("/"))
    .map((name) => name.slice(0, -".json".length));
  const found = await Promise.all(ids.map((id) => ownPrivate(owner, id, false)));
  return found.filter((p): p is Published => p !== null).sort((a, b) => b.published - a.published);
}

/** Copy a public build's model and cover into the private store, under an entry pending until the public copies are gone. */
async function copy(published: Published): Promise<Pending> {
  const { owner, id } = published;
  const blobs = await listed(folder(id));
  const keep = async (url: string | null, name: string) => {
    const blob = blobs.find((b) => b.url === url);
    if (!blob) return null;
    const response = await fetch(blob.url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error("Published file unavailable");
    const type = response.headers.get("content-type") ?? "application/octet-stream";
    await privateWrite(privateFolder(owner, id) + name, Buffer.from(await response.arrayBuffer()), type);
    return privateUrl(id, name);
  };
  const build = await keep(published.build, MODEL);
  if (!build) throw new Error("Published model unavailable");
  const pending = { ...published, pending: true, build, thumbnail: await keep(published.thumbnail, COVER) };
  await privateWrite(privateEntry(owner, id), JSON.stringify(pending), "application/json");
  return pending;
}

/** Only acknowledge privacy once every public object of the build is gone. */
async function hide(published: Published) {
  const { owner, id } = published;
  const saved = await privateRead(privateEntry(owner, id));
  const copied: Pending = saved ? await saved.json() : await copy(published);
  if (copied.owner !== owner || copied.id !== id) throw new Error("Invalid private build owner");
  await drop(folder(id));
  await drop(`${LIBRARY}${id}/`);
  await drop(`${shelf(owner)}${id}/`);
  delete copied.pending;
  await privateWrite(privateEntry(owner, id), JSON.stringify(copied), "application/json");
}

async function reveal(owner: string, id: string) {
  const response = await privateRead(privateEntry(owner, id));
  if (!response) {
    if (await find(id)) return;
    throw new Refusal(404, "No such private build.");
  }
  const stored: Published = await response.json();
  if (stored.owner !== owner || stored.id !== id) throw new Error("Invalid private build owner");
  const before = await files(id);
  const written: string[] = [];
  const restored = async (name: string) => {
    const file = await privateRead(privateFolder(owner, id) + name);
    if (!file) throw new Error("Private file unavailable");
    const type = file.headers.get("content-type") ?? "application/octet-stream";
    const data = Buffer.from(await file.arrayBuffer());
    const url = await save(id, name === COVER ? `${COVER}.${type.split("/")[1]}` : name, data, type);
    written.push(url);
    return url;
  };
  const build = await restored(MODEL);
  const thumbnail = stored.thumbnail ? await restored(COVER) : null;
  await enter({ ...stored, build, thumbnail }, before, written);
}

async function removePrivate(owner: string, id: string) {
  const blobs = await privateFiles(privateFolder(owner, id));
  await privateDelete([privateEntry(owner, id), ...blobs.map((b) => b.pathname)]);
}

/** Move a build between the public store and the private one, copying before deleting: a retry finishes a half-done move. */
export async function setPrivate(published: Published, value: boolean) {
  privateToken();
  await (value ? hide(published) : reveal(published.owner, published.id));
}

/** Owner-only file route: the caller names a build and one of its files, never a path, URL or owner. */
export async function privateFile(owner: string, id: string, name: string): Promise<Response> {
  if (name !== MODEL && name !== COVER) throw new Refusal(404, "No such file.");
  if (!(await ownPrivate(owner, id, false))) throw new Refusal(404, "No such private build.");
  const response = await privateRead(privateFolder(owner, id) + name);
  if (!response) throw new Refusal(404, "No such file.");
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/** Operator migration: every private entry left in the public store moves through `setPrivate`; `dryRun` only counts them. */
export async function migratePrivate(dryRun = false): Promise<number> {
  privateToken();
  const builds = new Set((await listed("private/")).map((b) => b.pathname.split("/").slice(1, 3).join("/")));
  for (const build of builds) {
    const [owner, id] = build.split("/");
    const [published] = await entries(`private/${owner}/`, id);
    if (!published || published.id !== id || !ID.test(id) || shelf(published.owner) !== `private/${owner}/`)
      throw new Error("Invalid legacy private entry");
    if (!dryRun) await setPrivate(published, true);
  }
  return builds.size;
}

/** Rename one of `owner`'s builds in the library, public or private; its files and link stay. */
export async function rename(owner: string, id: string, name: string) {
  const own = await ownPrivate(owner, id);
  if (own) await privateWrite(privateEntry(owner, id), JSON.stringify({ ...own, name }), "application/json");
  const [published] = await entries(LIBRARY, id);
  if (published?.owner === owner) await write(LIBRARY, { ...published, name });
}

/** Every public build, newest first. */
export const library = () => entries(LIBRARY);

/** Take a build out of the library, public or private, then delete its files. */
export async function unlist(id: string, owner?: string) {
  await drop(`${LIBRARY}${id}/`);
  if (owner) await drop(`${shelf(owner)}${id}/`);
  if (owner && privateConfigured()) await removePrivate(owner, id);
  await drop(folder(id));
}

/** Hide one of `owner`'s session builds from them for good. */
export async function forget(owner: string, id: string) {
  const at = Date.now();
  await put(`${trash(owner)}${id}/${at}.json`, JSON.stringify({ at }), {
    ...PUBLIC,
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

/** The ids of the session builds `owner` deleted. */
export async function forgotten(owner: string): Promise<string[]> {
  const prefix = trash(owner);
  return [...new Set((await listed(prefix)).map((b) => b.pathname.slice(prefix.length).split("/")[0]))];
}
