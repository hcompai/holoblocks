// Screenshot each showcase in the built site as its gallery thumbnail: node scripts/thumbnails.mjs, after npm run build.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const PORT = 5187;
const URL = `http://127.0.0.1:${PORT}`;
const FOLDERS = ["public/gallery/thumbnails", "dist/gallery/thumbnails"];

const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
});
const browser = await chromium.launch();
try {
  for (
    let tries = 0;
    !(await fetch(URL).then(
      (r) => r.ok,
      () => false,
    ));
    tries++
  ) {
    if (tries > 50) throw new Error("vite preview did not start");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const account = {
    user: { id: "thumbnails", email: "thumbnails@hcompany.ai", name: "Thumbnails" },
    key: "",
    keyId: "",
    expires: Date.now() / 1000 + 3600,
    pass: "",
  };
  await page.addInitScript((a) => localStorage.setItem("blockyard.account", JSON.stringify(a)), account);
  // Offline: a showcase needs nothing beyond the site, and a refused key would sign the page out.
  await page.route((url) => url.origin !== URL, (route) => route.abort());
  for (const folder of FOLDERS) mkdirSync(folder, { recursive: true });
  for (const { id, revision } of JSON.parse(readFileSync("public/gallery/builds.json", "utf8"))) {
    await page.goto(`${URL}/?showcase=${id}`);
    await page.locator(`.viewer[data-revision="${revision}"]`).waitFor({ timeout: 180000 });
    for (const folder of FOLDERS) await page.locator(".viewer-canvas").screenshot({ path: `${folder}/${id}.png` });
    console.log(`${id}.png`);
  }
} finally {
  await browser.close();
  server.kill();
}
