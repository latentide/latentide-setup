import { msg } from './i18n.mjs';

const TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(fetchImpl, url, init) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new ApiError(msg(`连不上 ${new URL(url).host}：${error.message}`, `Cannot reach ${new URL(url).host}: ${error.message}`), { code: 'network' });
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应按原样报状态码 */ }
  return { res, body };
}

function errorText(body) {
  return body?.error?.message ?? body?.message ?? '';
}

/**
 * 拉取这把 Key 真正可用的模型。网关 GET /models 按客户可见性和协议投影，
 * 每个模型带 latentide_capabilities.per_protocol（见网关 app.mjs 的 publicCatalog）。
 */
export async function fetchModels({ baseUrl, apiKey, fetchImpl = fetch }) {
  const { res, body } = await request(fetchImpl, `${baseUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' }
  });
  if (res.status === 401 || res.status === 403) {
    throw new ApiError(msg('Key 无效或已停用，请到控制台确认。', 'The API key is invalid or disabled. Check it in the console.'), { status: res.status, code: 'auth' });
  }
  if (!res.ok || !Array.isArray(body?.data)) {
    throw new ApiError(msg(`获取模型列表失败（HTTP ${res.status}）${errorText(body)}`, `Failed to list models (HTTP ${res.status}) ${errorText(body)}`), { status: res.status });
  }
  return body.data.map(normalizeModel).filter(Boolean);
}

export function normalizeModel(entry) {
  if (!entry?.id) return null;
  const caps = entry.latentide_capabilities ?? {};
  const perProtocol = caps.per_protocol ?? {};
  return {
    id: entry.id,
    protocols: caps.protocols ?? Object.keys(perProtocol),
    perProtocol,
    contextWindow: caps.context_window ?? null,
    maxOutputTokens: caps.max_output_tokens ?? null
  };
}

/** 发一次最小的真实请求，确认 Key、协议和模型三者对得上。 */
export async function ping({ baseUrl, apiKey, protocol, model, fetchImpl = fetch }) {
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const prompt = 'Reply with the single word: ok';
  const shapes = {
    messages: ['/v1/messages', { model, max_tokens: 16, messages: [{ role: 'user', content: prompt }] }],
    responses: ['/v1/responses', { model, max_output_tokens: 16, input: prompt }],
    chat_completions: ['/v1/chat/completions', { model, max_tokens: 16, messages: [{ role: 'user', content: prompt }] }]
  };
  const [path, payload] = shapes[protocol];
  const started = Date.now();
  const { res, body } = await request(fetchImpl, `${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const elapsedMs = Date.now() - started;
  const requestId = res.headers.get('x-upstream-request-id') ?? res.headers.get('x-latentide-request-id') ?? null;
  if (!res.ok) {
    return { ok: false, status: res.status, elapsedMs, requestId, error: errorText(body) };
  }
  return { ok: true, status: res.status, elapsedMs, requestId };
}
