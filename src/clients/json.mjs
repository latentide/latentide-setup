import { msg } from '../i18n.mjs';

export class ConfigParseError extends Error {}

/** 读 JSON 配置。文件不存在当空对象；解析失败就停下，绝不覆盖一份读不懂的文件。 */
export function readJsonObject(changeset, file) {
  const text = changeset.read(file);
  if (text === null || text.trim() === '') return {};
  let value;
  try {
    value = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new ConfigParseError(msg(`${file} 不是合法的 JSON（${error.message}），为避免覆盖你的配置，已跳过。修好后再运行一次。`,
      `${file} is not valid JSON (${error.message}). Skipped to avoid overwriting it; fix it and run again.`));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigParseError(msg(`${file} 的顶层不是对象，已跳过。`, `${file} does not contain a JSON object. Skipped.`));
  }
  return value;
}

export function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
