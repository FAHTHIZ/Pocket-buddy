# Adaptive hardware engine and MoE expert streaming

Pocket Buddy ships one ARM64 APK for every phone. On each load it looks at the phone it is running on and at the model file, then picks the engine and settings. It does not use device names anywhere. The decisions below are in `src/services/hardware.ts` (`planInference`), `src/services/llm.ts`, `android/app/src/main/java/com/pocketbuddy/PocketBuddyHardwareModule.kt` and `PocketBuddyMoeModule.kt`.

## What was studied

- **[BigMoeOnEdge](https://github.com/Helldez/BigMoeOnEdge)** (Apache-2.0) is a llama.cpp fork for Android. It keeps the dense part of a Mixture-of-Experts model resident and reads only the routed experts from flash. It has a bounded LRU expert cache, a routing history used to prefetch experts, parallel asynchronous reads (`--io-threads`) overlapped with compute (`--overlap`), and a planner (`--auto`) that measures threads and read lanes on the device. It exposes all of this through an OpenAI-compatible server. This is the approach Pocket Buddy integrates.
- **[colibri](https://github.com/JustVugg/colibri)** is a pure-C engine built on the same idea: dense weights resident, experts streamed from disk per token. It targets very large models (hundreds of billions of parameters) on desktop machines with 8 GB+ RAM and uses its own model packaging. Pocket Buddy adopts its principles rather than its code. Experts are streamed only for real MoE models. Precision and router semantics never change silently. Every optimisation must be backed by a reproducible measurement. Its runtime was not embedded because Pocket Buddy's models are plain GGUF files and already run through llama.cpp.

## Architecture first

Before anything else Pocket Buddy reads the GGUF header natively (`GgufInspector`, about 0.3 s). It records the architecture, expert count, experts used per token, the bytes taken by expert tensors versus dense tensors, the layer count, the attention layout and the context length.

| Model | Detected as | Engine |
|---|---|---|
| Qwen3.8 2B Uncensored (default, `qwen35`) | dense, no expert tensors | llama.rn (unchanged backend) |
| Qwen3.8 4B, Qwen3 0.6B, any dense GGUF | dense | llama.rn |
| LFM2.5 8B-A1B (`lfm2moe`, 32 experts, 4 per token) on a 6 GB phone | MoE, larger than the RAM budget | MoE expert streaming |
| The same MoE model on a 12 GB phone | MoE, fits in the RAM budget | llama.rn, fully in memory |

Expert streaming is never applied to a dense model. A MoE model that fits in the RAM budget also runs normally, because streaming only helps when the weights do not fit.

## Hardware detection

`PocketBuddyHardware.probe()` reads:

- CPU cores and their part numbers and maximum frequencies from `/proc/cpuinfo` and `cpufreq`. Cores are split into fast and efficiency clusters; Cortex-A35/A53/A55/A510/A520 count as efficiency cores.
- The ARM features `asimddp` (dotprod), `i8mm`, `sve` and `fphp` (fp16).
- Total, available and threshold RAM from `ActivityManager.MemoryInfo`, plus the process RSS.
- The storage type (eMMC or UFS) from block-device sysfs.
- The GPU renderer, battery level, charging state, Android battery saver and the thermal status (Android 10+).

It also reports runtime events: thermal status changes, `onTrimMemory` and `onLowMemory`.

## Profiles

Settings → On-device → Performance offers **Automatic** (the default), **Battery Saver**, **Balanced** and **Maximum Performance**. Automatic resolves as follows:

- Android battery saver on, battery below 20% and not charging, or severe thermal status → Battery Saver.
- Charging and cool → Maximum Performance.
- Otherwise → Balanced.

The profile is re-evaluated between messages. When Android reports memory pressure, the context is re-planned and the model reloads with a smaller context if needed.

## Memory policy

Inference never gets all the RAM:

- Reserve for Android and other apps = max(1536 MB, 25% of total RAM).
- Ceiling = total − reserve.
- Budget = a share of the ceiling (Battery 45%, Balanced 60%, Maximum 75%), raised to the RAM that is free right now when that is larger, and never above the ceiling. Battery Saver is additionally capped by the RAM that is free right now.

Example: a 6 GB phone that reports about 5.6 GB total gets a 1536 MB reserve and a Balanced budget of about 2.4 GB.

## Context and KV cache

The context window is the largest of 2K/4K/8K/16K that fits in 60% of the budget left after weights and compute buffers. The profile caps it: Battery 2K, Balanced 4K, Maximum 8K, or 16K on phones with 11 GB+.

KV size is computed from the model itself. Hybrid models (Qwen3.5/3.6 Gated DeltaNet, LFM2) only keep KV on their attention layers. If f16 KV does not fit, Pocket Buddy switches to q8_0 KV with flash attention. Context can still be set manually.

## Threads and scheduling

The starting thread count is the number of fast cores, plus up to two efficiency cores when there are only two fast cores. **Benchmark this phone** sweeps the thread count and saves the fastest stable value for that hardware and model, and the next load uses it. Thermal status ≥2 drops one thread and ≥3 drops two. Battery Saver keeps work on the fast cluster. One sequence slot (`n_parallel 1`) and a small saved prompt-state cache are used. The system prompt and tool list are pre-processed right after the model loads, which lowers the first-token latency of the first real message.

## GPU and NPU

llama.cpp's Android GPU path (OpenCL) only supports Qualcomm Adreno. On Mali GPUs such as the Helio G85's Mali-G52, Pocket Buddy uses the CPU kernels (NEON/dotprod) and says so in the plan. On Adreno phones GPU offload stays off unless you set it manually or a benchmark shows it is faster. The bundled MoE engine also includes upstream's OpenCL and Hexagon libraries. Pocket Buddy does not force them on; whether they get used is left to the upstream engine, and they have not been tested on a Snapdragon phone here.

## MoE expert streaming on Android

- **Engine.** The BigMoeOnEdge v0.40.2 server and its ggml libraries are extracted at build time from the pinned upstream release, verified by SHA-256 and packaged as `lib*.so` in the APK (about 30 MB, ARM64 only). `PocketBuddyMoE` starts it as a child process bound to `127.0.0.1` with a random port and an API key. It is tied to the app's process ID, so it exits with the app. Cleartext traffic is allowed only for loopback.
- **Bounded cache.** The expert cache equals the budget minus dense weights, KV, compute buffers and a 200 MB margin. On a 6 GB phone in Balanced this is about 1.6 GB.
- **Selection and prefetch.** The engine records which experts the router picks (`--routing-dir`, kept in app storage) and uses that history to keep and prefetch likely experts.
- **Parallel reads.** Read lanes come from the measured storage test (Settings → Measure storage speed: sequential plus random 512 KB reads at 1, 2 and 4 lanes). Without a measurement eMMC gets 2 lanes, UFS 4 and Maximum on UFS 6. Reads overlap with compute.
- **Automatic profile.** When the cache is at least 1.5 GB, the engine's own `--auto` planner measures threads and lanes inside Pocket Buddy's limits (cache floor and ceiling). Otherwise an explicit configuration is used.
- **Fallbacks.** If the auto planner fails, Pocket Buddy uses its own streaming settings. If the engine itself fails, it uses llama.rn with memory mapping, then the previous safe defaults.

## What this means on a 6 GB eMMC phone (Infinix Hot 10S, Helio G85)

- The plan for the default Qwen3.8 2B model is llama.rn on the CPU, 4 threads to start (the benchmark measures the best value), a 4K context and a budget of about 2.4 GB. This is the fastest option for everyday chat.
- The 8B MoE model streams experts over about 2 eMMC read lanes. It fits in memory and gives better answers, but every token waits for flash reads, so expect slow replies and a first load measured in minutes. See [BENCHMARKS.md](BENCHMARKS.md) for measured numbers. Pocket Buddy was not tuned with settings meant for 12 GB UFS 4 phones; those phones get larger budgets, more lanes or full in-memory loading automatically.

## Measuring on your phone

Settings → Performance → **Benchmark this phone** runs the same prompt twice. The first run uses the exact previous settings (`n_ctx` from Settings, the old batch size, no flash attention). The second uses the adaptive plan, with a thread sweep for dense models or expert streaming for MoE. It reports load time, time to first token, prefill and decode speed, and RSS. Results can be copied and are kept on the phone.
