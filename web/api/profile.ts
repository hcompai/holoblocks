import { holder } from "./lib/account";
import { body, route } from "./lib/http";
import { authorName, setAuthorName } from "./lib/profile";

const OWN = { "Cache-Control": "private, no-store" };

/** The name on the caller's public builds. */
export const GET = route(async (request) =>
  Response.json({ name: await authorName(holder(request).user) }, { headers: OWN }),
);

/** Set the name on the caller's public builds, old ones too: `{ name }`, "" for the default. */
export const PUT = route(async (request) => {
  const { user } = holder(request);
  const given = await body<{ name?: unknown }>(request);
  return Response.json({ name: await setAuthorName(user, given.name) }, { headers: OWN });
});
