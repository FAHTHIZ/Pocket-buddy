> **[Download Pocket Buddy for Android (ARM64 APK)](https://github.com/FAHTHIZ/Pocket-buddy/releases/latest/download/PocketBuddy.apk)**
>
> CI publishes this APK only after the Android build and emulator launch checks pass. For the current run, use the [Android validation workflow](https://github.com/FAHTHIZ/Pocket-buddy/actions/workflows/android.yml) and download the APK artifact from a successful run.

# Pocket Buddy

**A local-first, ChatGPT-style AI conversation for Android, with dedicated media models.**

Pocket Buddy keeps everyday chat on the phone with GGUF models through llama.cpp. It also draws images and short video clips **on the phone itself**, offline, with stable-diffusion.cpp. For higher-quality media you can optionally connect a ComfyUI server that you operate.

## On-phone images and video (offline)

Open **Models → Images & video · on this phone**, download a model once, then just say *“make 4 pictures of …”* or *“make a video of …”* in chat.

| | Model | Download | Typical time on a mid-range phone (e.g. Helio G85, 6 GB) |
|---|---|---|---|
| Images (default) | [DreamShaper 8 LCM](https://huggingface.co/haven-ai-companion/dreamshaper8-lcm-gguf) · SD 1.5, 6 steps | ~1.6 GB | ~3–6 min per 512×512 picture |
| Images (photoreal) | [Realistic Vision 6 Hyper](https://huggingface.co/second-state/Realistic_Vision_V6.0_B1-GGUF) · SD 1.5, 6 steps | ~1.6 GB | ~3–6 min per picture |
| Fast decoder | [TAESD](https://huggingface.co/madebyollin/taesd) (auto-downloaded) | 10 MB | saves ~2 min per picture |
| Video (experimental) | [Wan 2.1 T2V 1.3B GGUF](https://huggingface.co/off-grid-ai/Wan2.1-T2V-1.3B-GGUF) + [umT5 encoder](https://huggingface.co/off-grid-ai/Video-Companions-GGUF) + [CausVid LoRA](https://huggingface.co/Kijai/WanVideo_comfy) + [TAEW 2.1](https://github.com/madebyollin/taehv) | ~4.3 GB | 1–3 s clip at 416×240 in ~8–25 min |

- Engine: [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) (MIT), built for ARM64 in CI (`scripts/build-sd-engine.sh`) in two variants: ARMv8.2 dotprod+fp16 and a baseline ARMv8.0 fallback. It runs as a separate process, so running out of memory never crashes the app. The chat model is paused while media is generated and reloads on the next message.
- Measured with the same engine on a 2-core x86 machine: a 512×512 DreamShaper picture took ~3 min with TAESD; a 2-second Wan clip took ~11 min with peak RAM around 2 GB (spatial + temporal decode tiling).
- Video is re-encoded on the phone from the engine's MJPEG AVI to H.264 MP4 so it plays and shares anywhere. Photo-to-video still requires Wan 2.2 on ComfyUI.
- Content: adult content is allowed. Sexual content involving anyone who is or appears to be under 18 is always refused, and minor-related terms are added to the negative prompt of any sexual prompt.
- Quality is well below FLUX.1 / Wan 2.2 on a PC GPU; that is the trade-off for running on a phone CPU.

## Dedicated media models (your ComfyUI server, optional)

- **FLUX.1 Schnell** — default image model, Apache 2.0.
- **Wan 2.2 TI2V-5B** — Apache 2.0 text-to-video and image-to-video.
- FLUX.1-dev is an optional variant with non-commercial model-license terms. Review its license before using it.
- These are downloadable model weights, not subscription APIs. The app does not require an external media account, balance or paid model catalog.
- Wan 2.2 and FLUX.1 are large models. Typical Android phones are not suitable for running them locally. Pocket Buddy sends jobs to your own ComfyUI computer, which must have the weights, compatible nodes, sufficient compute and API-format workflows.
- Workflow text tokens: `{{prompt}}`, `{{model}}`, `{{shape}}`, `{{width}}`, `{{height}}`, `{{duration}}` and `{{count}}` are replaced in string inputs. The model token uses the installed ComfyUI checkpoint filename configured in Pocket Buddy. For image-to-video, add `{{input_image}}` to the Load Image filename input in the Wan workflow.

Official references: [Wan 2.2](https://github.com/Wan-Video/Wan2.2) · [Wan TI2V-5B weights](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B) · [FLUX.1 source](https://github.com/black-forest-labs/flux) · [FLUX.1 Schnell weights and license](https://huggingface.co/black-forest-labs/FLUX.1-schnell) · [FLUX.1 Dev weights](https://huggingface.co/black-forest-labs/FLUX.1-dev)

## Chat and local inference

- One-tap download and local GGUF chat.
- Attach a photo or video in chat: Android makes a resized image or up to four video frames for visual analysis by a configured vision-capable API endpoint. Local GGUF chat remains text-only; attachments stay in app storage unless you choose to send them to an API provider.
- Adaptive CPU/thread/context planning, hardware probing and thermal/memory-pressure awareness.
- BigMoeOnEdge expert streaming for supported MoE models that exceed the phone's practical memory budget.
- Colibrì is an architectural reference for hierarchical expert placement; it is not bundled into the Android app.
- Streaming Markdown chat, chat history, edit/regenerate, read aloud, voice input, calculator, SearXNG web search, webpage reading, GitHub and MCP connectors.

## Media workflow

See the step-by-step [Media host setup guide](docs/MEDIA_SETUP.md) before connecting your phone.

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
| On-phone images (DreamShaper / Realistic Vision) | This phone |
| On-phone video (Wan 2.1 1.3B) | This phone |
| FLUX.1 image generation | Your configured ComfyUI computer |
| Wan 2.2 video generation | Your configured ComfyUI computer |
| Web search | Your configured SearXNG instance |
| GitHub and MCP tools | The services you connect |

Media prompts, workflow JSON and media files you submit to a workflow are sent to your configured ComfyUI endpoint. Use a server you control or trust. A private Wi-Fi address such as `http://192.168.1.20:8188` is supported; public hosts must use HTTPS. Photo/video frames sent for visual analysis go only to your selected vision-capable chat API. There is no Pocket Buddy-hosted media proxy or inference subscription.

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

- Wan 2.2 and FLUX.1 are not embedded in the APK and do not run on ordinary Android phones. They run on the ComfyUI computer you configure. The on-phone models above are much smaller substitutes.
- On-phone generation is CPU-only and slow; keep the phone plugged in for video. Very low-memory phones (under 4 GB) may have the engine stopped by Android.
- A valid API-format workflow and all required weights/custom nodes must exist on that computer.
- The current adapter queues jobs and checks queue/history state. Automatic workflow authoring and robust output retrieval still depend on the configured server/workflow.
- BigMoeOnEdge expert streaming is ARM64 + Android 10+; other platforms fall back to the standard local runtime.
- Performance depends on CPU, RAM, storage bandwidth, context size and the selected model.

## License

Pocket Buddy is Apache-2.0. Third-party code, model weights, datasets, ComfyUI workflows, custom nodes and other assets retain their own licenses and terms.
