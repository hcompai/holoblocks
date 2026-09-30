import { del, list, type ListBlobResultBlob, put } from "@vercel/blob";

/** A build in the public library; its files are public, under builds/<id>/. */
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

export const ID = /^[\w-]{1,100}$/;
/** No path is ever written twice: the Blob CDN can serve a deleted path's 404, or an overwritten path's old content, for minutes. */
const PUBLIC = { access: "public", cacheControlMaxAge: 60 } as const;
const PARALLEL = 16;
/** A build's entries are `<shelf><id>/<milliseconds>.json`: the latest one counts. */
const LIBRARY = "library/";
/** Private entries sit apart, per owner, so listing the public library can never include them. */
const shelf = (owner: string) => `private/${encodeURIComponent(owner)}/`;
const folder = (id: string) => `builds/${id}/`;

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

/** Put the build in the library, then delete the files its previous publication used and this one does not. */
export async function enter(published: Published, before: string[], written: string[]) {
  await write(LIBRARY, published);
  const gone = before.filter((url) => !written.includes(url));
  if (gone.length) await del(gone);
}

/** A public build. */
export const find = async (id: string) => (await entries(LIBRARY, id))[0] ?? null;

/** A build of `owner`'s, public or private. */
export const findOwn = async (owner: string, id: string) => (await entries(shelf(owner), id))[0] ?? (await find(id));

/** The private builds of `owner`, newest first. */
export const privateOf = (owner: string) => entries(shelf(owner));

/** Move a build between the public library and its owner's private shelf; its files stay, and a retry finishes a half-done move. */
export async function setPrivate(published: Published, value: boolean) {
  const [to, from] = value ? [shelf(published.owner), LIBRARY] : [LIBRARY, shelf(published.owner)];
  await write(to, published);
  await drop(`${from}${published.id}/`);
}

/** Every public build, newest first. */
export const library = () => entries(LIBRARY);

/** Take a build out of the library, public or private, then delete its files. */
export async function unlist(id: string, owner?: string) {
  await drop(`${LIBRARY}${id}/`);
  if (owner) await drop(`${shelf(owner)}${id}/`);
  await drop(folder(id));
}
