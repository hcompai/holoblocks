// Runs one build step's JavaScript in a sandbox and prints the boxes it asked for.
// stdin: {"code": "...", "width": W, "depth": D, "height": H}   stdout: {"ops": [...], "log": [...], "error": null}
import vm from "node:vm";

const MAX_OPS = 20000;
const TIMEOUT_MS = 3000;

const input = JSON.parse(await readStdin());
const ops = [];
const log = [];

const push = (x0, y0, z0, x1, y1, z1, block) => {
  if (ops.length >= MAX_OPS) throw new Error(`more than ${MAX_OPS} fill/set calls in one step; use bigger fills`);
  for (const v of [x0, y0, z0, x1, y1, z1]) {
    if (!Number.isFinite(v)) throw new Error(`coordinates must be numbers, got ${[x0, y0, z0, x1, y1, z1].join(",")}`);
  }
  ops.push({
    x0: Math.min(x0, x1) | 0, y0: Math.min(y0, y1) | 0, z0: Math.min(z0, z1) | 0,
    x1: Math.max(x0, x1) | 0, y1: Math.max(y0, y1) | 0, z1: Math.max(z0, z1) | 0,
    block: String(block),
  });
};

const fill = (x0, y0, z0, x1, y1, z1, block, mode = "solid") => {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
  if (mode === "solid") return push(ax, ay, az, bx, by, bz, block);
  if (mode === "hollow" || mode === "walls") {
    push(ax, ay, az, ax, by, bz, block);
    push(bx, ay, az, bx, by, bz, block);
    push(ax, ay, az, bx, by, az, block);
    push(ax, ay, bz, bx, by, bz, block);
    if (mode === "hollow") {
      push(ax, ay, az, bx, ay, bz, block);
      push(ax, by, az, bx, by, bz, block);
    }
    return;
  }
  throw new Error(`unknown fill mode '${mode}'; use solid, hollow or walls`);
};

const sandbox = {
  fill,
  set: (x, y, z, block) => push(x, y, z, x, y, z, block),
  clear: (x0, y0, z0, x1, y1, z1) => fill(x0, y0, z0, x1, y1, z1, "air"),
  log: (...args) => log.push(args.map(String).join(" ")),
  Math,
  WIDTH: input.width,
  DEPTH: input.depth,
  HEIGHT: input.height,
};

let error = null;
try {
  vm.runInNewContext(input.code, sandbox, { timeout: TIMEOUT_MS, filename: "step.js" });
} catch (e) {
  error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (e && e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") error = `the step ran for more than ${TIMEOUT_MS} ms; shrink the loops`;
}
process.stdout.write(JSON.stringify({ ops, log, error }));

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}
