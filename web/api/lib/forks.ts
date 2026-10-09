import { gzipSync } from "node:zlib";
import { type ForkSeed, type ForkSummary, readSeed, type SavedFork } from "../../src/forkModel";
import { Refusal } from "./http";
import {
  privateClaim,
  privateConfigured,
  privateDelete,
  privateFiles,
  privateRead,
  privateWrite,
} from "./privateStore";

export const isFork = (id: string) => /^fork-[a-f0-9-]{36}$/.test(id);
/** The run a fork's session carries on from, named by its group: `<fork>+<ended run>`; a fresh fork's run is in `<fork>`. */
export function carriedFrom(id: string, group: string | null | undefined): string | null | undefined {
  if (group === id) return null;
  return group?.startsWith(`${id}+`) ? group.slice(id.length + 1) : undefined;
}

/** A fork is private: `forks/<owner>/<id>/` in the private store holds its record, starting model and session claim. */
const shelf = (owner: string) => `forks/${encodeURIComponent(owner)}/`;
const folder = (owner: string, id: string) => `${shelf(owner)}${id}/`;
const RECORD = "fork.json";
const SEED = "seed.json.gz";
const SESSION = "session.json";
/** Library ids are global, so each fork id is claimed for good by the first owner to save it. */
const ownerClaim = (id: string) => `fork-owners/${id}.json`;

async function readRecord(path: string): Promise<ForkSummary | null> {
  const response = await privateRead(path);
  return response && ((await response.json()) as ForkSummary);
}

/** One of `owner`'s forks, without its starting model. */
export const findFork = async (owner: string, id: string) =>
  privateConfigured() ? readRecord(folder(owner, id) + RECORD) : null;

export async function readFork(owner: string, id: string): Promise<SavedFork | null> {
  const fork = await findFork(owner, id);
  if (!fork) return null;
  const seed = await privateRead(folder(owner, id) + SEED);
  if (!seed) throw new Error("The fork's starting model is unavailable.");
  return { ...fork, seed: await readSeed(await seed.blob()) };
}

/** `owner`'s forks, newest first. */
export async function forkList(owner: string): Promise<ForkSummary[]> {
  if (!privateConfigured()) return [];
  const records = (await privateFiles(shelf(owner))).filter((b) => b.pathname.endsWith(`/${RECORD}`));
  const forks = await Promise.all(records.map((b) => readRecord(b.pathname)));
  return forks.filter((f): f is ForkSummary => f !== null).sort((a, b) => b.created - a.created);
}

/** The browser picks the id, so a retry after a lost response finds the fork it already saved. */
export async function saveFork(owner: string, id: string, seed: ForkSeed): Promise<ForkSummary> {
  const existing = await findFork(owner, id);
  if (existing) return existing;
  if ((await privateClaim(ownerClaim(id), { owner })).owner !== owner) throw new Refusal(409, "This fork id is taken.");
  const fork: ForkSummary = {
    id,
    name: seed.model.name,
    steps: seed.model.steps.length,
    created: Date.now() / 1000,
    sessionId: null,
  };
  await privateWrite(folder(owner, id) + SEED, gzipSync(JSON.stringify(seed)), "application/gzip");
  await privateWrite(folder(owner, id) + RECORD, JSON.stringify(fork), "application/json");
  return fork;
}

/** Bind the fork to `sessionId`; a fork whose run `after` ended moves on to the run carrying it on. */
export async function linkFork(owner: string, id: string, sessionId: string, after?: string | null) {
  const fork = await findFork(owner, id);
  if (!fork) throw new Refusal(404, "No such fork of yours.");
  if (fork.sessionId === sessionId) return;
  const taken = new Refusal(409, "This fork already continues in another session.");
  if (fork.sessionId) {
    if (fork.sessionId !== after) throw taken;
  } else if ((await privateClaim(folder(owner, id) + SESSION, { sessionId })).sessionId !== sessionId) throw taken;
  const runs = [...(fork.runs ?? []), ...(fork.sessionId ? [fork.sessionId] : [])];
  await privateWrite(folder(owner, id) + RECORD, JSON.stringify({ ...fork, sessionId, runs }), "application/json");
}

/** Delete a fork's record, starting model and session claim; its id stays claimed. Returns what it was, if it existed. */
export async function deleteFork(owner: string, id: string): Promise<ForkSummary | null> {
  const fork = await findFork(owner, id);
  if (!fork) return null;
  await privateDelete([RECORD, SEED, SESSION].map((name) => folder(owner, id) + name));
  return fork;
}
