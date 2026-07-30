# 工作事项模块

模块 ID：`tasks`

## 职责

- 作为工作事项列表、筛选、编辑、进度、TestHub 状态和资源分配的统一页面入口。
- 接收当前 BU，并按项目归属过滤数据。
- 维护模块自己的加载、失败重试和销毁生命周期。
- 为后续把数据查询、列表视图和编辑器从 `main.html` 继续迁出提供稳定边界。

## 当前迁移阶段

页面路由、生命周期、数据库并发查询、查询错误处理、统一刷新入口、页面视图模型、筛选交互、列表页面外壳、单条事项展示和详情抽屉布局已经由模块接管。
视图模型负责 BU/项目归属过滤、职责可见性、负责人映射、名称字典和任务状态统计。
筛选交互负责用户/BU 维度的筛选记忆、快速筛选、批量选择和刷新后事项定位。
成熟的工作事项视图与保存逻辑暂时通过 `context.renderTaskWorkspace(workspaceData)`
兼容接口复用，避免一次性迁移造成排期、多人进度和 TestHub 计算回归。

下一阶段按以下顺序继续迁移：

1. 进度与 TestHub 展示数据计算；
2. 新建/编辑与进度填报；
3. 删除 `main.html` 中的兼容渲染接口。

## 数据表

- `qa_tasks`
- `qa_task_assignees`
- `task_progress_logs`
- `task_testhub_progress`
- `task_testhub_daily_execution`
- `qa_task_allocation_history`
- `qa_task_activity`
- `profiles`
- `releases`
- `project_monthly_plans`
- `qa_projects`

## 权限

- 系统管理员：管理全部工作事项。
- QA 负责人：按 BU/项目查看并管理团队工作事项。
- 测试工程师：查看本人参与事项，并按 RLS 允许的范围更新状态或进度。

权限最终由 Supabase RLS 和 RPC 校验，前端按钮隐藏不作为安全边界。

## 外部服务

- Supabase Auth / Database
- 本地 TestHub 同步缓存
- PingCode/TestHub 计划与执行进度

## 验收

1. 工作事项页面可从侧边栏和项目 Tab 正常进入。
2. BU 切换、筛选、定位事项、编辑、复制、状态/进度更新行为与迁移前一致。
3. TestHub 自动进度、多人执行量和资源排期显示不回归。
4. 离开页面后模块执行销毁，再次进入可正常加载。
5. `python scripts/self_check.py` 通过。

## 多轮事项关系

- 第 1、2、3 轮是同一事项组中的独立工作事项，各自保留负责人、排期、人天、状态、进度和 TestHub 计划。
- “复制为下一轮”会沿用原事项的基础配置，并自动采用该组尚未使用的下一轮次。
- 也可以在编辑器中通过“关联已有事项”把已有事项归入同组；只允许关联同一项目、同一版本的事项。
- `qa_tasks.task_series_id` 是稳定的事项组 ID，`source_task_id` 记录复制或关联来源；数据库唯一索引避免同组出现重复轮次。
