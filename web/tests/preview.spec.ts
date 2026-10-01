import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WELL = {
  id: "well",
  name: `Ada's <well> & "bucket"`,
  prompt: "A private prompt",
  steps: 12,
  author: "Ada Lovelace",
  owner: "u-ada",
  published: 1,
  thumbnail: "https://blob.test/builds/well/thumbnail-x.webp",
  build: "https://blob.test/builds/well/build.json-x.gz",
};
const SHOWCASE = { id: "bag-end", name: "Bag End", prompt: "A private prompt", revision: "0a1b2c3d4e5f", steps: 9 };

/** Vercel Blob's API listing the public library entry of WELL, and the site's gallery holding SHOWCASE. */
async function host() {
  const server = createServer((request, response) => {
    const url = new URL(request.url!, origin);
    const json = (body: object, status = 200) => response.writeHead(status).end(JSON.stringify(body));
    const prefix = url.searchParams.get("prefix");
    if (prefix === "library/broken/") return json({ error: { code: "unknown_error" } }, 500);
    if (prefix === `library/${WELL.id}/`) {
      const pathname = `library/${WELL.id}/1790000000000.json`;
      const blob = { url: `${origin}/${pathname}`, downloadUrl: `${origin}/${pathname}`, pathname, size: 1 };
      return json({ blobs: [{ ...blob, uploadedAt: new Date().toISOString() }], hasMore: false });
    }
    if (prefix !== null) return json({ blobs: [], hasMore: false });
    if (url.pathname === `/library/${WELL.id}/1790000000000.json`) return json(WELL);
    json({}, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_secret",
    VERCEL_BLOB_API_URL: origin,
    VERCEL_BLOB_RETRIES: "0",
  });
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    String(input).endsWith("/gallery/builds.json") ? Response.json([SHOWCASE]) : real(input, init);
  return {
    origin,
    close: () => {
      globalThis.fetch = real;
      server.close();
    },
  };
}

const meta = (html: string, key: string) =>
  html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];

test("a link to a public build or a showcase previews its name, steps, author and cover; any other gets the app as is", async () => {
  // The webServer's build writes dist/index.html, which the function bundles.
  const out = mkdtempSync(join(tmpdir(), "blockyard-api-"));
  execFileSync("node", ["scripts/build-api.mjs", out]);
  const { GET } = await import(pathToFileURL(join(out, "functions/api/preview.func/index.mjs")).href);
  const index = readFileSync("dist/index.html", "utf8");
  const { origin, close } = await host();
  const page = async (search: string) => {
    const response: Response = await GET(new Request(`${origin}/${search}`));
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    return response.text();
  };
  try {
    const well = await page("?public=well");
    expect(meta(well, "og:title")).toBe("Ada&#39;s &#60;well&#62; &#38; &#34;bucket&#34; · HoloBlocks");
    expect(meta(well, "og:description")).toBe("Built in 12 steps, shared by Ada Lovelace");
    expect(meta(well, "og:url")).toMatch(/^https:\/\/[^/?]+\/\?public=well$/);
    expect(meta(well, "og:image")).toBe(WELL.thumbnail);
    expect(well).not.toContain("<well>");
    expect(well).not.toContain(WELL.prompt);
    expect(well.replace(/<meta property="og:[^>]*>\s*/g, "")).toBe(index.replace(/<meta property="og:[^>]*>\s*/g, ""));

    const bagEnd = await page("?showcase=bag-end");
    expect(meta(bagEnd, "og:title")).toBe("Bag End · HoloBlocks");
    expect(meta(bagEnd, "og:description")).toBe("Built in 9 steps, from the HoloBlocks gallery");
    expect(meta(bagEnd, "og:image")).toMatch(/^https:\/\/[^/?]+\/gallery\/thumbnails\/bag-end\.png\?v=0a1b2c3d$/);
    expect(bagEnd).not.toContain(SHOWCASE.prompt);

    for (const search of ["?public=gone", "?public=broken", "?public=../well", "?showcase=gone", "?build=well"])
      expect(await page(search), search).toBe(index);
  } finally {
    close();
  }
});
