import type { Palette } from "./model";
import type { UV } from "./atlas";
import { type MeshData, meshWorld, outline, type PackedBoxes, VoxelWorld } from "./voxels";
import { type PlacementPlan, planPlacement } from "./placement";

export interface MesherSetup {
  palette: Palette;
  uvs: Map<string, UV>;
}

export interface MeshRequest extends PackedBoxes {
  id: number;
  width: number;
  height: number;
  depth: number;
  /** Only the interactive viewer requests placement timing; renders and exports use completed geometry. */
  steps?: Int32Array<ArrayBuffer>;
  previous?: PackedBoxes & { width: number; height: number; depth: number };
}

export interface MeshReply {
  id: number;
  meshes: MeshData[];
  /** Vertices that bound every view of the meshes. */
  outline: Float32Array<ArrayBuffer>;
  counts: Map<string, number>;
  bounds: number[] | null;
  placement?: PlacementPlan;
}

export interface MeshFailure {
  id: number;
  error: string;
}

let setup: MesherSetup;

/** Web worker that fills a site's voxels and meshes them, off the main thread. */
self.onmessage = ({ data }: MessageEvent<MesherSetup | MeshRequest>) => {
  if ("palette" in data) {
    setup = data;
    return;
  }
  try {
    const world = new VoxelWorld(data.width, data.height, data.depth, setup.palette);
    world.apply(data);
    let previous: VoxelWorld | null = null;
    if (data.previous) {
      previous = new VoxelWorld(data.previous.width, data.previous.height, data.previous.depth, setup.palette);
      previous.apply(data.previous);
    }
    const placement = data.steps ? planPlacement(world, previous, data, data.steps) : undefined;
    const animated = placement?.cells.length ? placement : undefined;
    const meshes = meshWorld(world, setup.uvs, animated);
    const points = outline(meshes.filter((mesh) => !mesh.temporary));
    const reply: MeshReply = {
      id: data.id,
      meshes,
      outline: points,
      counts: world.counts(),
      bounds: world.bounds(),
      placement: animated,
    };
    const arrays = meshes.flatMap((m) => [m.positions, m.normals, m.uvs, m.colors, m.indices]);
    const timing = meshes.flatMap((m) => (m.placement ? [m.placement] : []));
    const order = animated ? [animated.starts, animated.cells, animated.blockIds] : [];
    self.postMessage(reply, { transfer: [...arrays, ...timing, ...order, points].map((a) => a.buffer) });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e) } satisfies MeshFailure);
  }
};
