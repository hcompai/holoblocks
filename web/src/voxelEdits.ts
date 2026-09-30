/** A block cell: x, y, z. */
export type Cell = [number, number, number];

/** One change made by hand to some cells, undone as one; moves and copies carry the cells' blocks, air left behind. */
export type Edit =
  | { kind: "set"; cells: Cell[]; block: string }
  | { kind: "move"; cells: Cell[]; by: Cell }
  | { kind: "duplicate"; cells: Cell[]; by: Cell };

/** A model as `blocks run` writes it, boxes packed eight numbers each: x0 y0 z0 x1 y1 z1 block step. */
export interface VoxelModel {
  width: number;
  depth: number;
  height: number;
  blocks: string[];
  boxes: number[];
  steps?: { index: number; title: string; code: string }[];
}

export const EDITED_STEP = "Edited by hand";

const BLOCK = /^[a-z0-9_]+(\[[a-z0-9_]+=[a-z0-9_]+(,[a-z0-9_]+=[a-z0-9_]+)*\])?$/;

/** The model with `edits` replayed in order, its changed cells appended as boxes (air where cleared) in a last step titled `EDITED_STEP`. */
export function applyEdits<M extends VoxelModel>(model: M, edits: Edit[]): M {
  if (!edits.length) return model;
  const { width, height, depth } = model;
  const blocks = [...model.blocks];
  const index = new Map<string, number>();
  blocks.forEach((name, i) => index.has(name) || index.set(name, i));
  const indexOf = (name: string) => {
    let i = index.get(name);
    if (i === undefined) index.set(name, (i = blocks.push(name) - 1));
    return i;
  };
  /** A cell's value: its block's index in `blocks` plus one, or 0 for air. */
  const value = (name: string) => (name === "air" ? 0 : indexOf(name) + 1);
  const values = model.blocks.map(value);
  const grid = new Uint16Array(width * height * depth);
  const at = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth ? -1 : (y * depth + z) * width + x;

  const packed = model.boxes;
  let last = -1;
  for (let i = 0; i < packed.length; i += 8) {
    const [x0, y0, z0, x1, y1, z1, block, step] = packed.slice(i, i + 8);
    last = Math.max(last, step);
    const [xa, xb] = [Math.max(x0, 0), Math.min(x1, width - 1)];
    if (xa > xb) continue;
    for (let y = Math.max(y0, 0); y <= Math.min(y1, height - 1); y++)
      for (let z = Math.max(z0, 0); z <= Math.min(z1, depth - 1); z++)
        grid.fill(values[block], at(xa, y, z), at(xb, y, z) + 1);
  }

  const before = new Map<number, number>();
  const put = (i: number, v: number) => {
    if (i < 0) return;
    if (!before.has(i)) before.set(i, grid[i]);
    grid[i] = v;
  };
  for (const edit of edits) {
    if (edit.kind === "set") {
      const v = value(edit.block);
      for (const [x, y, z] of edit.cells) put(at(x, y, z), v);
      continue;
    }
    const [dx, dy, dz] = edit.by;
    const carried = edit.cells
      .map(([x, y, z]) => ({ from: at(x, y, z), to: at(x + dx, y + dy, z + dz) }))
      .filter(({ from }) => from >= 0 && grid[from])
      .map(({ from, to }) => ({ from, to, v: grid[from] }));
    if (edit.kind === "move") for (const { from } of carried) put(from, 0);
    for (const { to, v } of carried) put(to, v);
  }

  const edited = model.steps ? model.steps.length : last + 1;
  const boxes = [...packed];
  const changed = [...before.keys()].filter((i) => grid[i] !== before.get(i)).sort((a, b) => a - b);
  for (let k = 0; k < changed.length;) {
    const start = changed[k];
    const v = grid[start];
    let end = start;
    while (k + 1 < changed.length && changed[k + 1] === end + 1 && (end + 1) % width && grid[end + 1] === v)
      end = changed[++k];
    k++;
    const x = start % width;
    const z = Math.floor(start / width) % depth;
    const y = Math.floor(start / (width * depth));
    boxes.push(x, y, z, x + end - start, y, z, v ? v - 1 : indexOf("air"), edited);
  }
  const steps = model.steps && [...model.steps, { index: edited, title: EDITED_STEP, code: "" }];
  return { ...model, blocks, boxes, ...(steps && { steps }) };
}

const isCell = (c: unknown): c is Cell => Array.isArray(c) && c.length === 3 && c.every(Number.isSafeInteger);

/** `x` as a list of edits, stripped of anything else, or null when any edit is malformed. */
export function validEdits(x: unknown): Edit[] | null {
  if (!Array.isArray(x)) return null;
  const edits: Edit[] = [];
  for (const e of x) {
    if (typeof e !== "object" || e === null) return null;
    const { kind, cells, block, by } = e as Record<string, unknown>;
    if (!Array.isArray(cells) || !cells.every(isCell)) return null;
    const copy = cells.map(([x, y, z]) => [x, y, z] as Cell);
    if (kind === "set" && typeof block === "string" && BLOCK.test(block)) edits.push({ kind, cells: copy, block });
    else if ((kind === "move" || kind === "duplicate") && isCell(by)) edits.push({ kind, cells: copy, by: [...by] });
    else return null;
  }
  return edits;
}
