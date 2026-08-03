# 项目中心模块

模块 ID：`projects`

## 职责

- 按小米、消费、新业务、Other 展示用户可见项目。
- 维护项目负责人、项目成员、状态和说明。
- 汇总项目关联的月度排期与工作事项。
- 按月展示工作事项甘特图，并识别周末和节假日。
- QA 负责人及系统管理员可拖动甘特条中间整体改期，或拖动左右边缘调整开始/结束日期；松手自动保存且不再二次确认。
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

项目基础信息由本模块维护；工作事项仍由工作事项模块创建和编辑，但项目甘特图可直接更新事项排期日期。
