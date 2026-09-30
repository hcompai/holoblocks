import { sessions, unavailable } from "./agent";
import { type Build, type BuildSummary, type Message, type Model, unpack } from "./model";
import { status } from "./session";

const GALLERY = "/gallery";
const STORE = "blockyard.library";

/** What the browser remembers of a session's model, since the platform keeps only its chat. */
interface Card {
  name: string;
  prompt: string;
  steps: number;
  thumbnail?: string;
}

const cards = (): Record<string, Card> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
};

const NEW_CARD: Card = { name: "Untitled build", prompt: "", steps: 0 };

export const card = (id: string): Card | undefined => cards()[id];

export function remember(id: string, card: Partial<Card>) {
  const all = cards();
  all[id] = { ...NEW_CARD, ...all[id], ...card };
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch (e) {
    console.error("Could not remember the build", e);
  }
}

interface ShowcaseSummary {
  id: string;
  name: string;
  prompt: string;
  revision: string;
  steps: number;
}

async function showcases(): Promise<BuildSummary[]> {
  const response = await fetch(`${GALLERY}/builds.json`);
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) return [];
  const summaries: ShowcaseSummary[] = await response.json();
  return summaries.map((s) => ({
    id: s.id,
    name: s.name,
    prompt: s.prompt,
    status: "done",
    created: 0,
    steps: s.steps,
    thumbnail: `${GALLERY}/thumbnails/${s.id}.png?v=${s.revision.slice(0, 8)}`,
    showcase: true,
  }));
}

export async function showcase(id: string): Promise<Build> {
  const response = await fetch(`${GALLERY}/builds/${encodeURIComponent(id)}.json`);
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error(`No showcase ${id}`);
  const shown: Model & { messages: Message[] } = await response.json();
  return { ...unpack(shown), id, status: "done", messages: shown.messages, open: false };
}

/** The user's builds, newest first, then the showcases. */
export async function library(): Promise<BuildSummary[]> {
  const [mine, shown] = await Promise.all([unavailable ? [] : sessions(), showcases()]);
  const known = cards();
  const builds = mine.map((s): BuildSummary => {
    const saved = known[s.id];
    const prompt = saved?.prompt || s.firstMessage?.message || "";
    return {
      id: s.id,
      name: saved?.name ?? (prompt.slice(0, 60) || NEW_CARD.name),
      prompt,
      status: status(s.status),
      created: s.createdAt.getTime() / 1000,
      steps: saved?.steps ?? null,
      thumbnail: saved?.thumbnail ?? null,
      showcase: false,
    };
  });
  return [...builds.sort((a, b) => b.created - a.created), ...shown];
}

const THUMBNAIL_SIDE = 320;

/** A render as a small WebP data URL, to keep beside the build. */
export async function thumbnail(png: Blob): Promise<string> {
  const bitmap = await createImageBitmap(png);
  const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.8);
}
