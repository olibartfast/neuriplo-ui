import { expect, test, type Page } from "@playwright/test";

/**
 * These assertions are deliberately written against the shape of the
 * capabilities contract rather than against specific tasks, models, or
 * backends. Adding a task or backend to neuriplo-infer must not require
 * editing this file.
 */

async function optionsOf(page: Page, testId: string): Promise<string[]> {
  const control = page.getByTestId(testId);
  if ((await control.evaluate((element) => element.tagName)) === "INPUT") {
    return page
      .getByTestId(`${testId}-suggestions`)
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => option.getAttribute("value") ?? ""),
      );
  }
  return control.locator("option").allTextContents();
}

test("renders a configurator driven by discovered capabilities", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Inference Pipeline" }),
  ).toBeVisible();

  // Discovery must resolve; a failure panel means the adapter could not reach
  // neuriplo-infer, which is a real failure rather than a skipped test.
  await expect(page.getByTestId("task")).toBeVisible();
  await expect(page.getByTestId("capabilities-error")).toHaveCount(0);

  expect((await optionsOf(page, "task")).length).toBeGreaterThan(0);
  expect((await optionsOf(page, "model")).length).toBeGreaterThan(0);
  await expect(page.getByTestId("source")).toBeVisible();
  await expect(page.getByTestId("source-path-0")).toBeVisible();
  await expect(page.getByTestId("run-status")).toHaveText("Idle");
  await expect(page.getByTestId("producer")).toContainText("neuriplo-infer");

  // Nothing has been supplied yet, so the run button must name what is
  // missing rather than launch an incomplete configuration.
  await expect(page.getByTestId("run")).toBeDisabled();
  await expect(page.getByTestId("run-hint")).toContainText("Source");
});

test("narrows model choices to the selected task", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("task")).toBeVisible();

  const tasks = await page.getByTestId("task").locator("option").all();
  test.skip(tasks.length < 2, "contract advertises a single task");

  const seen = new Set<string>();
  for (const task of tasks) {
    const value = await task.getAttribute("value");
    await page.getByTestId("task").selectOption(value!);
    seen.add((await optionsOf(page, "model")).join("|"));
  }

  // At least one task must offer a different model set, otherwise the UI is
  // not actually reacting to the task selection.
  expect(seen.size).toBeGreaterThan(1);
});

test("accepts advertised aliases and wildcard model selectors", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("task")).toBeVisible();

  const tasks = await page.evaluate(async () => {
    const response = await fetch("/api/capabilities");
    const payload = (await response.json()) as {
      tasks: Array<{
        id: string;
        models: Array<{ aliases: string[]; patterns: string[] }>;
      }>;
    };
    return payload.tasks;
  });
  test.skip(tasks.length < 2, "contract advertises a single task");

  const aliasOwner = tasks.find((task) =>
    task.models.some((model) => model.aliases.length > 0),
  );
  const patternOwners = tasks.flatMap((task) =>
    task.models.flatMap((model) =>
      model.patterns.map((pattern) => ({ taskId: task.id, pattern })),
    ),
  );
  const patternOwner = patternOwners.sort(
    (left, right) =>
      right.pattern.replaceAll("*", "").length -
      left.pattern.replaceAll("*", "").length,
  )[0];

  expect(aliasOwner).toBeDefined();
  await page.getByTestId("task").selectOption(aliasOwner!.id);
  const alias = aliasOwner!.models.find((model) => model.aliases.length > 0)!
    .aliases[0];
  await page.getByTestId("model").fill(alias);
  await page.getByTestId("model").press("Enter");
  await expect(page.getByTestId("model")).toHaveValue(alias);
  await expect(page.getByTestId("model")).toHaveAttribute(
    "aria-invalid",
    "false",
  );

  expect(patternOwner).toBeDefined();
  await page.getByTestId("task").selectOption(patternOwner.taskId);
  const wildcardSelector = patternOwner.pattern.replaceAll("*", "custom");
  await page.getByTestId("model").fill(wildcardSelector);
  await page.getByTestId("model").press("Enter");
  await expect(page.getByTestId("model")).toHaveValue(wildcardSelector);
  await expect(page.getByTestId("model")).toHaveAttribute(
    "aria-invalid",
    "false",
  );

  await page.getByTestId("model").fill("unadvertisedselector");
  await page.getByTestId("model").press("Enter");
  await expect(page.getByTestId("model")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByRole("alert")).toContainText("not advertised");
});

test("shows execution controls only for the selected workflow", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("task")).toBeVisible();

  const workflow = page.getByTestId("workflow");
  test.skip(
    (await workflow.count()) === 0,
    "build advertises a single execution workflow",
  );

  await workflow.selectOption("local");
  await expect(page.getByTestId("backend")).toBeVisible();
  await expect(page.getByTestId("protocol")).toHaveCount(0);
  await expect(page.getByTestId("transport")).toHaveCount(0);

  await workflow.selectOption("client_server");
  await expect(page.getByTestId("protocol")).toBeVisible();
  await expect(page.getByTestId("transport")).toBeVisible();
  await expect(page.getByTestId("backend")).toHaveCount(0);
});

test("blocks running until required parameters are supplied", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("task")).toBeVisible();

  const hint = page.getByTestId("run-hint");
  const workflow = page.getByTestId("workflow");
  if ((await workflow.count()) > 0) {
    await workflow.selectOption("client_server");
  }

  // client_server declares required parameters with no defaults, so the hint
  // must name them rather than inviting a run.
  await expect(hint).toContainText(/Provide .* before running\./);

  const endpoint = page.getByTestId("param-kserve_endpoint");
  if ((await endpoint.count()) > 0) {
    await expect(endpoint).toBeVisible();
    await endpoint.fill("http://127.0.0.1:8000");
  }
});

test("offers one source slot per source the task accepts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("task")).toBeVisible();

  const sources = await page.evaluate(async () => {
    const response = await fetch("/api/capabilities");
    const payload = (await response.json()) as {
      tasks: Array<{
        id: string;
        sources: { min_items: number; max_items: number };
      }>;
    };
    return payload.tasks;
  });

  const multi = sources.find((task) => task.sources.min_items > 1);
  test.skip(multi === undefined, "no task advertises multiple sources");

  await page.getByTestId("task").selectOption(multi!.id);
  for (let index = 0; index < multi!.sources.min_items; index += 1) {
    await expect(page.getByTestId(`source-path-${index}`)).toBeVisible();
  }

  // An unbounded task must let the user add further sources.
  if (multi!.sources.max_items < 0) {
    await page.getByTestId("add-source").click();
    await expect(
      page.getByTestId(`source-path-${multi!.sources.min_items}`),
    ).toBeVisible();
  }
});

test("picks a source path from the adapter's filesystem", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("task")).toBeVisible();

  await page.getByTestId("browse-source-path-0").click();
  const browser = page.getByTestId("file-browser");
  await expect(browser).toBeVisible();

  // The adapter decides where browsing starts, so the dialog must show a path
  // rather than an empty shell.
  await expect(page.getByTestId("file-browser-path")).not.toBeEmpty();
  await expect(page.getByTestId("file-browser-select")).toBeDisabled();

  const entries = page.locator('[data-testid^="file-entry-"]');
  await expect(entries.first()).toBeVisible();

  // Directories navigate; files become the selection.
  const file = entries.filter({ hasText: "📄" }).first();
  if ((await file.count()) > 0) {
    await file.click();
    await expect(page.getByTestId("file-browser-select")).toBeEnabled();
    await page.getByTestId("file-browser-select").click();
    await expect(browser).toHaveCount(0);
    await expect(page.getByTestId("source-path-0")).not.toHaveValue("");
  } else {
    await page.getByTestId("file-browser-cancel").click();
    await expect(browser).toHaveCount(0);
  }
});

test("launches a run once every requirement is supplied", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("task")).toBeVisible();

  await page.getByTestId("source-path-0").fill("/tmp/neuriplo-ui-fixture");

  // Required parameters have no defaults, so fill whatever the contract asks
  // for. The values only need to be well-formed; the binary decides the rest.
  const required = page.locator('[data-testid^="param-"]');
  for (const control of await required.all()) {
    const type = await control.evaluate((element) => ({
      tag: element.tagName,
      inputType: element.getAttribute("type"),
    }));
    if (type.tag === "SELECT" || type.inputType === "checkbox") continue;
    // Optional parameters live inside the collapsed advanced section and need
    // no value, so only what the form actually asks for is filled.
    if (!(await control.isVisible())) continue;
    if ((await control.inputValue()) !== "") continue;
    await control.fill(
      type.inputType === "number" ? "1" : "/tmp/neuriplo-ui-fixture",
    );
  }

  const run = page.getByTestId("run");
  await expect(run).toBeEnabled();
  await run.click();

  // The run must reach a terminal state. Which one depends on the machine's
  // models and weights, so this asserts the wiring rather than the outcome.
  await expect(page.getByTestId("run-status")).toHaveText(
    /Succeeded|Failed|Rejected/,
    { timeout: 60_000 },
  );

  const status = await page.getByTestId("run-status").textContent();

  // A rejected request never reached the binary, so it has no command, wall
  // time, or logs to show and must stay distinguishable from a failed run.
  if (status === "Rejected") {
    await expect(page.getByTestId("run-command")).toHaveCount(0);
    await expect(page.getByTestId("run-summary")).toContainText(
      "neuriplo-infer was not started",
    );
    return;
  }

  // Every completed run — successful or not — must be reproducible and
  // diagnosable from what the panel shows.
  const command = page.getByTestId("run-command");
  await expect(command).toBeVisible();
  await expect(command).toContainText(/neuriplo-infer/);
  await expect(page.getByTestId("copy-command")).toBeEnabled();

  // Wall time is the whole process, so the label must not claim latency.
  await expect(page.getByTestId("run-header")).toContainText("Wall time");
  await expect(page.getByTestId("run-header")).not.toContainText(/latency/i);
  await expect(page.getByTestId("run-duration")).not.toBeEmpty();

  await expect(page.getByTestId("log-toggle-stdout")).toBeVisible();
  await expect(page.getByTestId("log-toggle-stderr")).toBeVisible();
  await page.getByTestId("log-toggle-stdout").click();
  await expect(page.getByTestId("log-stdout")).toBeVisible();

  // A failed run puts its diagnosis on stderr, so that stream starts open.
  if (status === "Failed") {
    await expect(page.getByTestId("log-stderr")).toBeVisible();
    return;
  }

  // A null structured result is an expected state: the section appears only
  // when the binary actually emitted JSON on stdout.
  const stdout = (await page.getByTestId("log-stdout").textContent()) ?? "";
  const emitsJson = stdout.trimStart().startsWith("{") ||
    stdout.trimStart().startsWith("[");
  await expect(page.getByTestId("structured-result")).toHaveCount(
    emitsJson ? 1 : 0,
  );

  // A successful run renders whatever it produced, so an image artifact must
  // be displayed rather than only linked.
  const previews = page.locator('[data-testid^="artifact-preview-"]');
  expect(await previews.count()).toBeGreaterThan(0);

  const first = previews.first();
  await expect(first).toBeVisible();
  await expect
    .poll(() => first.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});
