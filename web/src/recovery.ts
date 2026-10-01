import { fileFromBlob, type HaiAgents } from "hai-agents";
import { begin, client, download, toolkit } from "./agent";
import { remember } from "./library";
import type { Build } from "./model";
import { script } from "./remix";
import { EMPTY_TRANSCRIPT, read, status } from "./session";

/** A build with blocks continues from them: its script rebuilds them exactly. */
export const canRestore = (build: Build) => build.boxes.length > 0;

/** Why no recovery started, in words for the user. */
export class RecoveryProblem extends Error {}

const pending = new Map<string, Promise<string>>();

const python = (code: string) => new Blob([code], { type: "text/x-python" });

/** `build`, Holo's last shared version: never the hand-edited one. */
async function prepare(build: Build): Promise<string> {
  // Also finds an accepted recovery after a reload or a lost creation response.
  const attempts = await client.sessions.listSessions({ groupId: build.id, size: 100 });
  if (attempts.items.length) {
    const existing = attempts.items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].id;
    remember(build.id, { recoveryAttempt: existing });
    remember(existing, { name: build.name, recoveredFrom: build.id });
    return existing;
  }
  remember(build.id, { recoveryAttempt: undefined });
  let transcript = EMPTY_TRANSCRIPT;
  let seed: string | null = null;
  for (;;) {
    const changes = await client.sessions.getSessionChanges({
      id: build.id,
      fromIndex: transcript.events,
      includeEvents: true,
    });
    if (changes && status(changes.status) === "building")
      throw new RecoveryProblem("This build is still running. Open it before trying again.");
    const events = changes?.newEvents ?? [];
    if (!events.length) break;
    for (const event of events) {
      if (event.type !== "AttachmentEvent") continue;
      const { origin, name, url } = (event as HaiAgents.SessionEventZero.AttachmentEvent).data;
      if (origin === "user" && name === "remix.py") seed = url;
    }
    transcript = read(transcript, events);
  }
  const requests = transcript.messages.filter((m) => m.role === "user");
  if (!requests.length) throw new RecoveryProblem("The original request is unavailable. Your build is unchanged.");
  const kit = await toolkit().catch(() => {
    throw new RecoveryProblem("The toolkit is unavailable. Try again later; your build is unchanged.");
  });
  const attached = [await fileFromBlob(kit, "blockyard.tgz")];
  if (canRestore(build)) attached.push(await fileFromBlob(python(script(build)), "remix.py"));
  else if (seed) {
    // A remix or a recovery can stop before sharing anything: it starts again from its own starting model.
    const start = await download(seed).catch(() => {
      throw new RecoveryProblem("The starting model could not be retrieved. Your build is unchanged.");
    });
    attached.push(await fileFromBlob(start, "remix.py"));
  }
  const messages: HaiAgents.UserMessageEvent[] = [];
  // Every photo is fetched before anything starts: a recovery never silently drops one.
  for (const [index, request] of requests.entries()) {
    const photos = await Promise.all(
      request.images.map((url) => (url.startsWith("data:") ? fetch(url).then((r) => r.blob()) : download(url))),
    ).catch(() => {
      throw new RecoveryProblem("A photo could not be retrieved. Try again later; your build is unchanged.");
    });
    const named = await Promise.all(
      photos.map((blob, i) =>
        fileFromBlob(blob, `photo-${index + 1}-${i + 1}.${blob.type === "image/png" ? "png" : "jpg"}`),
      ),
    );
    messages.push({
      type: "user_message",
      message: request.text,
      images: named.map((file, i) => `data:${photos[i].type || "image/jpeg"};base64,${file.source}`),
      files: [...(index === 0 ? attached : []), ...named],
    });
  }
  if (canRestore(build))
    messages.push({
      type: "user_message",
      message:
        "The session building the requests above stopped. files/remix.py rebuilds its last shared model exactly: after setup, copy it to build.py, run it, share the model and look at it, then continue the unfinished work. Keep the design; never start over.",
      images: [],
      files: [],
    });
  const id = await begin(messages, build.id);
  remember(build.id, { recoveryAttempt: id });
  remember(id, { name: build.name, prompt: requests[0].text, recoveredFrom: build.id });
  return id;
}

/** Start a new session continuing `build`, or open the one already started; the stopped session is never touched. */
export function recover(build: Build): Promise<string> {
  const existing = pending.get(build.id);
  if (existing) return existing;
  const attempt = navigator.locks
    ? navigator.locks.request(`blockyard-recovery-${build.id}`, () => prepare(build))
    : prepare(build);
  const next = attempt.finally(() => pending.delete(build.id));
  pending.set(build.id, next);
  return next;
}
