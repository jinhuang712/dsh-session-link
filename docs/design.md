# 设计文档：会话链接复制与跨会话读取（Copy Session Link & Cross-Session Read）

> 状态：评审稿 v1（未实现）
> 工作区：`dsh-session-crosser`（本机 DSH 部署的配套实验/落地区）
> 目标 DSH：`@deepseek-ai/dsh@0.1.0-rc.6`，Web 部署（`~/.dsh/profiles/web`，`$DSH_HOME=sessions` 指向 `~/.dsh/sessions`）

---

## 1. 背景与目标

### 1.1 用户痛点（原话提炼）

1. **拿不到 session id**：会话行菜单只有「重命名 / 分叉会话 / 归档会话」，悬浮卡片的复制复制的是**标题**，session id 在 UI 上完全不展示。
2. **搬运成本高**：想给另一个 session 看本 session 的内容，只能走「下载 Session 日志 ZIP → 传给另一个 session → 解压 → 读」的手动链路。
3. **期望**：在行菜单加一项「复制会话链接」，链接携带 **session id + 本机真实日志落盘路径**；另一个 session 拿到后能**快速读到内容**。

### 1.2 目标（非目标）

| | 内容 |
|---|---|
| 做 | 行菜单新增「复制会话链接」；链接携带 id + 绝对日志路径（+cwd/标题等元数据）；接收 session 可用宿主工具或直读快速拿到**可读对话投影** |
| 不做（本期） | 浏览器 URL 路由型 deeplink（`?session=` 打开页面）；跨机器传输（路径是机器本地的）；把读入的内容回灌为历史（那是 fork/seed 的范畴） |

---

## 2. 现状与约束（实证结论）

所有结论均来自对安装包源码与本机落盘文件的核对，是设计的前提。

### 2.1 行菜单硬编码、无 Slot 挂点

- 菜单定义：`dsh-client-ui-workspace/lib/client.js` 的 `SessionNodeItem`（约 699–715 行），硬编码 `rename/fork/archive` 三项；`onSelect` 分派（约 763–768 行）。
- 复制行为：`HoverCard copyText: row.title`（约 791 行）——复制**标题**。
- Slot 树（实测 `Slots.listSubTree`）：`sidebar.workspaces` 是 single 且 `replaceRisk: shadows-shipped-ui`，**没有**会话行菜单粒度的扩展点。
- 结论：加菜单项只能改 `dsh-client-ui-workspace` 包（本部署直接改安装文件，或上游 PR）；动态 Cordis 插件无法触达该菜单。

### 2.2 日志落盘是确定性路径

`dsh-session-persistence-jsonl`：

```
logPath(root, cwd, id, compression)
  = <root>/<projectKey(cwd)>/<encodeSegment(id)>/session.jsonl.zstd
```

- `root`：组合行 `session-persistence-jsonl.config.root = !!js dshHomePath('sessions')`，本机 = `~/.dsh/sessions`。
- `projectKey(cwd)`：cwd 的编码目录名（实测如 `--Users-huangjin-dev-projects-dsh-session-crosser--`）。
- 文件：zstd 压缩的 JSONL 事件流（首行 `session` 头 + 类型化事件）。

实测样例：

```
/Users/huangjin/.dsh/sessions/--Users-huangjin-dev-projects-dsh-session-crosser--/
  session-7fc2d98e-52e0-47c7-a550-e67b029c9ca1/session.jsonl.zstd
```

### 2.3 日志是事件流，不是可读 transcript

实测事件词汇（一个普通会话）：`session`、`permission/preset`、`sandbox/mode`、`approval/policy`、`agent/inbox/spliced`、`turn/start`、`step/start/end`、`user/message`、`assistant/message`、`assistant/chunk`、`reasoning-chunks`、`tool-call-chunks`、`tool/call`、`tool/result`、`session/title`、`request/header`、`request/context` 等（实测 31 种、约 1100 条记录）。

- 「读内容」= 投影成 user/assistant 对话文本；原始 JSONL 留给调试。

### 2.4 宿主自带 zstd 解码

`dsh-session-persistence-jsonl` 用 `node:zlib` 的 `zstdDecompressSync` / `createZstdDecompress`（还有 `scanLog` 只认已提交前缀）。→ 宿主侧读日志**零外部依赖**，且比 bash 直读更稳（并发写尾巴、半截帧）。

### 2.5 已内置「session 引用」休眠机制（远期正解）

`dsh-session-reference` 包（**当前未挂载、无消费方**）：

- 规范 URI：`dsh-session:` + `base64url(JSON.stringify(sessionId))`；mention 格式 `@[label](dsh-session:<…>)`；`decodeSessionReferenceUri` 做**规范形校验**（非规范即抛错 → 路径不能塞进该 URI，只能放 URI 之外）。
- `SessionReferenceResolver` 服务：`listCandidates(agent, query, limit)` 发现候选；`prepare(agent, content, references, signal)` 把被引用 session 投影为**可读 user/assistant 文本**（跳过工具/推理/注入上下文；默认 64KB 预算；最多 3 个引用；禁止自引用）。
- 客户端已认识 `session-reference` 类型上下文来源（渲染为 "recall" 角色，`dsh-client-runtime/lib/client.js` `contextProvenance`）。
- 组合现状：`dsh-base` / `dsh-web-app` 的 cordis patch 中**均无**该行；`dsh-agent` 循环中**无** mention 解析/`prepare` 调用方。

### 2.6 客户端可见的数据与 API

- `session.list` 摘要含 `sessionId / cwd / title 投影 / updatedAt / origin …`（`dsh-host-apiproxy` sessions.schema）——**含 cwd，不含日志路径**。
- 行菜单宿主调用走 `ctx.sessions.*` / `ctx.workspaces.*`（实测 `ctx.sessions.fork`、`ctx.sessions.binding(id).session.rename`、`ctx.sessions.open`、`ctx.workspaces.archiveSession`）。
- 图标可用：`IconCopyOutline16`、`IconLinkOutline14/16`、`IconShareOutline16`（`dsh-client-ui-primitives`）。

---

## 3. 总体架构

```
┌───────────────────────── 复制端（Web 客户端） ─────────────────────────┐
│ 会话行菜单 +「复制会话链接」                                            │
│   → ctx.sessions.resolveLog({ sessionId })   （新 RPC，宿主解析路径）   │
│   → 拼装链接文本 → navigator.clipboard.writeText(link)                  │
└────────────────────────────────────────────────────────────────────────┘
                              │ 链接（剪贴板，可粘贴进任意会话）
                              ▼
┌───────────────────────── 消费端（另一个 session 的 agent） ────────────┐
│ 粘贴链接 +「读一下」                                                    │
│   C1 直读：bash zstd -dc <log: 路径>           （零代码，受文件策略约束）│
│   C2 宿主工具：session:read({ link })          （推荐，走宿主+投影）     │
│   C3 原生：@[label](dsh-session:…) 自动注入    （远期，接线休眠机制）    │
└────────────────────────────────────────────────────────────────────────┘
```

**核心洞察**：`读`这一侧 C1 今天就能跑通（路径给到就能 `zstd -dc`）；真正缺的是**复制入口（UI）**与**路径解析（宿主 RPC）**。因此最低可行版本 = RPC + 菜单项；投影与原生接线是体验与鲁棒性升级。

---

## 4. 链接载荷格式（v1）

### 4.1 规范

```
@[<标题>](dsh-session:<b64url>)
log: <绝对路径>/session.jsonl.zstd
cwd: <会话工作目录>          # 可选
created: <epochMs>           # 可选
```

- 第一行：**直接复用 `dsh-session-reference` 的规范 mention 格式**（`formatSessionReferenceMention`），使链接与远期 C3 机制天然兼容；`<b64url> = base64url(JSON.stringify(sessionId))`。
- 第二行 `log:`：显式携带用户要求的**真实存放位置**；消费端优先用它（最快、免解析），宿主工具可再按 id 二次校验。
- 第三、四行：辅助元数据（cwd 可用于 id→路径回查；created 用于展示）。

### 4.2 示例（本机实测数据改写）

```
@[dsh-session-crosser 分析](dsh-session:InNlc3Npb24tN2ZjMmQ5OGUtNTJlMC00N2M3LWE1NTAtZTY3YjAyOWM5Y2ExIg)
log: /Users/huangjin/.dsh/sessions/--Users-huangjin-dev-projects-dsh-session-crosser--/session-7fc2d98e-52e0-47c7-a550-e67b029c9ca1/session.jsonl.zstd
cwd: /Users/huangjin/dev/projects/dsh-session-crosser
```

### 4.3 解析规则（消费端 `session:read` 工具）

1. 用 `parseSessionReferenceText`（或正则）提取 `dsh-session:` URI，`decodeSessionReferenceUri` 校验规范形 → 得到 sessionId；
2. 提取 `log:` 行 → 绝对路径；
3. 优先级：`log:` 路径存在 → 直读（最快）；否则按 id 经宿主解析（session-query 精确读 / 全 project 目录扫描 `*/<id>/session.jsonl.zstd`）；
4. 两者都失败 → 报错（不静默降级）。

**为什么必须带路径**：`logPath` 需要 `cwd` 才能定位 project 目录，光有 id 无法直接算路径；路径写死进链接可跨过这层推导，也正是用户的原始诉求。

---

## 5. 宿主 RPC 契约：`session.resolveLog`

新增一条轻量 RPC，供「复制」动作解析绝对路径（客户端只有 id+cwd，不知道 root 与目录编码）。

### 5.1 请求 / 响应（沿用 zod schema 模式）

```ts
// dsh-host-apiproxy/lib/types/api/sessions.schema.js 追加
sessionResolveLogRequestSchema = z.object({
  sessionId: sessionIdSchema,
})

sessionResolveLogValueSchema = z.object({
  sessionId: sessionIdSchema,
  logPath: z.string(),          // 绝对路径（即使文件不存在也返回，供展示）
  exists: z.boolean(),          // 该路径下 session.jsonl.zstd 是否真实存在
  sizeBytes: z.number().int().nonnegative().optional(), // exists 时
  cwd: z.string().optional(),
  title: z.string().optional(),
})
```

### 5.2 行为

- 解析：`root`（组合配置 `session-persistence-jsonl`）+ `cwd`（来自 `session.list` 摘要 / session-query）→ 复用 `dsh-session-persistence-jsonl` 的 `logPath()` 编码（**同一函数，避免两处编码漂移**）。
- 校验：session 必须存在（live 或已落盘），否则返回错误码 `SESSION_NOT_FOUND`；只解析不读盘。
- 不做：不校验文件内容、不返回内容（内容读取走消费端工具，见 §7）。

### 5.3 触及面（诚实清单）

| 文件 | 改动 |
|---|---|
| `dsh-host-apiproxy/lib/types/api/sessions.schema.js` | 追加上述两个 schema |
| `dsh-host-apiproxy/lib/types/api/rpc.schema.js` | 注册 `"session.resolveLog"` |
| `dsh-host-apiproxy/lib/index.js`（sessions 域） | `resolveLog(request)` handler |
| `dsh-host-apiproxy/lib/types/fetch/client.js` + `dsh-client-runtime/lib/client.js` | `sessions.resolveLog(payload)` 方法 |
| `dsh-client-ui-workspace/lib/client.js` | 菜单项 + 调用（见 §6） |

> 注：`dsh-session-reference` 的 `listCandidates` 已经能从查询词找到 session，但它是「服务注入」而非「RPC」；本期 RPC 是给 UI 复制的，二者职责不同，不冲突。

---

## 6. UI 改动设计（U1：改安装包）

### 6.1 菜单项

`SessionNodeItem` 的 `sessionMenuItems` 追加：

```js
{
  id: "copy-link",
  label: t("menu.copySessionLink"),        // zh: 复制会话链接 / en: Copy session link
  icon: <IconLinkOutline16 />,             // 或 IconCopyOutline16
}
```

`onSelect` 分派追加：

```js
if (id === "copy-link") onCopyLink(node.id);
```

`onCopyLink` 从 WorkspaceBrowser 注入（与 `forkSession` 同层）：

```js
copySessionLink: async (sessionId) => {
  const { logPath, cwd, title, exists } = await ctx.sessions.resolveLog({ sessionId });
  const uri = encodeSessionReferenceUri(sessionId);       // 复用 dsh-session-reference 导出
  const label = title ?? sessionId;
  const link = [
    `@[${label}](${uri})`,
    `log: ${logPath}${exists ? "" : "   # 文件尚未落盘（会话运行中）"}`,
    cwd ? `cwd: ${cwd}` : null,
  ].filter(Boolean).join("\n");
  await navigator.clipboard.writeText(link);
  // 可选：轻提示「已复制会话链接」
}
```

### 6.2 文案（zh/en 各一条）

- zh：`"menu.copySessionLink": "复制会话链接"`
- en：`"menu.copySessionLink": "Copy session link"`

### 6.3 交互细节

- 菜单点击是合法用户手势，`navigator.clipboard.writeText` 可用；失败时降级 `document.execCommand('copy')` 或报错 toast。
- 运行中的 session（`exists: false`）也允许复制，链接仍可粘贴；消费端读取时读到的会是「已落盘前缀」（见 §9 风险 1）。
- 空白（blank）会话行不显示该菜单项（与 `!row.blank` 一致的门槛）。

### 6.4 部署方式说明

- 本部署直接编辑安装文件：`/Users/huangjin/dev/npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`（及 host 侧 api-proxy 各文件）。
- 生效：浏览器模块由 `dsh-client-modules` 按包提供 `/plugins/<id>/client.js`；改后需**刷新页面**，若模块表有缓存则需重启 Web 进程。
- **升级会被覆盖**：`package.json` 更新后需重打补丁；建议把补丁 diff 存档在本工作区（`patches/` 目录，见 §11 里程碑 M1）。
- 治本路径是上游 PR（`deepseek-ai/deepseek-harness` 的 `packages/client/ui-workspace`）。

---

## 7. 消费端读取设计

### 7.1 C1 直读（零代码，现在就能用）

- 接收 agent 用 bash：`zstd -dc "<log: 路径>" | head -c 200000`
- 适用：danger-full-access 会话（本机大多数会话）；**沙箱（workspace-write）会话读不了 `~/.dsh` 之外**。
- 缺点：原始 JSONL 噪声大（chunk/工具/推理事件混在一起），需要模型自行投影。

### 7.2 C2 宿主工具 `session:read`（推荐）

新增一个宿主侧 Tool（实现方式：动态 Cordis 插件，或随 preset 挂载；宿主用 `node:zlib` 解压，不走文件策略）。

```
session:read({
  link: string,                       // 4.3 的链接文本（或仅含 dsh-session: / log: 之一）
  maxChars?: number = 64000,          // 投影文本预算（对齐 64KB 默认）
  truncate?: "tail" | "middle" = "tail", // 超预算时的保留策略（默认保最近）
  raw?: boolean = false,              // true 时返回原始 JSONL（限长），调试用
})
→ {
  ok: true,
  sessionId, title?, cwd?, logPath,
  seqRange: { first, last },          // 覆盖的事件区间
  transcript: string,                 // 可读对话投影
  truncated: boolean,
}
→ { ok: false, error: { code, message } }   // 如 SESSION_NOT_FOUND / LOG_UNREADABLE
```

解析与读取流程（宿主内）：

1. 按 §4.3 解析链接 → 定位 `session.jsonl.zstd`；
2. 存在则 `createZstdDecompress` 流式解压（或直接读文件再 `zstdDecompressSync`，文件通常 < 数 MB）；
3. **优先用 `scanLog`（只认已提交前缀）**而不是裸读，避免并发写尾巴/半截帧；
4. 按 §8 投影规则生成对话文本；
5. 超预算按 `truncate` 策略截断并在末尾标注 `（省略 N 字符，最早 seq=…）`。

### 7.3 C3 原生接线（远期正解）

目标：粘贴 `@[标题](dsh-session:…)` 后，内容**自动**注入，无需任何工具调用。

1. **挂载**：profile `cordis.patch.yml` 追加

   ```yaml
   - insert:
       - id: session-reference
         name: '@deepseek-ai/dsh-session-reference'
         config:
           maxReferences: 3
           candidateLimit: 50
           maxReferenceBytes: 65536
   ```

2. **接线**：在 `dsh-agent` 的用户消息 intake（inbox 处理）处，用 `parseSessionReferenceText` 检出 mention → `sessionReferenceResolver.prepare(agent, content, references, signal)` → 以 `user/message` 且 `source.kind: "session-reference"` 的形式注入（客户端已渲染为 "recall" 角色）。
   - 具体挂点需要读 `dsh-agent` 的消息预处理链确认（本期文档标注为**待确认点 TC-1**）。
3. **兼容**：v1 链接的 `log:` 行在 C3 下成为「原始/调试」降级通道，不参与自动注入。

> 与 C2 的关系：C3 激活前 C2 是主通道；C3 激活后 C2 保留为「原始日志/大日志」的显式读取入口。二者并存。

---

## 8. 投影规则（JSONL → 可读对话）

对齐 `dsh-session-reference` 的 `projectSessionConversation` 语义，明确定义：

| 事件类型 | 处理 |
|---|---|
| `session`（头） | 元数据行：id / cwd / agentPreset / createdAt（不进入正文） |
| `user/message` | 用户文本；`source.kind === "session-reference"` 标记为（引用注入）；**checkpoint 来源**标记为 `〔历史已压缩〕` 分隔行 |
| `agent/inbox/spliced` | 展开 `inserted[].content` 的文本，作为用户输入（标注来源） |
| `assistant/message` | 助手文本 |
| `session/title` | 标题（仅用于头部展示，不进入正文） |
| `turn/start` | 轮次分隔（可选 `── 第 N 轮 ──`） |
| `step/start` / `step/end` / `assistant/chunk` / `reasoning-chunks` / `tool-call-chunks` / `tool/call` / `tool/result` / `request/header` / `request/context` / `permission/*` / `sandbox/*` / `approval/*` / `session/title-llm-request` | **跳过**（工具/推理/环境噪声） |

- 顺序：按 `seq` 升序。
- 预算：默认 64KB（UTF-8 码点计数，参照 `DEFAULT_MAX_REFERENCE_BYTES`）；超限按 §7.2 策略截断。
- `raw: true` 时返回原始行（同样限长），供排查事件形态。

---

## 9. 边界、风险与对策

| # | 风险 | 说明 | 对策 |
|---|---|---|---|
| 1 | **活动会话读到旧内容** | 日志按 checkpoint 落盘，运行中会话的最近事件可能未写盘 | 链接标注「尚未落盘」（`exists:false`）；工具读「已提交前缀」不报错；与 zip 导出同限制，属可接受 |
| 2 | **并发写半截帧** | 裸读可能遇到未写完的 zstd 帧 | 宿主工具走 `scanLog`/已提交前缀；C1 直读建议 `zstd -dc` 容忍尾噪或失败重试 |
| 3 | **沙箱会话读不了日志** | workspace-write 策略挡 `~/.dsh` | C2 宿主工具（宿主读，不走文件策略）；C1 仅限 danger-full-access |
| 4 | **升级覆盖补丁** | 直接改安装包，`npm i` 更新后丢失 | 补丁 diff 存档 `patches/` + 重打脚本；治本走上游 PR |
| 5 | **i18n 缺文案** | 菜单标签 zh/en 都要加 | §6.2 已列 |
| 6 | **隐私** | 链接含绝对路径（暴露用户名/workspace 命名） | 单机自用可接受；文档注明不要外发 |
| 7 | **URI 规范形限制** | `decodeSessionReferenceUri` 拒绝非规范 URI，路径不能塞进 URI | 路径放 `log:` 独立行（v1 设计即如此） |
| 8 | **跨机器无效** | 路径是机器本地 | 明确「同机」前提；跨机仍走 zip 导出（不在本期） |
| 9 | **长链接剪贴板** | 标题含换行/方括号会破坏 mention | 生成时转义 label；`formatSessionReferenceMention` 已有 `escapeLabel` |

---

## 10. 验收标准

1. 在任意会话行菜单点「复制会话链接」，剪贴板得到含 `dsh-session:` mention 与 `log:` 绝对路径的文本。
2. 新会话粘贴该文本并说「读一下」，能返回该会话的**可读对话投影**（含标题、cwd、最近 N 轮 user/assistant 文本），且与 zip 导出解压后的同一事件源一致。
3. 沙箱会话也能通过 `session:read` 读取（宿主通道），不受文件策略影响。
4. 复制运行中会话的链接不报错；读取时返回已落盘前缀并在输出中标注范围。
5. 读超大日志不爆预算（截断 + 标注省略量）。
6. （C3 远期）粘贴 `@[标题](dsh-session:…)` 无需任何工具调用即自动注入内容，UI 以「recall」角色渲染。

---

## 11. 里程碑

| 里程碑 | 内容 | 产出 |
|---|---|---|
| M0（0 代码，可先行验证） | 手动复制一条 `log:` 路径给另一个 session，用 `zstd -dc` 直读 | 验证 C1 可行性与投影诉求 |
| M1（快速版，本部署） | ① `session.resolveLog` RPC（host + client 触及面）② ui-workspace 菜单项 + 剪贴板 ③ 可选：`session:read` 动态插件工具 | 本部署立即可用；补丁存档 `patches/` |
| M2（原生版/上游） | ① `dsh-session-reference` 挂载（profile patch）② `dsh-agent` mention 接线（先确认 TC-1 挂点）③ 菜单产出规范 mention；④ 上游 PR（ui-workspace + api-proxy + session-reference） | 产品化：粘贴即注入 |

**待确认项（TC）**
- TC-1：`dsh-agent` 用户消息 intake 的具体注入挂点与 `prepare` 返回的 `PreparedReferencedMessage` 消费方式（M2 开工前读 `dsh-agent` 源码确认）。
- TC-2：`session.resolveLog` 是走 api-proxy RPC 还是直接复用 `sessionReferenceResolver` 的宿主服务注入（取决于 M1 是否与 C2/C3 合并实施）。

---

## 12. 附：关键源码锚点（评审用）

| 主题 | 位置 |
|---|---|
| 行菜单硬编码 | `dsh-client-ui-workspace/lib/client.js` `SessionNodeItem`（~699–715、763–768、791） |
| 日志路径编码 | `dsh-session-persistence-jsonl/lib/index.js` `logPath/sessionDir/projectKey/encodeSegment`（~120–158） |
| 宿主 zstd 解码 / scanLog | 同包 `node:zlib` 解码器 + `scanLog`（~310、336–480） |
| session 引用休眠机制 | `dsh-session-reference/lib/index.js`（`SESSION_REFERENCE_SCHEME` ~189、mention ~222、`SessionReferenceResolver` ~279、`projectSessionConversation` ~41） |
| RPC 注册模式 | `dsh-host-apiproxy/lib/types/api/rpc.schema.js`（`session.fork` 等）；sessions schema 见 `sessions.schema.js` |
| 组合现状 | `dsh-base/cordis.patch.yml`、`dsh-web-app/cordis.patch.yml`（均无 session-reference 行） |
| 客户端 API 用法 | `dsh-client-ui-workspace/lib/client.js`（~2368–2386 `ctx.sessions.fork` / `ctx.workspaces.archiveSession`） |
| 图标 | `dsh-client-ui-primitives`：`IconLinkOutline16` / `IconCopyOutline16` / `IconShareOutline16` |
