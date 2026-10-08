import { gunzipSync } from "node:zlib";
import { checkedSeed, forkSeed } from "../src/forkModel";
import { holder } from "./lib/account";
import { body, Refusal, route } from "./lib/http";
import { imported } from "./lib/imported";
import { forkList, linkFork, readFork, saveFork } from "./lib/forks";
import { ownedSession } from "./lib/snapshot";

const OWN = { "Cache-Control": "private, no-store" };
const MAX_UPLOAD = 4 * 1024 * 1024;
const MAX_UNPACKED = 64 * 1024 * 1024;

function forkId(value: unknown): string {
  if (typeof value !== "string" || !/^fork-[a-f0-9-]{36}$/.test(value)) throw new Refusal(400, "No such fork.");
  return value;
}

/** The caller's forks, or one of them with its starting model with `?id=`. */
export const GET = route(async (request) => {
  const { user } = holder(request);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json(await forkList(user.id), { headers: OWN });
  const fork = await readFork(user.id, forkId(id));
  if (!fork) throw new Refusal(404, "No such fork of yours.");
  return Response.json(fork, { headers: OWN });
});

/** Save a private copy of a model as the caller's fork: `{ id, seed }`, gzipped. Holo only starts on its first message. */
export const POST = route(async (request) => {
  const { user } = holder(request);
  const upload = Buffer.from(await request.arrayBuffer());
  if (upload.length > MAX_UPLOAD) throw new Refusal(413, "The model is too large to fork.");
  let given: { id?: unknown; seed?: unknown };
  try {
    given = JSON.parse(gunzipSync(upload, { maxOutputLength: MAX_UNPACKED }).toString());
  } catch {
    throw new Refusal(400, "The fork could not be read.");
  }
  const id = forkId(given?.id);
  let seed;
  try {
    seed = checkedSeed(given.seed);
  } catch {
    throw new Refusal(400, "The fork's starting model is malformed.");
  }
  const model = imported(seed.model);
  const { revision, updated } = seed.model;
  const clean = forkSeed({ ...model, revision, updated }, seed.origin, model.name);
  return Response.json(await saveFork(user.id, id, clean), { status: 201, headers: OWN });
});

/** Bind one of the caller's forks to the session its first message started: `{ id, sessionId }`. */
export const PATCH = route(async (request) => {
  const { user, key } = holder(request);
  const given = await body<{ id?: unknown; sessionId?: unknown }>(request);
  const id = forkId(given.id);
  if (typeof given.sessionId !== "string") throw new Refusal(400, "No such session.");
  const session = await ownedSession(given.sessionId, key);
  if (session.request.groupId !== id) throw new Refusal(400, "This session was not started on this fork.");
  await linkFork(user.id, id, given.sessionId);
  return new Response(null, { status: 204, headers: OWN });
});
