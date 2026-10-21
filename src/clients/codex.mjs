import path from 'node:path';
import { ENV_KEY, PROVIDER_ID } from '../constants.mjs';
import { persistEnv } from '../env-persist.mjs';
import { msg } from '../i18n.mjs';
import { editToml, renderTable, tableName } from '../toml-edit.mjs';

// Codex 只剩 Responses 协议（wire_api = "chat" 已于 2026 年 2 月移除）。
// 自定义供给的 Key 只能从 env_key 指定的环境变量读，所以要把变量写进用户环境。
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

  plan(changeset, { home, env, apiKey, baseUrl, model, platform, shell, run }) {
    const file = path.join(configDir({ home, env }), 'config.toml');
    const provider = tableName('model_providers', PROVIDER_ID);
    const next = editToml(changeset.read(file), {
      topLevel: { model, model_provider: PROVIDER_ID },
      removeTables: (name) => name === `model_providers.${PROVIDER_ID}`,
      appendTables: [renderTable(provider, {
        name: 'Latentide',
        base_url: baseUrl,
        env_key: ENV_KEY,
        wire_api: 'responses'
      })]
    });
    changeset.write(file, next);
    const envTargets = persistEnv(changeset, { name: ENV_KEY, value: apiKey, home, platform, shell, run });
    return {
      files: [file, ...envTargets],
      notes: [msg(`Key 写进了环境变量 ${ENV_KEY}，请重开终端（或 IDE）后再启动 Codex`, `The key is stored in ${ENV_KEY}; open a new terminal (or restart your IDE) before starting Codex`)],
      pings: [{ protocol: PROTOCOL, model }]
    };
  }
};
