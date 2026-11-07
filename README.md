> **[Download Pocket Buddy for Android (ARM64 APK)](https://github.com/FAHTHIZ/Pocket-buddy/releases/latest/download/PocketBuddy.apk)**
>
> This link always points to the latest successful Android validation release. Builds are signed with the CI test key, not a Play Store production key. A new APK replaces the download only after the full validation workflow passes.

# Pocket Buddy

**One conversation. Your models. Your tools. Your media.**

Pocket Buddy is an Android-first personal AI workspace. Its default experience is a familiar chat session, while the application independently manages local GGUF models, OpenAI-compatible providers, an agent/tool loop, MCP connectors and media-generation workflows.

> Development status: The first-run connection flow, standalone Android packaging and emulator launch smoke test are part of the build pipeline. Real-device inference, provider compatibility, MCP interoperability and configured media workflows still need device-level validation.

## Product principles

- Chat first: one continuous conversation with streaming, Markdown, chat history and a compact composer.
- Model independence: image/video tools are application capabilities, not features required inside the selected LLM. Explicit image/video prompts are routed by the app; model tool calls are also supported.
- Bring your own AI: run a local GGUF model through llama.cpp/llama.rn or configure an OpenAI-compatible API endpoint.
- Built-in agent: calculator, device time, web search, webpage reading, media generation and GitHub operations.
- Extensible tools: connect remote MCP Streamable HTTP servers; remote actions request approval.
- User-controlled data flow: conversations are local until a configured API, search server, MCP server or ComfyUI endpoint is invoked.
- Phone-aware execution: inspect RAM, free storage and thermal state before recommending or loading models; automated throttling remains a device-validation task.

## Current implementation

| Area | Implementation |
|---|---|
| App/UI | React Native 0.87.1, React 19.2.3, TypeScript, dark chat-first interface |
| Local text models | llama.rn 0.13.0-rc.9, llama.cpp, GGUF |
| Remote models | OpenAI-compatible Chat Completions, SSE streaming and JSON fallback |
| Model discovery | Hugging Face Hub API, optional secure read token for gated access, installed-model library and Android DownloadManager |
| Local storage | Nitro SQLite 10.2.0, async queries and transactions |
| Secrets | react-native-keychain (Android Keystore-backed) |
| Agent | Bounded multi-turn tool loop and direct media intent routing |
| Web | User-configured SearXNG; public HTTPS webpage reader |
| GitHub | User token, repository search, file reading, open issues and confirmation-gated issue creation |
| MCP | Streamable HTTP initialization, tool listing and calls; remote calls require approval |
| Media | ComfyUI API workflows for image, video and audio generation with persisted job tracking |
| Android device data | Native profile: RAM, available storage, SoC, SDK and thermal status |

## Setup

Requirements:
- Node.js 22.13+
- npm or Yarn 1.22
- JDK 17+
- Android SDK platform 37 preview / build tools 37.0.0
- Android NDK 27.3.13750724
- The pinned Gradle wrapper at `android/gradlew` (committed to the repository)

Install dependencies:

    npm install

Start Metro in one terminal:

    npm start

In another terminal, attach an Android device with USB debugging enabled:

    npm run android

Build a debug APK:

    npm run build:android

The debug APK is written to:

    android/app/build/outputs/apk/debug/app-debug.apk

The repository uses the pinned Gradle wrapper at `android/gradlew`; a system-wide Gradle installation is not required.

The llama.rn and Nitro SQLite packages include native Android code, so rebuild the Android app after installing or upgrading dependencies.

## Release signing

Debug APKs are for local testing and are not production releases. The release variant does not fall back to the Android debug key. To sign a release, create a private keystore outside this repository and add these values to your local `~/.gradle/gradle.properties`:

    POCKET_BUDDY_RELEASE_STORE_FILE=/absolute/path/to/pocket-buddy-release.jks
    POCKET_BUDDY_RELEASE_STORE_PASSWORD=your-store-password
    POCKET_BUDDY_RELEASE_KEY_ALIAS=pocket-buddy
    POCKET_BUDDY_RELEASE_KEY_PASSWORD=your-key-password

Then run:

    npm run build:android:release

Keep the keystore and passwords private, backed up securely, and out of Git. Without all four properties, Gradle produces an unsigned release APK.

## First-run experience

1. Open Pocket Buddy. The chat welcome screen appears first; chat-history restoration and local-model loading happen in the background.
2. The primary action is **Choose a model for this phone**. Pocket Buddy detects physical RAM and available storage, then shows a short shelf of GGUF models with a suitable quantization already selected. Tap **Download & start**; the app downloads the model, adds it to the library, loads it and returns to the same chat screen automatically.
3. The starter shelf includes Qwen3 0.6B Instruct (Q4_K_M, about 484 MB) and SmolLM2 360M Instruct (Q4_K_M, about 271 MB). Qwen3 1.7B Instruct (Q4_K_M, about 1.28 GB) is shown only when Android reports at least 5 GiB of physical RAM, targeting the 6 GB Hot 10S variant. These are initial recommendations, not a promise of a particular speed or successful inference on every Android device. The phone-aware fit warning still checks current free memory and storage before download.
4. To use a remote provider instead, expand **Use an API provider instead** on the same welcome screen. Pocket Buddy tests the connection and discovers a model where the provider exposes `/models`; the key is stored using Android secure storage.
5. The chat remains the main workspace. The model chip above the composer opens the model shelf for switching; Settings, Connectors and Media library are optional destinations in the side drawer. A Hugging Face read token in Settings enables downloads of gated models your account is permitted to access.

A provider that does not expose `/models` can still be used by entering its exact model ID in the optional Model ID field. Provider URLs must be HTTPS and OpenAI-compatible. API keys are never accepted inside URLs.

## Agent tools

- calculator — safe arithmetic parser; no eval.
- current_time — device-local date/time.
- web_search — SearXNG search API.
- read_webpage — retrieve and extract text from public HTTPS pages.
- generate_image / generate_images — application-level image jobs.
- generate_video — application-level video jobs.
- generation_status / cancel_generation — ComfyUI job management.
- github_search_repositories, github_read_file, github_list_issues — GitHub read tools.
- github_create_issue — write operation with confirmation.
- MCP tools — discovered from connected servers; remote tool calls require confirmation.

The agent caps tool rounds and the number of calls per round. Older turns are summarized when the configured context budget is exceeded. The context allocator reserves separate space for the system prompt, summary and recent turns. Tool results and retrieved content are untrusted data.

## Media generation

A text-only LLM does not need native image/video generation. Pocket Buddy's application layer can directly route explicit generation requests and submit them to ComfyUI. The configured API workflow, model weights, custom nodes, compute capacity and provider limits determine what can actually be generated.

For local image generation, stable-diffusion.cpp is a candidate for qualified devices, but automatic local diffusion is not enabled as a general promise until device/backend combinations pass Android benchmarks. Video generation is normally remote because current video models are too demanding for most phones.

## Voice output

Assistant messages have a **Read aloud** control. It uses the best matching voice installed on Android by default. To use neural speech, save an ElevenLabs API key and Voice ID in Settings. Only text you explicitly choose to read aloud is sent to that provider; usage credits may apply. See the [official Text-to-Speech API reference](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

## Known limitations before production release

- Real-device installation and inference validation is still required.
- Local GGUF tool calling depends on the model's chat template and function-calling quality; explicit media requests bypass that requirement.
- Model downloads use Android DownloadManager and validate the private destination path plus a non-empty file, but they do not yet verify the Hugging Face SHA-256 checksum. Recovery after process death and real-device download behaviour still need device testing.
- ComfyUI image, video and audio jobs are persisted and can be checked. Audio requires a separately configured audio workflow and compatible nodes/model weights. Settings includes a server/workflow-node preflight check; model-weight availability and successful generation still require a real test job. Image previews can send the saved bearer token in-app; opening token-protected video/audio files in external apps is not supported yet.
- Search requires a user-configured SearXNG instance. There is no hidden Pocket Buddy search proxy.
- MCP supports configured Streamable HTTP endpoints; OAuth connector UX, prompts/resources and full protocol conformance remain future work.
- Thermal state is read, but automatic throttling/pause policies and benchmark-based recommendations still need hardware testing.
- Older turns are summarized when context budget is exceeded. The summary is a compact memory aid, not a vector database or a guarantee that every earlier detail is retained.
- Speech input uses the installed Android recognition service with an offline preference; actual offline support depends on that provider and language pack.
- No API key, model weight, workflow or custom node is bundled.

## Privacy and security

- Provider, GitHub, ComfyUI and MCP credentials are stored in Android secure storage.
- Local chat history is stored in app-private SQLite.
- Remote providers receive conversation messages when used.
- Search requests go to the configured SearXNG instance.
- MCP servers receive tool arguments for the tools the user invokes.
- ComfyUI receives prompts and workflow data for generation.
- The webpage reader is a convenience feature, not a hardened SSRF/network sandbox.
- Review third-party model, workflow and custom-node licensing before redistribution.

## Documentation

- Architecture: docs/ARCHITECTURE.md
- Tooling and license inventory: docs/TOOLING.md
- Security policy: SECURITY.md
- Contributing: CONTRIBUTING.md

## License

Apache-2.0. Third-party dependencies, model weights, datasets, workflows, custom nodes and other assets retain their own licenses and terms.