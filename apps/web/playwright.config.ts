import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3100);
// Use `localhost` (not 127.0.0.1): Next.js rewrites loopback redirects to localhost, and the
// session cookies/localStorage are per-host.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // Production build: dev-mode on-demand compilation is too slow for route assertions.
        command: process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? `pnpm build && pnpm start --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        env: {
          PORT: String(port),
          NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
        },
      },
});
