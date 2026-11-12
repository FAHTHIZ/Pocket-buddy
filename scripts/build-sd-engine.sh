#!/usr/bin/env bash
# Builds the on-device image/video engine (stable-diffusion.cpp sd-cli, MIT) for Android ARM64.
#
# Two executables are produced and later bundled as lib*.so so Android extracts them to
# nativeLibraryDir, where the app can run them as a child process:
#   libsdcli.so         ARMv8.2-A + dot product + FP16 (Helio G85, most phones since 2018)
#   libsdcli_compat.so  baseline ARMv8.0-A for older chips
#
# Usage: ANDROID_NDK_HOME=/path/to/ndk scripts/build-sd-engine.sh [output-dir]
set -euo pipefail

SD_COMMIT="${SD_COMMIT:-32d516c0197ed5ca31305b8575e14eb1451fad33}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/android/.gradle/sd-engine/jniLibs/arm64-v8a}"
WORK="${SD_WORK_DIR:-$ROOT/android/.gradle/sd-engine/src}"
NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-${ANDROID_NDK:-}}}"
if [ -z "$NDK" ] || [ ! -f "$NDK/build/cmake/android.toolchain.cmake" ]; then
  echo "Set ANDROID_NDK_HOME to an Android NDK (r26 or newer)." >&2
  exit 1
fi

if [ ! -d "$WORK/.git" ]; then
  rm -rf "$WORK"; mkdir -p "$WORK"
  git -C "$WORK" init -q
  git -C "$WORK" remote add origin https://github.com/leejet/stable-diffusion.cpp.git
fi
if [ "$(git -C "$WORK" rev-parse HEAD 2>/dev/null || true)" != "$SD_COMMIT" ]; then
  for attempt in 1 2 3 4; do
    git -C "$WORK" fetch -q --depth 1 origin "$SD_COMMIT" && break
    echo "fetch attempt $attempt failed; retrying"; sleep $((attempt * 15))
  done
  git -C "$WORK" checkout -q --force FETCH_HEAD
  git -C "$WORK" submodule update -q --init --recursive --depth 1
fi

build_variant() {
  local name="$1" arch="$2" dir="$WORK/build-$1"
  cmake -S "$WORK" -B "$dir" -G Ninja -Wno-dev \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24 \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
    -DGGML_CPU_ARM_ARCH="$arch" \
    -DSD_BUILD_EXAMPLES=ON -DSD_WEBP=OFF -DSD_WEBM=OFF >/dev/null
  cmake --build "$dir" --target sd-cli -j "$(nproc)"
  local bin
  bin="$(find "$dir" -type f -name sd-cli -perm -u+x | head -1)"
  [ -n "$bin" ] || { echo "sd-cli was not produced for $name" >&2; exit 1; }
  mkdir -p "$OUT"
  "$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip" -o "$OUT/$name" "$bin"
  echo "built $OUT/$name ($(du -h "$OUT/$name" | cut -f1))"
}

build_variant libsdcli.so "armv8.2-a+dotprod+fp16"
build_variant libsdcli_compat.so "armv8-a"
echo "$SD_COMMIT" > "$OUT/../SD_COMMIT"
