// 按行改 TOML：只动我们自己的顶层键和表，其余内容（包括注释、空行、键的顺序）原样保留。
// 不引入完整的 TOML 解析器：Codex、Kimi CLI 的配置都是“顶层键 + 若干表”，按表头切分就够了。
// 已知限制：多行字符串里如果有一行恰好长得像表头，会被误认为表头。

const HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;

/** 表名规范化：去掉点号两侧空白，并去掉引号，便于比较 `models."a/b"` 与 `models.a/b`。 */
export function normalizeTableName(name) {
  // 引号里的点号不是分隔符（如 models."glm-5.3"），所以不能直接 split('.')。
  const parts = [...name.matchAll(/"(?:[^"\\]|\\.)*"|'[^']*'|[^.\s"']+/g)].map((match) => match[0]);
  return parts.map((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith('"')) return JSON.parse(trimmed);
    if (trimmed.startsWith("'")) return trimmed.slice(1, -1);
    return trimmed;
  }).join('.');
}

function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [{ name: null, lines: [] }];
  for (const line of lines) {
    const match = line.match(HEADER);
    if (match && !line.trim().startsWith('#')) sections.push({ name: normalizeTableName(match[1]), lines: [line] });
    else sections.at(-1).lines.push(line);
  }
  return sections;
}

function joinSections(sections) {
  return sections.map((section) => section.lines.join('\n')).join('\n');
}

export function tomlString(value) {
  return JSON.stringify(String(value));
}

export function tomlValue(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  return tomlString(value);
}

/** 表名里有点号或斜杠的段要加引号。 */
export function tableName(...parts) {
  return parts.map((part) => (/^[A-Za-z0-9_-]+$/.test(part) ? part : tomlString(part))).join('.');
}

export function renderTable(name, entries) {
  const lines = [`[${name}]`];
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null) continue;
    lines.push(`${key} = ${tomlValue(value)}`);
  }
  return lines.join('\n');
}

/**
 * @param {string} text 原文件内容（可为空）
 * @param {object} edit
 * @param {Record<string, unknown>} [edit.topLevel] 要设置的顶层键
 * @param {(name: string) => boolean} [edit.removeTables] 返回 true 的表整段删除
 * @param {string[]} [edit.appendTables] 追加到文件末尾的表（已渲染好的文本）
 */
export function editToml(text, { topLevel = {}, removeTables = () => false, appendTables = [] }) {
  const sections = splitSections(text ?? '');
  const top = sections[0];
  for (const [key, value] of Object.entries(topLevel)) {
    const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
    const line = `${key} = ${tomlValue(value)}`;
    const index = top.lines.findIndex((existing) => pattern.test(existing));
    if (index >= 0) {
      top.lines[index] = line;
    } else {
      // 插在顶层最后一个非空行之后，保持与下面第一个表之间的空行。
      let insertAt = top.lines.length;
      while (insertAt > 0 && top.lines[insertAt - 1].trim() === '') insertAt -= 1;
      top.lines.splice(insertAt, 0, line);
    }
  }
  const kept = [top];
  for (const section of sections.slice(1)) {
    if (!removeTables(section.name)) { kept.push(section); continue; }
    // 被删的表末尾的注释通常是写给下一张表的（如 “# keep me” 紧挨着下一个表头），留下来。
    let lastContent = section.lines.length - 1;
    while (lastContent > 0 && /^\s*(#.*)?$/.test(section.lines[lastContent])) lastContent -= 1;
    const trailing = section.lines.slice(lastContent + 1);
    if (trailing.some((line) => line.trim().startsWith('#'))) kept.push({ name: null, lines: trailing });
  }
  let out = joinSections(kept).replace(/\s+$/, '');
  for (const table of appendTables) out += `${out ? '\n\n' : ''}${table}`;
  return `${out}\n`;
}

/** 读出顶层某个字符串键的值（仅用于展示和测试，不处理复杂值）。 */
export function readTopLevelString(text, key) {
  const top = splitSections(text ?? '')[0];
  for (const line of top.lines) {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (match) return JSON.parse(`"${match[1]}"`);
  }
  return null;
}
