import type { Box } from "./model";

interface Site {
  width: number;
  height: number;
  depth: number;
  boxes: Box[];
}

class Writer {
  private chunks: Uint8Array[] = [];

  bytes(data: Uint8Array | number[]) {
    this.chunks.push(data instanceof Uint8Array ? data : Uint8Array.from(data));
  }

  number(kind: "short" | "int", value: number) {
    const view = new DataView(new ArrayBuffer(kind === "short" ? 2 : 4));
    if (kind === "short") view.setInt16(0, value);
    else view.setInt32(0, value);
    this.bytes(new Uint8Array(view.buffer));
  }

  string(text: string) {
    const data = new TextEncoder().encode(text);
    this.number("short", data.length);
    this.bytes(data);
  }

  tag(kind: number, name: string) {
    this.bytes([kind]);
    this.string(name);
  }

  done(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

const INT = 3;
const BYTE_ARRAY = 7;
const COMPOUND = 10;
const INT_ARRAY = 11;
const SHORT = 2;

/** The blocks as a Sponge schematic v2 (gzip NBT), the format WorldEdit and FAWE paste. */
export async function schematic({ width, height, depth, boxes }: Site): Promise<Blob> {
  const palette = ["air"];
  const index = new Map([["air", 0]]);
  const cells = new Uint16Array(width * height * depth);
  const at = (x: number, y: number, z: number) => (y * depth + z) * width + x;
  for (const b of boxes) {
    const [x0, x1] = [Math.max(b.x0, 0), Math.min(b.x1, width - 1)];
    const [y0, y1] = [Math.max(b.y0, 0), Math.min(b.y1, height - 1)];
    const [z0, z1] = [Math.max(b.z0, 0), Math.min(b.z1, depth - 1)];
    if (x0 > x1 || y0 > y1 || z0 > z1) continue;
    let id = index.get(b.block);
    if (id === undefined) index.set(b.block, (id = palette.push(b.block) - 1));
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) cells.fill(id, at(x0, y, z), at(x1, y, z) + 1);
  }
  const lo = [width, height, depth];
  const hi = [-1, -1, -1];
  for (let y = 0; y < height; y++)
    for (let z = 0; z < depth; z++)
      for (let x = 0; x < width; x++) {
        if (!cells[at(x, y, z)]) continue;
        lo[0] = Math.min(lo[0], x);
        lo[1] = Math.min(lo[1], y);
        lo[2] = Math.min(lo[2], z);
        hi[0] = Math.max(hi[0], x);
        hi[1] = Math.max(hi[1], y);
        hi[2] = Math.max(hi[2], z);
      }
  const [x0, y0, z0] = hi[0] < 0 ? [0, 0, 0] : lo;
  const [x1, y1, z1] = hi[0] < 0 ? [0, 0, 0] : hi;
  const data: number[] = [];
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        let n = cells[at(x, y, z)];
        while (n > 0x7f) {
          data.push((n & 0x7f) | 0x80);
          n >>>= 7;
        }
        data.push(n);
      }

  const w = new Writer();
  w.tag(COMPOUND, "Schematic");
  w.tag(INT, "Version");
  w.number("int", 2);
  w.tag(INT, "DataVersion");
  w.number("int", 3700);
  w.tag(SHORT, "Width");
  w.number("short", x1 - x0 + 1);
  w.tag(SHORT, "Height");
  w.number("short", y1 - y0 + 1);
  w.tag(SHORT, "Length");
  w.number("short", z1 - z0 + 1);
  w.tag(INT_ARRAY, "Offset");
  w.number("int", 3);
  for (const v of [x0, y0, z0]) w.number("int", v);
  w.tag(INT, "PaletteMax");
  w.number("int", palette.length);
  w.tag(COMPOUND, "Palette");
  palette.forEach((name, i) => {
    w.tag(INT, `minecraft:${name}`);
    w.number("int", i);
  });
  w.bytes([0]);
  w.tag(BYTE_ARRAY, "BlockData");
  w.number("int", data.length);
  w.bytes(data);
  w.bytes([0]);
  return new Response(new Blob([w.done()]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
}
