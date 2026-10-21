import path from 'node:path';
import { PROVIDER_ID } from '../constants.mjs';
import { msg } from '../i18n.mjs';
import { editToml, renderTable, tableName } from '../toml-edit.mjs';
import { readJsonObject, stringifyJson } from './json.mjs';

// Codex 只剩 Responses 协议（wire_api = "chat" 已于 2026 年 2 月移除）。
// Key 的放法照 CC Switch：供给设 requires_openai_auth = true，Key 写进 ~/.codex/auth.json 的 OPENAI_API_KEY。
// 这样不用改 shell 配置，从 Dock / 开始菜单启动的 IDE 插件也能读到。
// 代价是覆盖了 auth.json 里原来的 ChatGPT 登录，原文件已备份，undo 可恢复。
const PROTOCOL = 'responses';

function configDir({ home, env }) {
  return env.CODEX_HOME || path.join(home, '.codex');
}

export default {
  id: 'codex',
  name: 'Codex',
  protocol: PROTOCOL,
  commands: ['codex'],
  preferences: ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-6-luna'],

  detectPaths(ctx) {
    return [configDir(ctx)];
  },

  plan(changeset, { home, env, apiKey, baseUrl, model }) {
    const dir = configDir({ home, env });
    const configFile = path.join(dir, 'config.toml');
    const authFile = path.join(dir, 'auth.json');
    // 先确认 auth.json 读得懂，读不懂就整个客户端跳过，不留半套配置。
    const auth = readJsonObject(changeset, authFile);
    const next = editToml(changeset.read(configFile), {
      topLevel: { model, model_provider: PROVIDER_ID },
      removeTables: (name) => name === `model_providers.${PROVIDER_ID}`,
      appendTables: [renderTable(tableName('model_providers', PROVIDER_ID), {
        name: 'Latentide',
        base_url: baseUrl,
        wire_api: 'responses',
        requires_openai_auth: true
      })]
    });
    changeset.write(configFile, next);
    changeset.write(authFile, stringifyJson({ OPENAI_API_KEY: apiKey }), { secret: true });
    const notes = [msg(`默认模型 ${model}，已在运行的 Codex 需要重启`, `Default model ${model}; restart Codex if it is running`)];
    if (auth.tokens || auth.auth_mode === 'chatgpt') {
      notes.push(msg('原来的 ChatGPT 登录已备份，想换回来运行 npx latentide undo', 'Your ChatGPT login was backed up; run npx latentide undo to switch back'));
    }
    return { files: [configFile, authFile], notes, pings: [{ protocol: PROTOCOL, model }] };
  }
};
