#!/bin/bash
# P3-06 continued: the nert pass (yoloseg, rfdetrseg, videomae, vivit,
# timesformer, raft, rfdetrpose, depth_anything_v2, owlvit, rtdetrul) is owned
# by the still-running rerun-nert.sh from the interrupted first pass. Wait for
# it to finish, then run the seven remaining libtorch/opencv_dnn cells
# sequentially on the same 5-minute budget (port 5182, 300000 ms).
set -u
cd /home/oli/repos/neuriplo-ui || exit 1
pkt=specs/2026-10-30-matrix-coverage/packets/p3-06-rerun
mkdir -p "$pkt/logs"
summary="$pkt/logs/summary-libtorch-opencv.tsv"
printf 'cell\tstarted_utc\texit\tstatus\trun_id\tduration_ms\n' >"$summary"

echo "WAIT_NERT $(date -u +%FT%TZ)"
while pgrep -f "artifacts/model-matrix/triage-rerun/rerun-nert.sh" >/dev/null 2>&1; do
  sleep 10
done
echo "NERT_DONE $(date -u +%FT%TZ)"

wait_idle() {
  container=$1
  for _ in $(seq 1 90); do
    if ! docker exec "$container" sh -c 'pgrep -f "/app/neuriplo-infer" >/dev/null 2>&1'; then
      return 0
    fi
    sleep 2
  done
  echo "WARN $container still busy" >&2
  return 0
}

run_cell() {
  backend=$1; model=$2; container=$3
  log="$pkt/logs/${backend}-${model}.log"
  started=$(date -u +%FT%TZ)
  echo "START ${backend}/${model} ${started}"
  wait_idle "$container"
  BACKEND="$backend" MODELS="$model" FORCE_MODELS="$model" UI_PORT=5182 \
    node artifacts/model-matrix/browser-matrix.mjs >"$log" 2>&1
  code=$?
  echo "EXIT=${code} END $(date -u +%FT%TZ)" >>"$log"
  row=$(python3 - "$backend" "$model" <<'PY'
import json,sys
backend,model=sys.argv[1],sys.argv[2]
try:
    d=json.load(open(f'artifacts/model-matrix/{backend}/results.json'))
except Exception as e:
    print('MISSING\t'+str(e)); raise SystemExit
for r in d['results']:
    if r['model']==model:
        print('\t'.join(str(r.get(k,'')) for k in ('status','run_id','duration_ms')))
        break
else:
    print('NO_ROW\t\t')
PY
)
  printf '%s/%s\t%s\t%s\t%s\n' "$backend" "$model" "$started" "$code" "$row" >>"$summary"
  echo "DONE ${backend}/${model} exit=${code} ${row}"
}

run_cell libtorch videomae neuriplo-ui-validate-libtorch
run_cell libtorch vivit neuriplo-ui-validate-libtorch
run_cell libtorch timesformer neuriplo-ui-validate-libtorch

run_cell opencv_dnn groundingdino friendly_albattani
run_cell opencv_dnn videomae friendly_albattani
run_cell opencv_dnn vivit friendly_albattani
run_cell opencv_dnn timesformer friendly_albattani

echo "DRIVER_DONE $(date -u +%FT%TZ)"
