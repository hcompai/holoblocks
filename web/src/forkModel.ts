import type { Model, Source } from "./model";
import { readJson } from "./session";

const SOURCES: Source[] = ["session", "public", "showcase", "fork"];

/** The build and version a fork was copied from. */
export interface ForkOrigin {
  id: string;
  source: Source;
  name: string;
  version: number | null;
  revision: string;
}

export interface ForkSeed {
  format: 1;
  origin: ForkOrigin;
  model: Model;
}

/** Explicit fields keep the chat, Holo's work and attachment URLs out of the fork. */
export function forkSeed(model: Model, origin: ForkOrigin, name: string): ForkSeed {
  const { width, depth, height, updated, revision, steps, blocks, boxes, script = "" } = model;
  return structuredClone({
    format: 1,
    origin,
    model: { name, width, depth, height, updated, revision, steps, blocks, boxes, script },
  });
}

/** `value` as a fork's starting model, or an error when it is not one. */
export function checkedSeed(value: unknown): ForkSeed {
  const { format, origin, model } = (value ?? {}) as Partial<ForkSeed>;
  if (
    format !== 1 ||
    !origin ||
    !SOURCES.includes(origin.source) ||
    typeof origin.id !== "string" ||
    typeof origin.name !== "string" ||
    typeof origin.revision !== "string" ||
    (origin.version !== null && !Number.isSafeInteger(origin.version)) ||
    typeof model?.name !== "string" ||
    !Number.isFinite(model.updated) ||
    typeof model.revision !== "string" ||
    model.revision.length > 1000 ||
    !Array.isArray(model.steps) ||
    !Array.isArray(model.blocks) ||
    !Array.isArray(model.boxes) ||
    model.boxes.length % 8
  )
    throw new Error("The fork's starting model is unavailable.");
  return value as ForkSeed;
}

export const readSeed = async (blob: Blob) => checkedSeed(await readJson(blob));

export interface SavedFork {
  id: string;
  name: string;
  steps: number;
  /** In seconds. */
  created: number;
  sessionId: string | null;
  seed: ForkSeed;
}

export type ForkSummary = Omit<SavedFork, "seed">;
