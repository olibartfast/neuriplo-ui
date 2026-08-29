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

/**
 * Sources are confined to the same directory.
 *
 * Without this the adapter accepts any existing path, and a run turns the file
 * it was given into an artifact the browser can fetch — so an unconfined
 * adapter is an arbitrary local-file read for anything that can reach it. The
 * harness is short-lived and bound to the loopback interface, but neither of
 * those is a reason to leave the door open. An operator supplying their own
 * sources sets `NEURIPLO_UI_BROWSE_ROOT` to a directory that contains them.
 */
const sourceRoot = process.env.NEURIPLO_UI_SOURCE_ROOT?.trim() || browseRoot;

// Run directories sit beside the traces rather than in the system temp
// directory, so a failed run's artifacts survive with the report that needs
// them. Playwright only cleans `outputDir`, which is a sibling of this.
const runRoot =
  process.env.NEURIPLO_UI_RUN_ROOT?.trim() || join(here, "test-results/runs");

const webPort = Number(process.env.NEURIPLO_UI_WEB_PORT ?? 5173);
const apiPort = Number(process.env.NEURIPLO_UI_API_PORT ?? 5174);
const apiUrl = `http://127.0.0.1:${apiPort}`;

const remotePort = Number(process.env.NEURIPLO_UI_REMOTE_PORT ?? 5175);
export const remoteUrl = `http://127.0.0.1:${remotePort}`;

/**
 * The remote a client-server run addresses.
 *
 * `NEURIPLO_UI_E2E_RUNTIME` points at a built `neuriplo-kserve-runtime`, whose
 * stub backend serves KServe V2 without a model — the deterministic remote this
 * phase and Phase 5 were both waiting for. Without one, a fixture responder
 * answers the metadata paths so the lookup is still exercised, but nothing
 * proves the serving half.
 *
 * Both publish the same model name, so no test has to know which is running.
 */
const runtime = process.env.NEURIPLO_UI_E2E_RUNTIME?.trim();
export const REMOTE_MODEL = "yolo26";

const remoteCommand = runtime
  ? // Loopback for the same reason the adapter and preview bind it: this
    // serves inference to whatever can reach it.
    `${runtime} --host 127.0.0.1 --port ${remotePort} --model-name ${REMOTE_MODEL} --backend stub`
  : `node ${join(here, "fixtures/remote/kserve-fixture.mjs")} ${remotePort}`;

const logs = join(here, "test-results");

/**
 * Builds, then starts a server with its output both forwarded and written to a
 * file that survives the run.
 *
 * Playwright's own `stdout: "pipe"` only forwards to the runner's terminal, so
 * on CI the logs would live in the job output and not in the uploaded
 * artifact. `test-results` is a sibling of `outputDir`, which Playwright
 * cleans, so these outlive the tests that needed them.
 */
function serve(name: string, build: string, start: string): string {
  return `npm run ${build} && mkdir -p ${logs} && ${start} 2>&1 | tee ${join(logs, `${name}.log`)}`;
}

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
      command: serve(
        "adapter",
        "build:server",
        "node apps/server/dist/index.js",
      ),
      cwd: repository,
      url: `${apiUrl}/api/health`,
      env: {
        NEURIPLO_INFER_BIN: producer,
        NEURIPLO_UI_BROWSE_ROOT: browseRoot,
        NEURIPLO_UI_SOURCE_ROOT: sourceRoot,
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
      command: remoteCommand,
      cwd: repository,
      url: `${remoteUrl}/v2`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    },
    {
      // `vite preview` is invoked directly rather than through the workspace's
      // own script, which binds 0.0.0.0. The harness serves a page that proxies
      // to an adapter that runs binaries and reads files, and it has no
      // business being reachable from the network.
      command: serve(
        "web",
        "build:web",
        `npm --workspace @neuriplo-ui/web exec -- vite preview --host 127.0.0.1 --port ${webPort} --strictPort`,
      ),
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
