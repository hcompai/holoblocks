import { useMemo, useState } from "react";
import { type Build, pack, unpackBoxes } from "./model";
import { applyEdits, type Edit, validEdits } from "./voxelEdits";

const STORE = "blockyard.edits";
const NONE: Edit[] = [];

/** A build's edits, bound to the revision they were made on. */
interface Saved {
  revision: string;
  edits: Edit[];
}

const stored = (): Record<string, unknown> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") ?? {};
  } catch {
    return {};
  }
};

function load(id: string): Saved | null {
  const value = stored()[id] as Partial<Saved> | undefined;
  const edits = validEdits(value?.edits);
  return typeof value?.revision === "string" && edits?.length ? { revision: value.revision, edits } : null;
}

function save(id: string, value: Saved | null) {
  const all = stored();
  if (value) all[id] = value;
  else delete all[id];
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch (e) {
    console.error("Could not save the edits", e);
  }
}

/** FNV-1a of `text`, as 8 hex digits. */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The build's boxes and steps with `edits` applied, under a revision of their own. */
function edited(build: Build, edits: Edit[]): Pick<Build, "boxes" | "steps" | "revision" | "script"> {
  const { width, depth, height, steps } = build;
  const model = applyEdits({ width, depth, height, steps, ...pack(build.boxes) }, edits);
  return {
    boxes: unpackBoxes(model),
    steps: model.steps ?? steps,
    revision: `${build.revision}-${digest(JSON.stringify(edits))}`,
    script: "",
  };
}

export interface Edits {
  /** The build as edited, or the build itself when it has no edits that apply. */
  build: Build | null;
  edits: Edit[];
  /** Whether the edits can change now: not while Holo builds, and only on the revision they were made on. */
  editable: boolean;
  /** Edits made on a revision Holo has since replaced, kept until discarded. */
  stale: number;
  /** Edits hidden while Holo builds, so its renders show its own model. */
  hidden: number;
  push: (edit: Edit) => void;
  undo: () => void;
  redo: () => void;
  canRedo: boolean;
  reset: () => void;
}

/** The hand edits of the open build, saved in this browser per build and revision. */
export function useEdits(build: Build | null): Edits {
  const id = build?.id ?? null;
  const [state, setState] = useState<{ id: string | null; saved: Saved | null; undone: Edit[] }>({
    id: null,
    saved: null,
    undone: [],
  });
  if (state.id !== id) setState({ id, saved: id ? load(id) : null, undone: [] });
  const saved = state.id === id ? state.saved : null;

  const building = build?.status === "building";
  const matches = !!build && (!saved || saved.revision === build.revision);
  const edits = matches && saved ? saved.edits : NONE;
  const applies = !building && edits.length > 0;
  const changed = useMemo(
    () => (build && applies ? edited(build, edits) : null),
    [build?.boxes, build?.steps, build?.revision, applies, edits],
  );
  const shown = useMemo(() => (build && changed ? { ...build, ...changed } : build), [build, changed]);

  const editable = !!build && !building && matches;
  const update = (next: Edit[], undone: Edit[]) => {
    if (!build) return;
    const value = next.length ? { revision: build.revision, edits: next } : null;
    setState({ id: build.id, saved: value, undone });
    save(build.id, value);
  };
  const undone = state.undone;
  return {
    build: shown,
    edits,
    editable,
    stale: !matches && saved ? saved.edits.length : 0,
    hidden: building ? edits.length : 0,
    push: (edit) => {
      if (editable) update([...edits, edit], []);
    },
    undo: () => {
      if (editable && edits.length) update(edits.slice(0, -1), [...undone, edits[edits.length - 1]]);
    },
    redo: () => {
      if (editable && undone.length) update([...edits, undone[undone.length - 1]], undone.slice(0, -1));
    },
    canRedo: editable && undone.length > 0,
    reset: () => update([], []),
  };
}
