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
  REMOTE_MODEL,
  remoteRoundTripModel,
  remoteServerName,
  setParameter,
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

test("retains finished runs and returns to an earlier one", async ({ page }) => {
  const capabilities = await capabilitiesOf(page);
  const task = taskForFamily(capabilities, "image")!;

  // Nothing has run, so there is no history to show.
  await expect(page.getByTestId("history")).toHaveCount(0);

  await configureRun(page, capabilities, { task });
  await expectRunOutcome(page, capabilities, await launchRun(page));
  const first = await page.getByTestId("run-id").textContent();

  await expect(page.getByTestId("history")).toBeVisible();
  await expect(page.getByTestId(`history-entry-${first}`)).toHaveAttribute(
    "aria-current",
    "true",
  );

  // A second run of the same configuration is a second entry, not a
  // replacement: two runs of one configuration are what a comparison needs.
  await expectRunOutcome(page, capabilities, await launchRun(page));
  const second = await page.getByTestId("run-id").textContent();
  expect(second).not.toBe(first);

  const entries = page.locator('[data-testid^="history-entry-"]');
  await expect(entries).toHaveCount(2);
  // Newest first.
  await expect(entries.first()).toHaveAttribute(
    "data-testid",
    `history-entry-${second}`,
  );

  // Selecting the earlier run shows that run, unchanged.
  await page.getByTestId(`history-entry-${first}`).click();
  await expect(page.getByTestId("run-id")).toHaveText(first!);
  await expect(page.getByTestId(`history-entry-${first}`)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByTestId("run-command")).toContainText("--type=");
});

test("never retains a request the adapter refused", async ({ page }) => {
  const capabilities = await capabilitiesOf(page);
  const task = taskForFamily(capabilities, "image")!;

  await configureRun(page, capabilities, { task });
  // A source that does not exist is refused before anything is spawned.
  await page.getByTestId("source-path-0").fill("/tmp/neuriplo-ui-absent-source");
  expect(await launchRun(page)).toBe("Rejected");

  // A rejection never reached the binary, so it has nothing to compare and
  // must not appear as a run that happened.
  await expect(page.getByTestId("history")).toHaveCount(0);
  await expect(page.getByTestId("run-summary")).toContainText(
    "neuriplo-infer was not started",
  );
});

test("compares two runs and marks what differed", async ({ page }) => {
  const capabilities = await capabilitiesOf(page);
  const local = capabilities.execution.workflows.find((w) => w.id === "local");
  const remote = capabilities.execution.workflows.find(
    (w) => w.id === "client_server",
  );
  test.skip(
    local === undefined || remote === undefined,
    "the build advertises a single execution workflow",
  );

  const task = taskForFamily(capabilities, "image")!;

  // Local against remote is the motivating comparison, and needs no special
  // support: they are two runs with different executions.
  await configureRun(page, capabilities, { task, workflow: "local" });
  await expectRunOutcome(page, capabilities, await launchRun(page));
  const first = (await page.getByTestId("run-id").textContent())!;

  await page.goto("/");
  await expect(page.getByTestId("task")).toBeVisible();
  await configureRun(page, capabilities, { task, workflow: "client_server" });
  await expectRunOutcome(page, capabilities, await launchRun(page), {
    remote: true,
  });
  const second = (await page.getByTestId("run-id").textContent())!;

  // A reload clears the page's history, so only the second run survives; run
  // the first again to have two in the same session.
  await configureRun(page, capabilities, { task, workflow: "local" });
  await expectRunOutcome(page, capabilities, await launchRun(page));
  const third = (await page.getByTestId("run-id").textContent())!;
  expect(third).not.toBe(second);
  expect(third).not.toBe(first);

  await expect(page.getByTestId("comparison")).toHaveCount(0);
  await page.getByTestId(`compare-${second}`).check();
  // One run is not a comparison.
  await expect(page.getByTestId("comparison")).toHaveCount(0);

  await page.getByTestId(`compare-${third}`).check();
  const comparison = page.getByTestId("comparison");
  await expect(comparison).toBeVisible();
  await expect(page.getByTestId("comparison-caption")).toContainText(
    "differing in execution",
  );

  // Execution differed by construction; the task did not.
  await expect(
    page.getByTestId("comparison-row-execution"),
  ).toHaveAttribute("data-differs", "true");
  await expect(page.getByTestId("comparison-row-task")).toHaveAttribute(
    "data-differs",
    "false",
  );

  // Nothing in the table concludes anything from the numbers.
  await expect(comparison).not.toContainText(/faster|slower|speedup/i);
});

test("repeats a configuration and summarizes what the runs measured", async ({
  page,
}) => {
  const capabilities = await capabilitiesOf(page);
  const task = taskForFamily(capabilities, "image")!;
  await configureRun(page, capabilities, { task });

  await page.getByTestId("repeat").fill("3");
  await expect(page.getByTestId("run")).toContainText("Run 3 times");
  await expect(page.getByTestId("run-hint")).toContainText("one after another");

  await page.getByTestId("run").click();
  // Three sequential runs, so the wait covers all of them.
  await expect(page.getByTestId("history").locator("li")).toHaveCount(3, {
    timeout: 120_000,
  });
  await expect(page.getByTestId("run-status")).toHaveText(/Succeeded|Failed/);

  // A repetition selects itself for comparison: it is a set worth looking at
  // together, and ticking each run by hand would be busywork.
  const summary = page.getByTestId("summary");
  await expect(summary).toBeVisible();
  await expect(page.getByTestId("comparison-caption")).toContainText(
    "same configuration",
  );

  const wallTime = page.getByTestId("summary-row-wall-time-whole-process");
  await expect(wallTime).toBeVisible();
  // Every run reported its own wall time, so all three contributed.
  await expect(wallTime.locator("td").first()).toHaveText("3");

  // The distinction the producer contract forces: this summarizes runs, not
  // the iterations of a benchmark loop nobody published per-iteration data for.
  await expect(page.getByText(/not over the iterations of/)).toBeVisible();
  await expect(summary).not.toContainText(/p9[059]|percentile/i);
});

test("describes the remote server the endpoint addresses", async ({ page }) => {
  const capabilities = await capabilitiesOf(page);
  const remote = capabilities.execution.workflows.find(
    (workflow) => workflow.id === "client_server",
  );
  test.skip(
    remote === undefined,
    "the build advertises no client-server workflow",
  );

  const endpoint = remote!.parameters.required.find(
    (id) => capabilities.parameters[id]?.value_type === "url",
  );
  test.skip(
    endpoint === undefined,
    "the contract advertises no endpoint parameter",
  );

  const task = taskForFamily(capabilities, "image")!;
  await configureRun(page, capabilities, { task, workflow: "client_server" });

  // The panel must show what the server said, so the expected name is read
  // from the server rather than written into the suite — which keeps this true
  // whether the fixture responder or a real runtime is answering.
  const named = await remoteServerName();
  expect(named).not.toBeNull();

  const metadata = page.getByTestId("remote-metadata");
  await expect(metadata).toBeVisible({ timeout: 15_000 });
  await expect(metadata).toContainText(named!);

  // Model metadata needs a model to ask about, found the way the UI finds it:
  // a string parameter whose id names a model rather than a version.
  const modelParameter = [
    ...remote!.parameters.required,
    ...remote!.parameters.optional,
  ].find(
    (id) =>
      capabilities.parameters[id]?.value_type === "string" &&
      /model/i.test(id) &&
      !/version/i.test(id),
  );
  test.skip(
    modelParameter === undefined,
    "the contract advertises no remote model parameter",
  );

  // The name both remotes publish, so the assertion does not depend on which
  // of them the harness started.
  await setParameter(page, modelParameter!, REMOTE_MODEL);

  // Whether the server knows this model depends on what it serves, and both
  // answers are legitimate — the panel has to state which one it got.
  const described = page.getByTestId("remote-platform");
  const unknown = page.getByTestId("remote-model-unknown");
  await expect(described.or(unknown).first()).toBeVisible({ timeout: 15_000 });

  if (await described.count()) {
    await expect(described).not.toBeEmpty();
    await expect(page.getByTestId("remote-inputs")).toContainText("FP32");
  } else {
    // A model the server does not publish is not an error about the server.
    await expect(unknown).toContainText("did not describe this model");
    await expect(metadata).toBeVisible();
  }

  // The description never gates the run, either way.
  await expect(page.getByTestId("run")).toBeEnabled();
});

test("refuses an endpoint outside the adapter's allowlist", async ({ page }) => {
  const capabilities = await capabilitiesOf(page);
  const remote = capabilities.execution.workflows.find(
    (workflow) => workflow.id === "client_server",
  );
  const endpoint = remote?.parameters.required.find(
    (id) => capabilities.parameters[id]?.value_type === "url",
  );
  test.skip(
    endpoint === undefined,
    "the contract advertises no endpoint parameter",
  );

  const task = taskForFamily(capabilities, "image")!;
  await configureRun(page, capabilities, { task, workflow: "client_server" });

  // The adapter can reach hosts the browser cannot, so an endpoint it was not
  // configured to allow is refused before anything connects.
  await setParameter(page, endpoint!, "http://169.254.169.254/latest/meta-data");
  await expect(page.getByTestId("remote-error")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("remote-error")).toContainText("not permitted");
  await expect(page.getByTestId("remote-metadata")).toHaveCount(0);

  // A refusal describes nothing about the server and blocks nothing.
  await expect(page.getByTestId("run")).toBeEnabled();
});

test("completes a client-server run against the deterministic runtime", async ({
  page,
}) => {
  const selector = remoteRoundTripModel();
  test.skip(
    selector === null,
    "set NEURIPLO_UI_E2E_REMOTE_MODEL to a selector the runtime's stub tensors fit",
  );

  const capabilities = await capabilitiesOf(page);
  const remote = capabilities.execution.workflows.find(
    (workflow) => workflow.id === "client_server",
  );
  test.skip(remote === undefined, "the build advertises no client-server workflow");

  const task = capabilities.tasks.find((candidate) =>
    candidate.models.some((model) => model.id === selector),
  );
  test.skip(
    task === undefined,
    `no advertised task offers the model ${selector}`,
  );

  await configureRun(page, capabilities, {
    task: task!,
    workflow: "client_server",
    model: selector!,
  });

  const parameters = [
    ...remote!.parameters.required,
    ...remote!.parameters.optional,
  ];
  const modelParameter = parameters.find(
    (id) =>
      capabilities.parameters[id]?.value_type === "string" &&
      /model/i.test(id) &&
      !/version/i.test(id),
  );
  if (modelParameter) await setParameter(page, modelParameter, REMOTE_MODEL);

  // This is the whole point of the slice: inference actually served by a
  // remote, not a metadata responder standing in for one.
  expect(await launchRun(page)).toBe("Succeeded");
  await expect(page.getByTestId("run-header")).toContainText("client_server");
  await expect(page.getByTestId("artifacts")).toBeVisible();
  await expect(page.locator('[data-testid^="artifact-preview-"]').first()).toBeVisible();
});

test("holds the controls until every run in a batch has finished", async ({
  page,
}) => {
  const capabilities = await capabilitiesOf(page);
  const task = taskForFamily(capabilities, "image")!;

  // Each run is delayed so the gap between them is observable: a finished run
  // leaves the live state "done" while later ones are still to come, which is
  // exactly when the controls must stay held.
  await page.route("**/api/runs", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });

  await configureRun(page, capabilities, { task });
  await page.getByTestId("repeat").fill("2");
  await page.getByTestId("run").click();

  const entries = page.locator('[data-testid^="history-entry-"]');
  await expect(entries).toHaveCount(1, { timeout: 30_000 });

  // The first run has landed and the second has not started. Launching another
  // batch here would create exactly the device contention sequencing prevents.
  await expect(page.getByTestId("run")).toBeDisabled();
  await expect(page.getByTestId("repeat")).toBeDisabled();
  await expect(page.getByTestId("run")).toContainText("of 2");

  await expect(entries).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("run")).toBeEnabled();
});

test("shows a rejection that stopped a batch part-way", async ({ page }) => {
  const capabilities = await capabilitiesOf(page);
  const task = taskForFamily(capabilities, "image")!;

  // The first run succeeds, the second is refused.
  let seen = 0;
  await page.route("**/api/runs", async (route) => {
    seen += 1;
    if (seen === 1) return route.continue();
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        status: "error",
        error: { code: "invalid_source", message: "Source path does not exist" },
      }),
    });
  });

  await configureRun(page, capabilities, { task });
  await page.getByTestId("repeat").fill("2");
  await page.getByTestId("run").click();

  // The batch stopped early, and saying so outranks continuing to display the
  // run that did succeed.
  await expect(page.getByTestId("run-status")).toHaveText("Rejected", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("run-error")).toContainText(
    "Source path does not exist",
  );

  // The successful run is still retained; it is simply not what is shown.
  await expect(page.locator('[data-testid^="history-entry-"]')).toHaveCount(1);
  await expect(page.getByTestId("run")).toBeEnabled();
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
