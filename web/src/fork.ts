import { client, download, firstMessage, forkSession, prepared } from "./agent";
import { type ForkSeed, readSeed } from "./forkModel";
import { card, linkFork, remember } from "./library";
import { unpack } from "./model";
import { script } from "./remix";
import { FORK_FILE } from "./session";

/** A fork of its own, or a build carried on under its session id. */
const FORK_ID = /^[\w-]{1,100}$/;
const UNCONFIRMED = "The fork may have started: send again to check.";

const seeds = new Map<string, ForkSeed>();

/** The starting model of session `id`, when this tab started it. */
export const cachedSeed = (id: string) => seeds.get(id) ?? null;

/** The starting model a session was sent, read from its request: setup may fail before it attaches anything. */
export async function requestedSeed(id: string, signal: AbortSignal): Promise<ForkSeed | null> {
  const session = await client.sessions.getSession({ id }, { abortSignal: signal });
  const input = session.request.messages;
  const messages = typeof input === "object" && input ? (Array.isArray(input) ? input : [input]) : [];
  const file = messages.flatMap((m) => m.files ?? []).find((f) => f.name === FORK_FILE);
  if (!file) return null;
  return readSeed(
    file.type === "url"
      ? await download(file.source, signal)
      : await fetch(`data:application/gzip;base64,${file.source}`).then((r) => r.blob()),
  );
}

/** Starts `group`'s session on a seed once: after an ambiguous request it looks for the session rather than send again. */
export function forkOperation(group = `fork-${crypto.randomUUID()}`) {
  let sent = false;
  let pending: Promise<string> | null = null;
  let accepted: string | null = null;
  const finish = (id: string, seed: ForkSeed, prompt: string) => {
    accepted = id;
    remember(group, { forkStarting: false });
    seeds.set(id, seed);
    remember(id, { name: seed.model.name, prompt, steps: seed.model.steps.length });
    return id;
  };
  const run = async (seed: ForkSeed, text: string, photos: string[], attached: Record<string, Blob>) => {
    const found = () => forkSession(group).catch(() => null);
    if (sent || card(group)?.forkStarting) {
      const id = await found();
      if (id) return finish(id, seed, text);
      throw new Error(UNCONFIRMED);
    }
    const existing = await forkSession(group);
    if (existing) return finish(existing, seed, text);
    const json = new Blob([JSON.stringify(seed)], { type: "application/json" });
    const packed = await new Response(json.stream().pipeThrough(new CompressionStream("gzip"))).blob();
    const first = await firstMessage(text, photos, {
      ...attached,
      [FORK_FILE]: packed,
      "remix.py": new Blob([script(unpack(seed.model))], { type: "text/x-python" }),
    });
    const submit = prepared([first], group);
    sent = true;
    remember(group, { forkStarting: true });
    try {
      return finish(await submit(), seed, text);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code && [400, 401, 403, 413, 422, 429].includes(code)) {
        sent = false;
        remember(group, { forkStarting: false });
        throw e;
      }
      const id = await found();
      if (id) return finish(id, seed, text);
      throw new Error(UNCONFIRMED);
    }
  };
  return (seed: ForkSeed, text: string, photos: string[], attached: Record<string, Blob>): Promise<string> => {
    if (accepted) return Promise.resolve(accepted);
    pending ??= run(seed, text, photos, attached).finally(() => {
      pending = null;
    });
    return pending;
  };
}

const starts = new Map<string, ReturnType<typeof forkOperation>>();

/**
 * Start Holo on fork `id` with its first message, and bind the fork to that session. Carrying a build on from its
 * ended session `after` starts a run in a group of its own, so the ended one is never mistaken for it.
 */
export async function startFork(
  id: string,
  seed: ForkSeed,
  text: string,
  photos: string[],
  attached: Record<string, Blob> = {},
  after?: string,
): Promise<string> {
  if (!FORK_ID.test(id)) throw new Error("No such fork.");
  const group = after ? `${id}+${after}` : id;
  let start = starts.get(group);
  if (!start) starts.set(group, (start = forkOperation(group)));
  const begin = async () => {
    const session = await start(seed, text, photos, attached);
    await linkFork(id, session);
    return session;
  };
  return navigator.locks ? navigator.locks.request(`blockyard-fork-${group}`, begin) : begin();
}
