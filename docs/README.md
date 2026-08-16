# 设计过程存档（中文）

这些文档是 `dsh-session-link` 开发期间的设计与实证记录，按时间顺序保留。
文中的路径（如 `bundle/dsh-session-link/`）、旧名（`dsh-session-crosser`）
与里程碑状态均为**当时的历史快照**，与最终仓库结构不必一致；最终行为以
根目录 [README.zh.md](../README.zh.md) 与 [SKILL.md](../skills/dsh-session-link/SKILL.md) 为准。

| 文档 | 内容 |
|---|---|
| [`design.md`](design.md) | 设计评审稿：需求分析、现状实证、载荷格式、RPC 契约、投影规则、风险 |
| [`architecture.md`](architecture.md) | 架构方案：组件职责、数据流时序、部署形态、安全边界、扩展点 |
| [`implementation-plan.md`](implementation-plan.md) | 实施计划：任务级 WBS、依赖关键路径、验收、回滚、TC 清单 |
| [`implementation-spec.md`](implementation-spec.md) | 实施规格：逐文件补丁级（锚点 + 完整代码）、各版本演进与踩坑 |
| [`m0-evidence.md`](m0-evidence.md) | M0 零代码验证记录：直读/投影/预算实证 |
