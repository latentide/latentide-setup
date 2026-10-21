import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeModel } from '../src/api.mjs';

export const API_KEY = 'sk-test0000000000000000000000000000000000000abcd';
export const BASE_URL = 'https://api.latentide.com';

export function tempHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latentide-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cell({ tools = true, image = false } = {}) {
  return { streaming: true, tools, input_modalities: image ? ['image', 'text'] : ['text'], output_modalities: ['text'] };
}

/** 形状照抄网关 GET /models（gateway/app.mjs publicCatalog）。 */
export const MODELS_RESPONSE = {
  object: 'list',
  data: [
    { id: 'claude-sonnet-5-5', protocols: ['chat_completions', 'messages', 'responses'], per: { chat_completions: cell({ image: true }), messages: cell({ image: true }), responses: cell({ image: true }) }, ctx: 1_000_000, out: 128_000 },
    { id: 'claude-opus-5-5', protocols: ['chat_completions', 'messages', 'responses'], per: { chat_completions: cell(), messages: cell(), responses: cell() }, ctx: 1_000_000, out: 128_000 },
    { id: 'claude-haiku-5-5', protocols: ['messages'], per: { messages: cell() }, ctx: 200_000, out: 64_000 },
    { id: 'gpt-6.1-sol', protocols: ['chat_completions', 'responses'], per: { chat_completions: cell(), responses: cell() }, ctx: 400_000, out: 128_000 },
    { id: 'glm-5.3', protocols: ['chat_completions', 'messages', 'responses'], per: { chat_completions: cell(), messages: cell({ tools: false }), responses: cell() }, ctx: 200_000, out: null },
    { id: 'no-tools-model', protocols: ['chat_completions'], per: { chat_completions: cell({ tools: false }) }, ctx: null, out: null }
  ].map((model) => ({
    id: model.id,
    object: 'model',
    owned_by: 'latentide',
    latentide_capabilities: { protocols: model.protocols, context_window: model.ctx, max_output_tokens: model.out, per_protocol: model.per }
  }))
};

export const MODELS = MODELS_RESPONSE.data.map(normalizeModel);

/** 假的 fetch：记录请求，/models 返回上面的列表，推理请求一律 200。 */
export function fakeFetch({ status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const body = url.endsWith('/models') ? MODELS_RESPONSE : { ok: true };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-upstream-request-id': 'req_test' } });
  };
  impl.calls = calls;
  return impl;
}

export function read(file) {
  return fs.readFileSync(file, 'utf8');
}

export function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export function ctxFor(home, extra = {}) {
  return { home, env: {}, platform: 'linux', apiKey: API_KEY, baseUrl: BASE_URL, models: MODELS, ...extra };
}
