import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Software-rendered WebGL on CPU-only runners is slow to warm up.
  timeout: 120000,
  expect: { timeout: 60000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5189",
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    // The production build mounts each WebGL scene once; dev StrictMode doubles every shader compile.
    command: "VITE_HAI_API_KEY=test-key npx vite build && npx vite preview --host 127.0.0.1 --port 5189 --strictPort",
    url: "http://127.0.0.1:5189",
    reuseExistingServer: !process.env.CI,
  },
});
