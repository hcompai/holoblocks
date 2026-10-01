import type { PackedBoxes, State, VoxelWorld } from "./voxels";

export const SETTLE_SECONDS = 0.09;

export interface PlacementPlan {
  /** Start time for each cell; -1 means it was already placed. */
  starts: Float32Array<ArrayBuffer>;
  /** Changed cells in step, layer, and winding row order. */
  cells: Uint32Array<ArrayBuffer>;
  blockIds: Uint16Array<ArrayBuffer>;
  names: string[];
  duration: number;
}

const key = (state: State) => `${state.name}:${JSON.stringify(Object.entries(state.props).sort())}`;

/** Resolve overwrites first, then give each changed block its own placement time. */
export function planPlacement(
  world: VoxelWorld,
  previous: VoxelWorld | null,
  packed: PackedBoxes,
  steps: Int32Array,
): PlacementPlan {
  const owners = new Int32Array(world.ids.length);
  for (let i = 0; i < packed.boxes.length; i += 7) {
    const [x0, y0, z0, x1, y1, z1] = packed.boxes.subarray(i, i + 6);
    for (let y = Math.max(0, y0); y <= Math.min(world.height - 1, y1); y++)
      for (let z = Math.max(0, z0); z <= Math.min(world.depth - 1, z1); z++)
        owners.fill(steps[i / 7], world.at(Math.max(0, x0), y, z), world.at(Math.min(world.width - 1, x1), y, z) + 1);
  }
  const keys = world.states.map(key);
  const oldKeys = previous?.states.map(key);
  const groups = new Map<number, number[]>();
  for (let y = 0; y < world.height; y++)
    for (let z = 0; z < world.depth; z++)
      for (let column = 0; column < world.width; column++) {
        const x = z % 2 ? world.width - 1 - column : column;
        const cell = world.at(x, y, z);
        const id = world.ids[cell];
        if (!id || world.states[id].name === "air") continue;
        const old =
          previous && x < previous.width && y < previous.height && z < previous.depth
            ? previous.ids[previous.at(x, y, z)]
            : 0;
        if (oldKeys && oldKeys[old] === keys[id]) continue;
        const owner = owners[cell];
        if (!groups.has(owner)) groups.set(owner, []);
        groups.get(owner)!.push(cell);
      }
  const starts = new Float32Array(world.ids.length).fill(-1);
  const ordered: number[] = [];
  let duration = 0;
  for (const [, cells] of [...groups].sort(([a], [b]) => a - b)) {
    const seconds = Math.min(2.2, Math.max(0.38, Math.sqrt(cells.length) * 0.035));
    cells.forEach((cell, index) => {
      starts[cell] = duration + (index / cells.length) * seconds;
    });
    for (const cell of cells) ordered.push(cell);
    duration += seconds + SETTLE_SECONDS;
  }
  const cells = Uint32Array.from(ordered);
  return {
    starts,
    cells,
    blockIds: Uint16Array.from(cells, (cell) => world.ids[cell]),
    names: world.states.map((s) => s.name),
    duration,
  };
}

/** How many placements have started by `seconds`, without scanning a large build each frame. */
export function placedCount(plan: PlacementPlan, seconds: number): number {
  let lo = 0,
    hi = plan.cells.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (plan.starts[plan.cells[mid]] <= seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
