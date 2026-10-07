import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";

const PRIVATE_TOKEN = "vercel_blob_rw_testprivate_testsecret";

/**
 * An isolated local transport for the real Blob SDK, with a public and a private store: objects in memory, no
 * production credentials or writes. Call `start()` in beforeAll and `stop()` in afterAll.
 */
export function blobStore() {
  const objects = new Map<string, Buffer>();
  const privateObjects = new Map<string, Buffer>();
  const types = new Map<string, string>();
  const privateOrigin = "https://testprivate.private.blob.vercel-storage.com";
  const dispatcher = getGlobalDispatcher();
  const mock = new MockAgent();
  mock.enableNetConnect(/127\.0\.0\.1/);
  mock
    .get(privateOrigin)
    .intercept({ path: /./, method: "GET" })
    .reply((opts) => {
      const auth = new Headers(opts.headers as Record<string, string>).get("authorization");
      const path = String(opts.path).split("?")[0].slice(1);
      const data = auth === `Bearer ${PRIVATE_TOKEN}` ? privateObjects.get(path) : undefined;
      return {
        statusCode: data ? 200 : 404,
        data: data ?? "",
        responseOptions: { headers: { "content-type": types.get(path) ?? "application/json" } },
      };
    })
    .persist();
  let base = "";
  const metadata = (pathname: string, isPrivate = false) => ({
    pathname,
    url: isPrivate ? `${privateOrigin}/${pathname}` : `${base}/objects/${pathname}`,
    downloadUrl: isPrivate ? `${privateOrigin}/${pathname}` : `${base}/objects/${pathname}`,
    size: (isPrivate ? privateObjects : objects).get(pathname)?.length ?? 0,
    uploadedAt: new Date().toISOString(),
    contentType: types.get(pathname) ?? "application/octet-stream",
    etag: "etag",
  });
  const pathOf = (url: string) => url.replace(`${base}/objects/`, "").replace(`${privateOrigin}/`, "").split("?")[0];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, base);
    const isPrivate = request.headers.authorization === `Bearer ${PRIVATE_TOKEN}`;
    const store = isPrivate ? privateObjects : objects;
    const send = (data: unknown, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(data));
    };
    const read = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    };
    if (url.pathname.startsWith("/objects/")) {
      const data = objects.get(url.pathname.slice(9));
      response.writeHead(data ? 200 : 404, {
        "Content-Type": types.get(url.pathname.slice(9)) ?? "application/octet-stream",
      });
      response.end(data);
    } else if (request.method === "PUT") {
      const given = url.searchParams.get("pathname")!;
      const pathname =
        request.headers["x-add-random-suffix"] === "1"
          ? given.replace(/(\.[^./]+)?$/, (ext) => `-${randomBytes(4).toString("hex")}${ext}`)
          : given;
      const body = await read();
      if (request.headers["x-allow-overwrite"] === "0" && store.has(pathname))
        return send({ error: { code: "bad_request", message: "Blob already exists" } }, 400);
      store.set(pathname, body);
      types.set(
        pathname,
        String(request.headers["x-content-type"] ?? request.headers["content-type"] ?? "application/octet-stream"),
      );
      send(metadata(pathname, isPrivate));
    } else if (request.method === "POST" && url.pathname.endsWith("/delete")) {
      for (const u of JSON.parse((await read()).toString()).urls as string[]) store.delete(pathOf(u));
      send({});
    } else if (url.searchParams.has("url")) {
      const pathname = pathOf(url.searchParams.get("url")!);
      send(
        store.has(pathname) ? metadata(pathname, isPrivate) : { error: { code: "not_found" } },
        store.has(pathname) ? 200 : 404,
      );
    } else {
      const prefix = url.searchParams.get("prefix") ?? "";
      send({
        blobs: [...store.keys()].filter((p) => p.startsWith(prefix)).map((p) => metadata(p, isPrivate)),
        hasMore: false,
      });
    }
  });
  // An idle socket the server closes can be reused by the SDK at that moment and reset, with retries off.
  server.keepAliveTimeout = 0;
  return {
    objects,
    privateObjects,
    async start() {
      setGlobalDispatcher(mock);
      process.env.BLOCKYARD_PRIVATE_BLOB_READ_WRITE_TOKEN = PRIVATE_TOKEN;
      process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_testsecret";
      process.env.VERCEL_BLOB_RETRIES = "0";
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      process.env.VERCEL_BLOB_API_URL = base;
    },
    async stop() {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      delete process.env.VERCEL_BLOB_API_URL;
      delete process.env.BLOCKYARD_PRIVATE_BLOB_READ_WRITE_TOKEN;
      setGlobalDispatcher(dispatcher);
      await mock.close();
    },
  };
}
