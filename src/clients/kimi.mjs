import fs from 'node:fs';
import path from 'node:path';
import { PROVIDER_ID } from '../constants.mjs';
import { msg } from '../i18n.mjs';
import { supports } from '../models.mjs';
import { editToml, normalizeTableName, renderTable, tableName } from '../toml-edit.mjs';

// Kimi CLI 的供给类型里，anthropic 与 openai_responses 在开源版（MoonshotAI/kimi-cli）和新版 Kimi Code
// 文档里都有；Chat Completions 在开源版叫 openai_legacy、新文档叫 openai，写错一个整份配置都加载失败，所以不用它。
// anthropic 供给用官方 anthropic SDK，base_url 填根地址，SDK 自己拼 /v1/messages。
// Claude 等支持 Messages 工具调用的模型走 anthropic，其余走 openai_responses。
// 每个模型一张 [models."latentide/<id>"] 表，/model 里能直接切换。
const ANTHROPIC = `${PROVIDER_ID}-anthropic`;
const RESPONSES = `${PROVIDER_ID}-responses`;
const DEFAULT_CONTEXT = 128_000;

function configDir({ home, env }) {
  if (env.KIMI_CODE_HOME) return env.KIMI_CODE_HOME;
  if (env.KIMI_SHARE_DIR) return env.KIMI_SHARE_DIR;
  // 开源版 Kimi CLI 用 ~/.kimi（KIMI_SHARE_DIR 可改），新版 Kimi Code 用 ~/.kimi-code（KIMI_CODE_HOME 可改）。
  // 新目录在就用新的；只有老目录在时用老目录；都没有时按新版文档用 ~/.kimi-code。
  const current = path.join(home, '.kimi-code');
  const legacy = path.join(home, '.kimi');
  if (!fs.existsSync(current) && fs.existsSync(legacy)) return legacy;
  return current;
}

/** 这个模型在 Kimi CLI 里走哪个供给；两种都不支持工具调用时返回 null。 */
function route(model) {
  if (supports(model, 'messages')) return { provider: ANTHROPIC, protocol: 'messages' };
  if (supports(model, 'responses')) return { provider: RESPONSES, protocol: 'responses' };
  return null;
}

export default {
  id: 'kimi',
  name: 'Kimi CLI',
  commands: ['kimi'],
  preferences: ['claude-sonnet-5-5', 'kimi-k3', 'claude-sonnet-5', 'deepseek-v4-pro'],

  eligible(models) {
    return models.filter((model) => route(model));
  },

  detectPaths(ctx) {
    return [configDir(ctx), path.join(ctx.home, '.kimi')];
  },

  plan(changeset, { home, env, apiKey, baseUrl, models, model }) {
    const file = path.join(configDir({ home, env }), 'config.toml');
    const usable = this.eligible(models);
    const providerTables = [
      renderTable(tableName('providers', ANTHROPIC), { type: 'anthropic', base_url: baseUrl, api_key: apiKey }),
      renderTable(tableName('providers', RESPONSES), { type: 'openai_responses', base_url: `${baseUrl}/v1`, api_key: apiKey })
    ];
    const modelTables = usable.map((entry) => renderTable(tableName('models', `${PROVIDER_ID}/${entry.id}`), {
      provider: route(entry).provider,
      model: entry.id,
      max_context_size: entry.contextWindow ?? DEFAULT_CONTEXT,
      display_name: `${entry.id} (Latentide)`
    }));
    const ours = (name) => name === normalizeTableName(tableName('providers', ANTHROPIC))
      || name === normalizeTableName(tableName('providers', RESPONSES))
      || name.startsWith(`models.${PROVIDER_ID}/`);
    const next = editToml(changeset.read(file), {
      topLevel: { default_model: `${PROVIDER_ID}/${model}` },
      removeTables: ours,
      appendTables: [...providerTables, ...modelTables]
    });
    changeset.write(file, next, { secret: true });
    const chosen = usable.find((entry) => entry.id === model);
    return {
      files: [file],
      notes: [msg(`写入 ${usable.length} 个模型，默认 latentide/${model}，可在 /model 里切换`, `Added ${usable.length} models, default latentide/${model}; switch with /model`)],
      pings: chosen ? [{ protocol: route(chosen).protocol, model }] : []
    };
  }
};
