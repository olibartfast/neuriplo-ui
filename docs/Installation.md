# Installation

The installer provisions the web app and one selected inference backend. Native
and Docker installations use the same dependency resolver and native build
procedure. Run it as your normal user; system packages request `sudo` as needed.

Automatic provisioning targets Ubuntu 24.04 on x86_64. Internet access is needed
for installation. Model weights and input data are supplied separately.

Use `install.sh` from a repository checkout or
[download it](https://raw.githubusercontent.com/olibartfast/neuriplo-ui/master/install.sh)
and run it with Bash. The standalone script bootstraps its own checkout and
missing Git/Python prerequisites; you do not need to prepare Node or SDKs.

## Native

```bash
bash install.sh --style native --backend onnx_runtime --start
```

This installs build tools and system libraries, a private Node 22 LTS runtime,
locked npm packages, clean released C++ components and the selected SDK. It builds
the runtime, records a clean-build provenance report, builds the frontend and API,
and starts the app at `http://127.0.0.1:5173`.

The default installation lives under
`~/.local/share/neuriplo-ui/native-onnx_runtime`. Start it again with:

```bash
~/.local/share/neuriplo-ui/native-onnx_runtime/bin/neuriplo-ui
```

The launcher serves the built frontend and API in one process. It checks the
installed executable hash and stops the app's inference processes when you exit.
No Node setup, environment exports or Vite development server are needed.

## Docker

```bash
bash install.sh --style docker --backend onnx_runtime --start
```

If Docker Engine is missing, the installer sets up Docker's official Ubuntu
repository and installs it. It builds the image from the same native installer,
then generates a launcher under
`~/.local/share/neuriplo-ui/docker-onnx_runtime/neuriplo-ui-docker`.

The host workspace is mounted at `/workspace`, and the web port is published on
loopback only. The generated launcher uses your host UID/GID, so generated files
do not become root-owned. The image also defaults to a non-root user.

Installation contexts contain tracked application files and installer files;
Git metadata, ignored files, media and private working notes are not copied.
Repository checkouts inside the image come from GitHub. Optional GitHub tokens
are passed as BuildKit secrets, not image build arguments.

## Select dependencies

Choose one backend for each installation prefix:

| `--backend` | Provisioned runtime |
| --- | --- |
| `onnx_runtime` | ONNX Runtime CPU binary SDK. |
| `openvino` | OpenVINO SDK from its pinned PyPI wheel, in a private Python environment. |
| `tensorrt` | TensorRT SDK and the CUDA toolkit. |
| `executorch` | ExecuTorch source build with XNNPACK. This can take substantially longer. |
| `opencv_dnn` | The recommended OpenCV release, built from source with DNN support. |
| `nert` | The first-party NERT backend fetched by the released core library. |

The installer resolves the latest `neuriplo-infer`, `neuriplo` and
`neuriplo-tasks` releases independently. Vendor SDK versions come from that core
release's `versions.env`; they are not guessed from the application version.
Other sibling dependencies follow the inference release's pins. Exact commits,
SDK pins and executable hashes are recorded in the installation directory.

ONNX Runtime uses the CPU distribution. OpenVINO is provisioned for CPU execution.
TensorRT is the NVIDIA GPU profile. Models must match the selected SDK and task;
installing a runtime does not validate every supported model.

All installations include the KServe V2 HTTP client. Add `--grpc` to install its
additional system dependencies and enable gRPC. A remote model server is supplied
separately; the [repository map](../README.md#repositories) links the first-party
server and client.

For a remote server outside loopback, supply `--remote-allow HOST[:PORT]` at
installation time (comma-separated for multiple servers). Docker launchers
include `host.docker.internal` for accessing a server on the host. Select the
client-server workflow and enter the endpoint in the UI; deploying the model
server is a separate operation.

HTTP and gRPC inference have been exercised against a real KServe-compatible
server with YOLO26. For gRPC, install with `--grpc`, select the gRPC transport
and supply that server's gRPC endpoint and port. The metadata panel currently
queries HTTP/HTTPS only: a `grpc://` endpoint can run inference while metadata
inspection reports that it is unavailable. The UI does not guess a separate
HTTP metadata port.

### OpenCV DNN inputs

OpenCV DNN requires explicit input sizes. For the tested YOLO26s ONNX model,
open Advanced controls and set **Input sizes** to `3,640,640`; batch size remains
`1`. Use the dimensions required by your own model. The current capability
contract does not mark this parameter as required specifically for OpenCV, so
omitting it currently produces a model-setup error after launch.

OpenCV 5's default DNN engine is CPU-only in the released integration; keep
**Use GPU** disabled for this profile. TensorRT is the validated NVIDIA profile.

### NVIDIA setup

A host driver compatible with the selected CUDA/TensorRT release is needed for TensorRT. If none is present, the installer
can install it with `--install-driver`; reboot and rerun the same command after
the driver installation. An existing working driver is left in place.

For Docker GPU installations, a missing NVIDIA Container Toolkit is provisioned
automatically. Configuring it requires a Docker daemon restart. If containers
are running, the installer stops before changing the daemon; pass
`--allow-docker-restart` when that interruption is acceptable.

## Other options

```bash
# Inspect the plan without installing anything.
bash install.sh --style docker --backend openvino --dry-run

# Keep models and inputs in a chosen workspace, and use a different web port.
bash install.sh --style native --backend openvino \
  --data-dir "$HOME/vision-data" --port 5180 --start

# Install into a chosen prefix and include browser-test dependencies.
bash install.sh --style native --backend onnx_runtime \
  --prefix "$HOME/neuriplo-local" --with-tests
```

OpenCV DNN and ExecuTorch compile their SDKs from source and can take
substantially longer than installing a binary SDK. TensorRT also downloads the
CUDA toolkit and a multi-gigabyte SDK archive.

`--jobs` limits SDK and inference application compilation parallelism
(default: at most four jobs).
The Node runtime and SDKs live in the chosen prefix. System packages are installed
through apt. The installer refuses to overwrite an unrelated, nonempty prefix.
A completed native installation can be reused after its runtime and provenance
checks pass; a changed binary is rejected. Use a fresh prefix for a new backend
or an updated release set. Failed installations keep diagnostic output and are
not presented as ready installations.

Keep model weights and inputs in the workspace (`~/Neuriplo` by default) so the
file picker can access them. The workspace is separate from software installation
prefixes. Native launchers accept `--data-dir`, `--port` and an explicit `--host`;
Docker's published port is selected at installation time.

## Validation scope

The following fresh Ubuntu 24.04 installations completed real inference through
Chrome after passing the clean-build provenance gate. Checks included input
selection, a fully visible result preview and artifact download.

| Backend | SDK/runtime | Installation tested | Model |
| --- | --- | --- | --- |
| ONNX Runtime CPU | 1.28.0 | Docker, including automatic Docker Engine installation in a fresh VM | YOLO26s |
| OpenVINO CPU | 2026.3.0 | Native | YOLO26s |
| TensorRT | 11.2.1.2 | Docker on an existing NVIDIA host; fresh engine built with the installed SDK | YOLO26s |
| NERT CPU (experimental) | 0.2.0 | Docker | YOLO26s |
| ExecuTorch CPU / XNNPACK | 1.2.0 | Docker | YOLOv8n |
| OpenCV DNN CPU | 5.0.0, native DNN engine | Docker | YOLO26s, input sizes `3,640,640` |

Client-server HTTP and gRPC runs also completed against a real server with
YOLO26. CI installs and starts ONNX Runtime with gRPC, OpenVINO and NERT CPU
profiles; its startup checks are separate from the real-model browser checks.
Results cover the listed models and execution paths, not every task/model pair.

Automatic NVIDIA driver and Container Toolkit provisioning remain unvalidated
on a fresh NVIDIA host; the GPU test host already had both installed. GPU tests
used an RTX 3060 Laptop (6 GiB) with driver 610.43.02.
