# E2E fixtures

## `producer/`

A deterministic stand-in for `neuriplo-infer`. It implements the capabilities
and run-report contracts and nothing else: it loads no model and predicts
nothing, and everything it writes is a function of the arguments it was given.

The harness points `NEURIPLO_INFER_BIN` at it unless the operator configured a
real binary, which is what lets the suite run on a machine with no models, no
weights, and nothing compiled.

It advertises `producer.version` ending in `-fixture`. That suffix is the only
thing that distinguishes it from a real producer, and it is what the few
fixture-specific assertions check before running.

A run's outcome is decided by its source rather than by a flag outside the
contract: a source whose basename begins with `fail-<stage>` fails in that
stage and reports it; `fail-` followed by anything else fails as `unknown`.

## `assets/`

Committed, deterministic inputs. `sample-image.png`, `second-image.png`, and
the `fail-*.png` sources are real PNGs and decode in a browser.

`sample-video.mp4` and `fixture-weights.onnx` are placeholders: bytes with the
right names and nothing else. The adapter checks that a source exists and the
fixture producer copies it, so bytes are all either of them needs. Neither file
decodes, and nothing in the suite asks it to.

Running against a real `neuriplo-infer` therefore needs the operator's own
sources and weights, which is what `NEURIPLO_UI_BROWSE_ROOT` selects.
