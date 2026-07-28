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
3. ~~tasks（页面入口与生命周期已迁移，业务内核继续拆分）~~
4. releases
5. reports
6. portfolio
