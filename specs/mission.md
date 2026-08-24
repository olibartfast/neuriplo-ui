# Mission

## Purpose

Neuriplo UI provides a thin web interface over the Neuriplo inference pipeline and a reproducible end-to-end test harness for exercising that pipeline from a user-facing workflow.

The product should make it easy to answer a simple question: **can a selected task, model, execution workflow, and source successfully run through Neuriplo and produce the expected result?**

## Primary goals

1. Let a user configure an inference run by selecting:
   - task;
   - model;
   - execution workflow: a specified local inference backend or a client-server workflow;
   - source.
2. Launch the corresponding `neuriplo-infer` pipeline without exposing CLI complexity in the browser.
3. Surface the important outputs of a run:
   - success or failure;
   - rendered or structured result;
   - latency and basic performance data;
   - stdout/stderr and diagnostic logs;
   - generated artifacts.
4. Make the same workflow automatable through browser E2E tests.
5. Keep `neuriplo-infer` as the source of truth for supported capabilities and inference behavior.

## Architectural principle

Dependency direction is intentionally one-way:

```text
neuriplo-ui
    -> local API adapter
        -> neuriplo-infer
            -> neuriplo
            -> neuriplo-tasks
            -> videocapture
```

`neuriplo-infer` must remain independently usable without the UI. Neuriplo UI should consume a stable, machine-readable contract rather than duplicate task or backend registries.

Execution topology is a first-class part of that contract. A remote client-server workflow is an alternative to choosing a local backend, not another local backend value. For the current KServe V2 integration, the remote branch selects endpoint, model name/version, and HTTP or gRPC transport while preprocessing and postprocessing remain in `neuriplo-infer`.

## Target users

- Neuriplo developers validating inference changes.
- Developers comparing models and backends.
- Contributors reproducing bugs across the complete pipeline.
- Users who want to run supported inference workflows without constructing CLI commands manually.

## Non-goals

The initial project is not intended to be:

- a replacement for `neuriplo-infer`;
- a model training UI;
- a general-purpose MLOps platform;
- a model registry or artifact store;
- a mandatory dependency of any Neuriplo C++ component;
- a place where task/backend capability lists are maintained independently.

## Success criteria

The first meaningful release is complete when a browser test can select a valid pipeline configuration, submit a source, run the real `neuriplo-infer` executable, and assert a successful structured result plus its output artifact.
