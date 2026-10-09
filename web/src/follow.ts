import { isTerminalSessionStatus, type HaiAgents } from "hai-agents";
import { answer, client, download, fail } from "./agent";
import { cachedSeed, requestedSeed } from "./fork";
import { type ForkSeed, readSeed } from "./forkModel";
import { card, remember } from "./library";
import { caption, dataUrl, type View, view } from "./look";
import { type Build, EMPTY_MODEL, type Message, type Model, type RenderRequest, PALETTE, unpack } from "./model";
import { BlockScene, type Site } from "./scene";
import {
  type Activity,
  activity,
  EMPTY_TRANSCRIPT,
  ending,
  type ModelAttachment,
  read,
  readJson,
  status as buildStatus,
  type Transcript,
} from "./session";
import { label } from "./suggestions";
import { H } from "./hosts";

const WAIT_S = 20;
const RETRY_MS = 3000;
const RENDER_TRIES = 3;
const LOAD_TRIES = 3;

/** A session as the Agents API last told it. */
export interface Followed {
  /** The completed inspection of the currently loaded revision. */
  inspection: RenderRequest | null;
  build: Build | null;
  /** What the builder is doing, while it builds. */
  activity: Activity | null;
  /** Why the build cannot be read at all; its follower has stopped. */
  error: string | null;
  /** A shown model can remain available, but must not be presented as confirmed live. */
  syncError: string | null;
  /** Every model the builder shared, in order. */
  models: ModelAttachment[];
  /** The model a fork's session started from. */
  seed: ForkSeed | null;
}

export const NOTHING: Followed = {
  build: null,
  activity: null,
  error: null,
  syncError: null,
  models: [],
  seed: null,
  inspection: null,
};

type Listener = (state: Followed) => void;

type Shown = ReturnType<typeof unpack>;

const named = (model: { name: string }) => model.name !== EMPTY_MODEL.name;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const status = (e: unknown) => (e instanceof Error && "statusCode" in e ? e.statusCode : null);

let eye: BlockScene | null = null;
let blocks = 0;
let rendering: Promise<unknown> = Promise.resolve();

/** Holo's view of `site`, drawn off screen one at a time whatever the user is looking at, with its block count. */
function render(site: Site, look: View & { request: string; revision: string }) {
  const next = rendering.then(async () => {
    try {
      if (!eye) {
        eye = new BlockScene(document.createElement("div"), Promise.resolve(PALETTE));
        eye.onCounts = (counts) => (blocks = [...counts.values()].reduce((a, b) => a + b, 0));
      }
      eye.show(site);
      const png = await eye.look(look);
      return png && { png, blocks };
    } catch (e) {
      eye?.dispose();
      eye = null;
      throw e;
    }
  });
  rendering = next.catch(() => undefined);
  return next;
}

/** Poll session `id` until it ends or `signal` aborts, answering every `look` it waits on. */
function follow(id: string, signal: AbortSignal, notify: Listener, displayed: () => boolean) {
  let state: Followed = NOTHING;
  const set = (next: Partial<Followed>) => {
    if (signal.aborted) return;
    state = { ...state, ...next };
    notify(state);
  };
  let transcript: Transcript = EMPTY_TRANSCRIPT;
  let session: HaiAgents.TrajectoryStatus = "pending";
  let failure: string | null = null;
  let seed = cachedSeed(id);
  let seedChecked = !!seed;
  let model: Shown = unpack(seed?.model ?? EMPTY_MODEL);
  let loaded = 0;
  /** The latest shared model while it fails to load: how many times, and why. */
  let unloaded: { shared: number; tries: number; reason: string } | null = null;
  const seen = new Set<string>();
  const pictures = new Map<string, string | null>();

  const stored = (src: string) => src.startsWith(`${H.agents}/`);
  const shownPicture = (src: string) => (stored(src) ? (pictures.get(src) ?? null) : src);
  const shown = (messages: Message[]) =>
    messages.map((m) => ({
      ...m,
      images: m.images.flatMap((src) => shownPicture(src) ?? []),
    }));

  const fetchPictures = () => {
    if (!displayed()) return;
    const sources = [...transcript.messages.flatMap((m) => m.images), ...transcript.references.map((r) => r.src)];
    for (const src of sources) {
      if (!stored(src) || pictures.has(src)) continue;
      pictures.set(src, null);
      download(src, signal).then(
        (blob) => {
          if (signal.aborted) return;
          pictures.set(src, URL.createObjectURL(blob));
          publish();
        },
        () => pictures.delete(src),
      );
    }
  };

  const see = async (call: HaiAgents.ToolRequest, shared: number) => {
    const wanted = view(call.args);
    if (typeof wanted === "string" || shared === 0)
      return fail(
        id,
        call,
        typeof wanted === "string" ? wanted : "Nothing is shared yet: share model.json.gz, then look.",
      );
    const shot = model;
    const request = { request: call.id!, ...wanted, revision: shot.revision };
    for (let tries = 1; ; tries++) {
      try {
        const drawn = await render(shot, request);
        if (!drawn) throw new Error("the render came back empty");
        await answer(id, call, [caption(request, drawn.blocks), await dataUrl(drawn.png)]);
        if (!signal.aborted && model.revision === shot.revision) {
          transcript = { ...transcript, inspection: request };
          publish();
        }
        return;
      } catch (e) {
        if (signal.aborted || status(e) === 409) return;
        console.error("Could not answer a look", e);
        if (tries >= RENDER_TRIES) {
          const reason = e instanceof Error ? e.message : String(e);
          return fail(id, call, `The render failed (${reason}). Carry on from the run's output, and look again later.`);
        }
        await sleep(RETRY_MS);
      }
    }
  };

  const publish = () => {
    const end = transcript.crashed ? null : ending(session);
    const request = transcript.messages.find((m) => m.role === "user")?.text;
    const state = transcript.crashed ? "error" : buildStatus(session);
    set({
      inspection:
        transcript.inspection && model.revision.startsWith(transcript.inspection.revision)
          ? { ...transcript.inspection, revision: model.revision }
          : null,
      models: transcript.models,
      seed,
      build: {
        ...model,
        name:
          [seed?.model.name, model.name, card(id)?.name, request && (label(request) ?? request.slice(0, 60))].find(
            (n) => n && named({ name: n }),
          ) ?? model.name,
        id,
        status: state,
        messages: shown(end ? [...transcript.messages, end] : transcript.messages),
        open: session === "idle" && !transcript.crashed,
        failure: transcript.error ?? failure,
      },
      activity:
        state === "building"
          ? {
              ...activity(transcript),
              references: transcript.references.flatMap((reference) => {
                const src = shownPicture(reference.src);
                return src ? [{ ...reference, src }] : [];
              }),
            }
          : null,
    });
    if (transcript.state !== "awaiting_tool_results") return;
    const lost = unloaded && unloaded.tries >= LOAD_TRIES ? unloaded : null;
    const look = transcript.looks.find((l) => l.shared <= loaded || lost);
    const call = look?.call;
    if (!look || !call?.id || seen.has(call.id)) return;
    seen.add(call.id);
    const answered =
      look.shared <= loaded
        ? see(call, look.shared)
        : fail(id, call, `The model you shared could not be loaded (${lost!.reason}). Share it again, then look.`);
    answered.catch((e) => {
      if (status(e) !== 409) seen.delete(call.id!);
    });
  };

  const loadModel = async () => {
    if (!seed && transcript.fork) {
      seed = await readSeed(await download(transcript.fork, signal));
      seedChecked = true;
      if (!loaded) model = unpack(seed.model);
    }
    if (!seedChecked && !transcript.model) {
      seedChecked = true;
      seed = await requestedSeed(id, signal).catch((e) => {
        if (signal.aborted) throw e;
        console.error("Could not read the session's request", e);
        return null;
      });
      if (seed) model = unpack(seed.model);
    }
    const latest = transcript.model;
    if (!latest || latest.shared === loaded) return;
    try {
      const next = unpack(await readJson<Model>(await download(latest.url, signal)));
      model = next.revision === model.revision ? { ...next, boxes: model.boxes } : next;
      loaded = latest.shared;
      unloaded = null;
      remember(id, { steps: model.steps.length, ...(named(model) && { name: seed?.model.name ?? model.name }) });
    } catch (e) {
      if (signal.aborted) throw e;
      console.error("Could not load the latest model", e);
      const tries = unloaded?.shared === latest.shared ? unloaded.tries + 1 : 1;
      unloaded = { shared: latest.shared, tries, reason: e instanceof Error ? e.message : String(e) };
    }
  };

  const poll = async () => {
    while (!signal.aborted) {
      try {
        const changed = (waitForSeconds: number) =>
          client.sessions.getSessionChanges(
            { id, fromIndex: transcript.events, includeEvents: true, waitForSeconds },
            { abortSignal: signal, timeoutInSeconds: waitForSeconds + 20, maxRetries: 0 },
          );
        let changes = await changed(WAIT_S);
        if (!changes) {
          const current = await client.sessions.getSessionStatus({ id }, { abortSignal: signal });
          // Events can land between the long poll and the status: the status never outruns the transcript.
          if (current.status !== session) changes = await changed(0);
          if (!changes) {
            session = current.status;
            failure = current.error ?? null;
          }
        }
        if (changes) {
          transcript = read(transcript, changes.newEvents ?? []);
          session = changes.status;
          failure = changes.error ?? null;
        }
        await loadModel();
        fetchPictures();
        publish();
        set({ error: null, syncError: unloaded && "Couldn't load the latest model." });
        if (!changes && isTerminalSessionStatus(session)) {
          if (!unloaded || unloaded.tries >= LOAD_TRIES) return;
          await sleep(RETRY_MS);
        }
      } catch (e) {
        if (signal.aborted) return;
        console.error(e);
        const code = status(e);
        if (code === 403 || code === 404) return set({ error: "Couldn't load this build" });
        set({ syncError: "Connection lost: the latest model cannot be confirmed. Reconnecting…" });
        await sleep(RETRY_MS);
      }
    }
  };
  if (seed) publish();
  void poll();
  return {
    refresh: () => {
      fetchPictures();
      if (state.build) publish();
    },
    release: () => {
      for (const url of pictures.values()) if (url) URL.revokeObjectURL(url);
    },
  };
}

interface Watched {
  controller: AbortController;
  listeners: Map<Listener, boolean>;
  state: Followed | null;
  follower: ReturnType<typeof follow>;
}

const watched = new Map<string, Watched>();

/** Follow session `id` for `listener` until the returned function is called; one follower serves every listener. */
export function watch(id: string, listener: Listener, { display = false } = {}): () => void {
  let entry = watched.get(id);
  if (!entry) {
    const controller = new AbortController();
    const listeners = new Map<Listener, boolean>();
    const created: Watched = { controller, listeners, state: null, follower: null! };
    created.follower = follow(
      id,
      controller.signal,
      (state) => {
        created.state = state;
        for (const l of listeners.keys()) l(state);
      },
      () => [...listeners.values()].some(Boolean),
    );
    watched.set(id, (entry = created));
  }
  const current = entry;
  current.listeners.set(listener, display);
  if (current.state) listener(current.state);
  if (display) current.follower.refresh();
  return () => {
    if (!current.listeners.delete(listener) || current.listeners.size) return;
    current.controller.abort();
    current.follower.release();
    watched.delete(id);
  };
}
