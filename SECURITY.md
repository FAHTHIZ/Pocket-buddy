# Security policy

## Reporting

Do not publish credentials, private MCP endpoints, API tokens or exploitable vulnerabilities in public issues. Use GitHub private vulnerability reporting for sensitive disclosures.

## Application security boundaries

- Provider, GitHub, ComfyUI and MCP credentials are stored using Android Keystore-backed storage.
- Conversation history and models are stored in app-specific storage.
- API providers receive prompts and relevant conversation messages when the user selects remote inference.
- Search requests go only to the configured SearXNG instance.
- MCP servers receive tool arguments for the operations the user invokes.
- ComfyUI receives prompts and workflow data for generation.
- Tool rounds are bounded; remote MCP calls and GitHub issue creation require confirmation.
- Retrieved content is untrusted data and must not be treated as executable instructions.
- The webpage reader is a convenience reader, not a hardened network sandbox. Do not use it as a public proxy or for untrusted URL fetching.
- Never log API credentials or include them in crash reports.

## Release checklist

Before a public release:
- review exported components, deep links, permissions and backup behavior;
- verify the secure-storage implementation on supported Android versions;
- audit redirect handling and network destinations;
- fuzz tool argument parsing and provider response handling;
- review MCP permissions and confirmation UX;
- create a dependency/SBOM report and verify all notices/licenses;
- test with real local models, API providers, MCP servers and ComfyUI workflows;
- test device thermal and low-memory behavior;
- sign release builds using a private release key stored outside the repository.
