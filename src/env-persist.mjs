import path from 'node:path';
import { execFileSync } from 'node:child_process';

// 有的客户端（Codex）只从环境变量读 Key。这里把 `export LATENTIDE_API_KEY=…` 写进 shell 配置，
// 用成对的标记行包住，重复运行时整段替换，undo 时整段删除。Windows 用 setx 写用户环境变量。

export const BLOCK_START = '# >>> latentide >>>';
export const BLOCK_END = '# <<< latentide <<<';

/** 当前用户会读到的 shell 配置文件。 */
export function shellProfiles({ home, shell = process.env.SHELL ?? '', platform = process.platform }) {
  const name = path.basename(shell);
  if (name === 'fish') return [{ file: path.join(home, '.config', 'fish', 'conf.d', 'latentide.fish'), syntax: 'fish' }];
  if (name === 'zsh') return [{ file: path.join(home, '.zshrc'), syntax: 'posix' }];
  if (name === 'bash') {
    const files = [{ file: path.join(home, '.bashrc'), syntax: 'posix' }];
    // macOS 的终端默认开登录 shell，只读 .bash_profile。
    if (platform === 'darwin') files.push({ file: path.join(home, '.bash_profile'), syntax: 'posix' });
    return files;
  }
  return [{ file: path.join(home, '.profile'), syntax: 'posix' }];
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function renderBlock(name, value, syntax) {
  const line = syntax === 'fish' ? `set -gx ${name} ${shellQuote(value)}` : `export ${name}=${shellQuote(value)}`;
  return `${BLOCK_START}\n# Added by \`npx latentide\`; remove with \`npx latentide undo\`.\n${line}\n${BLOCK_END}`;
}

export function removeBlock(text) {
  if (!text) return text ?? '';
  const pattern = new RegExp(`\\n*${escape(BLOCK_START)}[\\s\\S]*?${escape(BLOCK_END)}\\n?`, 'g');
  return text.replace(pattern, '\n').replace(/^\n+/, '');
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function upsertBlock(text, name, value, syntax) {
  const base = removeBlock(text ?? '').replace(/\s+$/, '');
  return `${base ? `${base}\n\n` : ''}${renderBlock(name, value, syntax)}\n`;
}

/**
 * 把环境变量持久化到用户环境里。POSIX 走 changeset（可 dry-run、可 undo），
 * Windows 直接调用 setx，并在清单里记下原值供 undo 使用。
 */
export function persistEnv(changeset, { name, value, home, platform = process.platform, shell, run = execFileSync }) {
  if (platform === 'win32') {
    const previous = process.env[name] ?? null;
    changeset.recordEnv({ kind: 'windows-user-env', name, previous }, () => run('setx', [name, value], { stdio: 'ignore' }));
    return [`HKCU\\Environment\\${name}`];
  }
  const profiles = shellProfiles({ home, shell, platform });
  for (const { file, syntax } of profiles) {
    changeset.write(file, upsertBlock(changeset.read(file), name, value, syntax), { secret: syntax === 'fish', undo: 'remove-env-block' });
  }
  return profiles.map((profile) => profile.file);
}

/** undo 时还原 Windows 用户环境变量。 */
export function restoreEnv(actions, { platform = process.platform, run = execFileSync } = {}) {
  for (const action of [...actions].reverse()) {
    if (action.kind !== 'windows-user-env' || platform !== 'win32') continue;
    if (action.previous === null) run('reg', ['delete', 'HKCU\\Environment', '/v', action.name, '/f'], { stdio: 'ignore' });
    else run('setx', [action.name, action.previous], { stdio: 'ignore' });
  }
}
