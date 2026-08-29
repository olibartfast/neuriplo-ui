import { expect, test } from "@playwright/test";
import {
  capabilitiesOf,
  configureRun,
  taskForFamily,
} from "./support/harness.js";

/**
 * Properties the linter asserts about the source but cannot see.
 *
 * `noLabelWithoutControl` is configured off because every control in the
 * configurator is returned by a nested component — `PathField` returns the
 * input, `renderControl` returns the input or select — and the rule only
 * inspects the JSX written directly inside the label. Turning a rule off on
 * that argument is only honest if something checks the argument still holds,
 * and the rendered DOM is where it either holds or does not.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("task")).toBeVisible();
});

test("gives every label in the configurator a control to name", async ({
  page,
}) => {
  const capabilities = await capabilitiesOf(page);
  const task = taskForFamily(capabilities, "image");
  test.skip(!task, "the producer advertises no single-image task");

  // Fill the form first so the optional and source rows are all present, then
  // open the advanced section: a label that renders only behind a disclosure
  // is exactly the one nobody would notice was orphaned.
  await configureRun(page, capabilities, { task: task! });
  const advanced = page.getByTestId("advanced-toggle");
  if (await advanced.count()) await advanced.click();

  const labels = page.locator("label");
  await expect(labels.first()).toBeVisible();

  // Association here is by containment, which is what the components build.
  const orphans = page.locator("label:not(:has(input, select, textarea))");
  await expect(
    orphans,
    "a label with no control inside it names nothing to a screen reader",
  ).toHaveCount(0);
});
