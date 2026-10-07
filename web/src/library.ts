import { current, key } from "./account";
import { sessions } from "./agent";
import type { ForkSeed, ForkSummary, SavedFork } from "./forkModel";
import { dataUrl } from "./look";
import { type Build, type BuildSummary, PALETTE, type Shared, type Status, unpack } from "./model";
import { BlockScene } from "./scene";
import { readJson, status } from "./session";
import type { Edit } from "./voxelEdits";

const GALLERY = "/gallery";
const API = "/api/builds";
const IMPORTS = "/api/imports";
const DELETED = "/api/deleted";
const FORKS = "/api/forks";
const NAMES = "/api/names";
const STORE = "blockyard.library";

/** What the browser remembers of a session's model, since the platform keeps only its chat. */
interface Card {
  name: string;
  prompt: string;
  steps: number;
  thumbnail?: string;
  /** The build this session recovers. */
  recoveredFrom?: string;
  /** The session started to recover this build. */
  recoveryAttempt?: string;
  /** A fork's first message may have started a session that is not confirmed yet. */
  forkStarting?: boolean;
}

const cards = (): Record<string, Card> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
};

const NEW_CARD: Card = { name: "Untitled build", prompt: "", steps: 0 };

export const card = (id: string): Card | undefined => cards()[id];

export function remember(id: string, card: Partial<Card>) {
  const all = cards();
  all[id] = { ...NEW_CARD, ...all[id], ...card };
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch (e) {
    console.error("Could not remember the build", e);
  }
}

interface ShowcaseSummary {
  id: string;
  name: string;
  prompt: string;
  revision: string;
  steps: number;
}

/** A build in the public library, as the API lists it. */
interface Published {
  id: string;
  name: string;
  prompt: string;
  steps: number;
  author: string;
  owner: string;
  published: number;
  thumbnail: string | null;
  build: string;
}

const opened = (shared: Shared, id: string): Build => ({
  ...unpack(shared),
  id,
  status: "done",
  messages: shared.messages,
  open: false,
});

async function showcases(): Promise<BuildSummary[]> {
  const response = await fetch(`${GALLERY}/builds.json`);
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) return [];
  const summaries: ShowcaseSummary[] = await response.json();
  return summaries.map((s) => ({
    id: s.id,
    name: s.name,
    prompt: s.prompt,
    status: "done" as Status,
    created: 0,
    steps: s.steps,
    thumbnail: `${GALLERY}/thumbnails/${s.id}.png?v=${s.revision.slice(0, 8)}`,
    source: "showcase",
    author: null,
    owner: null,
  }));
}

export async function showcase(id: string): Promise<Build> {
  const response = await fetch(`${GALLERY}/builds/${encodeURIComponent(id)}.json`);
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error(`No showcase ${id}`);
  return opened(await response.json(), id);
}

/** A refusal from the library API, whose message is meant for the user. */
export class LibraryError extends Error {}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init);
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new LibraryError(body?.error ?? `The library is unavailable (HTTP ${response.status}).`);
  return body as T;
}

/** The library API's URL; signed-in users can change the library, so they skip the shared cache. */
function read(params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  if (current()) query.set("t", String(Date.now()));
  return query.size ? `${API}?${query}` : API;
}

const summary = (p: Published): BuildSummary => ({
  id: p.id,
  name: p.name,
  prompt: p.prompt,
  status: "done",
  created: p.published,
  steps: p.steps,
  thumbnail: p.thumbnail,
  source: "public",
  author: p.author,
  owner: p.owner,
});

const signed = () => ({ Authorization: `Bearer ${current()?.pass}`, "X-Agents-Key": key() });

/** Everyone's public builds, newest first. */
async function community(): Promise<BuildSummary[]> {
  return (await api<Published[]>(read())).map(summary);
}

/** The signed-in user's private library builds, newest first. */
async function hidden(): Promise<BuildSummary[]> {
  return Promise.all(
    (await api<Published[]>(read({ mine: "1" }), { headers: signed() })).map(async (p) => ({
      ...summary(p),
      thumbnail: p.thumbnail && (await privateImage(p.thumbnail, p.id)),
      private: true,
    })),
  );
}

export async function publicBuild(id: string): Promise<Build> {
  // Signed in, the owner can open their private builds too.
  const published = await api<Published>(read({ id }), current() ? { headers: signed() } : {});
  const response = await fetch(published.build, privateAsset(published.build, id) ? { headers: signed() } : {});
  if (!response.ok) throw new Error(`No public build ${id}`);
  return { ...opened(await readJson<Shared>(await response.blob()), id), name: published.name };
}

/** A private cover as a data URL, so no credential sits in an img URL; null if it does not load. */
async function privateImage(url: string, id: string): Promise<string | null> {
  if (!privateAsset(url, id)) return url;
  const response = await fetch(url, { headers: signed() }).catch(() => null);
  return response?.ok ? dataUrl(await response.blob()) : null;
}

/** Send credentials only to this app's owner-authenticated file route. */
function privateAsset(url: string, id: string): boolean {
  if (!url.startsWith(`${API}?`)) return false;
  const parsed = new URL(url, location.origin);
  return parsed.pathname === API && parsed.searchParams.get("id") === id && parsed.searchParams.has("file");
}

/** Publish a build of the signed-in user as it is now, with this browser's hand edits and a thumbnail. */
export async function publish(id: string, thumbnail: string | null, edits: { revision: string; edits: Edit[] } | null) {
  return api<Published>(API, {
    method: "POST",
    headers: { ...signed(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, thumbnail, edits }),
  });
}

/** A HoloBlocks model file as the browser reads it, before the library checks it. */
export type ModelFile = Pick<Shared, "name" | "blocks" | "boxes" | "steps" | "width" | "depth" | "height"> &
  Partial<Shared>;

/** Read a model file (a session's model.json.gz, or a showcase or published build, gzipped or not), or say why not. */
export async function readModel(file: Blob): Promise<ModelFile> {
  const model = await readJson<Partial<ModelFile>>(file).catch(() => null);
  if (!Array.isArray(model?.boxes) || !model.boxes.length || !Array.isArray(model.blocks))
    throw new Error("This file is not a HoloBlocks model: choose a model.json.gz or a build's .json.");
  return { steps: [], ...model, name: model.name || "Imported build" } as ModelFile;
}

/** A thumbnail of the model, drawn offscreen, or null if it does not draw. */
async function cover(model: ModelFile): Promise<string | null> {
  const scene = new BlockScene(document.createElement("div"), Promise.resolve(PALETTE));
  try {
    scene.show(unpack({ updated: 0, revision: "", ...model }));
    const png = await scene.thumbnail();
    return png ? await thumbnail(png) : null;
  } catch (e) {
    console.error("Could not draw the imported model", e);
    return null;
  } finally {
    scene.dispose();
  }
}

/** Import a model into the public library as the signed-in user's build; returns its new id. */
export async function importModel(model: ModelFile): Promise<string> {
  const json = new Blob([JSON.stringify({ model, thumbnail: await cover(model) })]);
  const body = await new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  const published = await api<Published>(IMPORTS, {
    method: "POST",
    headers: { ...signed(), "Content-Type": "application/gzip" },
    body,
  });
  return published.id;
}

/** Make one of the user's library builds private, or public again; it keeps its link. */
export async function setPrivate(id: string, value: boolean) {
  await api(API, {
    method: "PATCH",
    headers: { ...signed(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, private: value }),
  });
}

/** Take a build out of the library and delete its files; for an imported build, that deletes it. */
export async function unpublish(id: string) {
  await api(`${API}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: signed() });
}

/** Delete one of the signed-in user's builds for good: it leaves their builds and the library. */
export async function remove(id: string) {
  await api(DELETED, {
    method: "POST",
    headers: { ...signed(), "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

/** One of the signed-in user's forks, with its starting model. */
export const savedFork = (id: string) => api<SavedFork>(`${FORKS}?id=${encodeURIComponent(id)}`, { headers: signed() });

/** Save `seed` as the signed-in user's fork `id`; saving it again is harmless. Holo starts on its first message. */
export async function saveFork(id: string, seed: ForkSeed): Promise<ForkSummary> {
  const json = new Blob([JSON.stringify({ id, seed })]);
  const body = await new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  const fork = await api<ForkSummary>(FORKS, {
    method: "POST",
    headers: { ...signed(), "Content-Type": "application/gzip" },
    body,
  });
  remember(id, { name: fork.name, steps: fork.steps });
  return fork;
}

/** Bind fork `id` to the session its first message started. */
export async function linkFork(id: string, sessionId: string) {
  await api(FORKS, {
    method: "PATCH",
    headers: { ...signed(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, sessionId }),
  });
}

/** The name an owner gave one of their builds. */
export interface ProjectName {
  id: string;
  name: string;
  /** In ms since the epoch. */
  updated: number;
}

export const projectNames = () => api<ProjectName[]>(NAMES, { headers: signed() });

/** Rename one of the signed-in user's builds, and its library entry. */
export const renameProject = (id: string, name: string) =>
  api<ProjectName>(NAMES, {
    method: "PATCH",
    headers: { ...signed(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, name }),
  });

/** A part of the library that loads on its own. */
export type Shelf = "mine" | "public";

/** The signed-in user's builds, newest first, then everyone's public builds, then the showcases; with the shelves that failed to load. */
export async function library(): Promise<{ builds: BuildSummary[]; failed: Shelf[] }> {
  const [sessionsLoaded, deletedLoaded, forksLoaded, sharedLoaded, hiddenLoaded, shownLoaded] =
    await Promise.allSettled([
      current() ? sessions() : Promise.resolve([]),
      current() ? api<string[]>(DELETED, { headers: signed() }) : Promise.resolve([]),
      current() ? api<ForkSummary[]>(FORKS, { headers: signed() }) : Promise.resolve([]),
      community(),
      current() ? hidden() : Promise.resolve([]),
      showcases(),
    ]);
  const failed: Shelf[] = [];
  const value = <T>(result: PromiseSettledResult<T[]>, shelf: Shelf): T[] => {
    if (result.status === "fulfilled") return result.value;
    console.error(result.reason);
    if (!failed.includes(shelf)) failed.push(shelf);
    return [];
  };
  const deleted = new Set(value(deletedLoaded, "mine"));
  const allForks = value(forksLoaded, "mine");
  const allSessions = value(sessionsLoaded, "mine");
  const lost = failed.includes("mine");
  const forks = lost ? [] : allForks;
  const mine = lost ? [] : allSessions.filter((s) => !deleted.has(s.id));
  const shared = value(sharedLoaded, "public");
  const own = value(hiddenLoaded, "mine");
  const shown = value(shownLoaded, "public");
  const known = cards();
  const listed = new Map(shared.map((p) => [p.id, p]));
  const builds = mine.map((s): BuildSummary => {
    const saved = known[s.id];
    const published = listed.get(s.id);
    const prompt = saved?.prompt || s.firstMessage?.message || published?.prompt || "";
    return {
      id: s.id,
      name: [saved?.name, published?.name, prompt.slice(0, 60)].find((n) => n && n !== NEW_CARD.name) ?? NEW_CARD.name,
      prompt,
      status: status(s.status),
      created: s.createdAt.getTime() / 1000,
      steps: saved?.steps ?? published?.steps ?? null,
      thumbnail: saved?.thumbnail ?? published?.thumbnail ?? null,
      source: "session",
      author: null,
      owner: null,
    };
  });
  const continued = new Set(forks.flatMap((f) => (f.sessionId ? [f.sessionId] : [])));
  // A build is public or private, never both: the public listing wins if a stale private entry lingers.
  const carded = new Set([...mine.map((s) => s.id), ...forks.map((f) => f.id)]);
  const privately = own.filter((p) => !listed.has(p.id) && !carded.has(p.id));
  const copies = forks.map((f): BuildSummary => {
    const run = builds.find((b) => b.id === f.sessionId);
    return {
      ...f,
      prompt: run?.prompt ?? "",
      status: run?.status ?? "done",
      steps: run?.steps ?? f.steps,
      thumbnail: known[f.id]?.thumbnail ?? run?.thumbnail ?? null,
      source: "fork",
      author: null,
      owner: null,
    };
  });
  const yours = [...builds.filter((b) => !continued.has(b.id)), ...copies].sort((a, b) => b.created - a.created);
  return { builds: [...yours, ...shared, ...privately, ...shown], failed };
}

const THUMBNAIL_SIDE = 320;

/** A render as a small WebP data URL, to keep beside the build. */
export async function thumbnail(png: Blob): Promise<string> {
  const bitmap = await createImageBitmap(png);
  const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.8);
}
