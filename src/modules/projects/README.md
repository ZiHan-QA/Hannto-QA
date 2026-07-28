# 项目中心模块

模块 ID：`projects`

## 职责

- 按小米、消费、Other 展示用户可见项目。
- 维护项目负责人、项目成员、状态和说明。
- 汇总项目关联的月度排期与工作事项。
- 按月展示工作事项甘特图，并识别周末和节假日。
- 汇总计划/实际点数、TestHub 执行率、版本、延期/阻塞、BUG/漏测和项目成员。
- 支持筹备中、进行中、暂停、结束、归档生命周期；归档项目默认隐藏。
- 向 QA 负责人提示尚未归属项目的排期、版本、事项和 BUG。
- 接收“项目总排期”页面的项目跳转。

## 数据表

- `qa_projects`
- `qa_project_members`
- `profiles`
- `project_monthly_plans`
- `qa_tasks`
- `qa_task_assignees`
- `work_calendar`
- `releases`
- `quality_defects`
- `task_testhub_progress`
- `task_progress_logs`
- `qa_project_data_health`

## 权限

- 系统管理员、QA 负责人：新增和编辑项目及成员。
- 测试工程师：只读其 RLS 允许查看的项目。

## 跨模块接口

`openProject(context, projectId, month)` 用于从项目总排期进入指定项目的月度甘特图。

模块只消费项目排期与工作事项数据，不负责修改这两个模块的数据。
