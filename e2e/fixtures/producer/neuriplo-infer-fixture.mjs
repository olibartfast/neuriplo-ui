#!/usr/bin/env node

/**
 * A deterministic stand-in for `neuriplo-infer`.
 *
 * It implements the two contracts the adapter depends on — the capabilities
 * document and the run report — and nothing else. It loads no model, decodes
 * nothing, and predicts nothing: every byte it writes is a function of the
 * arguments it was given, which is the whole point. Inference is tested in
 * `neuriplo-infer`; what is tested here is the path from a contract to a
 * rendered run.
 *
 * Because it measures nothing real, its stage timings are constants. They are
 * still honest in the one way that matters: a value it genuinely does not have
 * — frames for a still image, stages after a failure — is written as null and
 * therefore renders as nothing at all.
 *
 * A run's outcome is decided by its source rather than by a flag outside the
 * contract: a source whose basename begins with `fail-<stage>` fails in that
 * stage. Everything else succeeds.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { CAPABILITIES, RUN_REPORT, resolveSelector } from "./contract.mjs";

const OUTPUT_DIRECTORY = "data/output";

/** Constant per-stage timings; see the note above on why they are constants. */
const STAGE_MS = {
  model_load: 40,
  preprocess: 2.5,
  inference: 10,
  postprocess: 1.5,
  render: 2.5,
};

const STAGE_ORDER = [
  "configuration",
  "model_load",
  "source",
  "preprocess",
  "inference",
  "postprocess",
  "render",
];

/** Frames the fixture claims to have read from a video source. */
const VIDEO_FRAMES = 24;

const argv = process.argv.slice(2);

// Exit through `process.exitCode` rather than `process.exit`, which can cut a
// pending write to a pipe short — and every write here goes to one.
if (argv.includes("--capabilities")) {
  process.stdout.write(`${JSON.stringify(CAPABILITIES, null, 2)}\n`);
} else {
  process.exitCode = await run(parseArguments(argv));
}

async function run(options) {
  const selector = options.type ?? "";
  const resolved = resolveSelector(selector);
  if (!resolved) {
    return fail(
      "configuration",
      `unknown model selector: ${selector || "(none)"}`,
    );
  }

  const { task, model } = resolved;

  // The adapter validates that required parameters are present; the producer
  // is what discovers that a path it was handed does not exist.
  if (options.weights !== undefined && !existsSync(options.weights)) {
    return fail("model_load", `weights not found: ${options.weights}`);
  }

  const sources = options.source ? options.source.split(",") : [];
  if (sources.length === 0) {
    return fail("source", "no source was supplied");
  }
  for (const source of sources) {
    if (!existsSync(source)) {
      return fail("source", `source not found: ${source}`);
    }
  }

  const requested = failureStageOf(sources);
  if (requested) {
    return fail(requested, `fixture failure requested in stage ${requested}`);
  }

  // A run writes its output relative to the current directory, which is the
  // private per-run directory the adapter created for it.
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const artifact = join(
    OUTPUT_DIRECTORY,
    `${basename(sources[0], extname(sources[0]))}_out${extname(sources[0])}`,
  );
  await copyFile(sources[0], artifact);

  const video = task.sources.types.includes("video");
  const frames = video ? VIDEO_FRAMES : null;
  const processed = frames ?? sources.length;

  await writeReport({
    schema_version: RUN_REPORT.schema_version,
    status: "success",
    stage: null,
    metrics: {
      wall_time_ms: total(STAGE_ORDER),
      samples: sources.length,
      frames,
      throughput_per_second:
        Math.round((processed / (STAGE_MS.inference / 1000)) * 100) / 100,
      stages_ms: { ...STAGE_MS },
    },
    error: null,
  });

  const result = {
    task: task.id,
    model: model.id,
    sources,
    artifact,
    predictions: predictionsFor(task.id, options),
  };

  if (options.output_format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    // Never begin a line with a bracket: a consumer that parses stdout as JSON
    // must be able to tell a text run from a JSON one by looking at it.
    process.stdout.write(
      `fixture: ${task.id} ${model.id} -> ${artifact}\n` +
        `fixture: ${sources.length} source(s), ${result.predictions.length} prediction(s)\n`,
    );
  }
  process.stderr.write(`fixture: completed ${task.id} with ${model.id}\n`);

  return 0;
}

/**
 * Fails in a named stage: the stages before it were reached and are reported,
 * the stage itself and everything after it were not and stay null.
 */
async function fail(stage, message) {
  const position = STAGE_ORDER.indexOf(stage);
  // An unattributed failure names no position in the pipeline, so nothing can
  // be claimed to have been reached.
  const reached =
    position < 0
      ? []
      : STAGE_ORDER.slice(0, position).filter((name) => name in STAGE_MS);

  await writeReport({
    schema_version: RUN_REPORT.schema_version,
    status: "failed",
    stage,
    metrics: {
      wall_time_ms: reached.length > 0 ? total(reached) : null,
      samples: null,
      frames: null,
      throughput_per_second: null,
      stages_ms: Object.fromEntries(
        Object.keys(STAGE_MS).map((name) => [
          name,
          reached.includes(name) ? STAGE_MS[name] : null,
        ]),
      ),
    },
    error: { stage, message },
  });

  process.stderr.write(`fixture: ${stage}: ${message}\n`);
  return 1;
}

async function writeReport(report) {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await writeFile(
    RUN_REPORT.path,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

/** `fail-<stage>-anything.png` requests a failure in `<stage>`. */
function failureStageOf(sources) {
  for (const source of sources) {
    const name = basename(source);
    if (!name.startsWith("fail-")) continue;
    const stage = RUN_REPORT.stages.find(
      (candidate) => name.slice("fail-".length).split(/[-.]/)[0] === candidate,
    );
    if (stage) return stage;
    // A `fail-` source naming no advertised stage is exactly the case the
    // report has `unknown` for: the producer failed and cannot attribute it.
    return "unknown";
  }
  return null;
}

function predictionsFor(taskId, options) {
  const confidence = Number(options.min_confidence ?? 0.25);
  const label = options.prompt?.split(",")[0]?.trim() || "fixture";

  if (taskId === "optical_flow") return [];
  return [
    { label, confidence: Math.max(confidence, 0.9), box: [8, 8, 24, 24] },
  ];
}

function total(stages) {
  return (
    Math.round(
      stages.reduce((sum, name) => sum + (STAGE_MS[name] ?? 0), 0) * 100,
    ) / 100
  );
}

/** `--flag=value` and bare `--flag`, which is how the adapter spawns them. */
function parseArguments(args) {
  const options = {};
  for (const argument of args) {
    if (!argument.startsWith("--")) continue;
    const body = argument.slice(2);
    const separator = body.indexOf("=");
    if (separator === -1) {
      options[body] = "true";
      continue;
    }
    options[body.slice(0, separator)] = body.slice(separator + 1);
  }
  return options;
}
