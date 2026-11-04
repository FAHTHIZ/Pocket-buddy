# Pocket Buddy architecture

## Product boundary

Pocket Buddy is a mobile-first personal AI workspace. The default surface is a single familiar chat session. Model management, connector setup and media jobs are dedicated secondary screens, not required steps for normal chat.

The client does not operate a hosted inference backend. Users configure local models or remote endpoints themselves.

## Layers

1. Presentation: chat timeline, composer, streaming indicator, history drawer, model library, settings, connector hub and media library.
2. Conversation state: message timeline, SQLite persistence, active model and agent activity.
3. Agent runtime: normalized tool schemas, bounded function-call loop, confirmation policy and direct media intent router.
4. Capability registry: built-in deterministic tools plus user-connected MCP tools.
5. Model adapters: llama.cpp via llama.rn or OpenAI-compatible chat completion endpoints.
6. Media adapters: ComfyUI workflow queue for image/video jobs.
7. Platform services: Android DownloadManager, hardware profile, thermal status, SQLite and secure credential store.

## Capability independence

The selected language model is not the capability host. Pocket Buddy registers its own application capabilities:

| Intent | Dispatcher |
|---|---|
| Text conversation | Selected LLM adapter |
| Explicit image-generation request | App intent router → ComfyUI image workflow |
| Explicit video-generation request | App intent router → ComfyUI video workflow |
| Model-requested media operation | LLM tool call → media adapter |
| Web search | Configured SearXNG |
| Webpage reading | HTTPS reader |
| GitHub actions | GitHub REST API using user's token |
| External integrations | MCP Streamable HTTP servers |

The direct media intent router means an LLM does not need to know how to synthesize images or video; it can be text-only. The configured media workflow must still have appropriate model weights, nodes and compute. The app does not create capabilities that the underlying generation engine lacks.

## Chat turn

    User → Chat UI → Intent Router
      ├─ image/video intent → ComfyUI workflow → job ID → SQLite → UI
      └─ normal message → Agent → selected LLM + tool schemas
           ├─ final answer → SQLite → UI
           └─ tool call → confirmation policy → tool registry
                 ├─ SearXNG / webpage reader
                 ├─ GitHub REST
                 ├─ MCP server
                 └─ ComfyUI media job
              tool result → LLM → final answer

## Model adapters

- Local: GGUF weights through llama.rn and llama.cpp. The first implementation uses conservative CPU inference defaults. GPU/NPU offload is not assumed; supported device/driver combinations need qualification.
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

ComfyUI is a separately operated server. Pocket Buddy imports an API-format workflow, substitutes {{prompt}}, submits it to /prompt, stores the returned ID in SQLite and checks /history/{prompt_id}. A workflow is selected separately for image and video generation.

The current adapter covers job submission, status and cancellation. A release-grade media manager still needs WebSocket progress events, local output downloads, reliable interrupted-job recovery and richer media previews.

## Storage

- Conversations and messages: SQLite.
- Generation jobs: SQLite.
- Provider/GitHub/ComfyUI/MCP secrets: Android Keystore-backed secure storage.
- Model files: app-specific external files via Android DownloadManager.

Database migrations and encrypted database options should be considered before a production release where local data sensitivity warrants them.

## Android device intelligence

The native module reports device model, SoC, Android API level, total/available RAM, app memory class, available storage and thermal status. These are inputs for model-fit warnings. Reading thermal state alone does not automatically throttle the runtime; workload policy still needs device testing.

Large transfers use Android DownloadManager so they can survive Activity recreation. Process-death recovery and model-file integrity hashing should be verified on representative Android devices.

## Future adapters

- Local image generation: stable-diffusion.cpp only on qualified device/driver/model combinations.
- Offline ASR: whisper.cpp or sherpa-onnx.
- Offline TTS: sherpa-onnx / ONNX Runtime.
- Alternative LLM runtimes: MLC-LLM and ExecuTorch.
- Additional media backends: provider adapters behind the same job interface.