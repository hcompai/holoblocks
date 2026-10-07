import type { Build } from "./model";
import { script } from "./remix";
import type { Cell } from "./voxelEdits";

/** A spatial reference for the request, not a restriction on which blocks Holo may change. */
export function selectedArea(model: Build, cells: { at: Cell; block: string }[]): Record<string, Blob> {
  if (!cells.length) throw new Error("Select an area first.");
  const axis = (i: number) => cells.map((c) => c.at[i]);
  const area = {
    revision: model.revision,
    guidance:
      "These blocks indicate the area the user means. Adjust nearby or related blocks as needed to fulfil the request coherently; this is not a strict edit boundary.",
    coordinates: "Cells [x, y, z]: x east, y up from the ground, z south toward the front; one block each.",
    box: [0, 1, 2].map((i) => Math.min(...axis(i))).concat([0, 1, 2].map((i) => Math.max(...axis(i)))),
    cells,
  };
  return {
    "selected-area.json": new Blob([JSON.stringify(area)], { type: "application/json" }),
    "selected-area-model.py": new Blob([script(model)], { type: "text/x-python" }),
  };
}
