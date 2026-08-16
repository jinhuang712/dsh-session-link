# 架构方案：会话链接复制与跨会话读取

> 版本 v1 · 对应 DSH `@deepseek-ai/dsh@0.1.0-rc.6` · 详细设计决策见 [`design.md`](design.md)（本文件只讲结构）

---

## 1. 架构目标与设计原则

### 1.1 目标

1. **复制端**：会话行菜单（与「重命名 / 分叉 / 归档」并列）新增「复制会话链接」。
2. **载荷**：链接文本携带 **session id + 本机真实日志绝对路径**（+ cwd / 标题等元数据）。
3. **消费端**：另一个 session（agent）拿到链接后**快速读到该会话的可读内容**，免去 zip 下载/传输/解压。

### 1.2 设计原则

| 原则 | 含义 |
|---|---|
| 最小侵入 | 优先复用 DSH 已有资产：`dsh-session-reference` 的 URI/mention 格式、`node:zlib` zstd 解码、`scanLog` 已提交前缀读取 |
| 三段解耦 | 复制端（Web UI）/ 宿主（解析+读取）/ 消费端（agent）职责分离，**链接文本是唯一的跨端契约** |
| 渐进落地 | C1 直读 → C2 宿主工具 → C3 自动注入，每一层独立可上线、可回滚 |
| 同机信任 | 路径为本机绝对路径，默认同机单用户信任域；跨机不在本期 |
| 只读 | 所有读取路径均不改写源日志，只做解压/投影 |

---

## 2. 总体架构

```
┌──────────── 复制端（Web Client） ────────────────────────────────────┐
│ dsh-client-ui-workspace · SessionNodeItem（会话行菜单）               │
│   「复制会话链接」                                                    │
│     ├─ ctx.sessions.resolveLog({ sessionId })  ← 新 RPC（宿主解析）   │
│     └─ navigator.clipboard.writeText(link)      ← 链接拼装 + 写剪贴板 │
└───────────────────────┬──────────────────────────────────────────────┘
                        │ 链接文本（唯一跨端契约，见 §4.1）
                        ▼
┌──────────── 宿主（Host） ────────────────────────────────────────────┐
│ api-proxy · session.resolveLog（RPC）                                 │
│   → 查 session（session-query / 持久化）取 cwd                        │
│   → logPath(root, cwd, id)  ← 复用 session-persistence-jsonl 编码     │
│   → stat 校验 exists / sizeBytes                                      │
│                                                                       │
│ session:read（宿主工具，C2，动态插件）                                 │
│   → 解析链接 → node:zlib 解压 → scanLog（已提交前缀）→ 投影 → 限长     │
└───────────────────────┬──────────────────────────────────────────────┘
                        │ 可读对话文本（user/assistant 投影）
                        ▼
┌──────────── 消费端（另一 session 的 Agent） ──────────────────────────┐
│ C1  直读：bash zstd -dc "<log: 路径>"       （零代码；受文件策略约束） │
│ C2  工具：session:read({ link })            （推荐；宿主通道+投影）    │
│ C3  原生：@[label](dsh-session:…) 自动注入  （远期；无需任何工具调用） │
└───────────────────────────────────────────────────────────────────────┘
```

**核心架构判断**：读的链路（C1/C2/C3）与复制的链路（菜单 + RPC）是**两个正交的组件面**，只通过链接文本耦合。因此 M1 可以先只做复制端 + C2 工具，C3 后续无缝替换消费端实现。

---

## 3. 模块职责与归属

| 组件 | 职责 | 部署归属 | 改动类型 |
|---|---|---|---|
| `dsh-client-ui-workspace`（行菜单） | 复制入口：菜单项、RPC 调用、链接拼装、剪贴板 | shipped 包（本部署改安装文件；治本走上游 PR） | 补丁 |
| `dsh-host-apiproxy`（sessions 域） | `session.resolveLog` RPC：解析 cwd → 计算路径 → stat | shipped 包（同上） | 补丁 |
| `dsh-client-runtime` / fetch client | 客户端 API 面新增 `sessions.resolveLog` | shipped 包（同上） | 补丁 |
| `dsh-session-persistence-jsonl` | 路径编码、落盘、zstd 解码、`scanLog` | shipped 包 | **只读复用，不改** |
| `session:read`（宿主工具） | 读取 + 投影 + 限长（C2） | 动态 Cordis 插件 / preset 挂载 | 新增（可独立停用） |
| `dsh-session-reference`（服务） | 投影服务 + mention 解析（C3 远期） | 当前未挂载；M2 经 profile `cordis.patch.yml` 挂载 | 新增（组合层） |
| `dsh-agent`（消息管线） | C3：intake 检出 mention → `prepare` → 注入 | shipped 包 | M2 接线（待确认 TC-1） |

**依赖方向**：消费端 →（链接文本）→ 复制端；复制端 →（`session.resolveLog`）→ 宿主持久化/查询。无循环依赖。

---

## 4. 关键接口契约

### 4.1 链接文本（跨端唯一契约）

```
@[<标题>](dsh-session:<base64url(JSON.stringify(sessionId))>)
log: <绝对路径>/session.jsonl.zstd
cwd: <会话工作目录>        # 可选
created: <epochMs>         # 可选
```

- 第一行复用 `dsh-session-reference` 的规范 mention 格式（远期 C3 可直接识别）。
- `log:` 行是用户要求的「真实存放位置」，消费端优先用它；宿主工具再按 id 二次校验。
- 完整规范、示例、解析规则见 `design.md` §4。

### 4.2 RPC `session.resolveLog`

```
请求  { sessionId: string }
响应  { sessionId, logPath, exists, sizeBytes?, cwd?, title? }
错误  SESSION_NOT_FOUND（session 不存在，live 或持久化均无）
```

- 只解析不读盘；路径不存在也返回（供展示「尚未落盘」）。schema 见 `design.md` §5。

### 4.3 工具 `session:read`（C2）

```
session:read({
  link: string,                    // §4.1 链接文本（或仅含 dsh-session: / log: 之一）
  maxChars?: number = 64000,       // 投影预算（对齐 64KB）
  truncate?: "tail" | "middle",    // 超预算保留策略，默认保最近
  raw?: boolean = false,           // true 返回原始 JSONL（限长），调试用
})
→ { ok, sessionId, title?, cwd?, logPath, seqRange, transcript, truncated }
→ { ok: false, error: { code, message } }
```

### 4.4 服务 `sessionReferenceResolver`（C3 远期）

`listCandidates(agent, query, limit)` / `prepare(agent, content, references, signal)` → 投影文本注入。见 `design.md` §7.3。

---

## 5. 数据流与时序

### 5.1 复制时序（M1）

```
用户点击行菜单「复制会话链接」
  → ui-workspace: ctx.sessions.resolveLog({sessionId})        [RPC]
  → api-proxy handler: 取 cwd → logPath(root,cwd,id) → stat
  → 响应 { sessionId, logPath, exists, sizeBytes, cwd, title }
  → ui-workspace: 拼装 link（mention + log: + cwd:）
  → navigator.clipboard.writeText(link)
  → 用户粘贴到任意会话（同机任意 workspace 均可）
```

### 5.2 读取时序（C2，推荐）

```
接收 agent 收到 link + 「读一下」
  → 调用 session:read({ link })
  → 宿主：解析链接 → 定位 session.jsonl.zstd
  → node:zlib 解压 → scanLog（已提交前缀）
  → 投影（user/assistant 文本，跳过工具/推理/噪声）
  → 限长截断 → 返回 { transcript, seqRange, truncated }
  → agent 基于内容继续工作
```

### 5.3 自动注入时序（C3 远期）

```
用户粘贴 @[标题](dsh-session:…)
  → dsh-agent intake: parseSessionReferenceText 检出
  → sessionReferenceResolver.prepare(agent, content, references)
  → 投影以 user/message（source.kind="session-reference"）注入
  → 客户端渲染为 "recall" 角色（已支持）
  → agent 无需任何工具调用即看到内容
```

---

## 6. 部署架构

### 6.1 本部署（M1，快速版）

- **shipped 包改动**（ui-workspace / api-proxy / client-runtime）：直接编辑安装文件
  `/Users/huangjin/dev/npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/lib/…`
- **新增能力**（`session:read` 工具）：动态 Cordis 插件（可 `cordis_stop` / `cordis_undefine` 独立回滚）
- **补丁存档**：`patches/` 目录保存 diff + 重打脚本（升级覆盖后可一键恢复）
- 生效方式：浏览器模块由 `dsh-client-modules` 按包 serve，改后刷新页面；若模块表有缓存需重启 Web 进程

### 6.2 上游（M2，产品化）

- PR 到 `deepseek-ai/deepseek-harness`：
  - `packages/client/ui-workspace`（菜单项 + 文案 zh/en）
  - `packages/host-apiproxy`（`session.resolveLog` schema + handler + fetch client）
  - `packages/client-runtime`（client API 面）
- 组合挂载：`dsh-session-reference` 经 profile `cordis.patch.yml` 插入（示例见 `design.md` §7.3.1）

### 6.3 分层关系

```
profile cordis.patch.yml（组合挂载：session-reference 等）
        └─ shipped 包补丁（ui-workspace / api-proxy / client-runtime）
                └─ 动态插件（session:read，随会话生命周期）
```

---

## 7. 安全与权限边界

| 边界 | 说明 |
|---|---|
| 文件策略 | C1（bash 直读）受会话 sandbox 约束，仅 danger-full-access 可用；C2（宿主工具）由宿主读取，不经过文件策略，同机信任域内可用 |
| 只读 | 所有路径只解压/投影/返回，不写源日志、不落盘中间产物 |
| 预算 | 投影默认 64KB 截断，防超长日志撑爆上下文 |
| 隐私 | 链接含绝对路径（暴露用户名/workspace 命名），文档标注勿外发 |
| 同机信任 | 默认单机单用户；跨机需走 zip 导出或对象存储（不在本期） |
| 沙箱会话的取舍 | `session:read` 在受限会话中等于授予「读任意本机会话日志」能力——同机信任下可接受，需在工具描述中明示 |

---

## 8. 扩展点（后续可做，非本期）

1. **浏览器 URL deeplink**：`dsh-web-app` 增加 `?session=<id>` 路由解析（目前无此机制），让链接可「点击打开会话」。
2. **跨机传输**：把链接升级为可解析远端日志的引用（对象存储/共享盘），本期明确不做。
3. **种子回灌**：把读取的投影内容作为 `session.create` 的 `seed`/fork 输入，实现「从链接恢复会话」——属 `dsh-session` seed 机制范畴，可后续评估。
4. **复制增强**：菜单再加「复制 session id 原文」等细粒度项（同一 RPC，一行代码的事）。

---

## 9. 架构决策记录（ADR 摘要）

| # | 决策 | 理由 |
|---|---|---|
| ADR-1 | 链接第一行用 `dsh-session:` 规范 mention | 兼容远期 C3；`decodeSessionReferenceUri` 强校验保证 id 规范 |
| ADR-2 | 日志路径单独放 `log:` 行，不塞进 URI | URI 规范形校验拒绝附加参数（`design.md` §9 风险 7） |
| ADR-3 | `session.resolveLog` 走 api-proxy RPC 而非直接复用 `sessionReferenceResolver` | RPC 是 UI 复制用的只读解析，服务注入是 C3 自动注入用，职责不同（TC-2 待终裁） |
| ADR-4 | 读取优先 `scanLog` 已提交前缀而非裸文件读 | 并发写尾巴/半截帧的鲁棒性（`design.md` §9 风险 2） |
| ADR-5 | C2 用宿主工具而非教 agent 解析 JSONL | 投影由宿主完成，模型只消费可读文本；沙箱会话也可用 |
