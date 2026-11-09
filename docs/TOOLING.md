# Open-source tooling and licensing notes

This is the selected stack and extension inventory. Versions and licenses must be checked again at every release; model weights, datasets, workflows and custom nodes have separate terms.

| Layer | Tool | License / use |
|---|---|---|
| Mobile app | React Native | MIT; Android-first UI |
| Native language runtime | llama.cpp | MIT; GGUF model inference |
| React Native bridge | llama.rn | MIT; Android/iOS bridge to llama.cpp |
| MoE expert-streaming engine | BigMoeOnEdge v0.40.2 (Helldez) | Apache-2.0; prebuilt arm64 server and ggml libraries extracted from the pinned upstream APK (SHA-256 verified) at build time; license in `third_party/bigmoeonedge/` and app assets |
| Studied, not bundled | colibri (JustVugg) | Design reference for expert streaming; no code included |
| Heavy MoE pick | LFM2 8B-A1B Abliterated GGUF (mradermacher i1 quants of huihui-ai/Huihui-LFM2-8B-A1B-abliterated) | Model card license (LFM Open License); downloaded by the user, not bundled |
| API provider | OpenAI-compatible Chat Completions | Protocol; use provider's actual API terms |
| Database | react-native-nitro-sqlite / SQLite | MIT; async SQLite queries and transactions |
| Native modules bridge | react-native-nitro-modules | MIT; native JSI/Nitro module bridge |
| Secure credentials | react-native-keychain | MIT; Android Keystore-backed credential storage |
| Web search | SearXNG | AGPL-3.0-or-later; operate as a separate service |
| Agent protocol | MCP | Protocol specification; SDK package licenses vary |
| Built-in media engine | Pollinations (gen.pollinations.ai, enter.pollinations.ai) | Hosted API; free and pay-as-you-go (pollen) models; each upstream model keeps its own terms |
| Default chat model | Qwen3.8 2B Uncensored GGUF (atakhadivi) | Apache-2.0 per model card; community fine-tune on Qwen3.5 2B |
| Media workflow server | ComfyUI | GPL-3.0; separate server, not bundled into the Android app |
| Local image candidate | stable-diffusion.cpp | MIT; candidate runtime, requires Android device qualification |
| Speech recognition candidate | whisper.cpp | MIT; offline speech-to-text |
| Speech stack candidate | sherpa-onnx | Apache-2.0; offline ASR/TTS |
| Alternative LLM runtime | MLC-LLM | Apache-2.0; evaluate as a runtime adapter |
| Alternative model runtime | ExecuTorch | BSD-3-Clause; evaluate for supported Android model paths |
| Model repository | Hugging Face Hub API | Model weights have their own license and access terms |
| UI markdown | react-native-markdown-display | MIT |

## Integration policy

- Pollinations is called directly from the phone with the user's own key; Pocket Buddy runs no proxy.
- Do not bundle ComfyUI into Pocket Buddy's APK. Connect to a separate user-operated server.
- Do not bundle SearXNG into Pocket Buddy's APK. Use a configured user-operated instance.
- Do not assume an open-source runtime license grants permission to redistribute model weights.
- Check LoRA, VAE, checkpoint, tokenizer, dataset, workflow and custom-node licenses separately.
- Preserve required attribution and third-party notices.
- Avoid shipping any tool that executes arbitrary code from a prompt without explicit controls.
- Review all connector permissions and side effects before marking a connector generally available.

## Reference repositories and docs

- Pollinations API: https://enter.pollinations.ai/api/docs
- Pollinations BYOP / device sign-in: https://github.com/pollinations/pollinations

- PocketPal AI mobile architecture: https://github.com/a-ghorbani/pocketpal-ai
- llama.rn: https://github.com/mybigday/llama.rn
- llama.cpp Android guidance: https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md
- React Native: https://reactnative.dev/
- Android thermal APIs: https://developer.android.com/reference/android/os/PowerManager
- Android DownloadManager: https://developer.android.com/reference/android/app/DownloadManager
- Nitro SQLite docs: https://sqlite.margelo.com/docs
- Nitro SQLite repository: https://github.com/margelo/react-native-nitro-sqlite
- ComfyUI server API: https://docs.comfy.org/development/comfyui-server/comms_routes
- ComfyUI API examples: https://docs.comfy.org/development/comfyui-server/api-examples
- SearXNG Search API: https://docs.searxng.org/dev/search_api.html
- MCP specification: https://modelcontextprotocol.io/specification
- stable-diffusion.cpp: https://github.com/leejet/stable-diffusion.cpp
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx
- MLC-LLM: https://github.com/mlc-ai/mlc-llm
- ExecuTorch: https://github.com/pytorch/executorch
