# 业务模块

每个业务模块使用独立目录，并至少包含：

```text
module-name/
  index.js
  styles.css
  README.md
```

`README.md` 说明模块负责人、数据表、权限、项目关联、外部服务和验收步骤。`index.js` 通过 `HanntoQA.registerModule()` 注册，加载阶段不得直接发请求或修改 DOM。

推荐迁移顺序：

1. ~~feedback~~（已完成）
2. ~~projects~~（已完成）
3. tasks（页面入口、查询、列表和详情已迁移；编辑器、进度和 TestHub 计算继续拆分）
4. releases
5. reports
6. portfolio
7. bugs
8. members
9. dashboard

当前架构、剩余迁移范围和多人协作要求见
[`docs/developer-handoff-current-state.md`](../../docs/developer-handoff-current-state.md)。
