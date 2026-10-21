import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { main, parseArgs } from '../src/cli.mjs';
import { fetchModels, ApiError, ping } from '../src/api.mjs';
import { API_KEY, BASE_URL, fakeFetch, read, tempHome, write } from './helpers.mjs';

function deps(home, fetchImpl = fakeFetch()) {
  return { home, env: { LATENTIDE_API_KEY: API_KEY, PATH: '' }, platform: 'linux', shell: '/bin/bash', fetchImpl, interactive: false };
}

test('setup then undo restores the original files and removes only our shell block', async (t) => {
  const home = tempHome(t);
  const settings = path.join(home, '.claude', 'settings.json');
  write(settings, '{\n  "theme": "dark"\n}\n');
  write(path.join(home, '.bashrc'), 'alias ll="ls -l"\n');
  const fetchImpl = fakeFetch();
  assert.equal(await main(['setup', 'claude-code', 'codex', '-y'], deps(home, fetchImpl)), 0);
  assert.equal(JSON.parse(read(settings)).env.ANTHROPIC_AUTH_TOKEN, API_KEY);
  // 一次 /models + 两次测试请求（messages、responses）
  assert.deepEqual(fetchImpl.calls.map((call) => new URL(call.url).pathname), ['/models', '/v1/messages', '/v1/responses']);
  // 配置之后别的程序又往 .bashrc 追加了内容
  fs.appendFileSync(path.join(home, '.bashrc'), 'export NVM_DIR="$HOME/.nvm"\n');

  assert.equal(await main(['undo'], deps(home)), 0);
  assert.equal(read(settings), '{\n  "theme": "dark"\n}\n');
  assert.ok(!fs.existsSync(path.join(home, '.codex', 'config.toml')), 'files we created are removed');
  assert.equal(JSON.parse(read(path.join(home, '.claude.json'))).hasCompletedOnboarding, true, 'Claude Code state file is left alone');
  const bashrc = read(path.join(home, '.bashrc'));
  assert.ok(!bashrc.includes('LATENTIDE_API_KEY'));
  assert.ok(bashrc.includes('alias ll="ls -l"') && bashrc.includes('NVM_DIR'), 'other content survives');
  assert.equal(await main(['undo'], deps(home)), 0, 'second undo has nothing left to do');
});

test('undo skips files edited after setup unless --force', async (t) => {
  const home = tempHome(t);
  const settings = path.join(home, '.claude', 'settings.json');
  write(settings, '{}\n');
  await main(['setup', 'claude-code', '-y', '--no-ping'], deps(home));
  write(settings, '{"edited": true}\n');
  // Claude Code 自己改写 .claude.json 不应让 undo 报“被改过”
  write(path.join(home, '.claude.json'), '{"hasCompletedOnboarding": true, "numStartups": 3}\n');
  assert.equal(await main(['undo'], deps(home)), 1);
  assert.equal(read(settings), '{"edited": true}\n');
  assert.equal(await main(['undo', '--force'], deps(home)), 0);
  assert.equal(read(settings), '{}\n');
});

test('dry-run writes nothing and creates no backup', async (t) => {
  const home = tempHome(t);
  assert.equal(await main(['setup', 'claude-code', 'kimi', 'workbuddy', '--dry-run'], deps(home)), 0);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('a broken config skips that client but still configures the others', async (t) => {
  const home = tempHome(t);
  write(path.join(home, '.workbuddy', 'models.json'), 'not json');
  assert.equal(await main(['setup', 'workbuddy', 'claude-code', '-y', '--no-ping'], deps(home)), 0);
  assert.equal(read(path.join(home, '.workbuddy', 'models.json')), 'not json');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'settings.json')));
});

test('an invalid key stops before touching any file', async (t) => {
  const home = tempHome(t);
  assert.equal(await main(['setup', 'claude-code', '-y'], deps(home, fakeFetch({ status: 401 }))), 1);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('--model is honoured when the client can use it', async (t) => {
  const home = tempHome(t);
  await main(['setup', 'claude-code', '-y', '--no-ping', '--model', 'claude-opus-5-5'], deps(home));
  assert.equal(JSON.parse(read(path.join(home, '.claude', 'settings.json'))).env.ANTHROPIC_MODEL, 'claude-opus-5-5');
});

test('--base-url with a trailing /v1 is normalised', async (t) => {
  const home = tempHome(t);
  await main(['setup', 'claude-code', '-y', '--no-ping', '--base-url', 'https://staging.example.com/v1/'], deps(home));
  assert.equal(JSON.parse(read(path.join(home, '.claude', 'settings.json'))).env.ANTHROPIC_BASE_URL, 'https://staging.example.com');
});

test('unknown clients and options are rejected', async () => {
  await assert.rejects(main(['setup', 'cursor', '-y'], deps('/nonexistent')), /cursor/);
  assert.throws(() => parseArgs(['--nope']), /--nope/);
  assert.deepEqual(parseArgs(['setup', 'codex', '--model=gpt-6.1-sol', '-y']), { _: ['setup', 'codex'], model: 'gpt-6.1-sol', yes: true });
});

test('fetchModels reports an invalid key as an auth error and sends a Bearer header', async () => {
  const fetchImpl = fakeFetch({ status: 401 });
  await assert.rejects(fetchModels({ baseUrl: BASE_URL, apiKey: API_KEY, fetchImpl }), (error) => error instanceof ApiError && error.code === 'auth');
  assert.equal(fetchImpl.calls[0].init.headers.authorization, `Bearer ${API_KEY}`);
});

test('ping uses the right endpoint and a tiny token budget for each protocol', async () => {
  const fetchImpl = fakeFetch();
  for (const protocol of ['messages', 'responses', 'chat_completions']) {
    const result = await ping({ baseUrl: BASE_URL, apiKey: API_KEY, protocol, model: 'm', fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.requestId, 'req_test');
  }
  const bodies = fetchImpl.calls.map((call) => JSON.parse(call.init.body));
  assert.equal(bodies[0].max_tokens, 16);
  assert.equal(bodies[1].max_output_tokens, 16);
  assert.equal(bodies[2].max_tokens, 16);
  assert.deepEqual(fetchImpl.calls.map((call) => new URL(call.url).pathname), ['/v1/messages', '/v1/responses', '/v1/chat/completions']);
});
