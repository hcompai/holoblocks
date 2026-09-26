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
  /** A render shown with a tool note, as a URL. */
  image?: string;
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
  | { type: "rewind"; steps: number }
  | { type: "thinking"; text: string; reset: boolean }
  | RenderRequest;

/** A builder asking an open viewer for its views of the model, or of the blocks inside `box` (x0 y0 z0 x1 y1 z1): the four views when `angle` is null, else one view from `angle` degrees around (0 front, 90 right) and `pitch` degrees up. */
export interface RenderRequest {
  type: "render";
  request: string;
  box: number[] | null;
  angle: number | null;
  pitch: number;
  zoom: number;
}

/** A static, read-only export of chosen builds (`vite build --mode gallery`), served without the Python server. */
export const GALLERY = import.meta.env.MODE === "gallery";

const LIVE_URLS = {
  builds: "/api/builds",
  build: (id: string) => `/api/builds/${id}`,
  palette: "/api/blocks",
  thumbnail: (id: string) => `/api/builds/${id}/thumbnail.png`,
  download: (id: string) => `/api/builds/${id}/download.schem`,
};

const GALLERY_URLS: typeof LIVE_URLS = {
  builds: "/gallery/builds.json",
  build: (id) => `/gallery/builds/${id}.json`,
  palette: "/gallery/blocks.json",
  thumbnail: (id) => `/gallery/thumbnails/${id}.png`,
  download: (id) => `/gallery/builds/${id}.schem`,
};

const urls = GALLERY ? GALLERY_URLS : LIVE_URLS;

async function json<T>(response: Promise<Response>): Promise<T> {
  const r = await response;
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

let sheet: Promise<TextureSheet> | null = null;

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  builds: () => json<BuildSummary[]>(fetch(urls.builds)),
  build: (id: string) => json<Build>(fetch(urls.build(id))),
  builders: () => (GALLERY ? Promise.resolve([]) : json<BuilderInfo[]>(fetch("/api/builders"))),
  palette: () => json<Palette>(fetch(urls.palette)),
  create: (prompt: string, builder: string) => json<BuildSummary>(post("/api/builds", { prompt, builder })),
  say: (id: string, text: string) => json<BuildSummary>(post(`/api/builds/${id}/messages`, { text })),
  stop: (id: string) => post(`/api/builds/${id}/stop`, {}),
  events: (id: string) => new EventSource(`/api/builds/${id}/events`),
  putRender: (id: string, request: string, png: Blob) =>
    fetch(`/api/builds/${id}/renders/${request}`, { method: "PUT", body: png }),
  putThumbnail: (id: string, png: Blob) => fetch(`/api/builds/${id}/thumbnail.png`, { method: "PUT", body: png }),
  thumbnailUrl: urls.thumbnail,
  downloadUrl: urls.download,
  textureSheet: () => (sheet ??= json<TextureSheet>(fetch("/textures/sheet.json"))),
  textureSheetUrl: "/textures/sheet.png",
};
