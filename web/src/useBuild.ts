import { useEffect, useMemo, useState } from "react";
import { forkSession } from "./agent";
import type { ForkSeed, SavedFork } from "./forkModel";
import { publicBuild, savedFork, showcase } from "./library";
import { type Build, type Source, unpack } from "./model";
import type { Activity, ModelAttachment } from "./session";
import { useSession } from "./useSession";

export interface BuildRef {
  id: string;
  source: Source;
}

export interface LiveBuild {
  build: Build | null;
  loading: boolean;
  activity: Activity | null;
  error: string | null;
  /** A shown model can remain available, but must not be presented as confirmed live. */
  syncError: string | null;
  /** Every model the builder shared, in order. */
  models: ModelAttachment[];
  /** The model a fork started from. */
  seed: ForkSeed | null;
}

const NO_MODELS: ModelAttachment[] = [];

/** A finished build that no builder works on: a showcase, or a public build. */
function useFinished(ref: BuildRef | null): LiveBuild {
  const [build, setBuild] = useState<Build | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = ref?.id ?? null;
  const source = ref?.source ?? null;

  useEffect(() => {
    setBuild(null);
    setError(null);
    if (!id) return;
    let current = true;
    (source === "public" ? publicBuild(id) : showcase(id)).then(
      (shown) => current && setBuild(shown),
      () => current && setError("Couldn't load this build"),
    );
    return () => {
      current = false;
    };
  }, [id, source]);

  const shown = build?.id === id ? build : null;
  return {
    build: shown,
    loading: id !== null && !shown && !error,
    activity: null,
    error,
    syncError: null,
    models: NO_MODELS,
    seed: null,
  };
}

/** One of the user's forks, and the session its first message started, if it did. */
function useFork(id: string | null) {
  const [fork, setFork] = useState<SavedFork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setFork(null);
    setError(null);
    setSyncError(null);
    if (!id) return;
    let current = true;
    savedFork(id)
      .then(async (saved) => {
        if (saved.sessionId) return saved;
        try {
          return { ...saved, sessionId: await forkSession(id) };
        } catch {
          if (current) setSyncError("Connection lost: showing the fork's starting model.");
          return saved;
        }
      })
      .then(
        (saved) => current && setFork(saved),
        () => current && setError("Couldn't load this build"),
      );
    return () => {
      current = false;
    };
  }, [id]);

  const saved = fork?.id === id ? fork : null;
  const attach = (sessionId: string) => setFork((fork) => (fork && fork.id === id ? { ...fork, sessionId } : fork));
  return { saved, error, syncError, attach };
}

/** A showcase from the static gallery, a public build from the library, or a session or fork read live from the Agents API. */
export function useBuild(ref: BuildRef | null): LiveBuild & {
  /** The session behind the build: the session itself, or the one a fork continues in. */
  runId: string | null;
  /** Show the session a fork's first message started. */
  attachSession: (id: string) => void;
} {
  const forkId = ref?.source === "fork" ? ref.id : null;
  const fork = useFork(forkId);
  const runId = ref?.source === "session" ? ref.id : (fork.saved?.sessionId ?? null);
  const finished = useFinished(ref && (ref.source === "public" || ref.source === "showcase") ? ref : null);
  const session = useSession(runId);
  const seed = fork.saved?.seed ?? null;
  const started = useMemo(
    () =>
      forkId && seed ? { ...unpack(seed.model), id: forkId, status: "done" as const, open: true, messages: [] } : null,
    [forkId, seed],
  );
  const continued = useMemo(
    () => (forkId && session.build ? { ...session.build, id: forkId } : null),
    [forkId, session.build],
  );
  const attachSession = fork.attach;
  if (!forkId) return { ...(runId ? session : finished), runId, attachSession };
  if (runId) return { ...session, build: continued, seed: session.seed ?? seed, runId, attachSession };
  return {
    build: started,
    loading: !started && !fork.error,
    activity: null,
    error: fork.error,
    syncError: fork.syncError,
    models: NO_MODELS,
    seed,
    runId: null,
    attachSession,
  };
}
