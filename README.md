# latentide-setup

一条命令把 AI 编程客户端接入[微澜 Latentide](https://latentide.com) API 网关：一个 Key、一个 Base URL，Claude、GPT、DeepSeek、GLM、Kimi 等模型随便切。

```sh
npx latentide
```

粘贴 Key → 选本机装了的客户端 → 选默认模型 → 确认写入 → 自动发一条测试请求确认能用。改动前会备份原配置，`npx latentide undo` 一键还原。

[English](#english)

## 支持的客户端

| 客户端 | 协议 | 改哪个文件 | 方式 |
|---|---|---|---|
| Claude Code（CLI / VS Code 插件） | Anthropic Messages | `~/.claude/settings.json`（`env` 字段）、`~/.claude/config.json`、`~/.claude.json` | 自动 |
| Codex（CLI / IDE 插件） | OpenAI Responses | `~/.codex/config.toml`、`~/.codex/auth.json` | 自动 |
| Kimi CLI（Kimi Code） | Anthropic Messages + OpenAI Responses | `~/.kimi-code/config.toml`（开源版 `~/.kimi/config.toml`） | 自动 |
| WorkBuddy（腾讯） | OpenAI Chat | `~/.workbuddy/models.json` | 自动 |
| CodeBuddy Code（腾讯） | OpenAI Chat | `~/.codebuddy/models.json`（设了 `CODEBUDDY_CONFIG_DIR` 时写到那里） | 自动 |
| Cursor、Trae、Cherry Studio、Chatbox、Cline / Roo Code | — | 只能在界面里填 | `npx latentide guide` 打印填写说明 |

模型列表不写死在工具里：运行时从网关 `GET /models` 拉取这把 Key 能用的模型，并且只列出“在该客户端所用协议下支持工具调用”的模型，免得配完就报错。

## 用法

```sh
npx latentide                          # 交互式（推荐）
npx latentide setup claude-code codex  # 只配置指定客户端
npx latentide guide trae               # 手动配置说明
npx latentide undo                     # 撤销上一次配置
npx latentide list                     # 支持的客户端，以及本机检测到了哪些
```

| 选项 | 作用 |
|---|---|
| `--key-stdin` | 从标准输入读 Key，适合脚本；也可以设置环境变量 `LATENTIDE_API_KEY` |
| `--model <id>` | 默认模型（Claude Code、Codex、Kimi CLI） |
| `--dry-run` | 只打印将要写入的内容（Key 打码），不改任何文件 |
| `-y, --yes` | 不逐项确认，模型用推荐值 |
| `--no-ping` | 写完不发测试请求 |
| `--force` | `undo` 时连配置之后你又改过的文件也还原 |
| `--base-url <url>` | 网关地址，默认 `https://api.latentide.com` |
| `--lang zh\|en` | 界面语言，默认跟随系统 |

脚本里使用：

```sh
printf '%s' "$KEY" | npx latentide setup claude-code --key-stdin -y
```

不要把 Key 直接写在命令行参数里，会留在 shell 历史中。

## 它会做什么、不会做什么

- 只改上表列出的文件，只动我们自己的字段和条目（`latentide` 供给、`vendor: "Latentide"` 的模型），你原有的配置、注释和顺序都保留。
- 配置文件解析不了（比如 JSON 写坏了）就跳过这个客户端，不会覆盖。
- 写入前把原文件备份到 `~/.latentide/backups/<时间>/`。`undo` 发现你在配置之后又改过某个文件，默认不还原它，避免冲掉你的修改。唯一例外是 `~/.claude.json`：工具只在里面加了 `hasCompletedOnboarding`（跳过官方登录页），这个文件 Claude Code 自己一直在改写，undo 时保留不动。
- 含 Key 的文件权限设为 `0600`（Windows 除外）。
- 测试请求每个客户端最多一条，`max_tokens` 为 16，按正常价格计费，费用可以忽略；不想发就加 `--no-ping`。
- 不收集任何数据，除了访问网关本身不联网。零依赖，只用 Node 自带模块。

## 常见问题

**Codex 原来登录的 ChatGPT 账号呢？** 和 [CC Switch](https://github.com/farion1231/cc-switch) 一样，Key 写进 `~/.codex/auth.json`，会替换掉里面的 ChatGPT 登录。原文件已备份，`npx latentide undo` 就能换回来。已经打开的 Codex 需要重启。

**想换回官方账号？** `npx latentide undo`。

**国内 npx 下载慢？** `npx --registry=https://registry.npmmirror.com latentide`。

## 开发

```sh
npm test   # node --test，无需安装依赖
```

每个客户端一个写入器，放在 `src/clients/`：`plan()` 只把改动暂存到 `Changeset`，统一确认后再落盘。新增客户端时请附上实测过的客户端版本号。

需要 Node 18.17 及以上。

---

## English

Point your AI coding tools at the [Latentide](https://latentide.com) API gateway with one command:

```sh
npx latentide
```

Paste your key, pick the clients installed on this machine, choose a default model, confirm, and a tiny test request verifies everything works. Original files are backed up first, and `npx latentide undo` restores them.

Automatic setup: **Claude Code**, **Codex**, **Kimi CLI**, **WorkBuddy**, **CodeBuddy Code**. For Cursor, Trae, Cherry Studio, Chatbox and Cline / Roo Code, `npx latentide guide` prints what to fill in.

Models come from the gateway's live `GET /models`, filtered to those that support tool calls on the protocol each client uses. Only our own entries are touched, unparseable config files are skipped rather than overwritten, files holding the key are created with mode `0600`, and nothing is collected. No dependencies; Node 18.17+.

## License

MIT
