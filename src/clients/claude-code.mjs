import path from 'node:path';
import { msg } from '../i18n.mjs';
import { pickDefault } from '../models.mjs';
import { readJsonObject, stringifyJson } from './json.mjs';

// Claude Code 走 Anthropic Messages。配置写在 settings.json 的 env 里（Claude Code 启动时注入），
// 网关文档：ANTHROPIC_BASE_URL 填根域名，SDK 自己拼 /v1/messages。
const PROTOCOL = 'messages';

const PREFERENCES = {
  main: ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-sonnet-4-6'],
  opus: ['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8'],
  sonnet: ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6'],
  haiku: ['claude-haiku-5-5', 'claude-haiku-4-5']
};

function configDir({ home, env }) {
  return env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
}

export default {
  id: 'claude-code',
  name: 'Claude Code',
  protocol: PROTOCOL,
  commands: ['claude'],
  preferences: PREFERENCES.main,

  detectPaths(ctx) {
    return [configDir(ctx), path.join(ctx.home, '.claude.json')];
  },

  plan(changeset, { home, env, apiKey, baseUrl, models, model }) {
    const settingsFile = path.join(configDir({ home, env }), 'settings.json');
    const settings = readJsonObject(changeset, settingsFile);
    const tier = (name) => pickDefault(models, PROTOCOL, PREFERENCES[name])?.id;
    const next = { ...(settings.env ?? {}) };
    // 同时存在 ANTHROPIC_API_KEY 与 AUTH_TOKEN 时 Claude Code 会提示冲突，并可能用错 Key。
    delete next.ANTHROPIC_API_KEY;
    Object.assign(next, {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: tier('opus'),
      ANTHROPIC_DEFAULT_SONNET_MODEL: tier('sonnet'),
      ANTHROPIC_DEFAULT_HAIKU_MODEL: tier('haiku')
    });
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    changeset.write(settingsFile, stringifyJson({ ...settings, env: next }), { secret: true });

    // 没登录过官方账号时，Claude Code 首次启动会停在登录页；标记引导已完成后直接用上面的 Key（CC Switch 同样做法）。
    // 这个文件 Claude Code 自己会频繁改写，undo 时不还原（留着这个标记也无害）。
    const stateFile = env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json');
    const state = readJsonObject(changeset, stateFile);
    // VS Code 里的 Claude Code 插件另读 ~/.claude/config.json：primaryApiKey 设为任意值它才不弹登录，
    // 实际请求仍用 settings.json 里的 Key。做法照 CC Switch（src-tauri/src/claude_plugin.rs）。
    const pluginFile = path.join(configDir({ home, env }), 'config.json');
    const plugin = readJsonObject(changeset, pluginFile);
    const files = [settingsFile];
    if (plugin.primaryApiKey !== 'any') {
      changeset.write(pluginFile, stringifyJson({ ...plugin, primaryApiKey: 'any' }));
      files.push(pluginFile);
    }
    if (state.hasCompletedOnboarding !== true) {
      changeset.write(stateFile, stringifyJson({ ...state, hasCompletedOnboarding: true }), { undo: 'keep' });
      files.push(stateFile);
    }

    return {
      files,
      notes: [msg(`默认模型 ${model}，/model 里的 opus / sonnet / haiku 分别对应 ${tier('opus') ?? '-'} / ${tier('sonnet') ?? '-'} / ${tier('haiku') ?? '-'}`,
        `Default model ${model}; /model opus / sonnet / haiku map to ${tier('opus') ?? '-'} / ${tier('sonnet') ?? '-'} / ${tier('haiku') ?? '-'}`)],
      pings: [{ protocol: PROTOCOL, model }]
    };
  }
};
