---
name: dsh-session-link
description: Use this skill when the user wants to reference, share, or read another DSH session's context — copy a session reference (@session-id) to pass to another session, pick a session by title from the @ mention menu, or read another session's content (projected conversation) without downloading/unzipping session logs. 当用户需要跨会话引用/传递/读取会话内容时使用：一键复制当前会话引用（header「🔗 复制 Session ID」）、输入框 @ 菜单按标题选择会话并插入 @session-<uuid> 彩色引用、或用 session_read 工具按 @session-id / dsh-session:URI / @标题 读取并投影为可读对话文本。
version: 0.1.0
license: MIT
---

# dsh-session-link（会话链接）

在 DeepSeek Harness 会话之间快速**引用、传递、读取会话上下文**：免去「下载 Session 日志 ZIP → 传输 → 解压 → 读」的手动链路。由 `dsh-session-link` bundle 提供（header 按钮 + `@` 引用源 + `session_read` 工具）。

## 能力总览

| 能力 | 入口 | 说明 |
|---|---|---|
| 一键复制引用 | header「🔗 复制 Session ID」 | 复制当前会话引用 `@session-<uuid>`（全 ASCII → 输入框/气泡均为彩色 chip） |
| `@` 菜单选会话 | 输入框打 `@` | session 分组按**标题**显示（id 为副信息），可搜索标题或 id；选中插入 `@session-<uuid>` |
| 跨会话读取 | `session_read` 工具 | 解析 `@session-<uuid>` / `dsh-session:URI` / `@标题` → 投影为可读 user/assistant 对话（跳过 chunk/工具/推理噪声，64KB 预算） |

## 何时使用

- 用户想把**另一个会话的内容**给当前会话看，或把当前会话引用给别的会话；
- 用户提到「复制会话链接/引用」「@某个会话」「读一下那个会话」；
- 需要快速了解某会话聊了什么（替代 zip 下载解压）；
- 用户输入 `@session-…` / `@标题` 请求读取。

## 用法

**复制引用**：点击会话 header 的「🔗 复制 Session ID」→ 剪贴板得到 `@session-<uuid>` → 粘贴到任意会话的输入框（自动显示为彩色 chip）→ 发送。

**@ 菜单**：输入框打 `@` → 在 session 分组按标题选择会话（可输入标题关键词过滤）→ 回车插入 `@session-<uuid>`。

**读取**：收到 `@session-<uuid>` 或 `@标题` 后，调用 `session_read({ link })` 读取投影内容：

```
session_read({ link: "@session-7fc2d98e-…" })
→ { sessionId, title, cwd, logPath, seqRange, transcript, truncated }
```

`session_read` 支持三种输入：

| 输入 | 说明 |
|---|---|
| `@session-<uuid>` | 推荐，精确直达 |
| `dsh-session:<b64>` | 兼容旧 3 行链接里的 URI |
| `@会话标题` | 按标题精确匹配；无/多重匹配时返回候选与 id，改用 id 重试 |

可选参数：`maxChars`（投影预算，默认 64000）、`truncate`（`tail` 保最近 / `head` 保最早，默认 tail）、`raw`（调试用，返回原始 JSONL 前 200000 字符）。

## 边界

- **输入框**：`@session-<uuid>`（ASCII）会显示 chip；**中文标题**（`@分析…`）不命中 shipped 正则（`\w` 无 `/u`），显示为纯文本——上色仅限 id 格式（有意取舍）。
- **气泡**：`@session-<uuid>` 显示蓝底白字 chip（MutationObserver 精确作用域，不影响其他 `@` 提及）。
- 只读：`session_read` 只读不写源日志；live 优先（`sessionQuery.readSession`），沙箱会话可用（宿主通道）。
- `@标题` 解析依赖宿主 `sessionQuery` 的 `listSessions` + `readTitleSnapshots`；不可用时工具会明确报错并建议改用 `@session-<uuid>`。
- 会话归属：功能由 profile bundle 提供，全局所有会话可用；进程重启不丢失。
