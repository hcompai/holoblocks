import type { Build } from "./model";

/** A build script rebuilding `build` exactly: its own script when it has one, else one call per box, one `step` per step. */
export function script(build: Build): string {
  if (build.script) return build.script;
  const lines: string[] = [];
  for (const step of build.steps) {
    lines.push(`step(${JSON.stringify(step.title)})`);
    for (const { x0, y0, z0, x1, y1, z1, block } of build.boxes.filter((b) => b.step === step.index)) {
      const corners = `${x0}, ${y0}, ${z0}, ${x1}, ${y1}, ${z1}`;
      lines.push(block === "air" ? `clear(${corners})` : `fill(${corners}, ${JSON.stringify(block)})`);
    }
  }
  return lines.join("\n") + "\n";
}
