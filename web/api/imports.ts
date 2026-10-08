import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { holder } from "./lib/account";
import { Refusal, route } from "./lib/http";
import { imported } from "./lib/imported";
import { authorName } from "./lib/profile";
import { enter, type Published, save } from "./lib/store";

/** Under Vercel's 4.5 MB request limit; a gzipped 60,000-box model is well below it. */
const MAX_UPLOAD = 4 * 1024 * 1024;
const MAX_UNPACKED = 64 * 1024 * 1024;
const THUMBNAIL = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/;
const MAX_THUMBNAIL = 512 * 1024;

function unpacked(upload: Buffer): unknown {
  try {
    return JSON.parse(gunzipSync(upload, { maxOutputLength: MAX_UNPACKED }).toString());
  } catch {
    throw new Refusal(400, "The file could not be read: send a gzipped HoloBlocks model.");
  }
}

function cover(value: unknown): { data: Buffer; type: string } | null {
  const match = typeof value === "string" ? value.match(THUMBNAIL) : null;
  if (!match) return null;
  const data = Buffer.from(match[2], "base64");
  return data.length > MAX_THUMBNAIL ? null : { data, type: `image/${match[1]}` };
}

/** Import a model file into the public library as the caller's build: `{ model, thumbnail }`, gzipped. It gets a new id. */
export const POST = route(async (request) => {
  const { user } = holder(request);
  const upload = Buffer.from(await request.arrayBuffer());
  if (upload.length > MAX_UPLOAD) throw new Refusal(413, "The file is too large to import.");
  const given = unpacked(upload) as { model?: unknown; thumbnail?: unknown } | null;
  const id = `import-${randomUUID()}`;
  const build = imported(given?.model);
  const at = Math.floor(Date.now() / 1000);
  const image = cover(given?.thumbnail);
  const written: string[] = [];
  const keep = async (name: string, data: Buffer, type: string) => {
    const url = await save(id, name, data, type);
    written.push(url);
    return url;
  };
  const published: Published = {
    id,
    name: build.name,
    prompt: "",
    steps: build.steps.length,
    author: await authorName(user),
    owner: user.id,
    published: at,
    thumbnail: image ? await keep(`thumbnail.${image.type.split("/")[1]}`, image.data, image.type) : null,
    build: await keep("build.json.gz", gzipSync(JSON.stringify(build)), "application/gzip"),
  };
  await enter(published, [], written);
  return Response.json(published, { status: 201 });
});
