import { msg } from '../i18n.mjs';

// 这些客户端的配置只能在界面里填（或存在应用私有的数据库里），工具不去改，只打印要填的值。
export function manualGuides(baseUrl) {
  return [
    {
      id: 'cursor',
      name: 'Cursor',
      steps: () => [
        msg('Settings → Models → API Keys，打开 OpenAI API Key 并粘贴你的 Key', 'Settings → Models → API Keys: enable OpenAI API Key and paste your key'),
        msg(`打开 Override OpenAI Base URL，填 ${baseUrl}/v1`, `Enable Override OpenAI Base URL and enter ${baseUrl}/v1`),
        msg('在模型列表里 Add model，填模型 ID（如 claude-sonnet-5-5）', 'Add a custom model with its ID (e.g. claude-sonnet-5-5)'),
        msg('提示：自定义地址对 Chat 类模式最稳定，Agent、Tab 补全不保证走这个地址', 'Note: the override is reliable for chat-style modes; Agent and Tab completion may not use it')
      ]
    },
    {
      id: 'trae',
      name: msg('Trae（国内版 / 国际版）', 'Trae (CN / international)'),
      steps: () => [
        msg('右上角设置 → 模型 → 添加模型，服务商选 OpenAI 或 Anthropic，模型选“自定义模型”', 'Settings → Models → Add model; provider OpenAI or Anthropic; model “Custom”'),
        msg(`OpenAI：请求地址填完整路径 ${baseUrl}/v1/chat/completions`, `OpenAI: enter the full URL ${baseUrl}/v1/chat/completions`),
        msg(`Anthropic：请求地址填 ${baseUrl}/v1/messages（Claude 模型推荐这个）`, `Anthropic: enter ${baseUrl}/v1/messages (recommended for Claude models)`),
        msg('提示：Trae v3.3.51 起不再自动补路径，只填域名会报错；Trae 不支持 Responses 协议', 'Note: since v3.3.51 Trae no longer appends the path; it does not support the Responses API')
      ]
    },
    {
      id: 'cherry-studio',
      name: 'Cherry Studio',
      steps: () => [
        msg('设置 → 模型服务 → 添加，提供商类型选 OpenAI（Claude 模型也可选 Anthropic）', 'Settings → Model Providers → Add; type OpenAI (or Anthropic for Claude models)'),
        msg(`API 地址填 ${baseUrl}（只填根地址，Cherry Studio 会自己补 /v1）`, `API host: ${baseUrl} (root only; Cherry Studio appends /v1)`),
        msg('粘贴 Key，点“管理”拉取模型列表，勾选要用的模型', 'Paste your key, click Manage to fetch models, and enable the ones you want')
      ]
    },
    {
      id: 'chatbox',
      name: 'Chatbox',
      steps: () => [
        msg('设置 → 模型提供方 → 添加，API 模式选 OpenAI API 兼容', 'Settings → Model Provider → Add; API mode “OpenAI API Compatible”'),
        msg(`API 主机填 ${baseUrl}/v1，API 路径保持 /chat/completions`, `API host ${baseUrl}/v1, API path /chat/completions`),
        msg('粘贴 Key，新建模型并填模型 ID', 'Paste your key and add models by ID')
      ]
    },
    {
      id: 'cline',
      name: 'Cline / Roo Code / Kilo Code',
      steps: () => [
        msg('Claude 模型：API Provider 选 Anthropic，勾选自定义 Base URL，填根地址', 'Claude models: provider Anthropic, enable custom base URL, enter the root URL'),
        msg(`其他模型：API Provider 选 OpenAI Compatible，Base URL 填 ${baseUrl}/v1`, `Other models: provider OpenAI Compatible, base URL ${baseUrl}/v1`),
        msg(`根地址：${baseUrl}`, `Root URL: ${baseUrl}`)
      ]
    }
  ];
}
