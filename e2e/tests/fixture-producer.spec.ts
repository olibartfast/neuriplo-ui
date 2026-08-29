import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  discoverCapabilities,
  type NeuriploCapabilities,
} from "../../apps/server/src/capabilities.js";

/**
 * The fixture producer is a contract double, and the risk it carries is drift:
 * a fixture that satisfies only itself proves nothing about the real binary.
 *
 * These tests hold it to the same validator the adapter applies to
 * `neuriplo-infer`, so a contract change that breaks the real producer breaks
 * the fixture with it, and check that what it advertises actually covers the
 * structural families the rest of the suite drives.
 */

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/producer/neuriplo-infer-fixture.mjs",
);

const execFileAsync = promisify(execFile);

test.describe("fixture producer", () => {
  test("passes the adapter's own capabilities validator", async () => {
    const capabilities: NeuriploCapabilities = await discoverCapabilities(
      fixture,
      async (binaryPath) => {
        const { stdout, stderr } = await execFileAsync(binaryPath, [
          "--capabilities",
        ]);
        return { stdout, stderr };
      },
    );

    expect(capabilities.producer.name).toBe("neuriplo-infer");
    // The suffix is the only thing distinguishing a fixture from a real
    // binary, and the tests that need fixture-known values depend on it.
    expect(capabilities.producer.version).toMatch(/-fixture$/);
    expect(capabilities.diagnostics?.run_report).toBeDefined();
  });

  test("advertises every structural family the suite drives", async () => {
    const capabilities = await discoverCapabilities(
      fixture,
      async (binaryPath) => {
        const { stdout, stderr } = await execFileAsync(binaryPath, [
          "--capabilities",
        ]);
        return { stdout, stderr };
      },
    );

    const workflows = capabilities.execution.workflows;
    const local = workflows.find((workflow) => workflow.id === "local");
    const remote = workflows.find((workflow) => workflow.id === "client_server");

    expect(local?.backends.length).toBeGreaterThan(1);
    expect(remote?.protocols.length).toBeGreaterThan(0);
    expect(remote?.parameters.required.length).toBeGreaterThan(0);

    const tasks = capabilities.tasks;
    expect(tasks.some((task) => task.models.some((m) => m.aliases.length > 0)))
      .toBe(true);
    expect(tasks.some((task) => task.models.some((m) => m.patterns.length > 0)))
      .toBe(true);
    expect(tasks.some((task) => task.sources.min_items > 1)).toBe(true);
    expect(tasks.some((task) => task.sources.max_items < 0)).toBe(true);
    expect(tasks.some((task) => task.sources.types.includes("video"))).toBe(
      true,
    );
    expect(
      tasks.some((task) =>
        task.models.some((model) => model.parameters.required.length > 0),
      ),
    ).toBe(true);

    // Model sets must differ across tasks, or nothing proves the configurator
    // reacts to the task selection.
    const modelSets = new Set(
      tasks.map((task) => task.models.map((model) => model.id).join("|")),
    );
    expect(modelSets.size).toBeGreaterThan(1);
  });
});
