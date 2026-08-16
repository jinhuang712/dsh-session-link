# M0 零代码验证记录：给路径就能读

> 日期：本次会话 · 验证人：agent（本会话）
> 结论：**「把 session 链接（id + 日志绝对路径）交给另一个 session，即可直接读取其内容」成立**，且投影是刚需（原始事件 97.5% 是噪声）。

---

## 1. 验证目标

1. 一条真实 `log:` 路径能否被直接解压读取（`zstd -dc`）。
2. 原始 JSONL 事件流能否投影成可读的 user/assistant 对话。
3. 投影体积与 64KB 预算的关系（决定截断策略）。

## 2. 实验对象

```
session id : session-21dc1f2f-adcf-4035-b463-3d30da89bb4e
log 路径  : /Users/huangjin/.dsh/sessions/--Users-huangjin-dev--/session-21dc1f2f-adcf-4035-b463-3d30da89bb4e/session.jsonl.zstd
压缩大小  : 7,154,894 B（≈ 6.8 MB）
解压行数  : 22,075 行 JSONL
```

> 这是本机最大的会话之一（约 13 轮、395 个 assistant 消息），取它做上限压力测试。

## 3. 执行与结果

### 3.1 直读

```bash
zstd -dc "<log 路径>" > /tmp/m0-session.jsonl    # 成功，22,075 行
```

✓ 直接解压读取成立，无任何权限/格式障碍（danger-full-access 下）。

### 3.2 事件统计（噪声验证）

| 事件类型 | 数量 | 占比 | 是否进入投影 |
|---|---|---|---|
| tool-call-chunks | 9,248 | 41.9% | ✗ |
| reasoning-chunks | 5,068 | 23.0% | ✗ |
| assistant/chunk | 4,208 | 19.1% | ✗ |
| text-chunks | 1,352 | 6.1% | ✗ |
| tool/call + tool/result | 804 | 3.6% | ✗ |
| step/start + step/end | 790 | 3.6% | ✗ |
| assistant/message | 395 | 1.8% | ✓ |
| agent/inbox/spliced | 107 | 0.5% | ✓（有文本时） |
| user/message | 48 | 0.2% | ✓（仅 source.kind=user） |
| turn/start + turn/end | 26 | 0.1% | 分隔 |
| 其余（title/request/权限/seed 等） | 39 | 0.2% | title ✓，其余 ✗ |

**结论：22,075 行里 97.5% 是 chunk/工具/推理噪声，必须投影；直接喂原始 JSONL 给模型不可行。**

### 3.3 投影结果（过滤后）

- 投影条数：**421 条**（user 文本 + assistant 文本 + 有内容的 inbox 注入，已剔除系统注入的 user/message）
- 投影总字符数：**62,397 字符（≈ 61 KB）**
- 64KB 预算下：**整场 7MB 会话的投影几乎全部容纳**（421/421 条，覆盖 seq=3 起全部内容）

**结论：64KB 预算不是瓶颈，而是天然上限——一场 7MB 会话 ≈ 一份 61KB 可读对话。截断策略只需兜底超长会话。**

### 3.4 投影样例（真实性抽检）

```
[seq 3]      INBOX:     '请问我们通常怎么在Deepseek harness上面增加一个插件'
[seq 7]      USER:      '请问我们通常怎么在Deepseek harness上面增加一个插件'
[seq 10/14]  TITLE:     '如何在Deepseek harness上添加插件'
[seq 576]    ASSISTANT: '我来先加载相关技能，并了解一下当前 Harness 的实际结构，然后给你一个准确的回答。'
…
[seq 502404] USER:      '现在这个skill在全局是否在全局已经可以使用了？'
[seq 503088] ASSISTANT: '好问题！让我检查一下 `dsh-survey` skill 在全局（所有会话）是否真的可用……'
[seq 504882] ASSISTANT: '**确认：`dsh-survey` skill 现在全局可用了！** ✅ …'
```

✓ 投影输出与人工记忆一致，可读性满足「另一个 session 快速读取内容」的诉求。

## 4. 对设计/规格的实证修正

| # | 发现 | 对规格的影响 |
|---|---|---|
| 1 | `user/message` 里混有系统注入（文件策略、system-reminder 等，`source.kind ≠ "user"`） | 投影必须按 `data.source.kind === "user"` 过滤（与 `dsh-session-reference` 的 `projectSessionConversation` 行为一致）——**M0 前设计稿 §8 未明说，现已确认** |
| 2 | 存在 `session/end-seed`、`todo/write`、`text-chunks` 等设计稿未列事件 | 投影规则改为「白名单 + 未知类型默认跳过」，而非黑名单 |
| 3 | `agent/inbox/spliced` 常为 `''` 空文本 | 空文本跳过 |
| 4 | `session/title` 会出现多次（标题演进） | 取最后一条（最新标题） |
| 5 | 7MB 日志 ≈ 61KB 投影 | 64KB 默认预算合理；截断默认保尾部（最近内容） |
| 6 | `zstd -dc` 直读对 7MB 文件毫秒级完成 | C1（bash 直读）可行；C2（宿主 `readRaw`）更稳 |

## 5. 演示链接（可直接粘贴验证）

```
@[如何在Deepseek harness上添加插件](dsh-session:InNlc3Npb24tMjFkYzFmMmYtYWRjZi00MDM1LWI0NjMtM2QzMGRhODliYjRlIg)
log: /Users/huangjin/.dsh/sessions/--Users-huangjin-dev--/session-21dc1f2f-adcf-4035-b463-3d30da89bb4e/session.jsonl.zstd
cwd: /Users/huangjin/dev
```

> 说明：`dsh-session:` URI 的 base64url 由 `btoa(JSON.stringify(id))` 推导（ASCII id，无需 UTF-8 转义）。

## 6. 状态

- [x] 直读成立
- [x] 投影成立（含噪声过滤、空文本、标题演进处理）
- [x] 预算实证（61KB / 64KB）
- [ ] M1 落地（见 `implementation-plan.md` / `implementation-spec.md`）
