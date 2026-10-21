// 网关对外地址见网关仓库 docs/API.md：Base URL 统一为根域名，不带 /v1。
export const DEFAULT_BASE_URL = 'https://api.latentide.com';
export const CONSOLE_URL = 'https://latentide.com';
export const DOCS_URL = 'https://latentide.com/docs';

/** 写进 shell 配置、Codex env_key 的变量名。 */
export const ENV_KEY = 'LATENTIDE_API_KEY';

/** 我们写进各客户端配置里的条目统一带这个标记，重复运行时据此替换、不碰用户自己的条目。 */
export const PROVIDER_ID = 'latentide';
export const VENDOR_NAME = 'Latentide';

export function normalizeBaseUrl(url) {
  const trimmed = String(url).trim().replace(/\/+$/, '');
  // 用户可能照着别家教程填了 /v1，网关两种都认，这里统一成根地址再按客户端需要拼接。
  return trimmed.replace(/\/v1$/, '');
}

export function maskKey(key) {
  const text = String(key ?? '');
  return text.length <= 4 ? '****' : `****${text.slice(-4)}`;
}
