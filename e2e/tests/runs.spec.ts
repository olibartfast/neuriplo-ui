import { statSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURES,
  IMAGE_FIXTURE_SIZE,
  capabilitiesOf,
  configureRun,
  expectRunOutcome,
  isFixtureProducer,
  launchRun,
  taskForFamily,
  type Family,
} from "./support/harness.js";

/**
 * What a run meant, rather than that it happened.
 *
 * Every selection here is derived from the advertised contract, so the suite
 * runs against a real `neuriplo-infer` as well as the fixture producer. The
 * assertions that need a known output check the advertised producer version
 * first.
 *
 * A real binary handed the committed placeholders fails, legitimately — but
 * `expectRunOutcome` still requires it to fail past configuration, on the
 * inputs it was given, so a binary that rejects every command line cannot pass.
 * Point `NEURIPLO_UI_E2E_IMAGE` and `NEURIPLO_UI_E2E_WEIGHTS` at real inputs
 * and the same tests demand success instead.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("task")).toBeVisible();
  await expect(page.getByTestId("capabilities-error")).toHaveCount(0);
});

test("shows a successful run's artifact, result, and producer metrics", async ({
  page,
}) => {
  const capabilities = await capabilitiesOf(page);
  test.skip(
    !isFixtureProducer(capabilities),
    "asserts output only a deterministic producer can guarantee",
  );

  const task = taskForFamily(capabilities, "image")!;
  await configureRun(page, capabilities, {
    task,
    parameters: { output_format: "json" },
  });
  expect(await launchRun(page)).toBe("Succeeded");

  // The structured result is the producer's own document, so it must carry the
  // selection that produced it rather than merely exist.
  const result = page.getByTestId("structured-result");
  await expect(result).toContainText(`"task": "${task.id}"`);
  await expect(result).toContainText(`"model": "${task.models[0].id}"`);

  // The rendered artifact is served from the run's own directory and must
  // arrive intact: same bytes, same image, decoded by the browser.
  const preview = page.locator('[data-testid^="artifact-preview-"]').first();
  await expect(preview).toBeVisible();
  const source = await preview.getAttribute("src");
  const served = await page.evaluate(async (url) => {
    const response = await fetch(url!);
    return (await response.arrayBuffer()).byteLength;
  }, source);
  expect(served).toBe(statSync(FIXTURES.image).size);
  await expect
    .poll(() =>
      preview.evaluate((image) => ({
        width: (image as HTMLImageElement).naturalWidth,
        height: (image as HTMLImageElement).naturalHeight,
      })),
    )
    .toEqual(IMAGE_FIXTURE_SIZE);

  // Producer metrics are a different measurement from the adapter's wall time,
  // and each stage the report measured gets its own row.
  const metrics = page.getByTestId("metrics");
  await expect(metrics).toBeVisible();
  for (const stage of ["Model Load", "Preprocess", "Inference", "Render"]) {
    await expect(metrics).toContainText(stage);
  }
  await expect(page.getByTestId("metric-samples")).toHaveText("1");
  await expect(page.getByTestId("metric-throughput")).not.toBeEmpty();
  // A still image has no frames, and an unmeasured value is not a zero.
  await expect(page.getByTestId("metric-frames")).toHaveCount(0);
  expect(await page.getByTestId("metric-producer-wall-time").textContent()).not
    .toBe(await page.getByTestId("run-duration").textContent());
});

test("attributes a failed run to the stage the producer named", async ({
  page,
}) => {
  const capabilities = await capabilitiesOf(page);
  test.skip(
    !isFixtureProducer(capabilities),
    "needs a producer that fails on demand in a named stage",
  );

  const task = taskForFamily(capabilities, "image")!;
  await configureRun(page, capabilities, { task });
  await page.getByTestId("source-path-0").fill(FIXTURES.failInStage("inference"));
  expect(await launchRun(page)).toBe("Failed");

  await expect(page.getByTestId("run-error-stage")).toContainText("Inference");
  await expect(page.getByTestId("run-error")).toContainText(
    "fixture failure requested in stage inference",
  );
  await expect(page.getByTestId("run-summary")).toContainText("exit 1");

  // The diagnosis is on stderr, so that stream is already open.
  await expect(page.getByTestId("log-stderr")).toBeVisible();
  await expect(page.getByTestId("log-stderr")).toContainText("inference");

  // Nothing may claim a success the run did not have.
  await expect(page.getByTestId("structured-result")).toHaveCount(0);
  await expect(page.locator('[data-testid^="artifact-preview-"]')).toHaveCount(
    0,
  );

  // Stages before the failure were reached and are reported; the failing stage
  // and everything after it were not, and are absent rather than zero.
  const metrics = page.getByTestId("metrics");
  await expect(metrics).toContainText("Model Load");
  await expect(page.getByTestId("metric-inference")).toHaveCount(0);
  await expect(page.getByTestId("metric-render")).toHaveCount(0);
});

test("reports a completed run as a reproducible report", async ({ page }) => {
  const capabilities = await capabilitiesOf(page);
  const task = taskForFamily(capabilities, "image")!;
  await configureRun(page, capabilities, { task });
  await expectRunOutcome(page, capabilities, await launchRun(page));

  // The command is rendered from the argument array the adapter spawned, so
  // copying it reproduces the run outside the browser.
  const command = page.getByTestId("run-command");
  await expect(command).toContainText("--type=");
  await expect(command).toContainText(task.models[0].id);
  await expect(page.getByTestId("copy-command")).toBeEnabled();

  // Wall time is the whole process and must never be labelled latency.
  await expect(page.getByTestId("run-header")).toContainText("Wall time");
  await expect(page.getByTestId("run-header")).not.toContainText(/latency/i);
  await expect(page.getByTestId("run-duration")).not.toBeEmpty();

  await expect(page.getByTestId("log-toggle-stdout")).toBeVisible();
  await expect(page.getByTestId("log-toggle-stderr")).toBeVisible();
  await page.getByTestId("log-toggle-stdout").click();
  await expect(page.getByTestId("log-stdout")).toBeVisible();
});

const FAMILIES: Family[] = ["image", "multi_source", "video", "prompted"];

for (const family of FAMILIES) {
  test(`runs the ${family.replace("_", " ")} task family`, async ({ page }) => {
    const capabilities = await capabilitiesOf(page);
    const task = taskForFamily(capabilities, family);
    test.skip(
      task === undefined,
      `the contract advertises no ${family} task family`,
    );

    await configureRun(page, capabilities, { task: task! });
    const status = await launchRun(page);
    await expectRunOutcome(page, capabilities, status);

    if (!isFixtureProducer(capabilities)) {
      await expect(page.getByTestId("run-command")).toContainText("--type=");
      return;
    }

    await expect(page.getByTestId("artifacts")).toBeVisible();
    await expectArtifactFor(page, task!.sources.types[0]);

    if (family === "video") {
      // Frames are measured only where there are frames to count.
      await expect(page.getByTestId("metric-frames")).not.toBeEmpty();
    }
  });
}

test("runs each advertised local backend", async ({ page }) => {
  const capabilities = await capabilitiesOf(page);
  const local = capabilities.execution.workflows.find(
    (workflow) => workflow.id === "local",
  );
  test.skip(
    (local?.backends.length ?? 0) < 2,
    "the build advertises fewer than two local backends",
  );

  const task = taskForFamily(capabilities, "image")!;
  for (const backend of local!.backends) {
    await page.goto("/");
    await expect(page.getByTestId("task")).toBeVisible();
    await configureRun(page, capabilities, {
      task,
      workflow: "local",
      backend,
    });
    const status = await launchRun(page);

    // The backend is validated and echoed back rather than passed on the
    // command line, so the header is where it has to appear.
    await expect(page.getByTestId("run-header")).toContainText(backend);
    await expectRunOutcome(page, capabilities, status);
  }
});

test("runs the client-server workflow", async ({ page }) => {
  const capabilities = await capabilitiesOf(page);
  const remote = capabilities.execution.workflows.find(
    (workflow) => workflow.id === "client_server",
  );
  test.skip(
    remote === undefined,
    "the build advertises no client-server workflow",
  );

  const task = taskForFamily(capabilities, "image")!;
  await configureRun(page, capabilities, { task, workflow: "client_server" });
  const status = await launchRun(page);

  const protocol = remote!.protocols[0];
  if (protocol) {
    await expect(page.getByTestId("run-header")).toContainText(protocol.id);
  }

  // Without a remote runtime this only proves the UI and adapter halves; a
  // deterministic server belongs to Phase 6. A real producer with nothing
  // listening still has to fail past configuration.
  await expectRunOutcome(page, capabilities, status, { remote: true });
});

async function expectArtifactFor(page: Page, sourceType: string) {
  const previews = page.locator('[data-testid^="artifact-preview-"]');
  if (sourceType === "image") {
    await expect
      .poll(() =>
        previews
          .first()
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    return;
  }
  // A non-image artifact is served and linked; the browser is not asked to
  // decode a placeholder.
  await expect(page.getByTestId("artifacts")).toContainText(sourceType);
}
