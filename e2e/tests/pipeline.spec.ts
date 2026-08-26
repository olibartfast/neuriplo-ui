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
  await expect(page.getByTestId("run-status")).toHaveText("Idle");
  await expect(page.getByTestId("run")).toBeDisabled();
  await expect(page.getByTestId("producer")).toContainText("neuriplo-infer");
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
