# Contributing

1. Open an issue describing the problem or proposed capability.
2. Keep the presentation, provider adapters, agent tools, MCP, media and native platform services separated.
3. Add tests for tool parsing, provider payloads, URL validation and persistence changes.
4. Never commit API keys, personal endpoints, model weights or private datasets.
5. Document every new permission, network destination, dependency and license.
6. Run TypeScript validation and the Android debug build before requesting review.

## Architectural rule

The selected language model must not determine the application's capability set. Capabilities are registered by Pocket Buddy and dispatched to independent local or remote engines.

## Code review expectations

- Keep tool calls bounded and explicit.
- Ask before remote side effects.
- Treat tool output as untrusted data.
- Never claim that a media job or API action succeeded unless the service confirms it.
- Prefer device-aware behavior and graceful fallbacks over optimistic performance assumptions.
