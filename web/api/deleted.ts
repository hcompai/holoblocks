import { holder } from "./lib/account";
import { deleteFork, findFork } from "./lib/forks";
import { body, Refusal, route } from "./lib/http";
import { forgetName } from "./lib/names";
import { findOwn, forget, forgotten, ID, unlist } from "./lib/store";

/** The ids of the caller's deleted builds, which their builds leave out. */
export const GET = route(async (request) =>
  Response.json(await forgotten(holder(request).user.id), { headers: { "Cache-Control": "private, no-store" } }),
);

/** Delete one of the caller's builds for good: `{ id }`, with its library entry, name, and a fork's files and session. */
export const POST = route(async (request) => {
  const { user } = holder(request);
  const { id } = await body<{ id?: unknown }>(request);
  if (typeof id !== "string" || !ID.test(id)) throw new Refusal(400, "No such build.");
  const published = await findOwn(user.id, id);
  const theirs = published?.owner === user.id;
  const isFork = id.startsWith("fork-");
  const fork = isFork ? await findFork(user.id, id) : null;
  if ((isFork || id.startsWith("import-")) && !theirs && !fork) throw new Refusal(404, "No such build of yours.");
  if (theirs) await unlist(id, user.id);
  if (fork?.sessionId) await forget(user.id, fork.sessionId);
  if (fork) await deleteFork(user.id, id);
  if (!isFork && !id.startsWith("import-")) await forget(user.id, id);
  await forgetName(user.id, id);
  return new Response(null, { status: 204 });
});
