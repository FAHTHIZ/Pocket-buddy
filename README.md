# Pocket Buddy

**A local-first, ChatGPT-style AI conversation for Android, with dedicated media models.**

Pocket Buddy keeps everyday chat on the phone with GGUF models through llama.cpp. It also supports image and video generation through a ComfyUI server that you operate. The Android app is the client; your computer runs the large media models.

## Dedicated media models

- **FLUX.1 Schnell** — default image model, Apache 2.0.
- **Wan 2.2 TI2V-5B** — Apache 2.0 text-to-video and image-to-video.
- FLUX.1-dev is an optional variant with non-commercial model-license terms. Review its license before using it.
- These are downloadable model weights, not subscription APIs. The app does not require an external media account, balance or paid model catalog.
- Wan 2.2 and FLUX.1 are large models. Typical Android phones are not suitable for running them locally. Pocket Buddy sends jobs to your own ComfyUI computer, which must have the weights, compatible nodes, sufficient compute and API-format workflows.
- Optional `{{model}}` workflow text is replaced with the selected model identifier. A workflow can instead pin the installed checkpoint filename directly.

Official references: [Wan 2.2](https://github.com/Wan-Video/Wan2.2) · [Wan TI2V-5B weights](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B) · [FLUX.1 source](https://github.com/black-forest-labs/flux) · [FLUX.1 Schnell weights and license](https://huggingface.co/black-forest-labs/FLUX.1-schnell) · [FLUX.1 Dev weights](https://huggingface.co/black-forest-labs/FLUX.1-dev)

## Chat and local inference

- One-tap download and local GGUF chat.
- Adaptive CPU/thread/context planning, hardware probing and thermal/memory-pressure awareness.
- BigMoeOnEdge expert streaming for supported MoE models that exceed the phone's practical memory budget.
- Colibrì is an architectural reference for hierarchical expert placement; it is not bundled into the Android app.
- Streaming Markdown chat, chat history, edit/regenerate, read aloud, voice input, calculator, SearXNG web search, webpage reading, GitHub and MCP connectors.

## Media workflow

1. Install ComfyUI on a computer you control.
2. Install FLUX.1 Schnell weights and import a compatible image workflow. Export it in ComfyUI API format.
3. Install Wan 2.2 TI2V-5B and its required nodes/weights on that computer. Import and export a compatible Wan 2.2 API workflow.
4. In Pocket Buddy, open **Settings → Your media server**, enter the ComfyUI server URL, and paste the image/video API workflows. Put `{{prompt}}` in the positive-prompt input. Optionally put `{{model}}` in the model/checkpoint field.
5. In chat, tap **＋ → Create images** or **Create video**, write a prompt and send. Jobs are queued on your ComfyUI instance and tracked in the Media library.

Workflows are user-supplied because ComfyUI node IDs, loader configuration, model filenames and custom-node versions vary. Pocket Buddy checks server reachability and node classes, but that does not guarantee every weight is installed or every workflow will succeed.

## Where processing happens

| Feature | Processing location |
|---|---|
| GGUF chat in On-device mode | This phone |
| Chat through a configured API provider | The endpoint you choose |
| FLUX.1 image generation | Your configured ComfyUI computer |
| Wan 2.2 video generation | Your configured ComfyUI computer |
| Web search | Your configured SearXNG instance |
| GitHub and MCP tools | The services you connect |

Media prompts, workflow JSON and media files you submit to a workflow are sent to your configured ComfyUI endpoint. Use a server you control or trust. There is no Pocket Buddy-hosted media proxy or inference subscription.

## Adaptive MoE inference

Pocket Buddy integrates the Android-oriented BigMoeOnEdge runtime for compatible MoE GGUFs. It detects architecture and device capabilities, estimates a safe memory budget, benchmarks memory-mapping against expert streaming, and selects the faster supported path. Dense models continue to use llama.rn. See [docs/ADAPTIVE_ENGINE.md](docs/ADAPTIVE_ENGINE.md) and [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Build

Requirements: Node.js 22.13+, npm or Yarn 1.22, JDK 17+, Android SDK platform 37 preview/build tools 37.0.0, and Android NDK 27.3.13750724.

```bash
npm install
npm run typecheck
npm run build:android
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. CI test builds are not Play Store signing identities.

## Limitations

- Wan 2.2 and FLUX.1 are not embedded in the APK and do not run on ordinary Android phones. They run on the ComfyUI computer you configure.
- A valid API-format workflow and all required weights/custom nodes must exist on that computer.
- The current adapter queues jobs and checks queue/history state. Automatic workflow authoring and robust output retrieval still depend on the configured server/workflow.
- BigMoeOnEdge expert streaming is ARM64 + Android 10+; other platforms fall back to the standard local runtime.
- Performance depends on CPU, RAM, storage bandwidth, context size and the selected model.

## License

Pocket Buddy is Apache-2.0. Third-party code, model weights, datasets, ComfyUI workflows, custom nodes and other assets retain their own licenses and terms.
