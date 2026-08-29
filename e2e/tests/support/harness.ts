import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";
import type {
  CapabilityParameter,
  CapabilityTask,
  NeuriploCapabilities,
} from "../../../apps/server/src/capabilities.js";

/**
 * Driving the configurator from the contract.
 *
 * Nothing here names a task, a model, or a backend. A test says which
 * structural family it wants, this module reads the advertised contract and
 * fills whatever that family asks for, so the same test runs against the
 * fixture producer and against a real `neuriplo-infer`.
 */

const assets = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/assets",
);

/**
 * Real inputs, when the operator supplied them.
 *
 * The committed assets are placeholders: bytes with the right names, which a
 * real producer rejects. An operator running against a real binary can point
 * these at inputs it can actually load, and the suite then demands the runs
 * succeed instead of demanding they fail in a known way. They have to live
 * under `NEURIPLO_UI_BROWSE_ROOT`, which is what confines sources.
 */
const REAL = {
  image: process.env.NEURIPLO_UI_E2E_IMAGE?.trim(),
  video: process.env.NEURIPLO_UI_E2E_VIDEO?.trim(),
  weights: process.env.NEURIPLO_UI_E2E_WEIGHTS?.trim(),
};

export const FIXTURES = {
  image: REAL.image || join(assets, "sample-image.png"),
  secondImage: REAL.image || join(assets, "second-image.png"),
  video: REAL.video || join(assets, "sample-video.mp4"),
  weights: REAL.weights || join(assets, "fixture-weights.onnx"),
  failInStage: (stage: string) => join(assets, `fail-${stage}.png`),
};

/** True when the operator supplied inputs a real producer can actually load. */
export function hasRealAssets(): boolean {
  return Boolean(REAL.image && REAL.weights);
}

/** What a required free-text parameter is filled with. */
export const PROMPT = "fixture";

/**
 * The model name both remotes publish — the fixture responder and a real
 * `neuriplo-kserve-runtime` the harness starts — so a test never has to know
 * which one is answering.
 */
export const REMOTE_MODEL = "yolo26";

/** Where the harness's remote listens, whichever of the two is running. */
export function remoteEndpoint(): string {
  return (
    process.env.NEURIPLO_UI_E2E_ENDPOINT?.trim() ||
    `http://127.0.0.1:${process.env.NEURIPLO_UI_REMOTE_PORT ?? 5175}`
  );
}

/**
 * What the remote says about itself, read by the test process directly.
 *
 * Lets an assertion compare the panel against the server rather than against a
 * name written into the suite — which is what keeps it true whether the fixture
 * responder or a real `neuriplo-kserve-runtime` is answering.
 */
export async function remoteServerName(): Promise<string | null> {
  try {
    const response = await fetch(`${remoteEndpoint()}/v2`);
    const payload = (await response.json()) as { name?: string };
    return typeof payload.name === "string" ? payload.name : null;
  } catch {
    return null;
  }
}

/**
 * The local model selector to drive a full client-server round trip with, when
 * the operator has supplied one.
 *
 * The runtime's stub backend serves fixed tensor shapes, so whether a round
 * trip completes depends on what the selected task expects of them — and
 * nothing in the capabilities contract advertises that. Rather than encode a
 * producer's task semantics here, the operator names a selector they know fits
 * and the suite then requires the run to succeed.
 */
export function remoteRoundTripModel(): string | null {
  return process.env.NEURIPLO_UI_E2E_REMOTE_MODEL?.trim() || null;
}

/** The image fixture's own dimensions, which a rendered artifact must match. */
export const IMAGE_FIXTURE_SIZE = { width: 64, height: 64 };

export async function capabilitiesOf(
  page: Page,
): Promise<NeuriploCapabilities> {
  return page.evaluate(async () => {
    const response = await fetch("/api/capabilities");
    return (await response.json()) as unknown;
  }) as Promise<NeuriploCapabilities>;
}

/**
 * True when the adapter is talking to the fixture producer. The suffix is the
 * only thing that distinguishes it, and it gates the assertions that depend on
 * values only a deterministic producer can guarantee.
 */
export function isFixtureProducer(capabilities: NeuriploCapabilities): boolean {
  return capabilities.producer.version.endsWith("-fixture");
}

export type Family = "image" | "multi_source" | "video" | "prompted";

/**
 * The structural families the UI actually branches on. A family is a shape of
 * contract, not a kind of model, which is why a real producer's own tasks fall
 * into them without the suite knowing what they do.
 */
export function taskForFamily(
  capabilities: NeuriploCapabilities,
  family: Family,
): CapabilityTask | undefined {
  // A prompt is whichever required parameter carries free text, whether the
  // contract types it as one string or a list of them.
  const requiresText = (task: CapabilityTask) =>
    [...task.parameters.required, ...task.models[0].parameters.required].some(
      (id) =>
        capabilities.parameters[id]?.value_type === "string" ||
        capabilities.parameters[id]?.value_type === "string_list",
    );

  switch (family) {
    case "image":
      return capabilities.tasks.find(
        (task) =>
          task.sources.types.includes("image") &&
          task.sources.min_items === 1 &&
          !requiresText(task),
      );
    case "multi_source":
      return capabilities.tasks.find((task) => task.sources.min_items > 1);
    case "video":
      return capabilities.tasks.find((task) =>
        task.sources.types.includes("video"),
      );
    case "prompted":
      return capabilities.tasks.find(requiresText);
  }
}

export type Configuration = {
  task: CapabilityTask;
  /** Defaults to the task's first advertised model. */
  model?: string;
  /** Defaults to the workflow the contract advertises first, preferring local. */
  workflow?: string;
  backend?: string;
  /** Extra parameter values, on top of everything required. */
  parameters?: Record<string, string>;
};

/**
 * Fills the configurator for one run and leaves it ready to launch.
 *
 * Required parameters are filled from their advertised value type rather than
 * from a list of known names, so a newly required parameter is supplied without
 * touching this file.
 */
export async function configureRun(
  page: Page,
  capabilities: NeuriploCapabilities,
  configuration: Configuration,
): Promise<void> {
  const { task } = configuration;
  const model =
    task.models.find((entry) => entry.id === configuration.model) ??
    task.models[0];

  await page.getByTestId("task").selectOption(task.id);
  await page.getByTestId("model").fill(model.id);
  await page.getByTestId("model").press("Enter");
  await expect(page.getByTestId("model")).toHaveAttribute(
    "aria-invalid",
    "false",
  );

  const workflows = capabilities.execution.workflows;
  const wanted =
    configuration.workflow ??
    (workflows.some((entry) => entry.id === "local")
      ? "local"
      : workflows[0].id);
  const workflow =
    workflows.find((entry) => entry.id === wanted) ?? workflows[0];

  await choose(page, "workflow", workflow.id);
  if (configuration.backend) {
    await choose(page, "backend", configuration.backend);
  }
  await choose(page, "source", task.sources.types[0]);
  await fillSources(page, task);

  const active = [
    ...workflow.parameters.required,
    ...task.parameters.required,
    ...model.parameters.required,
  ];
  for (const id of active) {
    await setParameter(page, id, valueFor(capabilities.parameters[id]));
  }
  for (const [id, value] of Object.entries(configuration.parameters ?? {})) {
    await setParameter(page, id, value);
  }

  // The hint names whatever is still missing, so a configuration bug shows up
  // here rather than as an unexplained disabled button.
  await expect(page.getByTestId("run-hint")).toHaveText(
    "Launches neuriplo-infer through the local adapter.",
  );
}

/** Launches the configured run and waits for it to reach a terminal state. */
export async function launchRun(page: Page): Promise<string> {
  await expect(page.getByTestId("run")).toBeEnabled();
  await page.getByTestId("run").click();
  await expect(page.getByTestId("run-status")).toHaveText(
    /Succeeded|Failed|Rejected/,
    { timeout: 90_000 },
  );
  return (await page.getByTestId("run-status").textContent()) ?? "";
}

/**
 * Selects a value in one of the configurator's choices.
 *
 * A choice with a single option is rendered disabled — there is nothing to
 * choose — and one the contract does not advertise is not rendered at all. In
 * both cases the value is already the only one it can be.
 */
async function choose(
  page: Page,
  testId: string,
  value: string,
): Promise<void> {
  const control = page.getByTestId(testId);
  if ((await control.count()) === 0) return;
  if (!(await control.isEnabled())) {
    // Disabled means one option; asking for a different one is a mistake in
    // the test rather than something to pass over quietly.
    await expect(control).toHaveValue(value);
    return;
  }
  await control.selectOption(value);
}

/**
 * What a run is required to end in.
 *
 * The fixture producer succeeds, and so must a real one given real inputs. A
 * real producer handed the committed placeholders cannot succeed — but it must
 * still fail in a *particular* way: past configuration, on the inputs it was
 * knowingly given. Accepting any failure would keep the suite green against a
 * binary that rejects every command line the adapter builds, which is exactly
 * the regression these tests exist to catch.
 */
export async function expectRunOutcome(
  page: Page,
  capabilities: NeuriploCapabilities,
  status: string,
  options: { remote?: boolean } = {},
): Promise<void> {
  // A remote workflow needs a server as well as inputs, and this suite has
  // none: proving that half is Phase 6's.
  const mustSucceed =
    isFixtureProducer(capabilities) || (hasRealAssets() && !options.remote);

  if (mustSucceed) {
    expect(status).toBe("Succeeded");
    return;
  }

  expect(status).toBe("Failed");
  if (capabilities.diagnostics?.run_report) {
    // Placeholder weights fail in model load; a placeholder source fails in
    // source or preprocess. Configuration means the command was wrong.
    await expect(page.getByTestId("run-error-stage")).toHaveText(
      /Model Load|Source|Preprocess/,
    );
  }
}

/** One source slot per source the task advertises, filled with real files. */
async function fillSources(page: Page, task: CapabilityTask): Promise<void> {
  const video = task.sources.types[0] === "video";
  const paths = video
    ? [FIXTURES.video]
    : [FIXTURES.image, FIXTURES.secondImage];

  for (let index = 0; index < task.sources.min_items; index += 1) {
    const slot = page.getByTestId(`source-path-${index}`);
    if ((await slot.count()) === 0)
      await page.getByTestId("add-source").click();
    await page
      .getByTestId(`source-path-${index}`)
      .fill(paths[index % paths.length]);
  }
}

export async function setParameter(
  page: Page,
  id: string,
  value: string,
): Promise<void> {
  const control = page.getByTestId(`param-${id}`);
  if ((await control.count()) === 0) return;

  // Optional parameters live inside the collapsed advanced section, which has
  // to be open before anything in it can be filled.
  if (!(await control.isVisible())) {
    const advanced = page.getByTestId("advanced-toggle");
    if ((await advanced.count()) > 0) await advanced.click();
  }

  const shape = await describeControl(control);
  if (shape.tag === "SELECT") {
    await control.selectOption(value);
  } else if (shape.type === "checkbox") {
    await control.setChecked(value === "true");
  } else {
    await control.fill(value);
  }
}

async function describeControl(
  control: Locator,
): Promise<{ tag: string; type: string | null }> {
  return control.evaluate((element) => ({
    tag: element.tagName,
    type: element.getAttribute("type"),
  }));
}

/**
 * A value for a required parameter, chosen from its advertised type. A path
 * gets the weights fixture because a path parameter is what weights are; a
 * real producer rejects those bytes, which is a legitimate terminal state and
 * the reason the semantic assertions check the producer first.
 */
function valueFor(definition: CapabilityParameter | undefined): string {
  if (!definition) return "";

  switch (definition.value_type) {
    case "path":
      return FIXTURES.weights;
    case "url":
      // The fixture KServe responder the harness starts. A real remote is the
      // operator's, through NEURIPLO_UI_E2E_ENDPOINT.
      return (
        process.env.NEURIPLO_UI_E2E_ENDPOINT?.trim() || "http://127.0.0.1:5175"
      );
    case "enum":
      return definition.values?.[0] ?? "";
    case "boolean":
      return "false";
    case "integer":
      return String(definition.default ?? definition.minimum ?? 1);
    case "number":
      return String(definition.default ?? definition.minimum ?? 1);
    default:
      // A required free-text parameter is a prompt in everything but name, and
      // the fixture echoes it back as the label it predicted.
      return PROMPT;
  }
}
