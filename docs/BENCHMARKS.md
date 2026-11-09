# Pocket Buddy benchmarks

Every number on this page was measured; nothing is estimated or copied from other projects.

The most important limit comes first. **None of these numbers come from a phone.** They come from a GitHub `ubuntu-24.04-arm` runner and from the development sandbox. Pocket Buddy has not yet been measured on an Infinix Hot 10S (Helio G85, 6 GB, eMMC) or on any other real Android device. The CI Android emulator is x86_64, and the MoE engine is ARM64-only, so the emulator cannot run it either. To get real numbers for your phone, use **Settings → Performance → Benchmark this phone** (see [Measuring on your phone](#measuring-on-your-phone)).

## Test machines

| Machine | CPU | RAM | Storage | Used for |
|---|---|---|---|---|
| GitHub `ubuntu-24.04-arm` runner | 4× Arm Neoverse-N2 (armv9: NEON, dotprod, i8mm, SVE2, bf16) | 16 GB | cloud SSD | llama.cpp dense runs, MoE runs inside a 6 GB-phone emulation |
| Development sandbox | 2× x86_64 | small | slow network disk | checking that the real `bmoe-server` accepts the exact arguments the app generates |

These cores are server-class and much faster than the Helio G85's 2× Cortex-A75 + 6× Cortex-A55. Absolute speeds on the phone will be lower. Look at the ratios between configurations, not at the absolute values.

The scripts are [`scripts/bench/run-arm64-bench.sh`](../scripts/bench/run-arm64-bench.sh) (driver), [`chat_probe.py`](../scripts/bench/chat_probe.py) (time to first token and speeds over the streaming chat API) and [`gguf_probe.py`](../scripts/bench/gguf_probe.py) (architecture detection). The workflow is [`.github/workflows/bench.yml`](../.github/workflows/bench.yml); run it from the Actions tab.

## Architecture detection

The planner reads each GGUF header before choosing an engine. The benchmark ran the same detection on the CI runner:

| Model | `general.architecture` | Experts | Expert weights | Dense weights | Result |
|---|---|---|---|---|---|
| Qwen3.8 2B Uncensored Q4_K_M (default) | `qwen35` | none | 0 MiB | 1204 MiB | **dense**, so expert streaming is never applied |
| LFM2 8B-A1B Abliterated i1-IQ4_XS | `lfm2moe` | 32, 4 used per token | 3927 MiB | 340 MiB | **MoE**, so streaming is possible |

## Dense model: Qwen3.8 2B (the default)

The test used llama.cpp `b12211`, the same engine family as llama.rn. Settings: context 4096, the prompt "In three sentences, explain why the sea looks blue.", 64 tokens, and page cache dropped before each load. Runs 42558957735 and 42567807138 gave matching results; the table shows run 42567807138.

| Configuration | Threads | Cold first token | Warm first token | Prefill | Decode | Peak RSS |
|---|---|---|---|---|---|---|
| Existing settings (llama.rn default on a 4-core device, flash-attn off) | 2 | 1.013 s | 0.157 s | 44.6 tok/s | 11.85 tok/s | 2675 MB |
| Existing settings, adaptive thread count only | 4 | 0.544 s | 0.103 s | 84.8 tok/s | 21.89 tok/s | 2675 MB |
| Adaptive engine (threads, batch threads, flash-attn auto) | 4 | 0.532 s | 0.100 s | 86.8 tok/s | 22.05 tok/s | 2675 MB |

Thread sweep (`llama-bench`, mean of 3 runs, tok/s):

| Threads | Decode, fa off | Decode, fa on | Prefill (128), fa off | Prefill, fa on |
|---|---|---|---|---|
| 1 | 6.40 | 6.49 | 26.3 | 26.8 |
| 2 | 12.12 | 12.21 | 52.4 | 53.1 |
| 3 | 17.34 | 17.44 | 77.2 | 75.5 |
| 4 | 22.21 | 22.47 | 103.4 | 104.4 |

What this shows:

- Nearly all of the gain comes from the thread count: about 1.9× faster decoding and half the time to first token. Flash attention, batch threads and the other changes add only about 1%.
- This runner reports 4 cores, and llama.rn's default on a 4-core device is 2 threads. The Helio G85 reports 8 cores, so llama.rn would already use 4 threads there. **On the G85 the gain from threads will be smaller than shown here.** The adaptive engine's benefit there comes from measuring the best thread count on the actual phone. The A55 efficiency cores can make more threads slower, which the on-phone sweep detects. It also comes from memory budgeting, context sizing and thermal re-planning.
- Memory use is the same, because the model and context are the same.

## MoE model: LFM2 8B-A1B on an emulated 6 GB eMMC phone

The model file is 4.27 GB. On a 6 GB phone that is more than Pocket Buddy's inference budget, which keeps 2468 MB in Balanced and leaves the rest to Android and other apps. To emulate that, each server ran in a systemd cgroup with **MemoryMax=2468M, no swap** and a **250 MB/s read-bandwidth cap**, which is in the eMMC 5.1 sequential class. Page cache counts against the cgroup limit, so memory-mapped loading cannot quietly use the runner's 16 GB.

Engines: llama.cpp `b12211` (memory-mapped, like llama.rn) and BigMoeOnEdge `bmoe-server` 0.40.2 (expert streaming, the same binary family the APK ships). The streaming runs used **exactly the arguments Pocket Buddy's planner generates** for a 6 GB eMMC phone. 48 tokens were generated; "warm" means the second request on the same server. The results below are from runs 42573165123, 42576407078 and 42580004802.

| Configuration | Load | Cold first token | Warm first token | Decode cold / warm | Peak RSS | Notes |
|---|---|---|---|---|---|---|
| llama.cpp mmap, existing settings (2 threads) | 22.3 s | 15.6–15.8 s | 2.6–2.8 s | 2.49–2.56 / 3.00–3.01 tok/s | 2466 MB | no OOM |
| llama.cpp mmap, adaptive threads (4) | 22.3 s | 16.3 s | 2.46 s | 2.51 / 2.92 tok/s | 2467 MB | no OOM |
| bmoe expert streaming, engine auto planner (`--cache-mb auto`, cap 1636; it chose 4 read lanes and a 1500 MiB cache) | 60.2–60.4 s | 14.65 s | 12.7–13.0 s | 1.84 / 1.60–1.79 tok/s | 2471 MB | 64–65% expert-cache hit; 1.27–1.53 s of I/O vs 0.07 s of compute per token |
| bmoe expert streaming, Pocket Buddy's eMMC plan (`-t 4 --io-threads 2 --cache-mb 1636 --overlap`) | 60.7 s | 14.56 s | 12.55 s | 2.05 / 2.02 tok/s | 2471 MB | 67–68% expert-cache hit; 0.70 s of I/O vs 0.065 s of compute per token |

What this shows, honestly:

- Under this emulation, **expert streaming was not faster than plain memory-mapping** for this model. Memory-mapping decoded at about 2.5–3.0 tok/s; the best streaming plan reached about 2.0 tok/s. Memory-mapping's warm first token was also much quicker: about 2.5 s versus 12.5 s, because llama.cpp reuses the cached prompt prefix.
- Among the streaming plans, Pocket Buddy's own eMMC plan was faster than the engine's auto planner: 2.0–2.1 vs 1.6–1.8 tok/s, and half the I/O wait per token. It uses 2 read lanes and the full 1636 MB cache, while the auto planner chose 4 lanes and a smaller cache. **Automatic therefore uses the explicit plan on eMMC phones and on phones whose storage was measured**, and keeps the engine's auto planner only for unmeasured UFS phones.
- Streaming is I/O-bound: each token waits about 1.3 s for flash reads and computes for only 0.07 s. A larger expert cache or faster storage helps it directly.
- Both stayed inside the 2468 MB limit without being killed.
- The cgroup throttle limits bytes per second, not I/O operations. Real eMMC is much slower at small random reads. That penalises memory-mapped page faults (small reads) more than bmoe's large O_DIRECT expert reads, so this setup may favour mmap compared with a real phone.

To check that last point, run 42580071211 repeated everything with an extra **6000 read-IOPS cap** (`IOReadIOPSMax`):

| Configuration (250 MB/s + 6000 IOPS) | Cold first token | Warm first token | Decode cold / warm | Expert-cache hit |
|---|---|---|---|---|
| llama.cpp mmap, existing settings (2 threads) | 14.88 s | 2.76 s | 2.44 / 2.98 tok/s | — |
| llama.cpp mmap, adaptive threads (4) | 16.03 s | 2.58 s | 2.64 / 3.06 tok/s | — |
| bmoe streaming, Pocket Buddy's eMMC plan | 14.56 s | 12.62 s | 2.17 / 2.10 tok/s | 68–69% |
| bmoe streaming, engine auto planner | 14.66 s | 13.21 s | 1.83 / 1.87 tok/s | 65–66% |

The IOPS cap barely changed anything, so the ranking held: memory-mapping, then Pocket Buddy's streaming plan, then the engine's auto planner.

The planner applies these results as follows:

- **Automatic default:** if the RAM budget covers at least half of a MoE model, the model is memory-mapped with the adaptive llama.rn settings. That is the measured faster case here, where the budget covers 56% of LFM2 8B. A MoE model much larger than the budget (for example a 35B-A3B on a 6 GB phone) is expert-streamed, because the page cache could hold only a small part of it.
- **Benchmark this phone** overrides that default with a real measurement. For a MoE model that does not fit, it runs:
  1. the existing settings;
  2. expert streaming;
  3. memory-mapping with the adaptive settings.

  It keeps whichever engine gives a typical reply sooner (first-token time + 64 tokens), stores that choice per phone and model, and shows the measured timings under "Why these settings?".
- **MoE streaming → Always stream** forces streaming, and **Off** never streams.

**Bottom line for a 6 GB eMMC phone:** the 8B MoE model is for better answers, not speed. For fast everyday chat, the 2B dense model (Qwen3.8 2B) remains the fastest choice by a wide margin.

## Sandbox check of the real engine arguments (x86_64)

On the development sandbox (2 x86 cores, a slow network disk; not representative of any phone), the real `bmoe-server` 0.40.2 was started with the exact arguments the app's planner produced:

| Model | Arguments | Load | Decode | Expert-cache hit | Notes |
|---|---|---|---|---|---|
| LFM2 8B-A1B IQ4_XS | Automatic (`--cache-mb auto`) | 73 s | 0.88 tok/s | 67.3% | the planner chose 2 threads, 1 I/O lane, cache 1636 MiB; I/O about 0.99 s/token |
| LFM2 8B-A1B IQ4_XS | explicit (Balanced) | 68 s | — | — | arguments accepted; server became ready |
| LFM2.5 8B-A1B | Automatic | — | 0.62 tok/s | 55% | always reasons before answering, so it was replaced in the quick pick by LFM2 |

This check found and fixed two real bugs before release. Earlier argument sets passed `--routing-dir` and `--auto`, which `bmoe-server` rejects.

## Measuring on your phone

1. Install the APK from the [latest release](https://github.com/FAHTHIZ/Pocket-buddy/releases/latest/download/PocketBuddy.apk).
2. Download a model in **Models**: the default Qwen3.8 2B for speed, or "LFM2 8B-A1B Abliterated (MoE)" to try expert streaming.
3. Close other heavy apps, keep the phone unplugged and cool, and open **Settings → Performance**.
4. Optional: tap **Measure storage speed**. It times sequential and parallel random reads on the model file, and the result sets the number of streaming read lanes.
5. Tap **Benchmark this phone (previous vs adaptive)**.
   - Dense models: it compares the previous defaults with the adaptive engine and sweeps thread counts. The fastest stable count is saved for this phone and model.
   - MoE models: it compares the previous defaults, expert streaming and adaptive memory-mapping, and keeps the faster engine.
6. Tap **Copy results** and paste them into an issue or a note. The report includes the device description, model, architecture, load time, time to first token, prefill and decode speed, and the resident memory of each run.

A MoE first load reads gigabytes from eMMC and can take several minutes. Repeat the benchmark after the phone has cooled, because thermal throttling on the G85 lowers sustained speed.
