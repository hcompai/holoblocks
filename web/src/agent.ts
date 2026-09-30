import { fileFromBlob, HaiAgentsClient, HaiAgentsEnvironment, type HaiAgents } from "hai-agents";
import prompt from "../../agent/holo.md?raw";

export const AGENT = "blockyard";
const MODEL = "holo4-27b";
const MAX_STEPS = 300;
const MAX_TIME_S = 3 * 3600;
/** How long a finished build keeps its Workstation for a follow-up message. */
const IDLE_TIMEOUT_S = 3600;
const TOOLKIT = "/blockyard.tgz";
const DOWNLOAD_S = 60;

const API_KEY: string | undefined = import.meta.env.VITE_HAI_API_KEY;

/** Why builds cannot run from this page, or null when they can. */
export const unavailable = API_KEY ? null : "Set VITE_HAI_API_KEY to build with Holo.";

export const client = new HaiAgentsClient({
  environment: HaiAgentsEnvironment.Eu,
  apiKey: API_KEY ?? "",
  headers: { "X-HCompany-Client-Name": AGENT },
  // Safari sends the SDK's User-Agent in CORS preflights, and the Agents API does not allow it.
  fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("User-Agent");
    return fetch(input, { ...init, headers });
  },
});

const LOOK: HaiAgents.ToolDefinition = {
  name: "look",
  description:
    "Render the model you last shared, in the user's viewer, and return its revision, its block count and the image. " +
    "No arguments: the four views, 3/4 front-right, 3/4 back-left, front, and top (back at the top). " +
    "`angle` or `eye` gives one large view instead, `box` keeps only the blocks inside it.",
  inputSchema: {
    type: "object",
    properties: {
      angle: {
        type: "number",
        description: "Degrees around the model: 0 front, 90 right, 180 back, 270 left.",
      },
      pitch: {
        type: "number",
        minimum: -90,
        maximum: 90,
        description:
          "Degrees above the horizon, default 30, 0 eye level, 90 straight down; with `eye`, the tilt down (negative: up), default 0.",
      },
      zoom: { type: "number", minimum: 1, maximum: 8, description: "Magnification, default 1." },
      box: {
        type: "array",
        items: { type: "integer" },
        minItems: 6,
        maxItems: 6,
        description: "[x0, y0, z0, x1, y1, z1], all included: only the blocks inside it.",
      },
      eye: {
        type: "array",
        items: { type: "number" },
        minItems: 3,
        maxItems: 3,
        description: "[x, y, z], a wide camera at a visitor's eye, turned to the middle of the box or the model.",
      },
    },
    additionalProperties: false,
  },
};

function agent(): HaiAgents.Agent {
  const instructions = prompt
    .replace("{{date}}", new Date().toISOString().slice(0, 10))
    .replace("{{max_steps}}", String(MAX_STEPS));
  return {
    name: AGENT,
    description: "Designs Minecraft structures in code, step by step, in Blockyard.",
    model: MODEL,
    instructions,
    environments: [{ kind: "workstation", id: AGENT }],
    tools: [LOOK],
  };
}

async function message(
  text: string,
  photos: string[],
  toolkit: boolean,
): Promise<HaiAgents.UserMessageEvent & { type: "user_message" }> {
  const sent = Date.now().toString(36);
  const blobs = await Promise.all(photos.map((src) => fetch(src).then((r) => r.blob())));
  const files = await Promise.all(
    blobs.map((blob, i) => fileFromBlob(blob, `photo-${sent}-${i + 1}.${blob.type === "image/png" ? "png" : "jpg"}`)),
  );
  if (toolkit) {
    const response = await fetch(TOOLKIT);
    if (!response.ok) throw new Error("The Blockyard toolkit is missing from this site.");
    files.unshift(await fileFromBlob(await response.blob(), "blockyard.tgz"));
  }
  return { type: "user_message", message: text, images: photos, files };
}

/** Start a build; the session starts empty, then takes the first message with the toolkit and the photos. */
export async function create(text: string, photos: string[]): Promise<string> {
  const first = await message(text, photos, true);
  const session = await client.startSession({
    agent: agent(),
    maxSteps: MAX_STEPS,
    maxTimeS: MAX_TIME_S,
    idleTimeoutS: IDLE_TIMEOUT_S,
  });
  await session.sendMessage(first);
  return session.id;
}

export async function say(id: string, text: string, photos: string[]) {
  await client.session(id).sendMessage(await message(text, photos, false));
}

/** Holo ends its current step and answers; the session stays open for the next message. */
export const stop = (id: string) => client.session(id).forceAnswer();

export async function sessions(): Promise<HaiAgents.SessionSummary[]> {
  // hai-agents 1.0.13 sends the `agent` list as a JSON string, which matches no session.
  const page = await client.sessions.listSessions({ size: 100 }, { queryParams: { agent: AGENT } });
  return page.items;
}

/** An attachment or image the platform serves behind the API key. */
export async function download(url: string, signal?: AbortSignal): Promise<Blob> {
  const timeout = AbortSignal.timeout(DOWNLOAD_S * 1000);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status})`);
  return response.blob();
}

export async function answer(id: string, call: HaiAgents.ToolRequest, result: unknown) {
  await client.sessions.sendSessionToolResults({ id, body: { kind: "tool_result", toolReq: call, result } });
}

export async function fail(id: string, call: HaiAgents.ToolRequest, error: string) {
  await client.sessions.sendSessionToolResults({
    id,
    body: { kind: "error_event", error, origin: "client", toolReq: call },
  });
}
