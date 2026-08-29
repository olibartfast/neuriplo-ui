import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, "..");

/**
 * The suite starts what it tests.
 *
 * `NEURIPLO_INFER_BIN` defaults to the fixture producer, which is what lets the
 * whole matrix run on a machine with no models, no weights, and no compiled
 * `neuriplo-infer`. An operator who configured a real binary keeps it: the
 * suite reads its contract at runtime and asserts nothing the fixture alone
 * could satisfy, except where it checks the advertised producer version first.
 */
const producer =
  process.env.NEURIPLO_INFER_BIN?.trim() ||
  join(here, "fixtures/producer/neuriplo-infer-fixture.mjs");

// Browsing is confined to the fixture assets so the file picker lists the same
// files on every machine.
const browseRoot =
  process.env.NEURIPLO_UI_BROWSE_ROOT?.trim() || join(here, "fixtures/assets");

// Run directories sit beside the traces rather than in the system temp
// directory, so a failed run's artifacts survive with the report that needs
// them. Playwright only cleans `outputDir`, which is a sibling of this.
const runRoot =
  process.env.NEURIPLO_UI_RUN_ROOT?.trim() || join(here, "test-results/runs");

const webPort = Number(process.env.NEURIPLO_UI_WEB_PORT ?? 5173);
const apiPort = Number(process.env.NEURIPLO_UI_API_PORT ?? 5174);
const apiUrl = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: "./tests",
  outputDir: join(here, "test-results/output"),
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: process.env.NEURIPLO_UI_BASE_URL ?? `http://127.0.0.1:${webPort}`,
    // A failure has to be diagnosable from what it left behind, because the
    // machine that ran it is usually gone by the time anyone looks.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run build:server && node apps/server/dist/index.js",
      cwd: repository,
      url: `${apiUrl}/api/health`,
      env: {
        NEURIPLO_INFER_BIN: producer,
        NEURIPLO_UI_BROWSE_ROOT: browseRoot,
        NEURIPLO_UI_RUN_ROOT: runRoot,
        HOST: "127.0.0.1",
        PORT: String(apiPort),
      },
      // An operator with `npm run dev` already running keeps that adapter,
      // along with whichever producer they configured for it.
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 180_000,
    },
    {
      command: `npm run build:web && npm --workspace @neuriplo-ui/web run preview -- --port ${webPort} --strictPort`,
      cwd: repository,
      url: `http://127.0.0.1:${webPort}`,
      env: { NEURIPLO_UI_API: apiUrl },
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 180_000,
    },
  ],
});
