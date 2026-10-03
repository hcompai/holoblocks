import type { CameraBounds } from "./buildCamera";

export function addCameraCell(rows: CameraBounds[], x: number, y: number, z: number) {
  const last = rows.at(-1);
  if (last && last[1] === y && last[2] === z && (last[3] === x || last[0] === x + 1)) {
    last[0] = Math.min(last[0], x);
    last[3] = Math.max(last[3], x + 1);
  } else rows.push([x, y, z, x + 1, y + 1, z + 1]);
}

/** Compact voxel rows into rectangles and stacks before testing lines of sight. */
export function mergeCameraSolids(rows: CameraBounds[]): CameraBounds[] {
  let boxes = rows.map((b) => [...b] as CameraBounds);
  for (const axis of [2, 1]) {
    const others = [0, 1, 2].filter((a) => a !== axis);
    boxes.sort((a, b) => {
      for (const index of others.flatMap((a) => [a, a + 3])) if (a[index] !== b[index]) return a[index] - b[index];
      return a[axis] - b[axis];
    });
    const merged: CameraBounds[] = [];
    for (const box of boxes) {
      const last = merged.at(-1);
      if (last && last[axis + 3] === box[axis] && others.every((a) => last[a] === box[a] && last[a + 3] === box[a + 3]))
        last[axis + 3] = box[axis + 3];
      else merged.push(box);
    }
    boxes = merged;
  }
  return boxes;
}
