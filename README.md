# Pocket Buddy

**One conversation. Your models. Your tools. Your media.**

Pocket Buddy is an Android-first personal AI workspace. Its default experience is a familiar chat session, while the application independently manages local GGUF models, OpenAI-compatible providers, an agent/tool loop, MCP connectors and media-generation workflows.

> Development status: Core app sources are in the repository. Real-device inference, provider compatibility, MCP interoperability and configured media workflows still need device-level validation. Android build validation is being run in GitHub Actions; use the latest workflow artifact for the debug APK only after the run succeeds.

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
| Model discovery | Hugging Face Hub API, GGUF file listing and Android DownloadManager |
| Local storage | Nitro SQLite 10.2.0, async queries and transactions |
| Secrets | react-native-keychain (Android Keystore-backed) |
| Agent | Bounded multi-turn tool loop and direct media intent routing |
| Web | User-configured SearXNG; public HTTPS webpage reader |
| GitHub | User token, repository search, file reading, open issues and confirmation-gated issue creation |
| MCP | Streamable HTTP initialization, tool listing and calls; remote calls require approval |
| Media | ComfyUI API workflows for image/video generation and persisted job tracking |
| Android device data | Native profile: RAM, available storage, SoC, SDK and thermal status |

## Setup

Requirements:
- Node.js 22.13+
- npm or Yarn 1.22
- JDK 17+
- Android SDK platform 37 preview / build tools 37.0.0
- Android NDK 27.3.13750724
- Gradle 9.4.1 installed on PATH

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

This repository invokes a system Gradle installation directly and does not commit a generated Gradle wrapper JAR. Install Gradle 9.4.1 and ensure the gradle command is on PATH.

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

## First-run configuration

1. Open Models from the menu.
2. Search Hugging Face for GGUF models and select a quantization that matches your phone's RAM and storage.
3. Install and load the model. Model loading can fail if the runtime memory footprint is larger than available RAM.
4. Or open Settings and choose API provider, then enter a compatible base URL, model ID and API key.
5. To enable web research, configure a SearXNG instance and turn on web search in Settings.
6. Connect GitHub from Connectors with a personal access token. Use least-privilege scopes.
7. Connect a trusted MCP Streamable HTTP endpoint from Connectors → MCP.
8. Add a ComfyUI API URL and import API-format image/video workflow JSON in Settings. Include {{prompt}} in the positive prompt input.

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

The agent caps tool rounds and the number of calls per round. Tool results and retrieved content are untrusted data.

## Media generation

A text-only LLM does not need native image/video generation. Pocket Buddy's application layer can directly route explicit generation requests and submit them to ComfyUI. The configured API workflow, model weights, custom nodes, compute capacity and provider limits determine what can actually be generated.

For local image generation, stable-diffusion.cpp is a candidate for qualified devices, but automatic local diffusion is not enabled as a general promise until device/backend combinations pass Android benchmarks. Video generation is normally remote because current video models are too demanding for most phones.

## Known limitations before production release

- Real-device installation and inference validation is still required.
- Local GGUF tool calling depends on the model's chat template and function-calling quality; explicit media requests bypass that requirement.
- Model downloads use Android DownloadManager, but recovery after process death and file-integrity verification need device testing.
- ComfyUI jobs are persisted and can be checked; WebSocket live progress, local output copying, rich previews and robust job recovery remain release tasks.
- Search requires a user-configured SearXNG instance. There is no hidden Pocket Buddy search proxy.
- MCP supports configured Streamable HTTP endpoints; OAuth connector UX, prompts/resources and full protocol conformance remain future work.
- Thermal state is read, but automatic throttling/pause policies and benchmark-based recommendations still need hardware testing.
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