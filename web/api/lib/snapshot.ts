import { HaiAgentsClient, HaiAgentsError, type HaiAgents } from "hai-agents";
import { H } from "../../src/hosts";
import { platformAsset, externalImage, assetBlob } from "../../src/assetUrl";
import { EMPTY_MODEL, type Message, type Model, type Shared } from "../../src/model";
import { AGENT, EMPTY_TRANSCRIPT, read, readJson, status, type Transcript } from "../../src/session";
import { applyEdits, type Edit, validEdits } from "../../src/voxelEdits";
import { readFork } from "./forks";
import { Refusal } from "./http";
import { imported } from "./imported";

/** Chat images kept with a public build; past this, the chat keeps its text only. */
const MAX_IMAGES = 80;
const PARALLEL = 8;

/** Store one image of the chat under `name`, and return its public URL. */
export type Keep = (name: string, image: Blob) => Promise<string>;

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

const picture = (src: string, key: string): Promise<Blob> =>
  src.startsWith("data:") ? fetch(src).then(assetBlob) : download(src, key);

const extension = (image: Blob) => ({ "image/jpeg": "jpg", "image/webp": "webp" })[image.type] ?? "png";

/** Copy session images without Holo's reasoning; external HTTPS photos remain links. */
async function copied(messages: Message[], key: string, keep: Keep): Promise<Message[]> {
  const sources = [...new Set(messages.flatMap((m) => m.images))].slice(0, MAX_IMAGES);
  const urls = new Map<string, string>();
  for (let i = 0; i < sources.length; i += PARALLEL)
    await Promise.all(
      sources.slice(i, i + PARALLEL).map(async (src, j) => {
        if (!src.startsWith("data:") && !platformAsset(src)) {
          if (externalImage(src)) urls.set(src, src);
          return;
        }
        try {
          const image = await picture(src, key);
          urls.set(src, await keep(`images/${i + j + 1}.${extension(image)}`, image));
        } catch (e) {
          console.warn("Left an image out of the public build", e);
        }
      }),
    );
  return messages.map(({ work, ...m }) => ({ ...m, images: m.images.flatMap((src) => urls.get(src) ?? []) }));
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

/** The caller's finished build as the public sees it: its latest model with any hand edits, and its chat. */
export async function snapshot(id: string, key: string, edited: unknown, keep: Keep, owner?: string): Promise<Shared> {
  if (!id.startsWith("fork-")) return sessionSnapshot(id, key, edited, keep);
  const fork = owner ? await readFork(owner, id) : null;
  if (!fork) throw new Refusal(404, "No such build.");
  if (fork.sessionId) return sessionSnapshot(fork.sessionId, key, edited, keep, fork.seed.model);
  return { ...withEdits(fork.seed.model, checked(edited)), status: "done", messages: [] };
}

/** A session's build; `start` is the model it started from, until it shares one of its own. */
async function sessionSnapshot(id: string, key: string, edited: unknown, keep: Keep, start?: Model): Promise<Shared> {
  const agp = platform(key);
  const session = await mine(agp, id);
  const state = status(session.status.status);
  if (state === "building") throw new Refusal(409, "Holo is still building: publish once it answers.");
  const t = await transcript(agp, id);
  if (!t.model && !start) throw new Refusal(409, "Nothing is built yet.");
  const latest = t.model ? await readJson<Model>(await download(t.model.url, key)) : start!;
  const model = withEdits(latest, checked(edited));
  const prompt = t.messages.find((m) => m.role === "user")?.text ?? "";
  const name = model.name !== EMPTY_MODEL.name ? model.name : prompt.slice(0, 60) || model.name;
  return { ...model, name, status: state, messages: await copied(t.messages, key, keep) };
}
