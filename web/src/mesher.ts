import type { Palette } from "./api";
import type { UV } from "./atlas";
import { type MeshData, meshWorld, outline, type PackedBoxes, VoxelWorld } from "./voxels";

export interface MesherSetup {
  palette: Palette;
  uvs: Map<string, UV>;
}

export interface MeshRequest extends PackedBoxes {
  id: number;
  width: number;
  height: number;
  depth: number;
}

export interface MeshReply {
  id: number;
  meshes: MeshData[];
  /** Vertices that bound every view of the meshes. */
  outline: Float32Array<ArrayBuffer>;
  counts: Map<string, number>;
  bounds: number[] | null;
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
    const meshes = meshWorld(world, setup.uvs);
    const points = outline(meshes);
    const reply: MeshReply = { id: data.id, meshes, outline: points, counts: world.counts(), bounds: world.bounds() };
    const arrays = meshes.flatMap((m) => [m.positions, m.normals, m.uvs, m.colors, m.indices]);
    self.postMessage(reply, { transfer: [...arrays, points].map((a) => a.buffer) });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e) } satisfies MeshFailure);
  }
};
