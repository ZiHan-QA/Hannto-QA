# Hannto QA 管理平台开发交接与当前架构

更新时间：2026-07-28

本文档面向后续参与 Hannto QA 管理平台开发、模块迁移和代码评审的同事。开始开发前，应同时阅读：

- [`module-development-guide.md`](./module-development-guide.md)：长期开发规范；
- [`../src/modules/_template/README.md`](../src/modules/_template/README.md)：新模块模板；
- 目标模块目录内的 `README.md`；
- 与需求对应的 `supabase/migrations/` SQL。

## 1. 当前产品模型

平台的统一数据链路是：

```text
BU（小米 / 消费 / Other）
  -> QA 项目（qa_projects）
    -> 月度项目排期（project_monthly_plans）
    -> 版本（releases）
    -> 工作事项（qa_tasks）
      -> 负责人（qa_task_assignees）
      -> 手工进度 / TestHub 进度
      -> BUG、质量报表和资源占用
```

要求：

- 项目是所有业务数据的统一入口；
- 版本和工作事项必须使用稳定 ID 关联项目，不能依赖名称猜测；
- 无法识别项目的数据进入“待归属”，不得自动放进 `Other`；
- BU Tab 必须真实过滤数据；
- 工作台跳转到事项时，应先识别项目和 BU，再加载目标事项；
- QA 负责人可按 BU 查看团队数据，测试工程师只查看其参与的数据。

## 2. 当前技术形态

平台是可直接部署到 GitHub Pages 的静态前端，使用 Supabase Auth、Postgres、RLS、RPC 和 Edge Function。

当前仍保留以下特点：

- `main.html` 是应用入口，并承载大量历史业务代码；
- 无前端构建步骤，模块通过 `<script>` 和 `<link>` 直接加载；
- `src/core/platform.js` 提供模块注册、页面名称和 BU 公共配置；
- 独立模块位于 `src/modules/<module>/`；
- 外部 PingCode/TestHub 数据通过受控代理或本地同步工具写入 Supabase 缓存；
- 浏览器端不得保存 Hanntonb API Key、service role key 或用户密码。

`main.html` 当前约 500 KB、6000 多行。多人开发时，应把减少该文件冲突作为重要约束。

## 3. 当前模块化完成度

| 页面 | 当前实现 | 状态 | 后续处理 |
|---|---|---|---|
| 意见反馈 | `src/modules/feedback/` | 已模块化 | 维护即可 |
| 项目总览 | `src/modules/projects/` | 已模块化 | 维护即可 |
| 工作事项 | `src/modules/tasks/` + `main.html` 兼容层 | 部分模块化 | 分阶段迁移编辑器、进度和 TestHub 计算 |
| 版本与发布 | `main.html` | 未迁移 | 建议下一批迁移 |
| 质量报表 | `main.html` | 未迁移 | 适合在版本模块之后迁移 |
| 项目总排期 | `main.html` | 未迁移 | 数据依赖多，排在版本之后 |
| BUG 管理 | `main.html` | 未迁移 | 可独立迁移 |
| 成员管理 | `main.html` | 未迁移 | 涉及权限与密码重置，需单独 PR |
| 工作台 | `main.html` | 未迁移 | 跨模块聚合最多，最后迁移 |
| 全功能测试地图 | `main.html` | 未迁移 | 可在核心项目链路稳定后迁移 |
| 自动化测试 | `main.html` | 暂不排期 | 按当前产品计划保持现状 |
| PRD、资产、文案、知识库 | iframe/独立页面 | 旧模块兼容 | 不在普通功能 PR 中顺手重写 |
| AI 写用例 | 外部页面 iframe | 外部系统 | 保持独立发布 |

## 4. 下一阶段迁移顺序

建议一次只迁移一个模块：

1. **版本与发布**：先统一项目、版本和当前版本的接口；
2. **质量报表**：以只读聚合为主，迁移风险相对低；
3. **项目总排期**：复用项目、工作事项和服务器完成时间；
4. **BUG 管理**：整理 BUG、复盘和负责人关联；
5. **全功能测试地图**；
6. **成员管理**：同时复核 RLS、职责和管理员 Edge Function；
7. **工作事项第二阶段**：迁出编辑器、手工进度和 TestHub 计算；
8. **工作台**：最后迁移跨模块聚合与跳转；
9. 统一 UI、性能、自动化回归和无障碍体验。

以下内容目前不建议直接重写：

- 工作事项资源分配算法；
- 多负责人 TestHub 执行量分摊；
- 延期滚动占用；
- 本地 TestHub 同步流程；
- PRD、资产和文案 iframe 页面。

修改这些区域前，必须先补回归样例。

## 5. 新模块开发要求

新模块必须从 `src/modules/_template/` 复制，并至少包含：

```text
src/modules/<module>/
  index.js
  styles.css
  README.md
```

模块通过 `HanntoQA.registerModule()` 注册。不得在脚本加载阶段查询数据库、修改 DOM 或注册全局监听器。

模块 `README.md` 必须写明：

- 模块 ID、负责人和业务范围；
- 使用的数据表、RPC、Edge Function；
- 是否按 BU/项目过滤；
- 三种职责的权限；
- 外部服务和密钥方案；
- SQL 迁移文件；
- 验收步骤、回滚方式和已知限制。

新增页面还需完成：

1. 在 `src/core/platform.js` 增加页面标题；
2. 在 `main.html` 加载模块 CSS 和 JS；
3. 增加侧边栏入口；
4. 在 `renderPage()` 接入注册模块；
5. 如属于项目管理范围，加入 `projectBusinessPages`；
6. 添加模块 README 和必要 SQL；
7. 更新本文档的模块状态。

## 6. 模块间调用规则

允许：

- 使用 `createModuleContext()` 提供的 Supabase、用户、职责、BU、提示和公共格式化能力；
- 通过已声明的模块公开方法进行跳转，例如项目总排期调用项目模块的 `openProject()`；
- 使用稳定 ID 传递项目、版本、事项和用户。

禁止：

- 直接修改其他模块的内部变量；
- 复制一份角色判断、BU 映射或 Supabase 客户端；
- 用姓名、标题或邮箱作为唯一关联键；
- 新增大量 `window.*` 全局函数；
- 在 HTML 字符串中继续扩散跨模块业务逻辑；
- 绕过 RLS，仅靠隐藏按钮控制权限。

现阶段 `main.html` 中仍有历史全局函数。新模块可以通过兼容接口调用，但不得新增同类技术债；迁移完成后应删除兼容接口。

## 7. 数据库与权限要求

平台职责固定为：

| 职责 | 代码值 | 数据范围 |
|---|---|---|
| 系统管理员 | `admin` | 系统设置、全部项目和危险操作 |
| QA 负责人/项目负责人 | `qa_lead` | 全部 QA 项目、团队事项、排期和质量数据 |
| 测试工程师 | `tester` | 参与项目和本人事项 |

数据库要求：

- 新表必须启用 RLS；
- 分别设计 `SELECT / INSERT / UPDATE / DELETE` 策略；
- 普通成员保存本人事项必须同时满足 RLS 和 RPC 校验；
- 管理员能力不能通过浏览器提交的角色字段判断；
- 多负责人使用关联表，不保存逗号分隔字符串；
- 完成时间使用数据库服务器时间；
- 工作日使用统一日历，排期支持上午、下午和全天；
- 已完成事项保留原排期和历史资源占用；
- 统计实际投入时使用系统记录或 TestHub 数据，不允许负责人随意填写总投入。

迁移要求：

- 迁移命名为 `supabase/migrations/YYYYMMDD_description.sql`；
- 已执行的历史 SQL 不得修改，修复必须新增迁移；
- 同一环境不要并行执行 DDL，避免 Supabase 死锁；
- 高风险约束、索引或策略变更应拆成小步骤执行；
- 执行后验证表、函数、RLS 和 Schema Cache；
- 生产控制台临时执行的 SQL 也必须回填到 Git。

## 8. PingCode/TestHub 规则

- Hanntonb API Key 只能保存在 Windows 凭据或受控 Secret；
- 前端不得直连需要服务端 Key 的接口；
- 本地同步数据先写缓存，再由页面读取；
- 同步必须支持重复执行且不产生重复记录；
- 多计划的 Case 总数和已执行数必须逐计划相加；
- 只有全部关联计划完成时，事项才能自动完成；
- 部分用例范围应保存稳定模块/套件 ID；
- 用户映射使用 PingCode 用户 ID，姓名仅用于候选建议；
- 同步失败不得覆盖上一次成功缓存。

## 9. Git 和多人协作规则

- 禁止直接推送 `main`；
- 每人使用独立分支，推荐 `codex/<topic>` 或团队约定前缀；
- 一个 PR 只处理一个模块或一个清晰问题；
- 修改 `main.html`、`src/core/platform.js` 或公共 SQL 前先确认没有其他人在改同一区域；
- 不得顺手格式化整个 `main.html`；
- 不得覆盖或删除其他人的未合并改动；
- SQL、前端、权限变化在 PR 描述中分开说明；
- 涉及截图中的交互问题，PR 附修复前后截图；
- 合并前同步目标分支，并重新运行检查。

建议划分代码所有权：

| 范围 | 建议负责人 |
|---|---|
| `src/core/`、登录、职责、公共导航 | 平台维护人 |
| `src/modules/<module>/` | 对应模块负责人 |
| `supabase/migrations/`、RLS、RPC | 数据库评审人 |
| `scripts/`、TestHub 同步 | 集成维护人 |
| `main.html` 兼容层 | 平台维护人统一合并 |

## 10. 每个 PR 的最低验收

至少执行：

```powershell
python scripts/self_check.py
git diff --check
node --check src/modules/<module>/index.js
```

同时人工验证：

- 管理员、QA 负责人、测试工程师三种职责；
- 小米、消费、Other，以及管理员“待归属”；
- 加载、空数据、失败、重试和无权限状态；
- 保存按钮防重复提交；
- 弹窗打开后不能点击蒙层关闭；
- 刷新后筛选、定位和跳转仍正确；
- 项目、版本、排期和事项关联一致；
- 不在控制台或网络请求中暴露 Secret。

## 11. 同事开始开发时需要提交的信息

开始编码前先在需求或 PR 中写清：

1. 模块名称和负责人；
2. 用户问题与验收标准；
3. 影响的职责和 BU；
4. 使用或新增的数据表；
5. 是否修改 RLS、RPC、Edge Function；
6. 是否依赖 PingCode/TestHub；
7. 是否修改 `main.html` 或公共核心；
8. 历史数据如何迁移；
9. 失败和回滚方案；
10. 本地验证方式。

缺少以上信息时，不应直接开始数据库或公共核心改动。

