import path from 'node:path';
import { VENDOR_NAME } from '../constants.mjs';
import { msg } from '../i18n.mjs';
import { readJsonObject, stringifyJson } from './json.mjs';

// Qwen Code（QwenLM/qwen-code）把自带模型放在 ~/.qwen/settings.json 的 modelProviders.openai 数组里，
// 每条 {id, name, baseUrl, envKey}，envKey 指向同一文件 env 对象里的变量。格式和目录规则照 magpie
// internal/agent/qwen.go（MIT）。env 里的变量名用 LATENTIDE 专属名，避免被 shell 里同名变量盖掉；
// 靠这个 envKey 区分哪些条目是我们写的。security.auth.selectedType = "openai" 让它启动时不再弹登录选择。
const PROTOCOL = 'chat_completions';
const ENV_KEY = 'LATENTIDE_QWEN_API_KEY';

const dir = ({ home, env = {} }) => env.QWEN_HOME || path.join(home, '.qwen');

export default {
  id: 'qwen',
  name: 'Qwen Code',
  protocol: PROTOCOL,
  commands: ['qwen'],
  preferences: ['qwen3.8-max', 'claude-sonnet-5-5', 'deepseek-v4-pro', 'kimi-k3'],

  detectPaths(ctx) {
    return [dir(ctx)];
  },

  plan(changeset, { home, env, apiKey, baseUrl, models, model }) {
    const file = path.join(dir({ home, env }), 'settings.json');
    const config = readJsonObject(changeset, file);
    const providers = config.modelProviders && typeof config.modelProviders === 'object' ? config.modelProviders : {};
    const existing = Array.isArray(providers.openai) ? providers.openai : [];
    const theirs = existing.filter((entry) => entry?.envKey !== ENV_KEY);
    const usable = this.eligible(models);
    const v1 = `${baseUrl}/v1`;
    const ours = usable.map((entry) => ({
      id: entry.id,
      name: `${entry.id} (${VENDOR_NAME})`,
      baseUrl: v1,
      envKey: ENV_KEY,
      ...(entry.contextWindow ? { generationConfig: { contextWindowSize: entry.contextWindow } } : {})
    }));
    const next = {
      ...config,
      env: { ...(config.env && typeof config.env === 'object' ? config.env : {}), [ENV_KEY]: apiKey },
      modelProviders: { ...providers, openai: [...theirs, ...ours] },
      model: { ...(config.model && typeof config.model === 'object' ? config.model : {}), name: model, baseUrl: v1 },
      security: { ...(config.security ?? {}), auth: { ...(config.security?.auth ?? {}), selectedType: 'openai' } }
    };
    changeset.write(file, stringifyJson(next), { secret: true });
    return {
      files: [file],
      notes: [msg(`写入 ${ours.length} 个模型，默认 ${model}，可在 /model 里切换`, `Added ${ours.length} models, default ${model}; switch with /model`)],
      pings: [{ protocol: PROTOCOL, model }]
    };
  }
};

