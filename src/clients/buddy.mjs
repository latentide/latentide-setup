import path from 'node:path';
import { VENDOR_NAME } from '../constants.mjs';
import { msg } from '../i18n.mjs';
import { modelsFor, pickDefault, supportsImages } from '../models.mjs';
import { readJsonObject, stringifyJson } from './json.mjs';

// 腾讯的 WorkBuddy 与 CodeBuddy Code 用同一种 models.json：只支持 OpenAI Chat Completions，
// url 要填完整接口路径（…/v1/chat/completions）。改动后客户端自动重新加载，不用重启。
const PROTOCOL = 'chat_completions';
const PREFERENCES = ['claude-sonnet-5-5', 'deepseek-v4-pro', 'glm-5.3', 'kimi-k3'];

function makeBuddy({ id, name, dirName, dirEnv, commands }) {
  const dir = ({ home, env = {} }) => (dirEnv && env[dirEnv]) || path.join(home, dirName);
  return {
    id,
    name,
    protocol: PROTOCOL,
    commands,
    preferences: PREFERENCES,
    // models.json 没有“默认模型”，用户在客户端里自己选；这里不问模型。
    needsModel: false,

    detectPaths(ctx) {
      return [dir(ctx)];
    },

    plan(changeset, { home, env, apiKey, baseUrl, models }) {
      const file = path.join(dir({ home, env }), 'models.json');
      const config = readJsonObject(changeset, file);
      const existing = Array.isArray(config.models) ? config.models : [];
      const theirs = existing.filter((entry) => entry?.vendor !== VENDOR_NAME);
      const taken = new Set(theirs.map((entry) => entry?.id));
      const usable = modelsFor(models, PROTOCOL);
      // 模型 ID 会原样发给接口，不能加前缀；和用户已有的别家条目重名时让给对方，并提示。
      const clashes = usable.filter((entry) => taken.has(entry.id)).map((entry) => entry.id);
      const ours = usable.filter((entry) => !taken.has(entry.id)).map((entry) => ({
        id: entry.id,
        name: `${entry.id} (Latentide)`,
        vendor: VENDOR_NAME,
        url: `${baseUrl}/v1/chat/completions`,
        apiKey,
        ...(entry.contextWindow ? { maxInputTokens: entry.contextWindow } : {}),
        ...(entry.maxOutputTokens ? { maxOutputTokens: entry.maxOutputTokens } : {}),
        supportsToolCall: true,
        supportsImages: supportsImages(entry, PROTOCOL)
      }));
      const next = { ...config, models: [...theirs, ...ours] };
      // availableModels 是可选的白名单：用户原来有，就把我们的模型加进去，否则新模型在下拉框里看不到。
      if (Array.isArray(config.availableModels)) {
        const previousOurs = new Set(existing.filter((entry) => entry?.vendor === VENDOR_NAME).map((entry) => entry.id));
        const kept = config.availableModels.filter((modelId) => !previousOurs.has(modelId));
        next.availableModels = [...kept, ...ours.map((entry) => entry.id).filter((modelId) => !kept.includes(modelId))];
      }
      changeset.write(file, stringifyJson(next), { secret: true });
      const pingModel = pickDefault(usable.filter((entry) => !taken.has(entry.id)), PROTOCOL, PREFERENCES)?.id;
      const notes = [msg(`写入 ${ours.length} 个模型，在 ${name} 的模型下拉框里选带 (Latentide) 的即可`, `Added ${ours.length} models; pick one marked (Latentide) in ${name}'s model menu`)];
      if (clashes.length) notes.push(msg(`这些模型 ID 已被你的其他配置占用，未覆盖：${clashes.join(', ')}`, `Skipped model IDs already used by your other entries: ${clashes.join(', ')}`));
      return { files: [file], notes, pings: pingModel ? [{ protocol: PROTOCOL, model: pingModel }] : [] };
    }
  };
}

// WorkBuddy 5.x 只读 ~/.workbuddy（它启动时把 CODEBUDDY_CONFIG_DIR 指到这里），~/.codebuddy 是旧版遗留，
// Owner 2026-10-21 在 WorkBuddy v5.8.3 上确认。CodeBuddy Code 认 CODEBUDDY_CONFIG_DIR，没设时用 ~/.codebuddy。
export const workbuddy = makeBuddy({ id: 'workbuddy', name: 'WorkBuddy', dirName: '.workbuddy', commands: [] });
export const codebuddy = makeBuddy({ id: 'codebuddy', name: 'CodeBuddy Code', dirName: '.codebuddy', dirEnv: 'CODEBUDDY_CONFIG_DIR', commands: ['codebuddy'] });
