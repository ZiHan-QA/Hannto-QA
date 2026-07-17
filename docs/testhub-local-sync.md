# TestHub 本地同步

## 数据流

```text
本机同步工具 -> Hanntonb PingCode 只读代理
            -> Supabase 缓存/进度表
            -> Liene QA 管理平台
```

PingCode Key 和短期 Supabase 会话授权只在本机隐藏输入，不写入代码、文件、数据库或 GitHub。

## 首次启用

1. 在 Supabase SQL Editor 执行：
   `supabase/migrations/20260717_testhub_local_cache.sql`
   然后执行：
   `supabase/migrations/20260717_sync_health_and_single_day.sql`
   然后执行：
   `supabase/migrations/20260717_multi_assignee_execution.sql`
   最后执行：
   `supabase/migrations/20260717_task_workflow_hardening.sql`
2. 双击 `scripts/同步TestHub.cmd`，在第一个密码框中粘贴 Hanntonb API Key 并点击 OK。
3. 在管理平台“工作事项”页点击“复制本地同步授权”，粘贴到第二个密码框并点击 OK。
4. 两个授权只保留在当前进程内存，随后工具自动完成验证和同步。
5. 等待窗口显示“同步成功”。
6. 刷新管理平台，在工作事项中选择用例库，然后点击“查询缓存”。

## 默认同步范围

- 用例库：消费类 `661e31a128d44167e325552c`。
- 计划目录：完整分页拉取，按计划 ID 去重后写入缓存。
- 执行进度：所有进行中且已关联 TestHub 计划的工作事项。
- 每日执行：按 PingCode 执行人 ID 和执行日期归集；通过成员管理中的 PingCode 用户 ID 映射到平台成员，未映射记录保留并提示管理员。
- 计划执行记录固定 `page_size=5`，按执行记录 ID 去重。

只有完整拉取成功的数据才会写入。失败或中断不会把部分计划列表当作完整缓存。

## 其他用例库

在项目目录终端运行：

```powershell
python scripts/sync_testhub_local.py --library-id 6214acdba2fa0b097f549d45
```

同时同步多个用例库：

```powershell
python scripts/sync_testhub_local.py `
  --library-id 661e31a128d44167e325552c `
  --library-id 6214acdba2fa0b097f549d45
```

只更新计划目录、不拉取任务执行进度：

```powershell
python scripts/sync_testhub_local.py --skip-progress
```

## 权限

- PingCode：仅调用 GET 接口。
- Supabase：使用登录管理员的短期会话和现有 RLS 写入。
- 不需要 `service_role` Key。
- 普通成员无法写入计划缓存或 TestHub 进度。

## 每 30 分钟自动同步

双击 `scripts/配置TestHub自动同步.cmd`，填写：

1. 已验证成功的 Hanntonb API Key。
2. 管理平台管理员登录邮箱。
3. 管理平台管理员登录密码。

配置程序会先验证 PingCode 计划读取权限和 Supabase 管理员 RLS，再将凭据保存到当前 Windows 用户的凭据管理器，并创建任务：

`Liene QA TestHub Progress Sync`

任务每 30 分钟运行一次，只同步已关联工作事项的 TestHub 执行进度，不重复拉取全部计划目录。运行日志保存在本机 `logs/testhub-sync.log`，该目录已从 Git 忽略。

每次定时任务会在 `testhub_sync_status` 中记录运行中、成功或失败状态。管理员工作台显示上次成功时间和下次预计时间；超过 1 小时没有成功记录时自动加入风险提醒。

凭据不会写入项目文件、日志、命令行或 GitHub。更换公司 Key或管理平台密码后，重新运行配置程序即可覆盖旧凭据。
