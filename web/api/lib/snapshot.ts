import { HaiAgentsClient, HaiAgentsError, type HaiAgents } from "hai-agents";
import { H } from "../../src/hosts";
import { platformAsset, assetBlob } from "../../src/assetUrl";
import { EMPTY_MODEL, type Model, type Shared } from "../../src/model";
import { AGENT, EMPTY_TRANSCRIPT, read, readJson, status, type Transcript } from "../../src/session";
import { applyEdits, type Edit, validEdits } from "../../src/voxelEdits";
import { readSeed } from "../../src/forkModel";
import { isFork, readFork } from "./forks";
import { Refusal } from "./http";
import { imported } from "./imported";

const platform = (key: string) =>
  new HaiAgentsClient({
    environment: H.agents,
    apiKey: key,
    headers: { "X-HCompany-Client-Name": AGENT },
  });

const missing = (e: unknown) => e instanceof HaiAgentsError && (e.statusCode === 404 || e.statusCode === 403);

async function mine(agp: HaiAgentsClient, id: string): Promise<HaiAgents.Session> {
  const session = await agp.sessions.getSession({ id }).catch((e) => {
    throw missing(e) ? new Refusal(404, "No such build.") : e;
  });
  const agent = session.request.agent;
  if ((typeof agent === "string" ? agent : agent.name) !== AGENT) throw new Refusal(404, "No such build.");
  // Sessions are readable across an organization; the listing is the caller's own sessions only.
  const at = session.createdAt.getTime();
  const own = await agp.sessions.listSessions({
    createdAfter: new Date(at - 1000),
    createdBefore: new Date(at + 1000),
    size: 100,
  });
  if (!own.items.some((s) => s.id === id)) throw new Refusal(403, "Only its author can publish a build.");
  return session;
}

/** One of the caller's HoloBlocks sessions. */
export const ownedSession = (id: string, key: string) => mine(platform(key), id);

async function transcript(agp: HaiAgentsClient, id: string): Promise<Transcript> {
  let t = EMPTY_TRANSCRIPT;
  for (;;) {
    const changes = await agp.sessions.getSessionChanges({ id, fromIndex: t.events, includeEvents: true });
    const events = changes?.newEvents ?? [];
    if (!events.length) return t;
    t = read(t, events);
  }
}

async function download(url: string, key: string): Promise<Blob> {
  if (!platformAsset(url)) throw new Error("Untrusted attachment URL");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status})`);
  return assetBlob(response);
}

/** Hand edits as the browser saved them: bound to the revision they were made on. */
interface Edited {
  revision: string;
  edits: Edit[];
}

function checked(edited: unknown): Edited | null {
  if (edited == null) return null;
  const { revision, edits } = edited as Record<string, unknown>;
  const valid = validEdits(edits);
  if (typeof revision !== "string" || !valid) throw new Refusal(400, "The edits are malformed.");
  return valid.length ? { revision, edits: valid } : null;
}

/** The model with the hand edits applied; its script no longer rebuilds it, so it goes. */
function withEdits(model: Model, edited: Edited | null): Model {
  if (!edited) return model;
  if (edited.revision !== model.revision)
    throw new Refusal(409, "Your edits are for an earlier revision of the model.");
  const { blocks, boxes, steps, revision } = imported(applyEdits(model, edited.edits));
  return { ...model, blocks, boxes, steps, revision, script: "" };
}

/** The caller's finished build as the public sees it: its latest model with any hand edits, and no chat. */
export async function snapshot(id: string, key: string, edited: unknown, owner?: string): Promise<Shared> {
  const fork = owner ? await readFork(owner, id) : null;
  if (!fork) {
    if (isFork(id)) throw new Refusal(404, "No such build.");
    return sessionSnapshot(id, key, edited);
  }
  if (fork.sessionId) return sessionSnapshot(fork.sessionId, key, edited, fork.seed.model);
  return { ...withEdits(fork.seed.model, checked(edited)), status: "done", messages: [] };
}

/** A session's build; a session started on a seed (a fork, or a remix of an ended build) keeps the seed's name, and shows it until it shares a model. */
async function sessionSnapshot(id: string, key: string, edited: unknown, start?: Model): Promise<Shared> {
  const agp = platform(key);
  const session = await mine(agp, id);
  const state = status(session.status.status);
  if (state === "building") throw new Refusal(409, "Holo is still building: publish once it answers.");
  const t = await transcript(agp, id);
  if (!start && t.fork) start = (await readSeed(await download(t.fork, key))).model;
  if (!t.model && !start) throw new Refusal(409, "Nothing is built yet.");
  const latest = t.model ? await readJson<Model>(await download(t.model.url, key)) : start!;
  const model = withEdits(latest, checked(edited));
  const prompt = t.messages.find((m) => m.role === "user")?.text ?? "";
  const name = start?.name ?? (model.name !== EMPTY_MODEL.name ? model.name : prompt.slice(0, 60) || model.name);
  return { ...model, name, status: state, messages: [] };
}
