import blocks from "../../server/blockyard/blocks.json";

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  block: string;
  step: number;
}

export interface Step {
  index: number;
  title: string;
  code: string;
}

/** What the builder reasoned and did before a message, step by step. */
export interface Work {
  /** In ms since the epoch. */
  start: number;
  end: number;
  steps: { reasoning: string; actions: string[] }[];
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  /** URLs: the images a user attached, or the render shown with a look. */
  images: string[];
  work?: Work;
}

export type Status = "building" | "done" | "error";

/** What `blocks run` writes to model.json.gz, its boxes packed eight numbers each: x0 y0 z0 x1 y1 z1 block step. */
export interface Model {
  name: string;
  width: number;
  depth: number;
  height: number;
  /** When the blocks last changed, in seconds; 0 when unknown. */
  updated: number;
  revision: string;
  steps: Step[];
  blocks: string[];
  boxes: number[];
  /** The build script that rebuilds these boxes exactly; empty when none does, as after hand edits. */
  script?: string;
}

export const EMPTY_MODEL: Model = {
  name: "Untitled build",
  width: 128,
  depth: 128,
  height: 100,
  updated: 0,
  revision: "",
  steps: [],
  blocks: [],
  boxes: [],
};

/** A finished build as the library keeps it: a showcase in the gallery, or a build published to the library. */
export interface Shared extends Model {
  status: Status;
  messages: Message[];
}

export interface Build extends Omit<Model, "blocks" | "boxes"> {
  id: string;
  boxes: Box[];
  status: Status;
  messages: Message[];
  /** The builder waits for the next message. */
  open: boolean;
}

/** Where a build is read from: a session of the signed-in user, the public library, or the showcases. */
export type Source = "session" | "public" | "showcase";

export interface BuildSummary {
  id: string;
  name: string;
  prompt: string;
  status: Status;
  /** In seconds. */
  created: number;
  steps: number | null;
  thumbnail: string | null;
  source: Source;
  /** Who published it, for public builds. */
  author: string | null;
  /** The author's user id, for public builds. */
  owner: string | null;
  /** Listed to its owner only: a library build they made private. */
  private?: boolean;
}

export function unpack(model: Model): Omit<Build, "id" | "status" | "messages" | "open"> {
  const { blocks, boxes, ...rest } = model;
  return { ...rest, boxes: unpackBoxes({ blocks, boxes }) };
}

export function unpackBoxes({ blocks: names, boxes: packed }: Pick<Model, "blocks" | "boxes">): Box[] {
  const boxes: Box[] = [];
  for (let i = 0; i < packed.length; i += 8) {
    const [x0, y0, z0, x1, y1, z1, block, step] = packed.slice(i, i + 8);
    boxes.push({ x0, y0, z0, x1, y1, z1, block: names[block], step });
  }
  return boxes;
}

/** Boxes packed as in model.json.gz. */
export function pack(boxes: Box[]): Pick<Model, "blocks" | "boxes"> {
  const index = new Map<string, number>();
  const packed: number[] = [];
  for (const b of boxes) {
    let i = index.get(b.block);
    if (i === undefined) index.set(b.block, (i = index.size));
    packed.push(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, i, b.step);
  }
  return { blocks: [...index.keys()], boxes: packed };
}

/** A builder asking the viewer for its views of a revision, or of the blocks inside `box` (x0 y0 z0 x1 y1 z1): one view from a camera at `eye` (x y z) looking at the middle when set, else the four views when `angle` is null, else one view from `angle` degrees around (0 front, 90 right) and `pitch` degrees up. */
export interface RenderRequest {
  request: string;
  revision: string;
  box: number[] | null;
  angle: number | null;
  pitch: number;
  zoom: number;
  eye: number[] | null;
}

/** A texture reference from the palette: a name, [name, tint], or [base, overlay, tint]. */
export type Tex = string | [string, string] | [string, string, string];

export const texKey = (tex: Tex): string => (typeof tex === "string" ? tex : tex.join("|"));

export interface BlockInfo {
  tex: Tex | { top?: Tex; bottom?: Tex; side?: Tex };
  shape?:
    | "cube"
    | "stairs"
    | "slab"
    | "log"
    | "fence"
    | "wall"
    | "pane"
    | "cross"
    | "torch"
    | "lantern"
    | "carpet"
    | "door"
    | "trapdoor"
    | "rod"
    | "tall_cross"
    | "face"
    | "ladder";
  tags?: string;
  transparent?: boolean;
  cutout?: boolean;
  liquid?: boolean;
}

export type Palette = Record<string, BlockInfo>;

export const PALETTE = blocks as unknown as Palette;

/** Every texture's first frame packed row by row into one image. */
export interface TextureSheet {
  tile: number;
  columns: number;
  names: string[];
}

let sheet: Promise<TextureSheet> | null = null;

export const TEXTURE_SHEET_URL = "/textures/sheet.png";

export const textureSheet = () =>
  (sheet ??= fetch("/textures/sheet.json").then((r) => {
    if (!r.ok) throw new Error(`Could not load the texture sheet (HTTP ${r.status})`);
    return r.json() as Promise<TextureSheet>;
  }));
