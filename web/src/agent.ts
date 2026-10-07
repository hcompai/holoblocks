import { assertRequestUnderLimit, fileFromBlob, HaiAgentsClient, type HaiAgents } from "hai-agents";
import prompt from "../../agent/holo.md?raw";
import { expired, key } from "./account";
import { H } from "./hosts";
import { platformAsset, externalImage, assetBlob } from "./assetUrl";
import type { Build } from "./model";
import { script } from "./remix";
import { AGENT } from "./session";
import { HOLO } from "./holo";

const MAX_STEPS = 300;
const MAX_TIME_S = 3 * 3600;
/** How long a finished build keeps its Workstation for a follow-up message. */
const IDLE_TIMEOUT_S = 600;
const TOOLKIT = "/blockyard.tgz";
const DOWNLOAD_S = 60;

/** A call to the Agents API; a refused key signs the user out. */
async function call(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) expired();
  return response;
}

export const client = new HaiAgentsClient({
  environment: H.agents,
  apiKey: key,
  headers: { "X-HCompany-Client-Name": AGENT },
  // Safari sends the SDK's User-Agent in CORS preflights, and the Agents API does not allow it.
  fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("User-Agent");
    return call(input, { ...init, headers });
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
    .replace("{{max_steps}}", String(MAX_STEPS))
    .replaceAll("{{max_minutes}}", String(MAX_TIME_S / 60));
  return {
    name: AGENT,
    description: "Designs Minecraft structures in code, step by step, in HoloBlocks.",
    model: HOLO.id,
    reasoningEffort: "xhigh",
    instructions,
    environments: [{ kind: "workstation", id: AGENT }],
    tools: [LOOK],
  };
}

/** A message with the `attached` files, then its photos, named apart so later photos never overwrite earlier ones. */
async function message(
  text: string,
  photos: string[],
  attached: Record<string, Blob>,
): Promise<HaiAgents.UserMessageEvent & { type: "user_message" }> {
  const sent = Date.now().toString(36);
  const blobs = await Promise.all(photos.map((src) => fetch(src).then((r) => r.blob())));
  const files = await Promise.all([
    ...Object.entries(attached).map(([name, blob]) => fileFromBlob(blob, name)),
    ...blobs.map((blob, i) =>
      fileFromBlob(blob, `photo-${sent}-${i + 1}.${blob.type === "image/png" ? "png" : "jpg"}`),
    ),
  ]);
  return { type: "user_message", message: text, images: photos, files };
}

export async function toolkit(): Promise<Blob> {
  const response = await fetch(TOOLKIT);
  if (!response.ok) throw new Error("The HoloBlocks toolkit is missing from this site.");
  return response.blob();
}

/** Start a session with all its first messages in one request, so it never sits empty and any browser lists it by its prompt; `group` ties a recovery to its build. */
export async function begin(messages: HaiAgents.UserMessageEvent[], group?: string): Promise<string> {
  const request = {
    agent: agent(),
    messages,
    maxSteps: MAX_STEPS,
    maxTimeS: MAX_TIME_S,
    idleTimeoutS: IDLE_TIMEOUT_S,
    deleteAfterMin: null,
    ...(group && { groupId: group }),
  };
  assertRequestUnderLimit(request);
  // Creating a run is a side effect: never retry an ambiguous response automatically.
  return (await client.sessions.createSession({ body: request }, { maxRetries: 0 })).id;
}

/** Start a build: its message carries the toolkit, `attached` and the photos. */
export const create = async (text: string, photos: string[], attached: Record<string, Blob> = {}) =>
  begin([await message(text, photos, { "blockyard.tgz": await toolkit(), ...attached })]);

/** Start a build from an exact copy of `build`, which Holo then changes as `text` asks. */
export const remix = (build: Build, text: string, photos: string[], attached: Record<string, Blob> = {}) =>
  create(text, photos, { ...attached, "remix.py": new Blob([script(build)], { type: "text/x-python" }) });

export async function say(id: string, text: string, photos: string[], attached: Record<string, Blob> = {}) {
  await client.session(id).sendMessage(await message(text, photos, attached));
}

/** Holo ends its current step and answers; the session stays open for the next message. */
export const stop = (id: string) => client.session(id).forceAnswer();

/** Holo stops for good, without answering. */
export const cancel = (id: string) => client.sessions.cancelSession({ id });

export async function sessions(): Promise<HaiAgents.SessionSummary[]> {
  // hai-agents 1.0.13 sends the `agent` list as a JSON string, which matches no session.
  const page = await client.sessions.listSessions({ size: 100 }, { queryParams: { agent: AGENT } });
  return page.items;
}

/** Platform attachments use the API key; external HTTPS references are fetched anonymously. */
export async function download(url: string, signal?: AbortSignal): Promise<Blob> {
  const authenticated = platformAsset(url);
  if (!authenticated && !externalImage(url)) throw new Error("Unsupported download URL");
  const timeout = AbortSignal.timeout(DOWNLOAD_S * 1000);
  const response = await (authenticated ? call : fetch)(url, {
    headers: authenticated ? { Authorization: `Bearer ${key()}` } : undefined,
    credentials: "omit",
    redirect: authenticated ? "follow" : "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status})`);
  return assetBlob(response);
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
