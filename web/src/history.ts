import { useEffect, useRef, useState } from "react";
import { download } from "./agent";
import type { Model } from "./model";
import { type ModelAttachment, readJson } from "./session";

/** One distinct model of a build, numbered from 1 in the order it was made. */
export interface Version {
  id: string;
  number: number;
  /** When the builder shared it; empty for a fork's starting model. */
  at: string;
  model: Model;
}

/** What makes two models the same version: a new name or a reshared model does not. */
export const design = (model: Pick<Model, "revision">) => model.revision;

async function savedModel(blob: Blob): Promise<Model> {
  const model = await readJson<Model>(blob);
  if (
    typeof model?.revision !== "string" ||
    !Array.isArray(model.steps) ||
    !Array.isArray(model.blocks) ||
    !Array.isArray(model.boxes) ||
    model.boxes.length % 8
  )
    throw new Error("The saved model is malformed.");
  return model;
}

/** The versions of a build, read only when `enabled`: a failed download fails them all, so none is renumbered. */
export function useHistory(id: string | null, attachments: ModelAttachment[], seed: Model | null, enabled: boolean) {
  const [state, setState] = useState<{ id: string | null; versions: Version[]; count: number; error: boolean }>({
    id: null,
    versions: [],
    count: 0,
    error: false,
  });
  const [retry, setRetry] = useState(0);
  const cache = useRef<{ id: string | null; models: Map<string, Model> }>({ id: null, models: new Map() });

  useEffect(() => {
    if (!id || !enabled) return;
    if (cache.current.id !== id) cache.current = { id, models: new Map() };
    const models = cache.current.models;
    const controller = new AbortController();
    const load = async () => {
      const versions: Version[] = seed ? [{ id: "seed", number: 1, at: "", model: seed }] : [];
      for (const attachment of attachments) {
        let model = models.get(attachment.url);
        if (!model) {
          model = await savedModel(await download(attachment.url, controller.signal));
          models.set(attachment.url, model);
        }
        const previous = versions.at(-1);
        if (previous ? design(previous.model) === design(model) : !model.boxes.length) continue;
        versions.push({ id: attachment.url, number: versions.length + 1, at: attachment.at, model });
      }
      if (!controller.signal.aborted) setState({ id, versions, count: attachments.length, error: false });
    };
    load().catch((e) => {
      if (controller.signal.aborted) return;
      console.error("Could not read the build's history", e);
      setState((old) => ({ ...old, id, error: true }));
    });
    return () => controller.abort();
  }, [id, attachments, seed, enabled, retry]);

  const current = state.id === id;
  return {
    versions: current ? state.versions : [],
    loading: enabled && (!current || state.count !== attachments.length) && !(current && state.error),
    error: current && state.error,
    retry: () => {
      setState((old) => ({ ...old, error: false }));
      setRetry((n) => n + 1);
    },
  };
}
