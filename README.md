> **[Download Pocket Buddy for Android (ARM64 APK)](https://github.com/FAHTHIZ/Pocket-buddy/releases/latest/download/PocketBuddy.apk)**
>
> Every push to `main` is built, launched on an Android emulator and published as a GitHub release only when that passes. If the link is not live yet, open the [Android workflow](https://github.com/FAHTHIZ/Pocket-buddy/actions/workflows/android.yml) and download `PocketBuddy.apk` from the latest successful run. Builds use a CI test-signing key, not a Play Store identity.

# Pocket Buddy

**A ChatGPT-style chat on your phone that can also create images, video, music and speech.**

Pocket Buddy is an Android app in the spirit of PocketPal: install it, tap one button, and you are chatting with an uncensored model running entirely on your phone. Ask it for pictures, clips or songs in the same conversation and they appear right in the chat, ready to play, save to your gallery or share.

## What you get

- **Default model: Qwen3.8 2B Uncensored** (GGUF, Q4_K_M, ~1.27 GB). One tap downloads it, loads it and starts the chat. After that it runs offline.
- **Pick any model you like.** Curated picks (Qwen3.8 4B Heretic for 8 GB+ phones, Qwen3 0.6B Lite for older phones), any GGUF from Hugging Face via search, free cloud chat with no download, 200+ cloud models through Pollinations, or your own OpenAI-compatible provider.
- **Many images at once.** Up to 20 images per request, generated in parallel and shown as a live-filling grid. Tap any image for a full-screen swipeable viewer with Save / Share / Open.
- **Video.** Short clips (Wan 2.2, Veo 3.1, Seedance and others from the live catalog) with an in-app player.
- **Audio.** Music and songs, text-to-speech with 11 voices, and sound effects, with an in-chat player.
- **Media library.** Everything you create is kept on the phone, filterable by type, with save, share and delete.
- Streaming Markdown chat, chat history, edit and regenerate, read aloud, voice dictation, tools (calculator, time, web search via SearXNG, webpage reader, GitHub, MCP connectors).

## Using it

1. Install the APK (allow "install unknown apps" for your browser or file manager if Android asks).
2. Open Pocket Buddy and tap **Download & start chatting**. This fetches Qwen3.8 2B Uncensored and drops you into the chat when it is loaded. In a hurry? Tap **Chat in the cloud now** to start without downloading anything.
3. Just talk to it. To create media, either:
   - type naturally: "create 6 images of a samurai cat in neon Tokyo", "make a video of waves crashing at sunset", "make a lofi beat with rain", "say good morning in a calm voice"; or
   - tap **＋** → **Create images / Create video / Create audio**. A chip appears above the composer, for example `Image ×4 · Z-Image Turbo`. Tap the chip to change the count (1–20), shape, model, length, audio type or voice. Then type your prompt and send.
4. Optional but recommended: **Settings → Media creation → Connect Pollinations**. Your browser opens, you sign in to Pollinations and approve Pocket Buddy, and the app picks up the key automatically. You can also paste a key from [enter.pollinations.ai/keys](https://enter.pollinations.ai/keys).

Media requests go straight to the media engine, so they work even before you download a chat model, and they do not depend on the chat model being able to call tools. When the chat model does support tools (Qwen3.8 does), you can also ask in a roundabout way ("I need wallpapers for my phone, make me a few") and it will call the image tool itself.

## What is free and what costs money

Media is created by [Pollinations](https://pollinations.ai), an open generative-AI service. Pocket Buddy has no server of its own and no subscription.

| Feature | Without an account | With a connected Pollinations account |
|---|---|---|
| Chat on the phone (GGUF) | Free, offline | Free, offline |
| Cloud chat | Free (GPT-OSS 20B) | Many more models; free and paid |
| Images | Free, about one every 45 seconds | Fast, 4 in parallel; free models (Z-Image Turbo, FLUX.1 Schnell, FLUX 1.1 Pro, DreamShaper, MAI Image…) plus paid ones |
| Speech | — | Free models (OpenAI TTS, MAI Voice) |
| Video | — | Paid with pollen (Wan 2.2 Fast is the cheapest) |
| Music and sound effects | — | Paid with pollen |

Every model in the pickers is labelled Free or Paid. Paid models draw pollen from your Pollinations balance. The sign-in from Pocket Buddy requests a key valid for up to a year with a 10-pollen spending cap; you can change the cap or revoke the key at any time on the Pollinations keys page.

## About "uncensored"

- The chat model runs on your phone, so nothing filters it. Qwen3.8 2B Uncensored is a community fine-tune ([atakhadivi/Qwen3.8-2B-Uncensored-GGUF](https://huggingface.co/atakhadivi/Qwen3.8-2B-Uncensored-GGUF)) built on the Qwen3.5 2B architecture. Qwen3.8 4B Heretic ([mradermacher/Qwen3.8-4B-Heretic-i1-GGUF](https://huggingface.co/mradermacher/Qwen3.8-4B-Heretic-i1-GGUF)) is a larger abliterated variant. The official Qwen3.8 releases are 27B+ and too large for phones.
- Image, video and audio models run on Pollinations and the upstream providers. Pocket Buddy sends `safe=false` where the API supports it, but some providers (for example Google Veo and ElevenLabs) apply their own content policies, which the app cannot override. Open models such as Z-Image, FLUX and Wan are generally the least restrictive.
- Generating video or music *on the phone itself* is not practical with current phone hardware, so those always use the cloud engine.

## For heavy users: your own ComfyUI

Settings → Media creation → **My ComfyUI server** sends image/video/audio jobs to a ComfyUI server you run (API-format workflow JSON with a `{{prompt}}` placeholder). Jobs are tracked in the Media library.

## Agent tools

- generate_image / generate_images (1–20) / generate_video / generate_audio (music, speech, sfx): shown inline in chat.
- calculator, current_time, web_search (your SearXNG), read_webpage (asks first).
- GitHub search, file read, issue list, issue create (asks first). MCP tools from connected servers (ask first).
- generation_status / cancel_generation for ComfyUI jobs.

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

## Known limitations

- On-device speed depends on the phone. On a mid-range phone the 2B default typically streams at a comfortable reading speed; the 4B model needs a flagship.
- Without a Pollinations account, image batches are slow (about one image every 45 seconds, because the free endpoint is rate-limited per network).
- Video and music cost pollen. If your balance or the key's spending cap runs out, the app shows Pollinations' error message; top up or raise the cap at enter.pollinations.ai.
- Tool calling quality depends on the model. Direct requests ("create …", "make a video …") and the ＋ menu always work regardless of the model.
- Web search needs your own SearXNG instance.

## Privacy and security

- Chats and on-device model files stay on the phone (app-private SQLite and storage).
- Media prompts go to Pollinations (or your ComfyUI server). Cloud chat prompts go to the provider you pick.
- Keys (Pollinations, providers, GitHub, ComfyUI, Hugging Face, voice) are stored in Android Keystore-backed secure storage.
- Generated files are stored privately in the app; Save copies them to your gallery under "Pocket Buddy".

## Documentation

- Architecture: docs/ARCHITECTURE.md
- Tooling and license inventory: docs/TOOLING.md
- Security policy: SECURITY.md
- Contributing: CONTRIBUTING.md

## License

Apache-2.0. Third-party dependencies, model weights, datasets, workflows, custom nodes and other assets retain their own licenses and terms.