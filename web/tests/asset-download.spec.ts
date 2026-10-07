import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { snapshot } from "../api/lib/snapshot";
import { assetBlob, platformAsset } from "../src/assetUrl";
import { model, site } from "./fixtures";
import { platform } from "./platform";

test("only the exact HTTPS Agents origin can receive credentials", () => {
  expect(platformAsset("https://agp.eu.hcompany.ai/files/photo.png")).toBe(true);
  for (const url of [
    "https://images.example.org/photo.png",
    "https://agp.eu.hcompany.ai.evil.example/photo.png",
    "https://agp.eu.hcompany.ai:444/photo.png",
    "https://agp.eu.hcompany.ai@evil.example/photo.png",
    "https://user:password@agp.eu.hcompany.ai/photo.png",
    "http://agp.eu.hcompany.ai/photo.png",
    "file:///etc/passwd",
  ])
    expect(platformAsset(url)).toBe(false);
});

test("oversized attachments are cancelled with or without a declared size", async () => {
  const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
  await expect(assetBlob(new Response(bytes))).rejects.toThrow("too large");
  await expect(
    assetBlob(new Response("small", { headers: { "content-length": String(bytes.length) } })),
  ).rejects.toThrow("too large");
  const kept = await assetBlob(new Response("photo", { headers: { "content-type": "image/png" } }));
  expect(await kept.text()).toBe("photo");
  expect(kept.type).toBe("image/png");
});

test("publishing copies platform images but keeps external HTTPS photos as links without fetching them", async () => {
  const photos = [
    "https://agp.eu.hcompany.ai/photo",
    "data:image/png;base64,cGhvdG8=",
    "https://images.example.org/photo.jpg",
    "https://agp.eu.hcompany.ai.evil.example/photo.jpg",
    "https://127.0.0.1/photo.jpg",
    "http://169.254.169.254/photo.jpg",
    "https://user:password@images.example.org/photo.jpg",
    "file:///etc/passwd",
  ];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.protocol === "data:") return original(input, init);
    if (url.origin !== "https://agp.eu.hcompany.ai") throw new Error("External URLs must not be fetched");
    if (url.pathname === "/model" || url.pathname === "/photo") {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      return new Response(url.pathname === "/model" ? gzipSync(JSON.stringify(model())) : "photo", {
        headers: { "content-type": "image/png" },
      });
    }
    if (url.pathname.endsWith("/changes"))
      return Number(url.searchParams.get("from_index")) > 0
        ? new Response(null, { status: 204 })
        : Response.json({
            status: "failed",
            new_events: [
              {
                timestamp: "2026-01-01T00:00:00Z",
                type: "AgentEvent",
                data: {
                  kind: "message_event",
                  caller_id: "user",
                  content: ["A hut", ...photos.map((source) => ({ type: "url", source }))],
                },
              },
              {
                timestamp: "2026-01-01T00:00:00Z",
                type: "AttachmentEvent",
                data: {
                  origin: "agent",
                  name: "model.json.gz",
                  path: "/workspace/model.json.gz",
                  url: "https://agp.eu.hcompany.ai/model",
                  media_type: "application/json",
                  size_bytes: 1,
                },
              },
            ],
          });
    if (url.pathname.endsWith("/sessions"))
      return Response.json({
        items: [{ id: "mine", agent: "blockyard", status: "failed", created_at: "2026-01-01T00:00:00Z" }],
        total: 1,
        page: 1,
      });
    return Response.json({
      id: "mine",
      request: { agent: "blockyard" },
      status: { status: "failed" },
      created_at: "2026-01-01T00:00:00Z",
    });
  };
  try {
    const build = await snapshot("mine", "test-key", null, async (name) => `https://saved.example/${name}`);
    expect(build.messages[0].images).toEqual([
      "https://saved.example/images/1.png",
      "https://saved.example/images/2.png",
      ...photos.slice(2, 5),
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("a shared model follows storage redirects without forwarding the API key", async ({ page }) => {
  await site(page);
  const agp = await platform(page);
  agp.session("stored-model", "completed");
  const built = model();
  agp.share("stored-model", built);
  let storageRequests = 0;
  let forwardedKey = false;
  const storage = createServer((request, response) => {
    storageRequests++;
    forwardedKey ||= !!request.headers.authorization;
    response.writeHead(200, { "content-type": "application/gzip", "access-control-allow-origin": "*" });
    response.end(gzipSync(JSON.stringify(built)));
  });
  await new Promise<void>((resolve) => storage.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${(storage.address() as AddressInfo).port}/model.gz`;
  try {
    await page.route([...agp.files.keys()][0], (route) =>
      route.request().method() === "OPTIONS"
        ? route.fulfill({
            status: 204,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-headers": "authorization",
              "access-control-allow-methods": "GET",
            },
          })
        : route.fulfill({ status: 302, headers: { location: target, "access-control-allow-origin": "*" } }),
    );
    await page.goto("/?build=stored-model");
    await expect(page.locator(".viewer")).toHaveAttribute("data-revision", built.revision);
    expect(storageRequests).toBe(1);
    expect(forwardedKey).toBe(false);
  } finally {
    storage.closeAllConnections();
    await new Promise<void>((resolve, reject) => storage.close((error) => (error ? reject(error) : resolve())));
  }
});
