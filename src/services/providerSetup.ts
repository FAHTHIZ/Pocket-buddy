type ProviderSetupResult = { baseUrl: string; model: string };

type JsonResult = {
  response: Response;
  data: any;
};

function normalizeProviderBase(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Paste a valid provider URL, including https://.');
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    throw new Error('Provider URLs must use HTTPS so your API key and prompts stay protected.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Do not put API keys or other credentials inside the URL. Paste the key in the API key field.');
  }

  let path = parsed.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(?:chat\/completions|models)$/i, '');
  if (!path || path === '/') path = '/v1';
  parsed.pathname = path;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

async function requestJson(url: string, init: RequestInit = {}): Promise<JsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let data: any = {};
    if (raw.trim()) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = {};
      }
    }
    return { response, data };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('The provider did not respond within 20 seconds.');
    }
    throw new Error(error instanceof Error ? error.message : 'Could not reach the provider.');
  } finally {
    clearTimeout(timer);
  }
}

function modelIds(payload: any): string[] {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .map((item: any) => typeof item?.id === 'string' ? item.id.trim() : '')
    .filter((id: string) => id && !/(embedding|rerank|moderation|whisper|speech|tts|transcription)/i.test(id));
}

function providerHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(apiKey.trim() ? { Authorization: 'Bearer ' + apiKey.trim() } : {}),
  };
}

async function testModel(baseUrl: string, model: string, apiKey: string): Promise<void> {
  const { response, data } = await requestJson(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: providerHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      temperature: 0,
      max_tokens: 8,
      stream: false,
    }),
  });

  if (!response.ok) {
    const message = typeof data?.error?.message === 'string' ? data.error.message : '';
    throw new Error('Model check failed (HTTP ' + response.status + '). ' + message.slice(0, 180));
  }
  if (!Array.isArray(data?.choices) || data.choices.length === 0) {
    throw new Error('The provider responded, but did not return a chat completion. Check that this is a chat model endpoint.');
  }
}

export async function discoverAndTestProvider(
  rawUrl: string,
  apiKey: string,
  requestedModel = '',
): Promise<ProviderSetupResult> {
  const baseUrl = normalizeProviderBase(rawUrl);
  const headers = providerHeaders(apiKey);
  const requested = requestedModel.trim();
  let discovered: string[] = [];

  const modelsResult = await requestJson(baseUrl + '/models', { method: 'GET', headers });
  if (modelsResult.response.ok) {
    discovered = modelIds(modelsResult.data);
  }

  const candidates = requested ? [requested] : discovered.slice(0, 8);
  if (candidates.length === 0) {
    if (!modelsResult.response.ok) {
      throw new Error(
        'The provider URL is reachable only if its models endpoint is enabled. Enter the model ID supplied by your provider in the optional Model field, then connect again.'
      );
    }
    throw new Error('No chat models were found. Enter the exact model ID supplied by your provider.');
  }

  let lastError: unknown = null;
  for (const model of candidates) {
    try {
      await testModel(baseUrl, model, apiKey);
      return { baseUrl, model };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('The provider connection could not be verified. Check the URL, API key and model ID.');
}
