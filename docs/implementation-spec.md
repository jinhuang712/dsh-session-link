# 实施规格（Patch Specification）：M1 快速版

> 版本 v1 · 对应 DSH `@deepseek-ai/dsh@0.1.0-rc.6`（本部署）
> 本文件是**可照着改代码**的逐文件规格；编排与验收见 [`implementation-plan.md`](implementation-plan.md)，设计决策见 [`design.md`](design.md)，实证见 [`m0-evidence.md`](m0-evidence.md)。
> 所有行号以本部署安装文件为准（2026-08 版本），**编辑前必须用 grep 复核锚点**（edit 工具要求唯一匹配）。

---

## 0.1 已定方向：纯插件 v1（当前实施中）

> **2026-08 决策**：经与用户确认，M1 改为**纯插件 v1**（零补丁）——先跑通「复制 → 粘贴 → 读取」价值闭环；P1–P6（sidebar 行菜单补丁）降级为 **Phase 2（可选体验升级）**，仅当「先切到源会话再复制」不可接受时再做。

### v1 架构（已落地：动态插件 `slnk-1`，两版 Package）

```
Client 半（浏览器）
  conversation.session.header.actions（additive, replaceRisk none）
    注册按钮 id=copy-session-link（order 30）
    props.sessionId（槽位标准 props）→ host.call('resolve-link', {sessionId})
    → 拼链接（mention + log: + cwd:）→ navigator.clipboard.writeText
Host 半（宿主进程）
  harness.handle('resolve-link')            # 包私有，只服务本插件 Client
    ctx.get('sessions').get(id).header.cwd  # 当前会话（live）
    → ctx.get('sessionPersistence').locate({id, cwd}) → { kind:'jsonl', path }
    → 反向扫 session.events 取最新 session/title
  harness.defineTool/registerTool → session_read  # 模型可调工具（C2）
    解析链接 dsh-session: URI → persistence.readRaw(id, signal)
    → project()（投影规则 = design §8 + m0 修正：source.kind='user' 过滤/白名单/标题取最新）
    → { sessionId, title, cwd, logPath, seqRange, transcript, truncated }
```

### v5 简化版（当前）：一键复制 `@session-id`，无弹窗

> 2026-08 追加：用户澄清「没要读取弹窗，要的是点击即复制引用」→ 移除对话框，header 按钮**点击即复制当前会话引用 `@session-<uuid>`**；粘贴发送后命中 shipped `projectUserText` 正则（`[/@][\w-]+`，全 ASCII）→ **必渲染为彩色 chip**。动态插件 `slnk-1/pkg-3` 与 bundle `dsh-session-link` 均已更新为此行为。
>
> **上色边界（实测修正）**：① 输入框（composer）的 `@` 装饰是**词表门控**的（只认已注册引用源名字），任意 `@session-*` 在输入框是纯文本——插件改不了，这是 shipped 硬边界；② 已发送气泡按「形状」装饰（浅蓝底 22% 透明，太淡）。bundle 已用 **MutationObserver 精确上色**：只给文本以 `@session-` 开头的 `[data-ref-chip]` span 加醒目蓝色（白字），**不影响其他 @ 提及**（纯 CSS 做不到按文本选择元素，故用 DOM 观察）。
>
> **v6 定案：复制格式回到 `@session-<uuid>`（当前）**：标题格式（`@<会话标题>`）因中文无法上色被放弃（用户「战略性放弃中文文本能上色」）→ 复制内容为 `@session-7fc2d98e-…`。**全链路彩色**：输入框经 `@session` 引用源词表（lexicon = 全部会话 id）命中 `scanTextRefs` → chip；气泡经 `projectUserText` 形状装饰 + MutationObserver 蓝色上色（精确 `@session-` 前缀）。`session_read` 解析 `@session-<uuid>` / `dsh-session:URI`（兼容 `@标题` 按标题解析）。

```
Client（按钮，无弹窗）：
  conversation.session.header.actions「🔗 复制」
    props.sessionId → navigator.clipboard.writeText('@' + sessionId) → 1.5s「✓ 已复制」
Host（仅工具）：
  session_read 工具：解析 @session-<uuid> / dsh-session:URI → readSession(id) → 投影
bundle 版：无 webServer 路由（客户端零宿主依赖）
```

- 彩色 chip 的机理：气泡渲染 `projectUserText` 把 `@[\w-]+` 词元装饰为引用 chip（`data-ref-chip`）；uuid 全 ASCII+连字符 → 必命中。中文标题不命中（无 `/u`），所以**复制用 id 不用标题**。
- 接收侧：`session_read` 去 `@` 即得 id → `readSession` 读取；无工具时任意 agent 也能看到可解析的 id 文本。

### v4 持久化 bundle（已打包，待重启生效）

> 2026-08 追加：动态插件不跨进程存活（重启即失，实测踩坑）→ 打包成 **bundle** 装进 profile，重启不丢、每个会话都有、无需每次批准。

```
bundle/dsh-session-link/                     # 源码（本仓库，可版本化）
├── package.json                             # exports: . → lib/index.mjs, ./client → lib/client.js
│                                            # dsh.bundle.patch + dsh.client{inject, platform:"web"}
├── cordis.patch.yml                         # insert { id: dsh-session-link, name: 'dsh-session-link' }
└── lib/
    ├── index.mjs                            # Host：ctx.tools.register(defineTool(session_read))
    │                                        #      + webServer.register(prefix /api/dsh-session-link)
    │                                        #        GET /list → 全量会话；GET /read?sessionId|title → 投影
    └── client.js                            # Client：__ModuleLoader__.load({id, factory})；
                                             #         React 为闭包符号；fetch 宿主路由（不走 host.call）
profile 接线（~/.dsh/profiles/web/package.json）
    dependencies: "dsh-session-link": "file:…/bundle/dsh-session-link"
    dsh.profile.bundles: 追加 "dsh-session-link"
    → pnpm install（file: 本地依赖，222ms）→ 重启 dsh 生效
```

- 关键差异（动态 vs 打包）：打包插件**无 harness 沙箱** → 工具改 `ctx.tools.register(defineTool)`（inject `tools`）；客户端调宿主改 **webServer HTTP 路由 + fetch**（survey 同款；动态沙箱禁 fetch，打包客户端可用）。
- **踩坑（重要）**：`pnpm install` 对 `file:` 依赖是**复制**不是链接——改项目 `bundle/` 源码后，`node_modules` 里的副本不同步，模块服务器继续提供旧版（表现为「改了没生效」）。已改为**符号链接** `node_modules/dsh-session-link → bundle/dsh-session-link`，以后改源码立即生效；若被 pnpm 重装覆盖，重跑 `ln -s` 或直接 `cp` 同步。
- 生效前提：**重启 DSH 进程**（组合在启动时读取）；重启后动态插件消失、bundle 接管，组合行无需批准。
- 已实测：`pnpm install` 成功（+1 包）、`node --check` 两个文件语法通过。

### v3 复制格式改为 `@会话名`（已落地：`slnk-1/pkg-4`）

> 2026-08 追加：用户明确「贴进来不要裸文本，要 `@<会话名>`」→ 复制内容改为**单行 `@标题`**（如 `@你好`），干净、语义化；接收侧按标题解析到会话。

```
复制主按钮「复制引用 @名」 → 剪贴板: @<标题>          （无路径/无 base64/无换行）
复制次按钮「完整链接」       → 剪贴板: 旧 3 行格式（机器/C1 用，含 log: 路径）

解析（Host 侧 parseRef + resolveTitle）：
  @<标题>             → resolveTitle: listSessions + readTitleSnapshots 全量
                         精确匹配 → 唯一即取；多个/无 → 报错并给候选
  dsh-session:<b64>   → decode → id
  session-<uuid>      → id
read-session / session_read 统一走 readByRef(parsed, maxChars, signal)
```

- 气泡渲染实测结论（决定此格式）：用户消息渲染 `projectUserText` 只用 `(^|\s)([/@][\w-]+)` 正则把 `@word`/`/word` 词元装饰成 chip（硬编码 subagent/skill 两类），**其余纯文本**（`MessageText` 无 markdown）；无按 source 注册 chip 渲染器的扩展点 → 「粘贴即专属卡片」需上游 PR（session 一等引用 source），纯插件最大逼近 = 单行 `@标题`。
- 局限：中文标题 `@你好` 不命中 `[\w-]`（无 /u 标志）→ 气泡显示为纯文本但形态干净；ASCII 标题（如 `@dsh-session-crosser`）会命中并被装饰成 chip。

### v2 对话框版（已落地：`slnk-1/pkg-3`）

> 2026-08 追加：用户反馈「纯文本链接很丑」→ 增加**会话读取器对话框**，链接文本降级为传输格式（对话框里可一键生成）。

```
Client 半
  header.actions 按钮「🔗 读取」（id=copy-session-link）→ 打开对话框
  shell.overlay「session-reader-dialog」（list, replaceRisk none，已与 tomato-card-viewer 共存）
    左侧：会话列表（搜索过滤；标题/cwd/●运行中徽标）
    右侧：预览（投影文本 <pre>，等宽可滚动；元数据行：标题·cwd·seq 区间·已截断标记）
    底部：复制会话链接 / 复制内容 / 关闭（复制后 1.5s「✓」反馈）
Host 半（包私有 harness.handle）
  list-sessions : sessionQuery.listSessions()（最新优先，live+持久化全量）
                  + readTitleSnapshots(ids) 批量标题 → [{sessionId,title,cwd,createdAt,live,persisted}]
  read-session  : sessionQuery.readSession(id)（live 优先、replay 校验）
                  → events → JSONL → project() → {title,cwd,logPath,seqRange,transcript,truncated}
  resolve-link  : 保留（live 会话 → 链接载荷；对话框复制链接实际用 read-session 的结果自建）
  session_read 工具升级：sessionQuery.readSession 优先，fallback persistence.readRaw
```

- 关键事实：`SessionRecord = { header: SessionHeader, live, persisted }`；标题观测结果 `{ sessionId, status:'fulfilled', value:{header,title} }`；`SessionLogSnapshot = { session: SessionHeader, events: SessionEvent[] }`（均来自 `dsh-session-query` 类型，已查证）。
- 相比 v1 的改进：① 会话列表来自 `sessionQuery`（**live 优先 + 全量持久化**，不再只限 live）；② 读取走 `readSession`（**live 会话读到当前状态**，不再受限落盘滞后）；③ 读任何会话**无需切换**（对话框里直接选）。

### v1 踩坑记录（重要）

| 版本 | 问题 | 修复 |
|---|---|---|
| pkg-1 | `host-half-failed: unsupported JSON schema: schema.properties.error.additionalProperties must be explicitly true or false` | output schema 嵌套 `error` 对象补 `additionalProperties: false`（**动态工具的 JSON Schema 每个对象节点都必须显式声明 additionalProperties**） |
| pkg-2 | 已修复，运行中 | — |

### v1 已知边界（Phase 2 前接受）

- 只能复制**当前打开**的会话（header 语义）；复制别的会话需先切过去。
- 动态插件归定义它的会话；按钮是否在其他会话 header 出现**待实测**（若只跟随，挪进 agent preset 即可全局，仍非补丁）。
- `session_read` 仅支持按 `dsh-session:` id 读取（`readRaw` 主通道）；`log:` 纯路径分支暂返回提示（走 C1 bash 直读）。TC-3（动态宿主 `import('node:zlib')`）不再阻塞 v1。
- 回滚：`cordis_stop` / `cordis_undefine`，零副作用。

---



## 0. 总览

| # | 文件（安装路径基 = `/Users/huangjin/dev/npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`） | 改动 | 生效面 |
|---|---|---|---|
| P1 | `dsh-host-apiproxy/lib/index.js` | 4 处：schema、handler、RPC map、client class | 宿主运行时（Web/进程内都走它） |
| P2 | `dsh-host-apiproxy/lib/types/api/sessions.schema.js` | 2 个 schema | 源文件（上游一致性，本期可选） |
| P3 | `dsh-host-apiproxy/lib/types/fetch/handler.js` | fetch 路由 + import | HTTP 传输 |
| P4 | `dsh-host-apiproxy/lib/types/fetch/client.js` | fetch client 方法 | HTTP 传输 |
| P5 | `dsh-client-runtime/lib/client.js` | `SessionRuntime.resolveLog` | 浏览器端 `ctx.sessions` |
| P6 | `dsh-client-ui-workspace/lib/client.js` | 菜单项 / 分派 / props 透传 ×5 / 动作接线 / 文案 zh+en | 浏览器端行菜单 |
| P7 | （动态插件）`session:read` | 宿主工具（C2） | 模型可调用 |

> 关键事实（决定实现方式）：
> - `logPath/projectKey/encodeSegment` **未从** `dsh-session-persistence-jsonl` 导出 → handler **不重算路径**，改走服务公开 API `sessionPersistence.locate(meta)`（返回 `{ kind: "jsonl", path }`）。
> - `sessionPersistence.readRaw(id, signal)` 已封装 zstd 解压 + 稳定读 + 头部校验（`supportsRawArtifacts` 为 true 时可用）→ `session:read` 工具直接用，**不自己实现解压**。
> - `stat` 已在 `lib/index.js` 顶部导入（`import { mkdir, stat } from "node:fs/promises"`），handler 无需新增 import。

---

## 1. P1 宿主运行时 `dsh-host-apiproxy/lib/index.js`

### 1.1 schema（锚点：`sessionForkRequestSchema` 定义之后，约 line 477 区块末尾）

在

```js
const sessionForkValueSchema = z$1.object({
    sessionId: sessionIdSchema
});
```

之后追加：

```js
/** session.resolveLog request payload. */
const sessionResolveLogRequestSchema = z$1.object({
    sessionId: sessionIdSchema
});
/** session.resolveLog response value: the on-disk JSONL artifact path (resolved, not read). */
const sessionResolveLogValueSchema = z$1.object({
    sessionId: sessionIdSchema,
    logPath: z$1.string(),
    exists: z$1.boolean(),
    sizeBytes: z$1.number().int().nonnegative().optional(),
    cwd: z$1.string().optional()
});
```

> 复核点：`sessionIdSchema` 在该 region 已定义（与 `sessionForkRequestSchema` 同源）；`z$1` 即 zod。

### 1.2 sessions 域 handler（锚点：`fork` handler 的收尾 `return ok(request, { sessionId: childId });\n\t\t\t},` 与 `async prompt(request)` 之间）

插入：

```js
			async resolveLog(request) {
				const { sessionId } = request.payload;
				let source;
				try {
					source = await readSessionState(sessionId);
				} catch (error) {
					if (error instanceof ApiRemoteSessionNotFound) return err(request, {
						code: "session-not-found",
						message: error.message,
						details: { sessionId }
					});
					return err(request, {
						code: "internal",
						message: `failed to resolve log path for session "${sessionId}": ${String(error)}`,
						details: {}
					});
				}
				const persistence = ctx.get("sessionPersistence");
				if (persistence === void 0 || typeof persistence.locate !== "function") return err(request, {
					code: "internal",
					message: "session log resolution is unavailable: this deployment does not mount @deepseek-ai/dsh-session-persistence",
					details: {}
				});
				let located;
				try {
					located = persistence.locate({ id: source.id, cwd: source.header.cwd });
				} catch (error) {
					return err(request, {
						code: "internal",
						message: `failed to resolve session log location: ${String(error)}`,
						details: {}
					});
				}
				let exists = false;
				let sizeBytes;
				try {
					const st = await stat(located.path);
					exists = st.isFile();
					sizeBytes = st.size;
				} catch {
					/* path absent or unreadable: report exists=false */
				}
				return ok(request, {
					sessionId,
					logPath: located.path,
					exists,
					...sizeBytes === void 0 ? {} : { sizeBytes },
					...source.header.cwd === void 0 ? {} : { cwd: source.header.cwd }
				});
			},
```

> 复用本文件既有符号：`readSessionState`（~2010）、`ApiRemoteSessionNotFound`（已 import）、`err/ok`（域内）、`stat`（已 import）、`ctx.get`（与 `search` handler 同款用法）。`locate` 入参形状 = `SessionHeader`（`{ id, cwd }`），与 `readSessionState` 返回的 `source.header` 一致。

### 1.3 RPC map（锚点：`"session.fork": { schema: sessionForkRequestSchema, invoke: (api, r) => api.sessions.fork(r) },` 之后）

```js
	"session.resolveLog": {
		schema: sessionResolveLogRequestSchema,
		invoke: (api, r) => api.sessions.resolveLog(r)
	},
```

### 1.4 client class（锚点：`fork: (payload, signal) => this.callUnary("session.fork", payload, signal),` 之后）

```js
		resolveLog: (payload, signal) => this.callUnary("session.resolveLog", payload, signal),
```

---

## 2. P2–P4 源文件与 fetch 传输（上游一致性 + HTTP 生效）

### 2.1 `lib/types/api/sessions.schema.js`（锚点：`sessionForkValueSchema` 之后）

与 §1.1 相同的两个 schema（用 zod 写法，同文件现有风格）。

### 2.2 `lib/types/fetch/handler.js`

- 顶部 import 追加：`sessionResolveLogRequestSchema`（随其他 sessions schema 一起）。
- `UNARY_ROUTES` 中 `'session.fork': {…},` 之后追加：

```js
    'session.resolveLog': { schema: sessionResolveLogRequestSchema, invoke: (api, r) => api.sessions.resolveLog(r) },
```

### 2.3 `lib/types/fetch/client.js`

`sessions = { … }` 中 `fork: (payload, signal) => this.callUnary('session.fork', payload, signal),` 之后追加：

```js
        resolveLog: (payload, signal) => this.callUnary('session.resolveLog', payload, signal),
```

> 说明：浏览器走 fetch 传输（`fetch/client.js`），进程内走 `lib/index.js` base class——**两处都要加**，否则一端可用一端报 "unknown method"。

---

## 3. P5 客户端 API 面 `dsh-client-runtime/lib/client.js`

锚点：`SessionRuntime` 类中 `async fork(opts)` 方法结束之后（约 line 8207，`/** Insert-or-enrich…` 注释之前）。

```js
			/**
			* Contract session.resolveLog: resolve the on-disk JSONL artifact path for
			* a session (used by the workspace row "copy session link" action). Pure
			* read; the session may be live or detached.
			* @param opts - target session id.
			* @returns the transport result { ok, value: { sessionId, logPath, exists, sizeBytes?, cwd? }, error? }.
			*/
			async resolveLog(opts) {
				try {
					const { result } = await this.api.sessions.resolveLog({ sessionId: opts.sessionId });
					return result;
				} catch (error) {
					return transportError(error);
				}
			}
```

> 形状与 `fork` 一致（`this.api.sessions.*` 返回 `{ result: { ok, value, error } }`，`transportError` 同文件既有）。

---

## 4. P6 UI `dsh-client-ui-workspace/lib/client.js`（共 8 个小改动）

### 4.1 菜单项（锚点：`sessionMenuItems` 数组中 `{ id: "archive", … }` 之后、`];` 之前）

```js
				{
					id: "copy-link",
					label: t("menu.copySessionLink"),
					icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLinkOutline16, {})
				}
```

> 图标备选：`IconCopyOutline16`（若 `IconLinkOutline16` 未从 primitives 导出，编辑时以 grep 为准）。

### 4.2 onSelect 分派（锚点：`if (id === "archive") onArchive(node.id);` 之后）

```js
								if (id === "copy-link") onCopyLink(node.id, row.title);
```

### 4.3 `SessionNodeItem` 签名（锚点：`function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, drag, flat = false, t })`）

`onFork, onArchive,` 后加 `onCopyLink,`。

### 4.4 props 透传（4 处）

| 组件 | 锚点 | 改动 |
|---|---|---|
| `SessionTree` 签名（~1199） | `onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive,` | 加 `onCopyLink,` |
| `SessionTree` 内 `SessionNodeItem` 调用（~1410） | `onFork: forkSession,` | 加 `onCopyLink,` |
| `FlatList` 签名（~1468） | `onSessionRename, onSessionArchive,` | 加 `onCopyLink,` |
| `FlatList` 内 `SessionNodeItem` 调用（~1544） | `onFork: forkSession,` | 加 `onCopyLink,` |

### 4.5 `WorkspaceBrowser`（2 处）

- 签名（~1647）：`forkSession, renameWorkspace,` 后加 `copySessionLink,`。
- 内部 `SessionTree` / `FlatList` 调用处（~1997 / ~2011）：`forkSession,` 旁加 `onCopyLink: copySessionLink,`。

### 4.6 动作接线（锚点：`forkSession: (sessionId) => { … },` 之后，约 line 2373）

```js
				copySessionLink: async (sessionId, title) => {
					const result = await ctx.sessions.resolveLog({ sessionId });
					if (!result.ok) throw new Error(result.error.message);
					const { logPath, exists, cwd } = result.value;
					const label = title && title !== "" ? title : sessionId;
					const uri = `dsh-session:${btoa(JSON.stringify(sessionId)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
					const link = [
						`@[${label}](${uri})`,
						`log: ${logPath}${exists ? "" : "   # 文件尚未落盘（会话运行中）"}`,
						cwd ? `cwd: ${cwd}` : null
					].filter(Boolean).join("\n");
					await navigator.clipboard.writeText(link);
				},
```

> 说明：session id 是 ASCII（`session-<uuid>`），`btoa(JSON.stringify(id))` 安全；`cwd` 里若有 `#`/换行则链接第二行被截断——cwd 为本地路径，可接受（TC-4 可加转义）。

### 4.7 文案（2 处）

- zh（锚点：`"menu.archiveSession": "归档会话",` 之后）：`"menu.copySessionLink": "复制会话链接",`
- en（锚点：`"menu.archiveSession": "Archive session",` 之后）：`"menu.copySessionLink": "Copy session link",`

---

## 5. P7 `session:read` 动态插件（C2，宿主工具）

### 5.1 完整插件源码（`code.host`）

```js
return {
  apply(ctx) {
    const harness = globalThis.harness
    const disposers = []

    const parseLink = (link) => {
      const uri = link.match(/dsh-session:([A-Za-z0-9_-]+)/)?.[1]
      const log = link.match(/^log:\s*(\S+)/m)?.[1]
      let id = null
      if (uri) {
        try { id = JSON.parse(atob(uri.replace(/-/g, '+').replace(/_/g, '/'))) } catch (e) { /* fallthrough */ }
      }
      return { id, log }
    }

    const textOf = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      return blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
    }

    const project = (content, maxChars, truncate) => {
      const lines = content.split('\n')
      const out = []
      let header = null
      for (const line of lines) {
        if (!line.trim()) continue
        let r
        try { r = JSON.parse(line) } catch (e) { continue }
        const t = r.type
        if (t === 'session') { header = r; continue }
        if (t === 'user/message') {
          const src = r.data && r.data.source
          if (!src || src.kind !== 'user') continue
          const txt = textOf(r.data.content)
          if (txt) out.push({ seq: r.seq, role: 'user', text: txt })
        } else if (t === 'assistant/message') {
          const txt = textOf(r.data && r.data.message && r.data.message.content)
          if (txt) out.push({ seq: r.seq, role: 'assistant', text: txt })
        } else if (t === 'agent/inbox/spliced') {
          const txt = (r.data && r.data.inserted || []).map((i) => textOf(i.content)).filter(Boolean).join(' / ')
          if (txt) out.push({ seq: r.seq, role: 'inbox', text: txt })
        } else if (t === 'session/title') {
          if (r.data && typeof r.data.title === 'string') header = { ...(header || {}), title: r.data.title }
        }
        // 其余类型（chunk/工具/推理/环境）默认跳过
      }
      const blocks = []
      if (header) {
        blocks.push(`session: ${header.id}`)
        if (header.title) blocks.push(`title: ${header.title}`)
        if (header.cwd) blocks.push(`cwd: ${header.cwd}`)
        blocks.push('')
      }
      let acc = 0
      let kept = []
      for (const row of out) {
        acc += row.text.length
        kept.push(row)
      }
      if (acc > maxChars) {
        if (truncate === 'head') kept = kept.slice(0, Math.max(1, Math.floor(maxChars / (acc / kept.length))))
        else kept = kept.slice(-Math.max(1, Math.floor(maxChars / (acc / kept.length))))
        blocks.push(`〔已截断：${kept.length}/${out.length} 条，原 ${acc} 字符〕`)
      }
      for (const row of kept) blocks.push(`${row.role === 'assistant' ? 'assistant' : 'user'}${row.role === 'inbox' ? '（注入）' : ''}: ${row.text}`)
      return { text: blocks.join('\n'), seqs: kept.length ? [kept[0].seq, kept[kept.length - 1].seq] : null, truncated: acc > maxChars }
    }

    const tool = harness.defineTool({
      name: 'session_read',
      description: '读取本机任意 DSH 会话的日志（session.jsonl.zstd）并投影为可读对话文本。输入为「复制会话链接」产生的链接文本（含 dsh-session: URI 与 log: 绝对路径），或仅含其中一项。只读，不修改源日志。',
      parameters: {
        link: { type: 'string', required: true, description: '会话链接文本，例如 @[标题](dsh-session:…) 与 log: <绝对路径> 两行' },
        maxChars: { type: 'number', description: '投影文本预算，默认 64000' },
        truncate: { type: 'string', description: '超预算保留策略：tail（默认，保最近）| head' },
        raw: { type: 'boolean', description: 'true 时返回原始 JSONL（限长 200000 字符），调试用' }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sessionId: { type: 'string' },
            logPath: { type: 'string' },
            title: { type: 'string' },
            cwd: { type: 'string' },
            seqRange: { type: 'array', items: { type: 'integer' } },
            transcript: { type: 'string' },
            truncated: { type: 'boolean' }
          }
        },
        render: (args, value) => [{ type: 'text', text: value.transcript }]
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { link, maxChars = 64000, truncate = 'tail', raw = false } = args
        const parsed = parseLink(link)
        const persistence = ctx.get('sessionPersistence')
        if (persistence === void 0) return { error: { code: 'NO_PERSISTENCE', message: '宿主未挂载 sessionPersistence' } }
        if (parsed.id) {
          const artifact = await persistence.readRaw(parsed.id, exec.signal)
          if (artifact !== void 0) {
            if (raw) return { logPath: artifact.filename, transcript: artifact.content.slice(0, 200000), truncated: artifact.content.length > 200000 }
            const p = project(artifact.content, maxChars, truncate)
            return { sessionId: artifact.meta.id, title: artifact.meta.title, cwd: artifact.meta.cwd, logPath: artifact.filename, seqRange: p.seqs, transcript: p.text, truncated: p.truncated }
          }
        }
        if (parsed.log) {
          const { readFile } = await import('node:fs/promises')
          const { zstdDecompressSync } = await import('node:zlib')
          const buffer = await readFile(parsed.log)
          const content = buffer[0] === 0x28 ? zstdDecompressSync(buffer).toString('utf8') : buffer.toString('utf8')
          const p = project(content, maxChars, truncate)
          return { logPath: parsed.log, seqRange: p.seqs, transcript: p.text, truncated: p.truncated }
        }
        return { error: { code: 'UNPARSEABLE', message: '链接中既无 dsh-session: URI 也无 log: 路径' } }
      }
    })
    disposers.push(harness.registerTool(ctx, tool))
    ctx.effect(() => () => disposers.forEach((d) => d()))
  }
}
```

> 规格注记：
> - `harness.defineTool / registerTool` 为 Host Builtin（已查证）；`ToolDefinition` 字段（`name/description/parameters/output/execute/isConcurrencySafe`）与 `dsh-tool-fs` 的 `defineTool` 一致（已查证源码）。
> - `ctx.get('sessionPersistence')` 为可选服务（`access.optional`，需 undefined 检查——已做）；`readRaw` 仅在 `supportsRawArtifacts` 时可用，JSONL 后端满足。
> - 动态插件环境无 `node:fs/promises` / `node:zlib` 直接 import？——**TC-3 待确认**：若 Host 运行时不提供 Node 模块，`log:` 路径分支改为走 `sessionPersistence.readRaw`（按 id）或由宿主注入 `fs` 服务；`raw` 分支同理。若不可行，删除 `log:` 直读分支，仅保留按 id 读取（`dsh-session:` URI 已含 id，满足主流程）。
> - 剪贴板/菜单在本插件外（P6），本插件只做读取。

### 5.2 定义与运行步骤

1. `cordis_define`（`kind: "new"`，idPrefix 建议 `sread`，name "session-read"）。
2. `cordis_run`（`run`）。
3. 验证：粘贴 §M0 演示链接 → 输出与 `m0-evidence.md` 投影一致。

### 5.3 回滚

`cordis_stop`（暂停）或 `cordis_undefine`（彻底移除），不影响任何 shipped 包。

---

## 6. 补丁工程（`patches/`）

### 6.1 目录约定

```
patches/
├── README.md          # 补丁清单与重打说明
├── reapply.sh         # 从 patches/ 恢复全部安装文件改动
├── P1-api-proxy-index.diff    # 或整文件备份 .orig 方式（见下）
├── P5-client-runtime.diff
└── P6-ui-workspace.diff
```

### 6.2 reapply.sh 骨架

```bash
#!/usr/bin/env bash
# 重打 M1 补丁：以 .orig 备份为准，逐文件 cp 还原补丁版本
set -euo pipefail
BASE=/Users/huangjin/dev/npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
declare -A FILES=(
  [P1]="dsh-host-apiproxy/lib/index.js"
  [P2]="dsh-host-apiproxy/lib/types/api/sessions.schema.js"
  [P3]="dsh-host-apiproxy/lib/types/fetch/handler.js"
  [P4]="dsh-host-apiproxy/lib/types/fetch/client.js"
  [P5]="dsh-client-runtime/lib/client.js"
  [P6]="dsh-client-ui-workspace/lib/client.js"
)
DIR="$(cd "$(dirname "$0")" && pwd)"
for key in P1 P2 P3 P4 P5 P6; do
  src="$DIR/$key.patched"
  dst="$BASE/${FILES[$key]}"
  [ -f "$src" ] && cp "$src" "$dst" && echo "applied $key -> $dst"
done
echo "done. 刷新页面 / 必要时重启 Web 进程。"
```

> 落地方案：每次编辑前 `cp 原文件 patches/<P#>.orig`，编辑后 `cp 修改后文件 patches/<P#>.patched`。升级后 `reapply.sh` 一键恢复；同时保留 `.diff` 便于评审。

---

## 7. 回滚总则

| 层 | 回滚手段 |
|---|---|
| P1–P6（shipped 包） | `cp patches/<P#>.orig` 还原 → 刷新/重启 |
| P7（动态插件） | `cordis_stop` / `cordis_undefine` |
| 部分失败 | RPC 未生效不影响 rename/fork/archive（独立 map 项）；菜单项未生效不影响其他三项 |

---

## 8. 待确认项（新增/更新）

| # | 问题 | 影响 | 确认方式 |
|---|---|---|---|
| TC-3 | 动态插件宿主环境能否 `import('node:zlib')` / `node:fs` | `session:read` 的 `log:` 直读分支 | 定义插件前在宿主侧试一个最小工具；不行则删该分支（id 路径仍完整） |
| TC-4 | `cwd` 含 `#`/换行时链接第二行截断 | 链接可解析性 | 本地路径实测不含 `#`；如需稳妥加转义（延期） |
| TC-1 | `dsh-agent` mention 注入挂点（C3/M2） | M2 | M2 开工前读源码 |
| TC-2 | RPC vs 服务注入实现取舍 | 已定 RPC（本期） | 已归档，M2 可复议 |

---

## 9. 完成定义（M1）

1. P1–P6 全部落地且 `patches/` 存有 `.orig`/`.patched` 备份。
2. 浏览器行菜单出现「复制会话链接」，点击后剪贴板为 §4.6 格式。
3. 新会话粘贴链接 + 请求读取：`session:read` 返回与 `m0-evidence.md` §3.4 一致的可读投影。
4. 无 `session:read` 时（C1 兜底）：bash `zstd -dc <log 路径>` 可直读。
5. 全部验收标准见 `implementation-plan.md` §6。
