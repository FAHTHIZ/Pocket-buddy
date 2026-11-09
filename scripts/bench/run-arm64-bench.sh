#!/usr/bin/env bash
# Real measurements of Pocket Buddy's previous inference settings against the adaptive engine, on
# a GitHub ARM64 runner. The MoE section runs inside a cgroup that limits RAM to the inference
# budget the planner computes for a 6 GB phone and throttles reads to eMMC 5.1 speed. This is an
# emulation on server-class ARM cores (Neoverse), not a phone: absolute numbers will differ.
set -uo pipefail
WORK=${WORK:-$HOME/pb-bench}; OUT=${OUT:-$PWD/bench-results}; mkdir -p "$WORK" "$OUT"
LLAMA_TAG=${LLAMA_TAG:-b12211}; BMOE_VER=0.40.2
QWEN_URL=https://huggingface.co/atakhadivi/Qwen3.8-2B-Uncensored-GGUF/resolve/main/Qwen3.8-2B-Uncensored-Q4_K_M.gguf
LFM_URL=https://huggingface.co/mradermacher/Huihui-LFM2-8B-A1B-abliterated-i1-GGUF/resolve/main/Huihui-LFM2-8B-A1B-abliterated.i1-IQ4_XS.gguf
LFM_SHA=4ab7d5d7c3b5d89ded2f577dbfb6fe29475c34c6abc17b5f11d0920ae916f30f
MEM_BUDGET=${MEM_BUDGET:-2468M}     # planner's Balanced budget on a 6 GB phone (5650 MB visible)
EMMC_BW=${EMMC_BW:-250M}            # eMMC 5.1 sequential read class
HERE=$(cd "$(dirname "$0")" && pwd)
log(){ echo "[$(date +%H:%M:%S)] $*"; }
cd "$WORK"
lscpu > "$OUT/lscpu.txt"; free -m > "$OUT/free.txt"; nproc > "$OUT/nproc.txt"

log "building llama.cpp $LLAMA_TAG (CPU, native ARM64)"
if [ ! -x llama.cpp/build/bin/llama-server ]; then
  curl -fsSL "https://github.com/ggml-org/llama.cpp/archive/refs/tags/$LLAMA_TAG.tar.gz" | tar xz && mv "llama.cpp-$LLAMA_TAG" llama.cpp
  cmake -S llama.cpp -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF >/dev/null
  cmake --build llama.cpp/build -j"$(nproc)" --target llama-server llama-bench >/dev/null
fi
LS=$WORK/llama.cpp/build/bin/llama-server; LB=$WORK/llama.cpp/build/bin/llama-bench
log "fetching bmoe $BMOE_VER linux-aarch64"
if [ ! -d bmoe ]; then mkdir bmoe && curl -fsSL "https://github.com/Helldez/BigMoeOnEdge/releases/download/v$BMOE_VER/bmoe-cli-v$BMOE_VER-linux-aarch64.tar.gz" | tar xz -C bmoe --strip-components=1; fi
BS=$(find "$WORK/bmoe" -name bmoe-server -type f | head -1); BDIR=$(dirname "$BS")
log "fetching models"
[ -f qwen.gguf ] || curl -fsSL -o qwen.gguf "$QWEN_URL"
[ -f lfm.gguf ] || curl -fsSL -o lfm.gguf "$LFM_URL"
echo "$LFM_SHA  lfm.gguf" | sha256sum -c - || exit 1
python3 "$HERE/gguf_probe.py" qwen.gguf lfm.gguf | tee "$OUT/architecture.txt"

PROMPT="In three sentences, explain why the sea looks blue."
CORES=$(nproc)
# llama.rn's default on Android: 2 threads when the phone reports 4 cores, else min(4, cores).
BASE_T=$([ "$CORES" -eq 4 ] && echo 2 || echo $(( CORES < 4 ? CORES : 4 )))
drop_caches(){ sync; echo 3 | sudo tee /proc/sys/vm/drop_caches >/dev/null; }
wait_http(){ for _ in $(seq 1 900); do curl -fs -H "Authorization: Bearer ${2:-x}" "$1" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }
hwm(){ awk '/VmHWM/{print $2/1024}' "/proc/$1/status" 2>/dev/null || echo 0; }

# ---------------- dense: Qwen3.8 2B ----------------
log "llama-bench thread sweep (dense)"
"$LB" -m qwen.gguf -p 128 -n 64 -t $(seq -s, 1 "$CORES") -fa 0,1 -r 3 -o json > "$OUT/dense-llama-bench.json" 2> "$OUT/dense-llama-bench.err" || true
BEST_T=$(python3 - "$OUT/dense-llama-bench.json" <<'PY'
import json,sys
try: rows=json.load(open(sys.argv[1]))
except Exception: print(0); sys.exit()
tg=[r for r in rows if r.get("n_gen",0)>0 and r.get("flash_attn") in (True,1)]
best=max(tg,key=lambda r:r["avg_ts"]) if tg else None
print(best["n_threads"] if best else 0)
PY
)
[ "$BEST_T" -gt 0 ] 2>/dev/null || BEST_T=$CORES
log "dense: baseline threads=$BASE_T adaptive threads=$BEST_T"
run_dense(){ # label, args...
  local label=$1; shift
  drop_caches
  local t0=$(date +%s.%N)
  "$LS" -m qwen.gguf --port 8091 --host 127.0.0.1 "$@" > "$OUT/dense-$label.log" 2>&1 & local pid=$!
  wait_http http://127.0.0.1:8091/health || { echo "{\"label\":\"$label\",\"error\":\"server did not start\"}" >> "$OUT/dense.jsonl"; kill $pid; return; }
  local load=$(python3 -c "import time;print(round(time.time()-$t0,2))")
  local cold=$(python3 "$HERE/chat_probe.py" http://127.0.0.1:8091 "" "$PROMPT" 64)
  local warm=$(python3 "$HERE/chat_probe.py" http://127.0.0.1:8091 "" "$PROMPT" 64)
  echo "{\"label\":\"$label\",\"load_s\":$load,\"peak_rss_mb\":$(hwm $pid),\"cold\":$cold,\"warm\":$warm}" >> "$OUT/dense.jsonl"
  kill $pid; wait $pid 2>/dev/null
}
: > "$OUT/dense.jsonl"
run_dense existing -c 4096 -b 256 -ub 256 -np 1 -fa off -t "$BASE_T" --no-warmup
# Same old settings but the tuned thread count, to separate the thread effect from the rest.
run_dense existing-tuned-threads -c 4096 -b 256 -ub 256 -np 1 -fa off -t "$BEST_T" --no-warmup
run_dense adaptive -c 4096 -b 256 -ub 256 -np 1 -fa auto -t "$BEST_T" -tb "$CORES"

# ---------------- MoE: LFM2 8B-A1B under a 6 GB-phone budget ----------------
DEV=$(lsblk -no pkname "$(findmnt -no SOURCE --target "$WORK")" 2>/dev/null | head -1); DEV=/dev/${DEV:-sda}
log "MoE runs: MemoryMax=$MEM_BUDGET IOReadBandwidthMax=$DEV $EMMC_BW"
IO_PROP=(-p "IOReadBandwidthMax=$DEV $EMMC_BW")
if ! sudo systemd-run --quiet --scope "${IO_PROP[@]}" true 2>/dev/null; then echo "io throttling unavailable; RAM limit only" | tee "$OUT/io-throttle-unavailable.txt"; IO_PROP=(); fi
SCOPE=(sudo systemd-run --quiet --scope -p MemoryMax=$MEM_BUDGET -p MemorySwapMax=0 "${IO_PROP[@]}" --uid="$(id -u)" --gid="$(id -g)")
echo key-for-bench > "$WORK/key"; echo '{"version":1,"about":"bench","models":[]}' > "$WORK/cat.json"
run_moe(){ # label, kind(llama|bmoe), args...
  local label=$1 kind=$2; shift 2
  drop_caches; mkdir -p "$WORK/bmdata"
  local t0=$(date +%s.%N) url key=""
  if [ "$kind" = llama ]; then
    "${SCOPE[@]}" --setenv=LD_LIBRARY_PATH="$(dirname "$LS")" "$LS" -m lfm.gguf --port 8092 --host 127.0.0.1 "$@" > "$OUT/moe-$label.log" 2>&1 &
    url=http://127.0.0.1:8092; wait_http $url/health || true
  else
    "${SCOPE[@]}" --setenv=LD_LIBRARY_PATH="$BDIR" "$BS" --port 8092 --data-dir "$WORK/bmdata" --catalog "$WORK/cat.json" --api-key-file "$WORK/key" --chat-only -m "$WORK/lfm.gguf" "$@" > "$OUT/moe-$label.log" 2>&1 &
    url=http://127.0.0.1:8092; key=key-for-bench
    for _ in $(seq 1 1200); do s=$(curl -fs -H "Authorization: Bearer $key" $url/api/info | python3 -c "import json,sys;print(json.load(sys.stdin)['state'])" 2>/dev/null); [ "$s" = ready ] || [ "$s" = error ] && break; sleep 1; done
  fi
  local pid=$(pgrep -n -x llama-server || pgrep -n -x bmoe-server)
  local load=$(python3 -c "import time;print(round(time.time()-$t0,2))")
  local cold=$(timeout 1800 python3 "$HERE/chat_probe.py" $url "$key" "$PROMPT" 48 || echo '{"error":"request failed"}')
  local warm=$(timeout 1800 python3 "$HERE/chat_probe.py" $url "$key" "$PROMPT" 48 || echo '{"error":"request failed"}')
  local oom=$(grep -c -i "killed\|out of memory" "$OUT/moe-$label.log" || true)
  echo "{\"label\":\"$label\",\"load_s\":$load,\"peak_rss_mb\":$(hwm ${pid:-0}),\"oom_lines\":$oom,\"cold\":$cold,\"warm\":$warm}" >> "$OUT/moe.jsonl"
  sudo pkill -f "port 8092"; sleep 3
}
: > "$OUT/moe.jsonl"
run_moe existing-mmap llama -c 4096 -b 256 -ub 256 -np 1 -fa off -t "$BASE_T" --no-warmup
# Exactly the argument sets Pocket Buddy's planner emits for a 6 GB eMMC phone (Balanced, and Automatic).
# The data folder is kept between the two runs, as on the phone, so the second launch can use the routing record.
rm -rf "$WORK/bmdata"
run_moe stream-explicit bmoe --moe-stream -c 4096 --temp 0.7 --top-p 0.9 -t "$CORES" --threads-batch "$CORES" --io-threads 2 --cache-mb 1636 --overlap
run_moe stream-auto bmoe --moe-stream -c 4096 --temp 0.7 --top-p 0.9 --cache-mb auto --cache-floor-mb 512 --cache-ceil-mb 1636
log "done"; cat "$OUT"/dense.jsonl "$OUT"/moe.jsonl
