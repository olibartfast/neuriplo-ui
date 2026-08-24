import { expect, test } from "@playwright/test";

test("shows the pipeline configuration scaffold", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Inference Pipeline" })).toBeVisible();
  await expect(page.getByTestId("task")).toBeVisible();
  await expect(page.getByTestId("model")).toBeVisible();
  await expect(page.getByTestId("backend")).toBeVisible();
  await expect(page.getByTestId("source")).toBeVisible();
  await expect(page.getByTestId("run-status")).toHaveText("Idle");
  await expect(page.getByTestId("run")).toBeDisabled();
});
