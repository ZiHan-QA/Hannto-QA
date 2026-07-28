# 前端模块目录

本目录用于 Hannto QA 管理平台的渐进式模块化。

- `core/`：平台配置、权限、路由和模块注册；
- `shared/`：公共组件、工具与样式；
- `modules/`：独立业务模块。

新增代码前请先阅读 [`docs/module-development-guide.md`](../docs/module-development-guide.md)。

在旧代码完全迁移前，`main.html` 仍是应用入口。所有抽离必须保持静态 GitHub Pages 可直接运行，不引入必须构建才能启动的依赖。

