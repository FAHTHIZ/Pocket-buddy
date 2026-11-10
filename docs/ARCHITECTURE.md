# Pocket Buddy architecture

## Product boundary

Pocket Buddy is a mobile-first personal AI workspace. The default surface is a single familiar chat session. Model management, connector setup and media jobs are dedicated secondary screens, not required steps for normal chat.

The client does not operate a hosted inference backend. Chat runs on-device (GGUF through llama.cpp) or on a provider the user picks. Media generation is routed only to a ComfyUI server the user operates. FLUX.1 Schnell is the default image target and Wan 2.2 TI2V-5B is the video target; weights run on the ComfyUI computer, not inside the Android APK.

## Layers

1. Presentation: chat timeline, composer, streaming indicator, history drawer, model library, settings, connector hub and media library.
2. Conversation state: message timeline, SQLite persistence, active model, agent activity and rolling conversation summaries.
3. Agent runtime: normalized tool schemas, bounded function-call loop, confirmation policy and direct media intent router.
4. Capability registry: built-in deterministic tools plus user-connected MCP tools.
5. Model adapters: llama.cpp via llama.rn or OpenAI-compatible chat completion endpoints.
6. Media adapter: `services/media.ts` submits user-supplied API-format workflows to ComfyUI, substitutes `{{prompt}}` and `{{model}}`, and tracks queue/history state. A static catalog exposes FLUX.1 Schnell/Dev and Wan 2.2 targets. Native `PocketBuddyMedia` manages app-private files, playback, sharing and gallery saves.
7. Platform services: Android DownloadManager, hardware profile, thermal status, SQLite and secure credential store.

## Capability independence

The selected language model is not the capability host. Pocket Buddy registers its own application capabilities:

| Intent | Dispatcher |
|---|---|
| Text conversation | Selected LLM adapter |
| Explicit image request ("create 4 images of…" or ＋ → Create images) | Intent router / composer mode → `createMedia` → user's ComfyUI FLUX.1 workflow |
| Explicit video request | Intent router / composer mode → `createMedia` → user's ComfyUI Wan 2.2 workflow |
| Explicit audio request (music / speech / sfx) | Intent router / composer mode → `createMedia` → optional ComfyUI audio workflow |
| Model-requested media operation | LLM tool call → media adapter |
| Web search | Configured SearXNG |
| Webpage reading | HTTPS reader |
| GitHub actions | GitHub REST API using user's token |
| External integrations | MCP Streamable HTTP servers |

The direct media intent router means an LLM does not need to know how to synthesize images or video; it can be text-only. The configured media workflow must still have appropriate model weights, nodes and compute. The app does not create capabilities that the underlying generation engine lacks.

## Chat turn

    User → Chat UI → Intent Router
      ├─ media intent or composer media mode → createMedia → files in filesDir/media → message attachments + Media library → UI
      └─ normal message → Agent → selected LLM + tool schemas
           ├─ final answer → SQLite → UI
           └─ tool call → confirmation policy → tool registry
                 ├─ SearXNG / webpage reader
                 ├─ GitHub REST
                 ├─ MCP server
                 └─ media tools → createMedia (attachments collected and shown inline)
              tool result → LLM → final answer

## Model adapters

- Local: GGUF weights through llama.rn and llama.cpp. Users can configure context size and GPU layer offload. OpenCL is optional and device/quantization dependent; CPU remains the universal fallback.
- Remote: OpenAI-compatible Chat Completions using a configurable base URL, model ID and API key. Streaming uses SSE; selected compatibility failures retry through non-streaming JSON.
- Normalized response: assistant content plus structured function calls. The chat UI does not need to know which adapter produced the result.

Local tool invocation depends on model chat templates and runtime tool-call parsing. Explicit media intents bypass this requirement.

## Agent safety

- Built-in tools are registered by Pocket Buddy.
- Tool arguments must parse as JSON objects.
- Tool rounds and the number of calls per round are bounded.
- MCP tools require user approval before execution.
- GitHub issue creation requires approval; read operations do not.
- Tool/page content is untrusted data and cannot supersede system or user instructions.
- Secrets are not added to model context.
- External network destinations are configured or derived from explicit user input.

## MCP connector protocol

The connector client negotiates both current stateless MCP (2026-07-28) and legacy 2025 Streamable HTTP:
- for current servers, it sends stateless requests with per-request protocol metadata and the required transport headers;
- it uses server discovery to detect supported protocol versions;
- for 2025 servers, it falls back to initialize/initialized and the session header where required;
- it lists tools and mirrors supported direct primitive x-mcp-header parameters;
- it requires user approval before each remote tool call.

This is a focused mobile client implementation. OAuth authorization, resource and prompt browsing, elicitation, sampling, subscriptions and full protocol conformance testing remain future work.

## Web research

The first search adapter uses the SearXNG JSON Search API. Users supply the endpoint. This avoids a hidden Pocket Buddy proxy and supports self-hosting. The webpage reader extracts text from public HTTPS pages and limits response size. It is a convenience reader, not a hardened SSRF boundary.

## Media

ComfyUI is a separately operated server. Pocket Buddy imports API-format workflows, substitutes `{{prompt}}` and optional `{{model}}`, submits them to `/prompt`, stores the returned ID in SQLite and checks `/history/{prompt_id}`. Separate workflows are configured for FLUX.1 image generation and Wan 2.2 video generation.

The current adapter covers job submission, status and cancellation. A release-grade media manager still needs WebSocket progress events, local output downloads, reliable interrupted-job recovery and richer media previews.

## Storage

- Conversations, messages and rolling context summaries: SQLite.
- Installed model metadata: AsyncStorage; model weights: app-specific external files via Android DownloadManager.
- Hugging Face read tokens: Android Keystore-backed secure storage.
- Generation jobs: SQLite.
- Provider/GitHub/ComfyUI/MCP secrets: Android Keystore-backed secure storage.
- Model files: app-specific external files via Android DownloadManager.

Database migrations and encrypted database options should be considered before a production release where local data sensitivity warrants them.

## Android device intelligence

The native module reports device model, SoC, Android API level, total/available RAM, app memory class, available storage and thermal status, which feed the model-fit warnings. `PocketBuddyHardware` adds CPU topology and ARM features, storage type and speed, GPU, battery and power-save state, and thermal and memory-pressure events. These drive the adaptive planner. Thermal status lowers the thread count, and memory pressure triggers a re-plan. See [ADAPTIVE_ENGINE.md](ADAPTIVE_ENGINE.md).

Large transfers use Android DownloadManager so they can survive Activity recreation. Process-death recovery and model-file integrity hashing should be verified on representative Android devices.

## Future adapters

- Local image generation: stable-diffusion.cpp only on qualified device/driver/model combinations.
- Offline ASR: whisper.cpp or sherpa-onnx.
- Offline TTS: sherpa-onnx / ONNX Runtime.
- Alternative LLM runtimes: MLC-LLM and ExecuTorch.

FLUX.1 Schnell and Wan 2.2 TI2V-5B are model weights, not hosted APIs. The mobile client sends jobs to the user's ComfyUI installation, which must have matching weights, custom nodes and API workflows. FLUX.1-dev is optional and carries non-commercial terms. Colibrì is an architectural reference, not a bundled runtime; BigMoeOnEdge remains the Android MoE implementation.

## Media pipeline

- `MediaRequest {kind, prompt, count, model, shape, audioStyle, duration, voice}` comes from the composer chip, the direct intent router (`detectDirectMediaRequest`, which also strips phrases like "create 4 images of") or an LLM tool call.
- `createMedia` resolves the selected FLUX.1 / Wan 2.2 model and submits a user-supplied ComfyUI API workflow. Jobs are queued and tracked in the Media library.
- Each result becomes a `MessageAttachment` (file URI, MIME, thumbnail, prompt, model) stored on the assistant message and as a completed `generation_jobs` row, which powers the Media library.
- Video uses `Prefer: respond-async` and polls `/v1/jobs/{id}` until `succeeded`, then downloads the result.
- No third-party media account, balance or hosted inference API is used. The ComfyUI bearer token, when supplied, is stored in Android Keystore.

## Local inference details

Two local engines sit behind the same `complete()` call: llama.rn for dense models and for MoE models that fit in RAM, and the bundled BigMoeOnEdge server (loopback only) for MoE models that need expert streaming. `planInference` chooses between them from the GGUF header and the hardware probe. Fallbacks run MoE auto → MoE explicit → llama.rn adaptive → the previous defaults.


Local completions use the GGUF chat template through llama.rn's Jinja path (`jinja: true`) with `enable_thinking: false` and `reasoning_format: 'auto'`, so Qwen3.x thinking blocks are kept out of the visible reply; any stray `<think>` text is stripped defensively. Streaming uses the parsed `content` field so tool-call markup does not flash in the chat.
