# 今日工作台数据盘点与 PingCode 同步契约

## 1. 结论

- 当前页面代码可以确认工作台已经使用 `profiles`、`run_tasks`、`device_configs`、`assets`、`consumables` 和 `prds`。
- 今日待办和团队活动版本没有可确认的数据表，需要新增 `qa_tasks` 和 `releases`。
- 发布风险需要稳定、可审计的结果表，建议新增 `release_checks`。
- 团队使用一个活动版本，所有登录成员可读取团队风险；只有管理员可以维护版本和检查规则。
- PingCode 写权限已具备，但当前进程没有 `PINGCODE_TOKEN`，本阶段没有读取或写入任何 PingCode 数据。
- PingCode 写回必须通过受控服务端接口完成，不能由 GitHub Pages 浏览器直接持有令牌。

## 2. 现有数据源

| 数据源 | 当前用途 | 今日工作台用途 | 已知限制 |
|---|---|---|---|
| `profiles` | 用户姓名、角色 | 当前用户、管理员判断 | 需确认角色约束和 RLS |
| `run_tasks` | 自动化任务及执行历史 | 24小时失败、运行超时、今日执行 | 需确认是否有错误摘要、报告地址 |
| `device_configs` | 自动化设备选择 | 在线/离线设备 | 当前代码只确认 `is_online`，未确认心跳字段 |
| `assets` | 手机、打印机资产 | 在用设备统计 | 资产状态不等同于自动化设备在线状态 |
| `consumables` | 耗材库存 | 低库存风险 | 已有 `quantity`、`threshold` |
| `prds` | PRD管理 | 待评审与版本关联 | 当前未确认负责人和截止时间 |
| `requirements` | PRD需求点 | 后续需求覆盖风险 | 当前未关联 TestHub 用例实体 |
| `copy_texts` | 17语言文案 | 后续文案缺失风险 | 需要定义必填语言与版本范围 |

以上字段来自前端调用推断，不代表生产数据库完整结构。执行迁移前必须在 Supabase SQL Editor 中只读核对现有表、列、约束和 RLS。

## 3. 新增数据表

### `releases`

保存团队统一的活动版本。数据库只允许一个 `status = active` 的版本。

### `qa_tasks`

保存个人待办，可关联 PRD、自动化任务、PingCode工作项或其他对象。

### `release_checks`

保存当前版本的发布检查结果和风险详情。检查结果可以来自人工、自动化、PingCode或系统规则。

SQL草案见 `supabase/migrations/20260715_today_dashboard_foundation.sql`。

## 4. PingCode 已知只读能力

当前已知项目和库：

- Liene APP工作项项目：`66bf279c5816cd1f8079dd24`。
- Liene & 极印App项目：`6243c80338d2aaa74c787462`。
- 消费TestHub库：`661e31a128d44167e325552c`。
- 打印机TestHub库：`6214acdba2fa0b097f549d45`。
- PCTestHub库：`6746eb4a87e7da0dbd43c027`。

现有只读代理可以获取：

- TestHub用例、用例详情、计划、计划执行结果。
- 项目工作项和BUG。
- 用例字段包括标题、状态、模块、前置条件、步骤、重要程度和维护人。
- 计划字段包括状态、负责人、起止时间和页面链接。

## 5. PingCode 写回边界

第一阶段只设计以下三种写回动作：

1. AI评审通过的测试用例创建到指定TestHub模块。
2. 自动化失败经人工确认后创建PingCode BUG。
3. 本地对象保存PingCode ID和链接，后续更新时执行幂等同步。

暂不自动执行：

- 自动关闭BUG。
- 自动修改他人用例。
- 自动覆盖人工编辑内容。
- 自动变更测试计划执行结果。

## 6. 推荐同步架构

```text
GitHub Pages
  -> Supabase Edge Function（校验当前登录用户）
  -> Hanntonb PingCode代理（服务端持有令牌）
  -> PingCode
  -> 返回 external_id / html_url
  -> 写回 Supabase 同步状态
```

浏览器只发送业务字段，不接触PingCode令牌。

## 7. 字段映射草案

| 本地字段 | PingCode目标 | 说明 |
|---|---|---|
| `qa_tasks.title` | 工作项标题 | 必填 |
| `qa_tasks.priority` | 优先级字段ID | 需要从项目元数据解析，不能写死中文名称 |
| `qa_tasks.assignee_id` | 负责人ID | 需要维护Supabase用户与PingCode用户映射 |
| `qa_tasks.status` | 状态ID | 使用项目工作流状态ID |
| `qa_tasks.due_date` | 截止时间 | 时区统一为Asia/Shanghai |
| `qa_tasks.external_id` | PingCode对象ID | 幂等更新依据 |
| `qa_tasks.external_url` | PingCode页面链接 | 页面跳转使用 |
| `qa_tasks.sync_status` | 本地同步状态 | 不写入PingCode |

TestHub用例写回必须继续遵守Liene QA固定12列、步骤与预期结果一一对应、P0/P1/P2优先级和模块路径规范。

## 8. 写回安全规则

- 所有写操作必须由已登录用户显式点击触发。
- 首次启用前先在非生产对象上做一次创建、更新和重复提交测试。
- 使用幂等键避免双击创建重复用例或BUG。
- 保存请求人、动作、目标ID、结果和错误信息，但不保存令牌。
- 批量写入前显示新增、更新、跳过数量并要求确认。
- 写回失败只标记 `sync_status = failed`，不得删除本地数据。
- 服务端从会话中取得用户身份，不能相信浏览器传来的操作者姓名。

## 9. 执行迁移前的只读核对SQL

在Supabase SQL Editor中只读执行以下查询，并保存结果，不要执行迁移文件：

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles', 'run_tasks', 'device_configs', 'assets', 'consumables',
    'prds', 'requirements', 'copy_texts', 'releases', 'qa_tasks', 'release_checks'
  )
order by table_name, ordinal_position;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

## 10. 第四步输入

第四步开始前需要：

1. 上述Supabase只读查询结果。
2. `device_configs`是否存在心跳时间字段。
3. PingCode服务端写接口的正式文档或代理能力说明。
4. 一个允许测试写入的PingCode项目或TestHub模块。
