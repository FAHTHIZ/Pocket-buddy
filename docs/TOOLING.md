# Open-source tooling and licensing notes

This is the selected stack and extension inventory. Versions and licenses must be checked again at every release; model weights, datasets, workflows and custom nodes have separate terms.

| Layer | Tool | License / use |
|---|---|---|
| Mobile app | React Native | MIT; Android-first UI |
| Native language runtime | llama.cpp | MIT; GGUF model inference |
| React Native bridge | llama.rn | MIT; Android/iOS bridge to llama.cpp |
| API provider | OpenAI-compatible Chat Completions | Protocol; use provider's actual API terms |
| Database | react-native-sqlite-storage / SQLite | MIT wrapper / public-domain SQLite |
| Secure credentials | react-native-keychain | MIT; Android Keystore-backed credential storage |
| Web search | SearXNG | AGPL-3.0-or-later; operate as a separate service |
| Agent protocol | MCP | Protocol specification; SDK package licenses vary |
| Media workflow server | ComfyUI | GPL-3.0; separate server, not bundled into the Android app |
| Local image candidate | stable-diffusion.cpp | MIT; candidate runtime, requires Android device qualification |
| Speech recognition candidate | whisper.cpp | MIT; offline speech-to-text |
| Speech stack candidate | sherpa-onnx | Apache-2.0; offline ASR/TTS |
| Alternative LLM runtime | MLC-LLM | Apache-2.0; evaluate as a runtime adapter |
| Alternative model runtime | ExecuTorch | BSD-3-Clause; evaluate for supported Android model paths |
| Model repository | Hugging Face Hub API | Model weights have their own license and access terms |
| UI markdown | react-native-markdown-display | MIT |

## Integration policy

- Do not bundle ComfyUI into Pocket Buddy's APK. Connect to a separate user-operated server.
- Do not bundle SearXNG into Pocket Buddy's APK. Use a configured user-operated instance.
- Do not assume an open-source runtime license grants permission to redistribute model weights.
- Check LoRA, VAE, checkpoint, tokenizer, dataset, workflow and custom-node licenses separately.
- Preserve required attribution and third-party notices.
- Avoid shipping any tool that executes arbitrary code from a prompt without explicit controls.
- Review all connector permissions and side effects before marking a connector generally available.

## Reference repositories and docs

- PocketPal AI mobile architecture: https://github.com/a-ghorbani/pocketpal-ai
- llama.rn: https://github.com/mybigday/llama.rn
- llama.cpp Android guidance: https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md
- React Native: https://reactnative.dev/
- Android thermal APIs: https://developer.android.com/reference/android/os/PowerManager
- Android DownloadManager: https://developer.android.com/reference/android/app/DownloadManager
- ComfyUI server API: https://docs.comfy.org/development/comfyui-server/comms_routes
- ComfyUI API examples: https://docs.comfy.org/development/comfyui-server/api-examples
- SearXNG Search API: https://docs.searxng.org/dev/search_api.html
- MCP specification: https://modelcontextprotocol.io/specification
- stable-diffusion.cpp: https://github.com/leejet/stable-diffusion.cpp
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx
- MLC-LLM: https://github.com/mlc-ai/mlc-llm
- ExecuTorch: https://github.com/pytorch/executorch
