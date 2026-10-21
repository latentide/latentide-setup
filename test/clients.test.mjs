import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Changeset } from '../src/fsx.mjs';
import { findClient } from '../src/clients/index.mjs';
import { ConfigParseError } from '../src/clients/json.mjs';
import { BLOCK_START } from '../src/env-persist.mjs';
import { readTopLevelString } from '../src/toml-edit.mjs';
import { API_KEY, ctxFor, read, tempHome, write } from './helpers.mjs';

function plan(id, home, extra = {}) {
  const client = findClient(id);
  const changeset = new Changeset({ home });
  const ctx = ctxFor(home, extra);
  const result = client.plan(changeset, { ...ctx, model: extra.model ?? client.preferences[0] });
  changeset.apply();
  return { result, changeset };
}

test('claude-code merges env into existing settings and drops a conflicting ANTHROPIC_API_KEY', (t) => {
  const home = tempHome(t);
  const settings = path.join(home, '.claude', 'settings.json');
  write(settings, JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, env: { FOO: '1', ANTHROPIC_API_KEY: 'old' } }));
  const { result } = plan('claude-code', home);
  const out = JSON.parse(read(settings));
  assert.deepEqual(out.permissions, { allow: ['Bash(ls)'] });
  assert.equal(out.env.FOO, '1');
  assert.equal(out.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(out.env.ANTHROPIC_BASE_URL, 'https://api.latentide.com');
  assert.equal(out.env.ANTHROPIC_AUTH_TOKEN, API_KEY);
  assert.equal(out.env.ANTHROPIC_MODEL, 'claude-sonnet-5-5');
  assert.equal(out.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-opus-5-5');
  assert.equal(out.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'claude-haiku-5-5');
  assert.equal(JSON.parse(read(path.join(home, '.claude.json'))).hasCompletedOnboarding, true);
  assert.deepEqual(result.pings, [{ protocol: 'messages', model: 'claude-sonnet-5-5' }]);
  if (process.platform !== 'win32') assert.equal(fs.statSync(settings).mode & 0o777, 0o600);
});

test('claude-code refuses to overwrite a settings file it cannot parse', (t) => {
  const home = tempHome(t);
  const settings = path.join(home, '.claude', 'settings.json');
  write(settings, '{ "env": { broken');
  assert.throws(() => plan('claude-code', home), ConfigParseError);
  assert.equal(read(settings), '{ "env": { broken');
});

test('codex adds a responses provider, keeps the rest of config.toml, and exports the key in the shell profile', (t) => {
  const home = tempHome(t);
  const config = path.join(home, '.codex', 'config.toml');
  write(config, '# mine\nmodel = "o3"\n\n[mcp_servers.x]\ncommand = "y"\n');
  write(path.join(home, '.zshrc'), 'export PATH="$HOME/bin:$PATH"\n');
  plan('codex', home);
  const text = read(config);
  assert.equal(readTopLevelString(text, 'model'), 'gpt-6.1-sol');
  assert.equal(readTopLevelString(text, 'model_provider'), 'latentide');
  assert.match(text, /\[model_providers\.latentide\]\nname = "Latentide"\nbase_url = "https:\/\/api\.latentide\.com"\nenv_key = "LATENTIDE_API_KEY"\nwire_api = "responses"/);
  assert.ok(text.includes('# mine') && text.includes('[mcp_servers.x]'));
  assert.ok(!text.includes(API_KEY), 'the key must not be written into config.toml');
  const zshrc = read(path.join(home, '.zshrc'));
  assert.ok(zshrc.startsWith('export PATH="$HOME/bin:$PATH"\n'));
  assert.ok(zshrc.includes(`export LATENTIDE_API_KEY='${API_KEY}'`));
});

test('codex run twice leaves a single provider table and a single env block', (t) => {
  const home = tempHome(t);
  plan('codex', home);
  plan('codex', home);
  const text = read(path.join(home, '.codex', 'config.toml'));
  assert.equal(text.match(/\[model_providers\.latentide\]/g).length, 1);
  assert.equal(read(path.join(home, '.zshrc')).split(BLOCK_START).length - 1, 1);
});

test('codex on Windows defers setx until apply and never runs it in dry-run', (t) => {
  const home = tempHome(t);
  const calls = [];
  const run = (...args) => calls.push(args);
  const client = findClient('codex');
  const dry = new Changeset({ home, dryRun: true });
  client.plan(dry, { ...ctxFor(home, { platform: 'win32' }), model: 'gpt-6.1-sol', run });
  dry.apply();
  assert.equal(calls.length, 0);
  assert.ok(!fs.existsSync(path.join(home, '.codex')));

  const real = new Changeset({ home });
  client.plan(real, { ...ctxFor(home, { platform: 'win32' }), model: 'gpt-6.1-sol', run });
  assert.equal(calls.length, 0, 'nothing runs before apply');
  real.apply();
  assert.deepEqual(calls.map(([command, args]) => [command, args]), [['setx', ['LATENTIDE_API_KEY', API_KEY]]]);
  assert.ok(!fs.existsSync(path.join(home, '.zshrc')), 'no shell profile on Windows');
});

test('kimi routes Messages-capable models to the anthropic provider and the rest to openai', (t) => {
  const home = tempHome(t);
  const config = path.join(home, '.kimi-code', 'config.toml');
  write(config, 'default_model = "kimi-code/k3"\n\n[providers."managed:kimi-code"]\ntype = "kimi"\n\n[models."kimi-code/k3"]\nprovider = "managed:kimi-code"\nmodel = "k3"\nmax_context_size = 1048576\n');
  plan('kimi', home, { model: 'glm-5.3' });
  const text = read(config);
  assert.equal(readTopLevelString(text, 'default_model'), 'latentide/glm-5.3');
  assert.ok(text.includes('[providers."managed:kimi-code"]'), 'existing provider kept');
  assert.match(text, /\[providers\.latentide-anthropic\]\ntype = "anthropic"\nbase_url = "https:\/\/api\.latentide\.com"\n/);
  assert.match(text, /\[providers\.latentide-openai\]\ntype = "openai"\nbase_url = "https:\/\/api\.latentide\.com\/v1"\n/);
  assert.match(text, /\[models\."latentide\/claude-sonnet-5-5"\]\nprovider = "latentide-anthropic"\nmodel = "claude-sonnet-5-5"\nmax_context_size = 1000000/);
  // glm-5.3 在 messages 上不支持工具，应走 openai
  assert.match(text, /\[models\."latentide\/glm-5\.3"\]\nprovider = "latentide-openai"/);
  assert.ok(!text.includes('no-tools-model'));
  plan('kimi', home, { model: 'glm-5.3' });
  assert.equal(read(config).match(/\[models\."latentide\/glm-5\.3"\]/g).length, 1);
});

test('kimi keeps using the legacy ~/.kimi directory when only that exists', (t) => {
  const home = tempHome(t);
  write(path.join(home, '.kimi', 'config.toml'), '');
  plan('kimi', home);
  assert.ok(fs.existsSync(path.join(home, '.kimi', 'config.toml')));
  assert.ok(!fs.existsSync(path.join(home, '.kimi-code')));
  assert.ok(read(path.join(home, '.kimi', 'config.toml')).includes('latentide-anthropic'));
});

test('workbuddy keeps other vendors, skips clashing IDs, and extends availableModels', (t) => {
  const home = tempHome(t);
  const file = path.join(home, '.workbuddy', 'models.json');
  write(file, JSON.stringify({
    models: [
      { id: 'gpt-6.1-sol', vendor: 'Other', url: 'https://other.example/v1/chat/completions', apiKey: 'x' },
      { id: 'stale', vendor: 'Latentide', url: 'old' }
    ],
    availableModels: ['gpt-6.1-sol', 'stale']
  }));
  const { result } = plan('workbuddy', home);
  const out = JSON.parse(read(file));
  const ids = out.models.map((entry) => `${entry.vendor}:${entry.id}`);
  assert.deepEqual(ids, ['Other:gpt-6.1-sol', 'Latentide:claude-sonnet-5-5', 'Latentide:claude-opus-5-5', 'Latentide:glm-5.3']);
  const sonnet = out.models[1];
  assert.equal(sonnet.url, 'https://api.latentide.com/v1/chat/completions');
  assert.equal(sonnet.apiKey, API_KEY);
  assert.equal(sonnet.supportsToolCall, true);
  assert.equal(sonnet.supportsImages, true);
  assert.equal(sonnet.maxInputTokens, 1_000_000);
  assert.equal(out.models[3].maxOutputTokens, undefined);
  assert.deepEqual(out.availableModels, ['gpt-6.1-sol', 'claude-sonnet-5-5', 'claude-opus-5-5', 'glm-5.3']);
  assert.ok(result.notes.some((note) => note.includes('gpt-6.1-sol')));
});

test('codebuddy writes the same format under ~/.codebuddy without creating availableModels', (t) => {
  const home = tempHome(t);
  plan('codebuddy', home);
  const out = JSON.parse(read(path.join(home, '.codebuddy', 'models.json')));
  assert.equal(out.models.length, 4);
  assert.equal(out.availableModels, undefined);
});

test('codebuddy honours CODEBUDDY_CONFIG_DIR, workbuddy always uses ~/.workbuddy', (t) => {
  const home = tempHome(t);
  const custom = path.join(home, 'custom-buddy');
  plan('codebuddy', home, { env: { CODEBUDDY_CONFIG_DIR: custom } });
  assert.ok(fs.existsSync(path.join(custom, 'models.json')));
  assert.ok(!fs.existsSync(path.join(home, '.codebuddy')));
  plan('workbuddy', home, { env: { CODEBUDDY_CONFIG_DIR: custom } });
  assert.ok(fs.existsSync(path.join(home, '.workbuddy', 'models.json')));
});
