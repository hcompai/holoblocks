export interface BuilderInfo {
  name: string;
  label: string;
  /** Replays a scripted build and ignores the prompt. */
  showcase: boolean;
}

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

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  images: string[];
  at: number;
}

export type Status = "idle" | "building" | "done" | "error";

export interface BuildSummary {
  id: string;
  name: string;
  prompt: string;
  builder: string;
  status: Status;
  created: number;
  boxes: number;
  steps: number;
  width: number;
  depth: number;
  height: number;
  thumbnail?: boolean;
}

export interface Build extends Omit<BuildSummary, "boxes" | "steps" | "thumbnail"> {
  boxes: Box[];
  steps: Step[];
  messages: Message[];
}

/** A texture reference from the palette: a name, [name, tint], or [base, overlay, tint]. */
export type Tex = string | [string, string] | [string, string, string];

export interface BlockInfo {
  tex: Tex | { top?: Tex; bottom?: Tex; side?: Tex };
  shape?: "cube" | "stairs" | "slab" | "log" | "fence" | "wall" | "pane" | "cross" | "torch" | "lantern" | "carpet" | "door" | "trapdoor" | "rod";
  tags?: string;
  transparent?: boolean;
  cutout?: boolean;
  liquid?: boolean;
}

export type Palette = Record<string, BlockInfo>;

/** Every texture's first frame packed row by row into one image. */
export interface TextureSheet {
  tile: number;
  columns: number;
  names: string[];
}

export type BuildEvent =
  | { type: "hello"; build: BuildSummary }
  | { type: "build"; build: BuildSummary }
  | { type: "message"; message: Message }
  | { type: "step"; step: Step; boxes: Box[] }
  | { type: "undo"; index: number; title: string }
  | { type: "thinking"; text: string; reset: boolean }
  | { type: "render"; request: string };

async function json<T>(response: Promise<Response>): Promise<T> {
  const r = await response;
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

let sheet: Promise<TextureSheet> | null = null;

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  builds: () => json<BuildSummary[]>(fetch("/api/builds")),
  build: (id: string) => json<Build>(fetch(`/api/builds/${id}`)),
  builders: () => json<BuilderInfo[]>(fetch("/api/builders")),
  palette: () => json<Palette>(fetch("/api/blocks")),
  create: (prompt: string, builder: string) => json<BuildSummary>(post("/api/builds", { prompt, builder })),
  say: (id: string, text: string) => json<BuildSummary>(post(`/api/builds/${id}/messages`, { text })),
  stop: (id: string) => post(`/api/builds/${id}/stop`, {}),
  events: (id: string) => new EventSource(`/api/builds/${id}/events`),
  putRender: (id: string, request: string, png: Blob) =>
    fetch(`/api/builds/${id}/renders/${request}`, { method: "PUT", body: png }),
  putThumbnail: (id: string, png: Blob) => fetch(`/api/builds/${id}/thumbnail.png`, { method: "PUT", body: png }),
  thumbnailUrl: (id: string) => `/api/builds/${id}/thumbnail.png`,
  downloadUrl: (id: string) => `/api/builds/${id}/download.schem`,
  textureSheet: () => (sheet ??= json<TextureSheet>(fetch("/textures/sheet.json"))),
  textureSheetUrl: "/textures/sheet.png",
};
