# 实施计划：会话链接复制与跨会话读取（v2 · 纯插件 v1）

> 状态：**M0 ✅ / M1 纯插件 v1 ✅ 已运行（slnk-1/pkg-2）** · 架构 [`architecture.md`](architecture.md) · 设计 [`design.md`](design.md) · 规格 [`implementation-spec.md`](implementation-spec.md) · M0 实证 [`m0-evidence.md`](m0-evidence.md)
> 方向决策（2026-08）：**先纯插件 v1，零补丁**；sidebar 行菜单降级为 Phase 2（可选）。

---

## 1. 里程碑状态

| 里程碑 | 状态 | 产出 |
|---|---|---|
| M0 零代码验证 | ✅ | 直读/投影/预算实证（[`m0-evidence.md`](m0-evidence.md)） |
| **M1 纯插件 v1** | ✅ **已运行** | 动态插件 `slnk-1`（pkg-3 对话框版）：会话读取器对话框（列表+搜索+预览+复制）+ `session_read` 工具 |
| Phase 2（可选） | 📋 待定 | sidebar 行菜单（补丁或上游 PR）——对话框已覆盖「读任意会话免切换」，Phase 2 需求弱化 |

## 2. M1 已交付与验证记录

| 项 | 内容 | 验证 |
|---|---|---|
| 插件 | `slnk-1`（session-link），Host+Client 双半 | `state: running`，host `handlers: ["resolve-link"]` |
| 私有方法 | `resolve-link`：`sessions.get(id).header.cwd` → `sessionPersistence.locate` → `{sessionId, logPath, cwd, title}` | host status running |
| 工具 | `session_read`：链接 → `readRaw` → 投影 → 限长 | 已出现在 Tool.listTools |
| 按钮 | `conversation.session.header.actions` 注册 `copy-session-link`（order 30） | 槽位 occupants 显示 `dyn/slnk-1 active: true` |
| 踩坑 | pkg-1 失败：output schema 嵌套对象缺 `additionalProperties` → pkg-2 修复 | 已记录在 spec §0.1 |

## 3. 用户实测清单（待你操作）

1. **刷新页面**（Client 半加载），会话 header 出现 **🔗 读取** 按钮。
2. 点按钮 → 打开**会话读取器**对话框：左侧全部会话（标题/cwd/运行中徽标，可搜索），右侧预览投影内容。
3. 选任意会话 → 底部**「复制引用 @名」**：剪贴板得到单行 `@<会话标题>`（如 `@你好`），无路径/无换行。
4. 把 `@你好` 粘贴到本会话发给我 → 我按标题解析到该会话并读取投影（`session_read` 支持 `@标题` / `dsh-session:URI` / `session-<uuid>`）。
5. （次要）对话框里「完整链接」仍可复制旧 3 行格式，供机器/C1 用途。

## 4. 已知边界（Phase 2 前接受）

- 只能复制**当前打开**的会话；复制别的会话需先切过去。
- 动态插件归**定义它的会话**；其他会话默认没有按钮/工具（可用 C1 直读；或后续挪进 agent preset 全局化）。
- `session_read` 仅按 `dsh-session:` id 读取；`log:` 纯路径分支返回提示（走 C1）。

## 5. Phase 2 决策点（暂不执行）

- 触发条件：实测中发现「先切到源会话再复制」明显影响使用。
- 选项：① sidebar 行菜单补丁（spec §1–§6，需 `patches/`）；② 上游 PR（ui-workspace + api-proxy，治本）；③ 纯插件 header 版 + preset 全局化（仍零补丁）。

## 6. 回滚

`cordis_stop slnk-1` 暂停（按钮与工具消失）；`cordis_undefine slnk-1` 彻底移除。零副作用，不影响任何 shipped 文件。
