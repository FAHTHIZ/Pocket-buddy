# Pocket Buddy media host setup

Pocket Buddy is the Android control surface. **Wan 2.2** and **FLUX.1** run on a computer that you control, through ComfyUI. The APK does not contain these multi-gigabyte weights and does not try to run them on a typical phone.

## 1. Prepare the host computer

1. Install and launch ComfyUI on a computer with enough memory and GPU capacity for the selected workflow.
2. Install the model weights and all custom nodes required by the chosen workflow. The Wan 2.2 TI2V-5B workflow may use several model components (diffusion model, text encoder, VAE and other loaders); a single model filename field is not a replacement for installing all of them.
3. Open each workflow in ComfyUI and run it there once. Resolve missing-node, missing-weight and memory errors on the host before connecting Pocket Buddy.

Official model references:
- [Wan 2.2 repository and Apache 2.0 license](https://github.com/Wan-Video/Wan2.2)
- [Wan 2.2 TI2V-5B weights](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)
- [FLUX.1 Schnell weights and Apache 2.0 license](https://huggingface.co/black-forest-labs/FLUX.1-schnell)
- [FLUX.1 Dev weights and license information](https://huggingface.co/black-forest-labs/FLUX.1-dev)

FLUX.1 Dev has non-commercial model-license terms. Prefer Schnell when you need the Apache 2.0 model license.

## 2. Make ComfyUI reachable from your phone

For a home setup, put the phone and host computer on the same trusted Wi-Fi network. Start ComfyUI listening on the private network interface (for example, using its `--listen 0.0.0.0` option), then allow the ComfyUI port through the computer's firewall for the **Private** network profile only.

Find the host computer's private IPv4 address and enter an address like:

```text
http://192.168.1.20:8188
```

The actual address and port depend on your network and ComfyUI launch settings. Do not port-forward an unauthenticated ComfyUI instance to the public internet. For a host outside your private network, use HTTPS and an authenticated reverse proxy.

Pocket Buddy accepts plain HTTP only for private hostnames/IP ranges. Public endpoints must use HTTPS.

## 3. Export API-format workflows

Create and test two separate workflows:

- **Image workflow:** FLUX.1 Schnell or FLUX.1 Dev.
- **Video workflow:** Wan 2.2 TI2V-5B.

In ComfyUI, export each workflow in **API format** (not the normal UI workflow JSON). Pocket Buddy substitutes these template strings in string values throughout the API workflow:

| Template | Replaced with |
|---|---|
| `{{prompt}}` | The text prompt entered in Pocket Buddy |
| `{{model}}` | The optional checkpoint filename entered in Settings |
| `{{input_image}}` | The uploaded source image path for Wan image-to-video |
| `{{shape}}`, `{{width}}`, `{{height}}` | The selected aspect ratio and suggested pixel dimensions |
| `{{duration}}`, `{{count}}` | The selected clip length and requested batch count |

Paste the API JSON into the corresponding field in **Pocket Buddy → Settings → Your media server**.

For FLUX, the optional Schnell/Dev checkpoint field is useful when the workflow uses a single checkpoint loader that accepts one filename. For Wan 2.2 workflows with multiple model components, configure each loader with the correct installed filename inside ComfyUI; you can leave Pocket Buddy's single optional video checkpoint field blank unless your workflow has one matching field.

### Image-to-video with a source photo

To let Pocket Buddy pass a selected photo into a Wan image-to-video workflow, set the Load Image node's filename input to the literal `{{input_image}}` before exporting API format. Pocket Buddy uploads the selected photo to ComfyUI first, then substitutes the returned input filename. If the workflow does not contain this token, it remains a text-to-video workflow.

## 4. Connect Pocket Buddy

1. Open **Settings → Your media server**.
2. Enter the ComfyUI address and optional bearer token (for example, a token enforced by your reverse proxy).
3. Paste the image and video API workflows.
4. Set checkpoint filenames only where your workflow contains `{{model}}`.
5. Tap **Test ComfyUI server & workflows**, then save.

The test checks API reachability and whether the workflow's node classes exist. It cannot prove that weights are installed or that a full generation will fit in the host's memory.

## 5. Use it from the phone

In chat, tap **＋ → Create images** or **Create video**. Write the prompt and send. For image-to-video, attach a photo as well; the workflow must contain `{{input_image}}`. Pocket Buddy polls job status and downloads completed outputs into its app-private media folder so the media library can preview, play, share and save them locally.

## 6. Photo and video understanding in chat

Tap **＋ → Attach photo or video** to add up to three files (120 MB maximum per file). Pocket Buddy imports the original into app-private storage. For a vision-capable API chat model, it sends a resized photo or up to four selected video frames to the API endpoint you configured. The phone does the resizing and frame extraction.

The built-in local GGUF chat path is text-only. It keeps attachments on the phone but cannot visually interpret them. To ask questions about an image or video, switch to a vision-capable model under **Settings → My API endpoint**. Only send photos or videos to an endpoint you control or trust.

## Troubleshooting

- **Connection refused:** check the host IP, port, Wi-Fi network and firewall. The phone and host must be able to reach each other.
- **HTTP rejected:** HTTP works only for private-LAN ComfyUI addresses. Use HTTPS for a public host.
- **Missing node classes:** open the workflow on the ComfyUI host, install the missing nodes and restart ComfyUI.
- **Checkpoint not found:** enter the exact filename shown in ComfyUI's model loader, or pin it directly in the workflow.
- **Workflow accepted but fails:** the API node check does not validate model weights, GPU memory, custom-node versions or workflow parameter compatibility.
- **Photo upload rejected:** use a supported image type and verify that the workflow contains `{{input_image}}` in the Load Image filename input.
