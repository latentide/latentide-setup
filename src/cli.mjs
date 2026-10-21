import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiError, fetchModels, ping } from './api.mjs';
import { CLIENTS, detectInstalled, findClient } from './clients/index.mjs';
import { ConfigParseError } from './clients/json.mjs';
import { manualGuides } from './clients/manual.mjs';
import { CONSOLE_URL, DEFAULT_BASE_URL, ENV_KEY, maskKey, normalizeBaseUrl } from './constants.mjs';
import { Changeset, latestRun, markUndone, restoreFiles } from './fsx.mjs';
import { msg, setLang } from './i18n.mjs';
import { findModel } from './models.mjs';
import { ask, askSecret, confirm, isInteractive, readAll } from './prompt.mjs';

const VALUE_FLAGS = new Set(['--model', '--base-url', '--lang']);

export function parseArgs(argv) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('-')) { options._.push(arg); continue; }
    const [name, inline] = arg.split(/=(.*)/s, 2);
    if (VALUE_FLAGS.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(msg(`${name} 需要一个值`, `${name} needs a value`));
      options[name.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
    } else if (name === '-y' || name === '--yes') options.yes = true;
    else if (name === '-h' || name === '--help') options.help = true;
    else if (name === '-v' || name === '--version') options.version = true;
    else if (name === '--dry-run') options.dryRun = true;
    else if (name === '--no-ping') options.noPing = true;
    else if (name === '--key-stdin') options.keyStdin = true;
    else if (name === '--force') options.force = true;
    else throw new Error(msg(`不认识的参数 ${name}，运行 npx latentide --help 查看用法`, `Unknown option ${name}; run npx latentide --help`));
  }
  return options;
}

const ui = {
  out: (line = '') => process.stdout.write(`${line}\n`),
  ok: (line) => process.stdout.write(`${color('32', '✔')} ${line}\n`),
  warn: (line) => process.stdout.write(`${color('33', '!')} ${line}\n`),
  fail: (line) => process.stdout.write(`${color('31', '✖')} ${line}\n`)
};

function color(code, text) {
  return process.stdout.isTTY && !process.env.NO_COLOR ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function version() {
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  return pkg.version;
}

function help() {
  const ids = CLIENTS.map((client) => client.id).join(', ');
  return msg(`用法：
  npx latentide                         交互式配置（推荐）
  npx latentide setup <客户端...>        只配置指定客户端：${ids}
  npx latentide guide [客户端]           打印 Cursor、Trae、Cherry Studio 等需手动填写的客户端的填写说明
  npx latentide undo                    撤销上一次配置，还原原文件
  npx latentide list                    列出支持的客户端

选项：
  --key-stdin       从标准输入读 Key（脚本用）；也可以设置环境变量 ${ENV_KEY}
  --model <id>      默认模型（对需要选模型的客户端生效）
  --base-url <url>  网关地址，默认 ${DEFAULT_BASE_URL}
  --dry-run         只显示将要修改什么，不写入
  -y, --yes         不逐项确认
  --no-ping         写完不发测试请求
  --force           undo 时连你后来改过的文件也一并还原
  --lang zh|en      界面语言`, `Usage:
  npx latentide                         interactive setup (recommended)
  npx latentide setup <client...>       configure specific clients: ${ids}
  npx latentide guide [client]          show manual steps for Cursor, Trae, Cherry Studio, etc.
  npx latentide undo                    revert the last setup and restore original files
  npx latentide list                    list supported clients

Options:
  --key-stdin       read the API key from stdin (for scripts); or set ${ENV_KEY}
  --model <id>      default model for clients that need one
  --base-url <url>  gateway URL, default ${DEFAULT_BASE_URL}
  --dry-run         show what would change without writing
  -y, --yes         do not ask for confirmation
  --no-ping         skip the test request after writing
  --force           with undo: also restore files you changed afterwards
  --lang zh|en      interface language`);
}

export async function main(argv, deps = {}) {
  const options = parseArgs(argv);
  if (options.lang) setLang(options.lang);
  if (options.version) { ui.out(version()); return 0; }
  if (options.help) { ui.out(help()); return 0; }
  const ctx = {
    home: deps.home ?? os.homedir(),
    env: deps.env ?? process.env,
    platform: deps.platform ?? process.platform,
    fetchImpl: deps.fetchImpl ?? fetch,
    interactive: deps.interactive ?? isInteractive()
  };
  const [command = 'setup', ...rest] = options._;
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  switch (command) {
    case 'setup': return setup(rest, options, ctx, baseUrl);
    case 'undo': return undo(options, ctx);
    case 'guide': return guide(rest, baseUrl);
    case 'list': return list(ctx);
    default:
      // `npx latentide claude-code` 也当作 setup。
      if (findClient(command)) return setup(options._, options, ctx, baseUrl);
      ui.fail(msg(`不认识的命令 ${command}`, `Unknown command ${command}`));
      ui.out(help());
      return 2;
  }
}

async function readKey(options, ctx) {
  let key;
  if (options.keyStdin) key = (await readAll()).trim();
  else if (ctx.env[ENV_KEY]) {
    key = ctx.env[ENV_KEY].trim();
    ui.out(msg(`使用环境变量 ${ENV_KEY} 里的 Key`, `Using the key from ${ENV_KEY}`));
  }
  else if (ctx.interactive) key = await askSecret(msg(`粘贴你的微澜 API Key（在 ${CONSOLE_URL} 控制台创建）：`, `Paste your Latentide API key (create one at ${CONSOLE_URL}): `));
  if (!key) throw new Error(msg(`没有拿到 Key。交互运行，或用 --key-stdin / 环境变量 ${ENV_KEY} 传入。`, `No API key. Run interactively, or pass it via --key-stdin or ${ENV_KEY}.`));
  if (/\s/.test(key)) throw new Error(msg('Key 里不能有空格或换行，请重新复制。', 'The key must not contain spaces or line breaks.'));
  return key;
}

async function chooseClients(ids, ctx) {
  if (ids.length) {
    const unknown = ids.filter((id) => !findClient(id));
    if (unknown.length) throw new Error(msg(`不支持的客户端：${unknown.join(', ')}。运行 npx latentide list 查看支持列表，或 npx latentide guide 看手动配置说明。`,
      `Unsupported client(s): ${unknown.join(', ')}. Run npx latentide list, or npx latentide guide for manual steps.`));
    return ids.map(findClient);
  }
  const detected = detectInstalled(ctx);
  if (!ctx.interactive) {
    if (detected.length === 0) throw new Error(msg('没检测到支持的客户端，请在命令里指定，例如 npx latentide setup claude-code', 'No supported client detected; name one, e.g. npx latentide setup claude-code'));
    return detected;
  }
  ui.out(msg('\n可以自动配置的客户端：', '\nClients that can be configured automatically:'));
  CLIENTS.forEach((client, index) => {
    const mark = detected.includes(client) ? color('32', msg(' （已检测到）', ' (detected)')) : '';
    ui.out(`  ${index + 1}. ${client.name}${mark}`);
  });
  const fallback = detected.length ? detected : [];
  const hint = fallback.length ? msg(`回车 = 已检测到的 ${fallback.map((c) => c.name).join('、')}`, `Enter = detected: ${fallback.map((c) => c.name).join(', ')}`) : '';
  for (;;) {
    const answer = await ask(msg(`输入编号，多个用逗号隔开${hint ? `（${hint}）` : ''}：`, `Numbers, comma-separated${hint ? ` (${hint})` : ''}: `));
    if (!answer && fallback.length) return fallback;
    const picked = answer.split(/[,，\s]+/).filter(Boolean).map((token) => CLIENTS[Number(token) - 1] ?? findClient(token));
    if (picked.length && picked.every(Boolean)) return [...new Set(picked)];
    ui.warn(msg('没看懂，请输入列表里的编号', 'Please enter numbers from the list'));
  }
}

async function chooseModel(client, models, options, ctx) {
  const eligible = client.eligible(models);
  if (eligible.length === 0) return null;
  const preferred = client.preferences.map((id) => eligible.find((model) => model.id === id)).find(Boolean) ?? eligible[0];
  if (options.model) {
    const hit = findModel(eligible, options.model);
    if (hit) return hit.id;
    ui.warn(msg(`${client.name} 用不了 ${options.model}（该协议下不支持工具调用或不存在），改用 ${preferred.id}`,
      `${options.model} is not usable in ${client.name}; using ${preferred.id}`));
    return preferred.id;
  }
  if (!ctx.interactive || options.yes) return preferred.id;
  ui.out(msg(`\n${client.name} 可用的模型：`, `\nModels available in ${client.name}:`));
  eligible.forEach((model, index) => ui.out(`  ${String(index + 1).padStart(2)}. ${model.id}${model === preferred ? color('32', msg(' （推荐）', ' (recommended)')) : ''}`));
  for (;;) {
    const answer = await ask(msg(`选默认模型（编号或 ID，回车 = ${preferred.id}）：`, `Default model (number or ID, Enter = ${preferred.id}): `));
    if (!answer) return preferred.id;
    const hit = eligible[Number(answer) - 1] ?? findModel(eligible, answer);
    if (hit) return hit.id;
    ui.warn(msg('列表里没有这个模型', 'That model is not in the list'));
  }
}

async function setup(ids, options, ctx, baseUrl) {
  const apiKey = await readKey(options, ctx);
  let models;
  try {
    models = await fetchModels({ baseUrl, apiKey, fetchImpl: ctx.fetchImpl });
  } catch (error) {
    if (error instanceof ApiError) { ui.fail(error.message); return 1; }
    throw error;
  }
  ui.ok(msg(`Key 有效（${maskKey(apiKey)}），可用 ${models.length} 个模型`, `Key OK (${maskKey(apiKey)}), ${models.length} models available`));

  const clients = await chooseClients(ids, ctx);
  const changeset = new Changeset({ home: ctx.home, dryRun: options.dryRun });
  const planned = [];
  for (const client of clients) {
    const model = client.needsModel ? await chooseModel(client, models, options, ctx) : null;
    if (client.needsModel && !model) { ui.warn(msg(`${client.name}：这把 Key 下没有可用模型，跳过`, `${client.name}: no usable models for this key, skipped`)); continue; }
    const snapshot = changeset.snapshot();
    try {
      const result = client.plan(changeset, { ...ctx, apiKey, baseUrl, models, model });
      planned.push({ client, ...result });
    } catch (error) {
      changeset.rollback(snapshot);
      if (error instanceof ConfigParseError) { ui.fail(`${client.name}：${error.message}`); continue; }
      throw error;
    }
  }
  if (planned.length === 0) return 1;

  ui.out(msg('\n将要修改：', '\nAbout to change:'));
  for (const item of planned) {
    ui.out(`  ${item.client.name}`);
    for (const file of item.files) ui.out(`    ${file}`);
    for (const note of item.notes) ui.out(`    · ${note}`);
  }
  if (options.dryRun) {
    for (const entry of changeset.pending()) {
      ui.out(`\n--- ${entry.file}`);
      ui.out(entry.after.split(apiKey).join(maskKey(apiKey)));
    }
    ui.out(msg('\n（--dry-run：没有写入任何文件）', '\n(--dry-run: nothing was written)'));
    return 0;
  }
  if (ctx.interactive && !options.yes && !(await confirm(msg('确认写入？', 'Write these changes?')))) {
    ui.out(msg('已取消，没有改动任何文件。', 'Cancelled; nothing was changed.'));
    return 1;
  }
  const written = changeset.apply();
  ui.ok(msg(`已写入 ${written.length} 个文件，原文件备份在 ${changeset.backupDir}`, `Wrote ${written.length} file(s); backups in ${changeset.backupDir}`));
  ui.out(msg('  想撤销：npx latentide undo', '  To revert: npx latentide undo'));

  let failures = 0;
  if (!options.noPing) {
    const seen = new Set();
    for (const item of planned) {
      for (const target of item.pings) {
        const key = `${target.protocol}:${target.model}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const result = await ping({ baseUrl, apiKey, ...target, fetchImpl: ctx.fetchImpl }).catch((error) => ({ ok: false, error: error.message }));
        const label = `${item.client.name} · ${target.model}`;
        if (result.ok) ui.ok(msg(`${label} 测试请求成功，${(result.elapsedMs / 1000).toFixed(1)} 秒`, `${label} test request OK in ${(result.elapsedMs / 1000).toFixed(1)}s`));
        else {
          failures += 1;
          ui.fail(msg(`${label} 测试请求失败（HTTP ${result.status ?? '-'}）${result.error ?? ''}${result.requestId ? ` 请求 ID ${result.requestId}` : ''}`,
            `${label} test request failed (HTTP ${result.status ?? '-'}) ${result.error ?? ''}${result.requestId ? ` request ID ${result.requestId}` : ''}`));
        }
      }
    }
  }
  ui.out(msg('\n用 Cursor、Trae、Cherry Studio、Chatbox？运行 npx latentide guide 查看填写说明。', '\nUsing Cursor, Trae, Cherry Studio or Chatbox? Run npx latentide guide for manual steps.'));
  return failures ? 1 : 0;
}

function undo(options, ctx) {
  const run = latestRun(ctx.home);
  if (!run) { ui.out(msg('没有可以撤销的配置记录。', 'Nothing to undo.')); return 0; }
  const { restored, skipped } = restoreFiles(run, { force: options.force });
  for (const file of restored) ui.ok(msg(`已还原 ${file}`, `Restored ${file}`));
  for (const file of skipped) ui.warn(msg(`${file} 在配置之后被改过，未还原（加 --force 强制还原）`, `${file} changed after setup; not restored (use --force)`));
  if (skipped.length === 0) markUndone(run);
  return skipped.length ? 1 : 0;
}

function guide(ids, baseUrl) {
  const guides = manualGuides(baseUrl);
  const selected = ids.length ? guides.filter((item) => ids.includes(item.id)) : guides;
  if (selected.length === 0) {
    ui.fail(msg(`没有这个客户端的说明。可选：${guides.map((item) => item.id).join(', ')}`, `No guide for that client. Available: ${guides.map((item) => item.id).join(', ')}`));
    return 2;
  }
  for (const item of selected) {
    ui.out(`\n${item.name}`);
    item.steps().forEach((step, index) => ui.out(`  ${index + 1}. ${step}`));
  }
  ui.out(msg(`\nKey 在 ${CONSOLE_URL} 控制台创建；模型 ID 以控制台模型页为准。`, `\nCreate keys at ${CONSOLE_URL}; see the console's model page for model IDs.`));
  return 0;
}

function list(ctx) {
  const detected = detectInstalled(ctx);
  ui.out(msg('自动配置：', 'Automatic:'));
  for (const client of CLIENTS) ui.out(`  ${client.id.padEnd(14)} ${client.name}${detected.includes(client) ? msg(' （已检测到）', ' (detected)') : ''}`);
  ui.out(msg('手动配置（npx latentide guide <id>）：', 'Manual (npx latentide guide <id>):'));
  for (const item of manualGuides(DEFAULT_BASE_URL)) ui.out(`  ${item.id.padEnd(14)} ${item.name}`);
  return 0;
}
