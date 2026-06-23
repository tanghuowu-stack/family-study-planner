# Codex 精简使用说明

这份说明用于减少重复背景信息和 Token 消耗，同时避免后续修改偏离当前项目规则。

## 每次修改前

先让 Codex 阅读：

1. `docs/project-rules.md`
2. `docs/current-state.md`
3. `docs/change-log.md`

如果任务涉及云端迁移，再额外阅读 `docs/cloud-migration-plan.md`。

## 如何写新提示词

- 每次只描述本轮要解决的问题、不能改动的范围和验收标准。
- 不要重复粘贴项目全部历史、完整分类说明或已经稳定的功能。
- 可以直接写：“先阅读 docs/project-rules.md、docs/current-state.md 和 docs/change-log.md，再在原项目上增量修改。”
- 如果本轮要求与长期规则冲突，以本轮用户明确要求为准，并同步更新相关文档。

## 推荐 Codex 设置

- 小修、样式、文案、按钮和普通单页面问题：速度=快速，推理=中。
- 普通 bug：速度=快速，推理=中。
- 统计口径、IndexedDB 迁移或多页面批量修改：速度=快速或默认，推理=高。
- Supabase、数据库迁移、登录、权限、RLS、云同步：速度=默认，推理=高。

推荐设置只是使用建议，不能替代用户在 Codex 界面中的实际选择。

## 每次修改后

1. 在 `docs/change-log.md` 顶部追加一条简短记录。
2. 如果长期规则发生变化，更新 `docs/project-rules.md`。
3. 如果已完成功能或部署状态发生变化，更新 `docs/current-state.md`。
4. 运行 `npm run build`，确认 TypeScript 和生产构建通过。

## 精简提示词示例

```text
请先阅读 docs/project-rules.md、docs/current-state.md 和 docs/change-log.md。
在原项目上只修复本轮问题：……
不要修改：……
验收：……
完成后更新 docs/change-log.md，并运行 npm run build。

推荐 Codex 设置：速度=快速，推理=中。
```
