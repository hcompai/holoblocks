import { createHash } from "node:crypto";
import { PALETTE, type Shared, type Step } from "../../src/model";
import { Refusal } from "./http";

/** What one import may hold; the largest Holo builds are about 60,000 boxes. */
export const LIMITS = { boxes: 500_000, blocks: 5_000, steps: 2_000, side: 256, text: 20_000 };
const SCRIPT = 1_000_000;
const BLOCK = /^([a-z0-9_]+)(?:\[[a-z0-9_]+=[a-z0-9_]+(?:,[a-z0-9_]+=[a-z0-9_]+)*\])?$/;

const refuse = (why: string): never => {
  throw new Refusal(400, `This is not a HoloBlocks model: ${why}.`);
};

const whole = (value: unknown): value is number => Number.isSafeInteger(value);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

function side(value: unknown, name: string): number {
  if (!whole(value) || value < 1 || value > LIMITS.side)
    refuse(`its ${name} is not a whole number up to ${LIMITS.side}`);
  return value as number;
}

function blocks(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length) refuse("it has no blocks");
  const list = value as unknown[];
  if (list.length > LIMITS.blocks) refuse(`it uses more than ${LIMITS.blocks} different blocks`);
  return list.map((b, i) => {
    const name = typeof b === "string" ? b.match(BLOCK)?.[1] : undefined;
    if (!name || (name !== "air" && !(name in PALETTE))) refuse(`block ${i + 1} is not a known block`);
    return b as string;
  });
}

function boxes(value: unknown, size: [number, number, number], kinds: number): number[] {
  if (!Array.isArray(value) || !value.length || value.length % 8) refuse("its boxes are not packed eight numbers each");
  const packed = value as unknown[];
  if (packed.length / 8 > LIMITS.boxes) refuse(`it has more than ${LIMITS.boxes.toLocaleString("en")} boxes`);
  for (let i = 0; i < packed.length; i += 8) {
    const [x0, y0, z0, x1, y1, z1, block, step] = packed.slice(i, i + 8) as number[];
    const inside =
      [x0, y0, z0, x1, y1, z1].every(whole) &&
      [0, 1, 2].every((a) => {
        const [lo, hi] = [[x0, y0, z0][a], [x1, y1, z1][a]];
        return lo >= 0 && lo <= hi && hi < size[a];
      });
    if (!inside || !whole(block) || block < 0 || block >= kinds || !whole(step) || step < 0 || step >= LIMITS.steps)
      refuse(`box ${i / 8 + 1} is malformed or off the site`);
  }
  return packed as number[];
}

function steps(value: unknown, packed: number[]): Step[] {
  const given = Array.isArray(value) ? value.slice(0, LIMITS.steps) : [];
  let last = 0;
  for (let i = 7; i < packed.length; i += 8) last = Math.max(last, packed[i]);
  return Array.from({ length: last + 1 }, (_, index) => ({
    index,
    title: text(given[index]?.title, 120) || `Step ${index + 1}`,
    code: text(given[index]?.code, LIMITS.text),
  }));
}

/** A model file (a session's model.json.gz, or a showcase or published build), checked and made into a library build, without its chat. */
export function imported(input: unknown): Shared {
  const given = input as Record<string, unknown> | null;
  if (!given || typeof given !== "object") refuse("it is not a model");
  const size: [number, number, number] = [
    side(given!.width, "width"),
    side(given!.height, "height"),
    side(given!.depth, "depth"),
  ];
  const kinds = blocks(given!.blocks);
  const packed = boxes(given!.boxes, size, kinds.length);
  const shape = { width: size[0], height: size[1], depth: size[2], blocks: kinds, boxes: packed };
  return {
    name: text(given!.name, 120).trim() || "Imported build",
    ...shape,
    updated: Date.now() / 1000,
    revision: createHash("sha256").update(JSON.stringify(shape)).digest("hex"),
    steps: steps(given!.steps, packed),
    script: text(given!.script, SCRIPT),
    status: "done",
    messages: [],
  };
}
