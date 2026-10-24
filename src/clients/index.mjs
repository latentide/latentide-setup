import fs from 'node:fs';
import path from 'node:path';
import claudeCode from './claude-code.mjs';
import codex from './codex.mjs';
import kimi from './kimi.mjs';
import qwen from './qwen.mjs';
import droid from './droid.mjs';
import { codebuddy, workbuddy } from './buddy.mjs';
import { modelsFor } from '../models.mjs';

/** 能由工具直接写配置的客户端，按展示顺序排列。 */
export const CLIENTS = [claudeCode, codex, kimi, qwen, droid, workbuddy, codebuddy].map((client) => ({
  needsModel: true,
  eligible(models) { return modelsFor(models, client.protocol); },
  ...client
}));

export function findClient(id) {
  return CLIENTS.find((client) => client.id === id) ?? null;
}

/** 在 PATH 里找可执行文件（Windows 要考虑 PATHEXT）。 */
export function onPath(command, { env = process.env, platform = process.platform } = {}) {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  return dirs.some((dir) => exts.some((ext) => fs.existsSync(path.join(dir, command + ext))));
}

/** 本机看起来装了的客户端：有配置目录，或命令在 PATH 里。 */
export function detectInstalled(ctx) {
  return CLIENTS.filter((client) => client.detectPaths(ctx).some((p) => fs.existsSync(p))
    || client.commands.some((command) => onPath(command, ctx)));
}
