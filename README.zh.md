# dsh-session-link

在 DSH 会话之间传上下文，不再「下载 → 传输 → 解压」。

`dsh-session-link` 是 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的会话链接插件。会话 header 一键复制当前会话的引用；任意其他会话拿到引用即可把整段对话读回来，得到干净的 `user:`/`assistant:` 文本。

[![license](https://badgen.net/badge/license/MIT/green)](LICENSE)
[![dsh-plugin](https://badgen.net/badge/topic/dsh-plugin/8257D0)](https://github.com/topics/dsh-plugin)
[![English](https://badgen.net/badge/lang/English/blue)](README.md)

<div align="center">

| 复制 | @ 提及 | 读取 |
|---|---|---|
| header 按钮 → 剪贴板得到 `@session-<uuid>` | `@` 菜单按标题列出会话 | `session_read` 投影出对话全文 |

</div>

## 什么时候用得上

- **会话 A 摸清了一件事，会话 B 要用。** 没有它就是导出日志、传文件、解压、手读 zstd JSONL；有了它，A 的 header 按钮复制 `@session-<uuid>`，粘到 B 里模型调 `session_read` 就读到了。
- **引用始终是一等对象。** `@session-<uuid>` 全 ASCII，输入框和气泡里都渲染成彩色 chip，不是一坨要解释的文本。
- **读回来的是人话，不是原始流。** `session_read` 把事件流投影成对话行，跳过 chunk/工具/推理噪声；7MB 日志通常读回 ~60KB 对话。

## 你会得到什么

- **header「🔗 复制 Session ID」按钮** — 一键复制当前会话的 `@session-<uuid>`。纯剪贴板操作，不走宿主。
- **`@` 引用源 `session`** — 输入框打 `@` 按标题列出本机全部会话（可按标题/id 搜索）；选中即插入 chip 形式的引用。
- **chip 上色** — `@session-…` 引用在气泡里蓝底白字，精确作用域，不影响其他 `@` 提及。
- **`session_read` 工具** — 模型解析 `@session-<uuid>` / `dsh-session:` URI / `@标题`，得到 `{ sessionId, title, cwd, logPath, seqRange, transcript, truncated }`。只读、live 优先、沙箱会话可用。

## 安装

钉在某个 release 上装。构建产物已入库，装的时候不编译、也不经过任何 registry：

```sh
dsh plugin --profile web add "github:jinhuang712/dsh-session-link#v0.1.0"
# 重启 dsh web，刷新页面
```

想跟未发布的提交，就跟 `main`：

```sh
dsh plugin --profile web add "github:jinhuang712/dsh-session-link#main"
```

或者从本地 checkout 以 link 方式装，改了代码刷新页面即可生效：

```sh
git clone https://github.com/jinhuang712/dsh-session-link.git
dsh plugin --profile web add "link:$PWD/dsh-session-link"
```

如果你的 dsh profile 目录是 pnpm workspace，pnpm 会要求往 root 加依赖时带 `-w`，透传即可：`dsh plugin --profile web add -w …`。

装好（并重启一次）后，header 按钮、`@` 菜单分组和 `session_read` 工具在所有会话常驻可用。配套 skill `dsh-session-link` 随安装注册（`dsh.skills` 声明），教模型何时、如何读取引用。

## 怎么用

**分享会话**：打开它 → 点 header「🔗 复制 Session ID」→ 粘贴到任意会话输入框（自动显示 chip）→ 发送。

**免切换选会话**：输入框打 `@` → 在 `session` 分组按标题找到会话 → 插入。

**读取引用**：模型调用

```json
session_read({ "link": "@session-7fc2d98e-…" })
```

| 输入 | 行为 |
|---|---|
| `@session-<uuid>` | 精确直达，推荐 — 按钮复制的即此格式 |
| `dsh-session:<b64>` | 兼容旧链接载荷里的 URI 形式 |
| `@标题` | 按标题精确匹配；无/多重匹配返回候选与 id，改用 id 重试 |

可选参数：`maxChars`（投影预算，默认 64000）、`truncate`（`"tail"` 保最近 — 默认；`"head"` 保最早）、`raw`（调试：原始 JSONL 前 200000 字符）。

## 边界（实测，不是猜的）

- 中文标题（`@分析…`）不成 chip — shipped 的 `@` 提及正则无 `/u` 标志。复制格式因此用 id 不用标题。
- `@标题` 解析依赖宿主 `sessionQuery` 的标题快照；不可用时工具会明说并引导用 id 形式。
- 读取只读、live 优先：`sessionQuery.readSession` 读到运行中会话的当前状态；`logPath` 只解析路径供参考，从不写。

## 架构

- **Host 半**（`lib/index.mjs`）：Cordis 入口
  - `defineTool` 注册 `session_read`；`execute` 解析引用、经 `sessionQuery` 解析标题、投影 JSONL 事件流并按预算截断
  - 无 webServer 路由 — 复制按钮是纯剪贴板
- **Client 半**（`src/` → `lib/client.js`）：`__ModuleLoader__.load` bundle
  - `runtime.js` 从 loader 的 `require` 绑定宿主 React — 从不打包，插件与宿主共享同一 React 实例
  - `copy-button.js` header 按钮；`mention.js` `@` 引用源；`chips.js` MutationObserver 上色
- **Skill**（`skills/dsh-session-link/SKILL.md`）：随安装注册的用法指南
- **`docs/`**：设计过程存档（中文）— 实证记录、边界测量与被否决的备选方案

### 开发

`lib/client.js` 与其 source map 是构建产物，入库是为了 GitHub 一行安装。改 `src/`，然后：

```sh
pnpm install
pnpm build      # esbuild src/index.js -> lib/client.js + lib/client.js.map
```

## 验证

装没装上：

- `__DSH_BOOT__` 包含 `dsh-session-link` 客户端行，且 `/plugins/dsh-session-link/client.js` 返回 200
- `cordis_inspect_query`（Tool.listTools）列出 `session_read`

再跑一遍闭环：

| 看哪里 | 期望 |
|---|---|
| 会话 header | 「🔗 复制 Session ID」按钮；点击翻成「✓ 已复制」，剪贴板是 `@session-<uuid>` |
| 输入框 | 粘贴引用显示 chip；打 `@` 出现按标题的 `session` 分组 |
| 已发送消息 | 引用渲染为蓝色 chip，其他 `@` 提及不变 |
| 对粘贴的引用调 `session_read` | 返回该会话的 `title`/`cwd` 与 `user:`/`assistant:` 对话文本 |

## 卸载

- 从 web profile 的 `cordis.patch.yml` 删掉 `dsh-session-link` insert 行
- 从 web profile 的 `dsh.profile.bundles` 删掉 `dsh-session-link` 依赖并 `pnpm remove`

## 许可

MIT
