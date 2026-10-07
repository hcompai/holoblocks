import { holder } from "./lib/account";
import { findFork } from "./lib/forks";
import { body, Refusal, route } from "./lib/http";
import { projectNames, saveProjectName } from "./lib/names";
import { ownedSession } from "./lib/snapshot";
import { findOwn, ID, rename } from "./lib/store";

const OWN = { "Cache-Control": "private, no-store" };

/** The names the caller gave their builds. */
export const GET = route(async (request) =>
  Response.json(await projectNames(holder(request).user.id), { headers: OWN }),
);

/** Rename one of the caller's builds, a session, fork or import, and its library entry: `{ id, name }`. */
export const PATCH = route(async (request) => {
  const { user, key } = holder(request);
  const given = await body<{ id?: unknown; name?: unknown }>(request);
  if (typeof given.id !== "string" || !ID.test(given.id)) throw new Refusal(400, "No such build.");
  const id = given.id;
  const name = typeof given.name === "string" ? given.name.trim() : "";
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
    throw new Refusal(400, "Use a name of 1 to 80 characters.");
  if (id.startsWith("fork-")) {
    if (!(await findFork(user.id, id))) throw new Refusal(404, "No such build of yours.");
  } else if (id.startsWith("import-")) {
    if ((await findOwn(user.id, id))?.owner !== user.id) throw new Refusal(404, "No such build of yours.");
  } else
    await ownedSession(id, key).catch((e) => {
      throw e instanceof Refusal && e.status === 403 ? new Refusal(403, "Only its owner can rename it.") : e;
    });
  const named = await saveProjectName(user.id, id, name);
  await rename(user.id, id, name);
  return Response.json(named, { headers: OWN });
});
