import path from 'node:path';
import { PROVIDER_ID, VENDOR_NAME } from '../constants.mjs';
import { msg } from '../i18n.mjs';
import { supports, supportsImages } from '../models.mjs';
import { readJsonObject, stringifyJson } from './json.mjs';

// Factory Droid CLI 的 BYOK：~/.factory/settings.json 的 customModels 数组，provider 取
// anthropic（Messages，baseUrl 填根地址，SDK 自己加 /v1）、openai（Responses）、
// generic-chat-completion-api（Chat Completions）。选择时用 "custom:<id>"，默认模型写在
// sessionDefaultSettings.model。格式照 magpie internal/agent/droid.go（MIT）。
// Chat Completions 上不声明图片能力的话 droid 会当作不支持，所以 noImageSupport 总是写出。
const ID_PREFIX = `custom:${PROVIDER_ID}/`;

const dir = ({ home, env = {} }) => (env.FACTORY_HOME_OVERRIDE ? path.join(env.FACTORY_HOME_OVERRIDE, '.factory') : path.join(home, '.factory'));

function route(model) {
  if (supports(model, 'messages')) return { provider: 'anthropic', protocol: 'messages' };
  if (supports(model, 'responses')) return { provider: 'openai', protocol: 'responses' };
  if (supports(model, 'chat_completions')) return { provider: 'generic-chat-completion-api', protocol: 'chat_completions' };
  return null;
}

export default {
  id: 'droid',
  name: 'Factory Droid',
  commands: ['droid'],
  preferences: ['claude-sonnet-5-5', 'gpt-6.1-sol', 'deepseek-v4-pro', 'kimi-k3'],

  eligible(models) {
    return models.filter((model) => route(model));
  },

  detectPaths(ctx) {
    return [dir(ctx)];
  },

  plan(changeset, { home, env, apiKey, baseUrl, models, model }) {
    const file = path.join(dir({ home, env }), 'settings.json');
    const config = readJsonObject(changeset, file);
    const existing = Array.isArray(config.customModels) ? config.customModels : [];
    const theirs = existing.filter((entry) => !String(entry?.id ?? '').startsWith(ID_PREFIX));
    const usable = this.eligible(models);
    const ours = usable.map((entry) => {
      const { provider, protocol } = route(entry);
      return {
        model: entry.id,
        id: `${ID_PREFIX}${entry.id}`,
        displayName: `${entry.id} (${VENDOR_NAME})`,
        baseUrl: provider === 'anthropic' ? baseUrl : `${baseUrl}/v1`,
        apiKey,
        provider,
        ...(entry.contextWindow ? { maxContextLimit: entry.contextWindow } : {}),
        ...(entry.maxOutputTokens ? { maxOutputTokens: entry.maxOutputTokens } : {}),
        noImageSupport: !supportsImages(entry, protocol)
      };
    });
    const next = {
      ...config,
      customModels: [...theirs, ...ours],
      sessionDefaultSettings: { ...(config.sessionDefaultSettings ?? {}), model: `${ID_PREFIX}${model}` }
    };
    changeset.write(file, stringifyJson(next), { secret: true });
    const chosen = usable.find((entry) => entry.id === model);
    return {
      files: [file],
      notes: [msg(`写入 ${ours.length} 个自定义模型，默认 ${model}，可在 /model 的 Custom models 里切换`, `Added ${ours.length} custom models, default ${model}; switch under Custom models in /model`)],
      pings: chosen ? [{ protocol: route(chosen).protocol, model }] : []
    };
  }
};
