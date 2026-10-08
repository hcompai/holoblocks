import type { PackedBoxes, State, VoxelWorld } from "./voxels";
import type { CameraBounds, CameraLayer, CameraLens, CameraPlanData } from "./buildCamera";
import { addCameraCell, mergeCameraSolids } from "./cameraSolids";
import { CAMERA_MOVE_SECONDS } from "./buildTiming";

export const SETTLE_SECONDS = 0.09;

export interface PlacementPlan {
  /** Start time for each cell; -1 means it was already placed. */
  starts: Float32Array<ArrayBuffer>;
  /** Changed cells in step, layer, and winding row order. */
  cells: Uint32Array<ArrayBuffer>;
  blockIds: Uint16Array<ArrayBuffer>;
  names: string[];
  duration: number;
  camera: {
    initial: CameraBounds | null;
    initialSolids: CameraBounds[];
    layers: CameraLayer[];
    framing?: { lens: CameraLens; plan: CameraPlanData };
  };
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
  const initialSolids: CameraBounds[] = [];
  const solid = world.states.map(
    ({ info }) => !info.transparent && !info.cutout && !info.liquid && ["cube", "log"].includes(info.shape ?? "cube"),
  );
  let initial: CameraBounds | null = null;
  const expand = (bounds: CameraBounds | null, x: number, y: number, z: number): CameraBounds =>
    bounds
      ? [
          Math.min(bounds[0], x),
          Math.min(bounds[1], y),
          Math.min(bounds[2], z),
          Math.max(bounds[3], x + 1),
          Math.max(bounds[4], y + 1),
          Math.max(bounds[5], z + 1),
        ]
      : [x, y, z, x + 1, y + 1, z + 1];
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
        if (oldKeys && oldKeys[old] === keys[id]) {
          initial = expand(initial, x, y, z);
          if (solid[id]) addCameraCell(initialSolids, x, y, z);
          continue;
        }
        const owner = owners[cell];
        if (!groups.has(owner)) groups.set(owner, []);
        groups.get(owner)!.push(cell);
      }
  const starts = new Float32Array(world.ids.length).fill(-1);
  const ordered: number[] = [];
  const layers: CameraLayer[] = [];
  let duration = 0;
  for (const [step, cells] of [...groups].sort(([a], [b]) => a - b)) {
    if (layers.length) duration += CAMERA_MOVE_SECONDS;
    const seconds = Math.min(2.2, Math.max(0.38, Math.sqrt(cells.length) * 0.035));
    let layer: CameraLayer | null = null;
    cells.forEach((cell, index) => {
      const time = duration + (index / cells.length) * seconds;
      starts[cell] = time;
      const x = cell % world.width;
      const y = Math.floor(cell / (world.width * world.depth));
      const z = Math.floor(cell / world.width) % world.depth;
      if (!layer || layer.bounds[1] !== y) {
        if (layer) layer.end = time;
        layer = {
          step,
          start: time,
          end: duration + seconds + SETTLE_SECONDS,
          bounds: [x, y, z, x + 1, y + 1, z + 1],
          solids: [],
        };
        layers.push(layer);
      } else layer.bounds = expand(layer.bounds, x, y, z);
      if (solid[world.ids[cell]]) addCameraCell(layer.solids!, x, y, z);
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
    camera: {
      initial,
      initialSolids: mergeCameraSolids(initialSolids),
      layers: layers.map((layer) => ({ ...layer, solids: mergeCameraSolids(layer.solids!) })),
    },
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
