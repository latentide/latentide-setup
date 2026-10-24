import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 一次运行里所有文件改动都经过这里：改之前先备份原文件，最后写一份清单，
 * `latentide undo` 按清单原样还原（原来没有的文件就删掉）。
 */
export class Changeset {
  constructor({ home, dryRun = false, now = new Date() }) {
    this.home = home;
    this.dryRun = dryRun;
    this.runId = now.toISOString().replace(/[:.]/g, '-');
    this.backupDir = path.join(home, '.latentide', 'backups', this.runId);
    this.files = new Map();
  }

  read(file) {
    if (this.files.has(file)) return this.files.get(file).after;
    try { return fs.readFileSync(file, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.secret] 内容含 Key，文件权限收紧为 0600
   * @param {'restore'|'keep'} [options.undo] undo 方式：整份还原，或不还原（客户端自己频繁改写的状态文件）
   */
  write(file, content, { secret = false, undo = 'restore' } = {}) {
    if (!this.files.has(file)) {
      let before = null;
      try { before = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.files.set(file, { before, after: content, secret, undo });
    } else {
      const entry = this.files.get(file);
      entry.after = content;
      entry.secret ||= secret;
    }
  }

  /** 某个客户端规划到一半出错时，用它撤回这个客户端已暂存的改动。 */
  snapshot() {
    return new Map([...this.files].map(([file, entry]) => [file, { ...entry }]));
  }

  rollback(snapshot) {
    this.files = snapshot;
  }

  /** 暂存的改动（内容有变化的文件）。 */
  pending() {
    return [...this.files].filter(([, entry]) => entry.before !== entry.after).map(([file, entry]) => ({ file, ...entry }));
  }

  /** 真正落盘。返回改动过的文件列表（内容没变的不算）。 */
  apply() {
    const changed = [...this.files].filter(([, entry]) => entry.before !== entry.after);
    if (this.dryRun || changed.length === 0) return changed.map(([file]) => file);
    fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    const manifest = { version: 1, runId: this.runId, files: [] };
    changed.forEach(([file, entry], index) => {
      let backup = null;
      if (entry.before !== null) {
        backup = `${index}-${path.basename(file)}`;
        writeAtomic(path.join(this.backupDir, backup), entry.before, 0o600);
      }
      manifest.files.push({ path: file, backup, undo: entry.undo, written: sha256(entry.after) });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeAtomic(file, entry.after, entry.secret ? 0o600 : undefined);
    });
    writeAtomic(path.join(this.backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
    return changed.map(([file]) => file);
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function writeAtomic(file, content, mode) {
  const tmp = `${file}.latentide-tmp-${process.pid}`;
  let finalMode = mode;
  if (finalMode === undefined) {
    // 保留原文件权限；新文件用默认权限。
    try { finalMode = fs.statSync(file).mode & 0o777; } catch { finalMode = undefined; }
  }
  fs.writeFileSync(tmp, content, finalMode === undefined ? undefined : { mode: finalMode });
  if (finalMode !== undefined) fs.chmodSync(tmp, finalMode);
  fs.renameSync(tmp, file);
}

export function backupsRoot(home) {
  return path.join(home, '.latentide', 'backups');
}

/** 最近一次还没撤销的运行。 */
export function latestRun(home) {
  const root = backupsRoot(home);
  let names = [];
  try { names = fs.readdirSync(root); } catch { return null; }
  const runs = names.filter((name) => !name.endsWith('.undone') && fs.existsSync(path.join(root, name, 'manifest.json'))).sort();
  if (runs.length === 0) return null;
  const dir = path.join(root, runs.at(-1));
  return { dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) };
}

/**
 * 按清单还原文件。文件在我们写入之后又被改过的，默认跳过并报告，免得冲掉用户后来的修改；
 * force 时照样还原。
 */
export function restoreFiles(run, { force = false } = {}) {
  const restored = [];
  const skipped = [];
  for (const entry of [...run.manifest.files].reverse()) {
    let current = null;
    try { current = fs.readFileSync(entry.path, 'utf8'); } catch { /* 已被删除 */ }
    if (entry.undo === 'keep') continue;
    if (!force && current !== null && entry.written && sha256(current) !== entry.written) {
      skipped.push(entry.path);
      continue;
    }
    if (entry.backup) {
      fs.mkdirSync(path.dirname(entry.path), { recursive: true });
      writeAtomic(entry.path, fs.readFileSync(path.join(run.dir, entry.backup), 'utf8'));
    } else {
      fs.rmSync(entry.path, { force: true });
    }
    restored.push(entry.path);
  }
  return { restored, skipped };
}

export function markUndone(run) {
  fs.renameSync(run.dir, `${run.dir}.undone`);
}
