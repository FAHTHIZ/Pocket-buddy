#!/usr/bin/env bash
set -euo pipefail

startup_log="android-startup.log"
exit_file="emulator-smoke.exit"

capture_diagnostics() {
  local code=$?
  printf '%s\n' "$code" > "$exit_file"
  adb logcat -d > "$startup_log" 2>/dev/null || true
  echo "Emulator smoke test exit code: $code"
  exit "$code"
}
trap capture_diagnostics EXIT

echo "Smoke test started at $(date -u +%FT%TZ)"
adb wait-for-device

boot_completed="$(adb shell getprop sys.boot_completed | tr -d '\r')"
if [ "$boot_completed" != "1" ]; then
  echo "Android emulator did not finish booting."
  exit 1
fi

adb logcat -c
adb install -r PocketBuddy-smoke.apk
adb shell am start -W -n ai.pocketbuddy/com.pocketbuddy.MainActivity

# Fail with the actual Android exception instead of waiting until the launcher
# replaces a crashed activity and reporting only that the Activity disappeared.
sleep 3
adb logcat -d > "$startup_log"
if grep -E 'Process: ai\.pocketbuddy|Unable to start activity ComponentInfo\{ai\.pocketbuddy|ReactNativeJS.*(Error|error)|Unable to load script' "$startup_log"; then
  echo "Pocket Buddy emitted a startup crash or JavaScript bundle error."
  exit 1
fi

process_id="$(adb shell pidof ai.pocketbuddy | tr -d '\r' || true)"
if [ -z "$process_id" ]; then
  echo "Pocket Buddy process did not remain alive after launch."
  adb shell dumpsys activity top || true
  tail -n 120 "$startup_log" || true
  exit 1
fi

sleep 20
process_id="$(adb shell pidof ai.pocketbuddy | tr -d '\r' || true)"
if [ -z "$process_id" ]; then
  echo "Pocket Buddy exited during the post-launch stability window."
  adb logcat -d > "$startup_log"
  grep -E 'FATAL EXCEPTION|Process: ai\.pocketbuddy|Unable to start activity ComponentInfo\{ai\.pocketbuddy|ReactNativeJS.*(Error|error)|Unable to load script' "$startup_log" | tail -n 80 || true
  exit 1
fi

activity_state="$(adb shell dumpsys activity activities)"
if ! printf '%s\n' "$activity_state" | grep -F 'ai.pocketbuddy' >/dev/null; then
  echo "ActivityManager did not report Pocket Buddy as an active app."
  adb shell dumpsys activity top || true
  exit 1
fi

adb logcat -d > "$startup_log"
if grep -E 'FATAL EXCEPTION|Process: ai\.pocketbuddy|Unable to start activity ComponentInfo\{ai\.pocketbuddy|ReactNativeJS.*(Error|error)|Unable to load script' "$startup_log"; then
  echo "Android startup log contains a fatal or JavaScript launch error."
  exit 1
fi

echo "Standalone APK installed and remained active for the smoke-test window."
