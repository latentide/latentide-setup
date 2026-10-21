import fs from 'node:fs';
import path from 'node:path';
import { PROVIDER_ID } from '../constants.mjs';
import { msg } from '../i18n.mjs';
import { supports } from '../models.mjs';
import { editToml, normalizeTableName, renderTable, tableName } from '../toml-edit.mjs';

// Kimi CLI（Kimi Code）原生支持 anthropic / openai / openai_responses 三种供给类型。
// 这里建两个供给：Claude 等支持 Messages 工具调用的模型走 anthropic，其余走 openai（Chat Completions）。
// 每个模型一张 [models."latentide/<id>"] 表，/model 里能直接切换。
const ANTHROPIC = `${PROVIDER_ID}-anthropic`;
const OPENAI = `${PROVIDER_ID}-openai`;
const DEFAULT_CONTEXT = 128_000;

function configDir({ home, env }) {
  if (env.KIMI_CODE_HOME) return env.KIMI_CODE_HOME;
  const current = path.join(home, '.kimi-code');
  const legacy = path.join(home, '.kimi');
  // 老版本 Kimi CLI 用 ~/.kimi，新版本用 ~/.kimi-code；只有老目录在时沿用老目录。
  if (!fs.existsSync(current) && fs.existsSync(path.join(legacy, 'config.toml'))) return legacy;
  return current;
}

/** 这个模型在 Kimi CLI 里走哪个供给；两种都不支持工具调用时返回 null。 */
function route(model) {
  if (supports(model, 'messages')) return { provider: ANTHROPIC, protocol: 'messages' };
  if (supports(model, 'chat_completions')) return { provider: OPENAI, protocol: 'chat_completions' };
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
      renderTable(tableName('providers', OPENAI), { type: 'openai', base_url: `${baseUrl}/v1`, api_key: apiKey })
    ];
    const modelTables = usable.map((entry) => renderTable(tableName('models', `${PROVIDER_ID}/${entry.id}`), {
      provider: route(entry).provider,
      model: entry.id,
      max_context_size: entry.contextWindow ?? DEFAULT_CONTEXT,
      display_name: `${entry.id} (Latentide)`
    }));
    const ours = (name) => name === normalizeTableName(tableName('providers', ANTHROPIC))
      || name === normalizeTableName(tableName('providers', OPENAI))
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
