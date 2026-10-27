#!/usr/bin/env bash
# Bootstrap only the tools needed to run the installer. SDKs live in its prefix.
set -euo pipefail
script_source="${BASH_SOURCE[0]:-}"
script_dir=""
if [[ -n "$script_source" && -f "$script_source" ]]; then
  script_dir="$(cd -- "$(dirname -- "$script_source")" && pwd)"
fi
for arg in "$@"; do
  if [[ "$arg" == --help || "$arg" == -h ]]; then
    if command -v python3 >/dev/null 2>&1 && [[ -n "$script_dir" && -f "$script_dir/scripts/install.py" ]]; then
      exec python3 "$script_dir/scripts/install.py" "$@"
    fi
    echo 'Usage: ./install.sh --style native|docker --backend onnx_runtime|openvino|tensorrt|executorch|opencv_dnn|nert [--prefix DIR] [--dry-run] [--start]'
    exit 0
  fi
done
missing=()
for cmd in python3 git curl xz; do command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd"); done
if ((${#missing[@]})); then
  for arg in "$@"; do
    if [[ "$arg" == --dry-run ]]; then
      echo "Bootstrap would install: python3 git curl xz-utils ca-certificates"
      exit 0
    fi
  done
  [[ -r /etc/os-release ]] || { echo 'Automatic bootstrap requires Ubuntu 24.04.' >&2; exit 1; }
  . /etc/os-release
  [[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'Automatic bootstrap requires Ubuntu 24.04.' >&2; exit 1; }
  privilege=()
  if [[ "$EUID" != 0 ]]; then privilege=(sudo); fi
  "${privilege[@]}" apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 update
  "${privilege[@]}" apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 install -y --no-install-recommends python3 git curl xz-utils ca-certificates
fi
if [[ -n "$script_dir" && -f "$script_dir/scripts/install.py" ]]; then
  exec python3 "$script_dir/scripts/install.py" "$@"
fi
bootstrap_dir="$(mktemp -d -t neuriplo-bootstrap.XXXXXXXX)"
trap 'rm -rf -- "$bootstrap_dir"' EXIT
git clone --depth 1 https://github.com/olibartfast/neuriplo-ui.git "$bootstrap_dir/ui"
python3 "$bootstrap_dir/ui/scripts/install.py" "$@"
