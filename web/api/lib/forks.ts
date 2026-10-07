import { del, put } from "@vercel/blob";
import { gzipSync } from "node:zlib";
import { type ForkSeed, type ForkSummary, readSeed, type SavedFork } from "../../src/forkModel";
import { Refusal } from "./http";
import { claim, drop, PUBLIC, record, records } from "./store";

/** A fork's record: its summary, and the URL of its starting model. */
interface Saved extends ForkSummary {
  seed: string;
}

/** Records are `<shelf><id>/<milliseconds>.json`; starting models get unguessable URLs, as they are private. */
const shelf = (owner: string) => `forks/${encodeURIComponent(owner)}/`;
const seeds = (owner: string) => `seeds/${encodeURIComponent(owner)}/`;
/** Written once, so two sessions racing to continue a fork cannot both win. */
const sessionClaim = (owner: string, id: string) => `fork-sessions/${encodeURIComponent(owner)}/${id}.json`;

const summary = ({ seed, ...fork }: Saved): ForkSummary => fork;

const findSaved = async (owner: string, id: string) => (await records<Saved>(shelf(owner), id))[0] ?? null;

/** One of `owner`'s forks, without its starting model. */
export async function findFork(owner: string, id: string): Promise<ForkSummary | null> {
  const saved = await findSaved(owner, id);
  return saved && summary(saved);
}

export async function readFork(owner: string, id: string): Promise<SavedFork | null> {
  const saved = await findSaved(owner, id);
  if (!saved) return null;
  const response = await fetch(saved.seed);
  if (!response.ok) throw new Error(`Could not read the fork's starting model (HTTP ${response.status})`);
  return { ...summary(saved), seed: await readSeed(await response.blob()) };
}

/** `owner`'s forks, newest first. */
export const forkList = async (owner: string) =>
  (await records<Saved>(shelf(owner))).map(summary).sort((a, b) => b.created - a.created);

/** The browser picks the id, so a retry after a lost response finds the fork it already saved. */
export async function saveFork(owner: string, id: string, seed: ForkSeed): Promise<ForkSummary> {
  const existing = await findFork(owner, id);
  if (existing) return existing;
  const { url } = await put(`${seeds(owner)}${id}.json.gz`, gzipSync(JSON.stringify(seed)), {
    ...PUBLIC,
    addRandomSuffix: true,
    contentType: "application/gzip",
  });
  const saved: Saved = {
    id,
    name: seed.model.name,
    steps: seed.model.steps.length,
    created: Date.now() / 1000,
    sessionId: null,
    seed: url,
  };
  await record(shelf(owner), saved);
  return summary(saved);
}

/** Bind the fork to the session its first message started; a fork continues in one session only. */
export async function linkFork(owner: string, id: string, sessionId: string) {
  const saved = await findSaved(owner, id);
  if (!saved) throw new Refusal(404, "No such fork of yours.");
  if (saved.sessionId === sessionId) return;
  const claimed = saved.sessionId ?? (await claim(sessionClaim(owner, id), { sessionId })).sessionId;
  if (claimed !== sessionId) throw new Refusal(409, "This fork already continues in another session.");
  await record(shelf(owner), { ...saved, sessionId });
}

/** Delete a fork's starting model, record and session link; returns what it was, if it existed. */
export async function deleteFork(owner: string, id: string): Promise<ForkSummary | null> {
  const saved = await findSaved(owner, id);
  if (!saved) return null;
  await del(saved.seed);
  await drop(sessionClaim(owner, id));
  await drop(`${shelf(owner)}${id}/`);
  return summary(saved);
}
