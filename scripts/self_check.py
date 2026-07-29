#!/usr/bin/env python3
"""Static smoke checks for the Hannto QA dashboard workflow."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(text: str, values: list[str], label: str) -> None:
    missing = [value for value in values if value not in text]
    if missing:
        raise AssertionError(f"{label} missing: {', '.join(missing)}")


def main() -> None:
    html = (ROOT / "main.html").read_text(encoding="utf-8")
    prd_html = (ROOT / "prd.html").read_text(encoding="utf-8")
    platform_js = (ROOT / "src/core/platform.js").read_text(encoding="utf-8")
    feedback_js = (ROOT / "src/modules/feedback/index.js").read_text(encoding="utf-8")
    feedback_css = (ROOT / "src/modules/feedback/styles.css").read_text(encoding="utf-8")
    projects_js = (ROOT / "src/modules/projects/index.js").read_text(encoding="utf-8")
    projects_css = (ROOT / "src/modules/projects/styles.css").read_text(encoding="utf-8")
    tasks_js = (ROOT / "src/modules/tasks/index.js").read_text(encoding="utf-8")
    tasks_css = (ROOT / "src/modules/tasks/styles.css").read_text(encoding="utf-8")
    module_guide = (ROOT / "docs/module-development-guide.md").read_text(encoding="utf-8")
    migration = (ROOT / "supabase/migrations/20260717_task_workflow_hardening.sql").read_text(encoding="utf-8")
    closure_migration = (ROOT / "supabase/migrations/20260720_task_management_closure.sql").read_text(encoding="utf-8")
    release_migration = (ROOT / "supabase/migrations/20260720_release_management.sql").read_text(encoding="utf-8")
    defect_migration = (ROOT / "supabase/migrations/20260720_quality_defect_review.sql").read_text(encoding="utf-8")
    requirement_migration = (ROOT / "supabase/migrations/20260720_requirement_delivery.sql").read_text(encoding="utf-8")
    prd_direct_migration = (ROOT / "supabase/migrations/20260720_prd_direct_delivery.sql").read_text(encoding="utf-8")
    defect_round_migration = (ROOT / "supabase/migrations/20260720_quality_defect_test_round.sql").read_text(encoding="utf-8")
    feature_map_migration = (ROOT / "supabase/migrations/20260720_feature_test_map.sql").read_text(encoding="utf-8")
    pad_platform_migration = (ROOT / "supabase/migrations/20260721_pad_platform_support.sql").read_text(encoding="utf-8")
    feature_batch_migration = (ROOT / "supabase/migrations/20260721_feature_batch_management.sql").read_text(encoding="utf-8")
    prd_triage_migration = (ROOT / "supabase/migrations/20260721_prd_feature_triage.sql").read_text(encoding="utf-8")
    task_scope_migration = (ROOT / "supabase/migrations/20260721_task_scope_and_half_day.sql").read_text(encoding="utf-8")
    release_currents_migration = (ROOT / "supabase/migrations/20260721_release_platform_currents.sql").read_text(encoding="utf-8")
    release_indexes_fix_migration = (ROOT / "supabase/migrations/20260721_release_active_indexes_fix.sql").read_text(encoding="utf-8")
    assignee_status_migration = (ROOT / "supabase/migrations/20260721_assignee_task_status.sql").read_text(encoding="utf-8")
    case_trace_migration = (ROOT / "supabase/migrations/20260723_testhub_case_trace.sql").read_text(encoding="utf-8")
    atomic_progress_migration = (ROOT / "supabase/migrations/20260724_atomic_task_progress.sql").read_text(encoding="utf-8")
    observer_profiles_migration = (ROOT / "supabase/migrations/20260728_resource_observer_profiles.sql").read_text(encoding="utf-8")
    portfolio_planning_migration = (ROOT / "supabase/migrations/20260728_project_monthly_planning.sql").read_text(encoding="utf-8")
    duty_permissions_migration = (ROOT / "supabase/migrations/20260728_three_duty_permissions.sql").read_text(encoding="utf-8")
    projects_feedback_migration = (ROOT / "supabase/migrations/20260728_projects_and_feedback.sql").read_text(encoding="utf-8")
    project_data_hub_migration = (ROOT / "supabase/migrations/20260728_project_data_hub.sql").read_text(encoding="utf-8")
    atomic_task_project_link_migration = (ROOT / "supabase/migrations/20260728_atomic_task_project_link.sql").read_text(encoding="utf-8")
    direct_task_project_link_migration = (ROOT / "supabase/migrations/20260728_task_direct_project_link.sql").read_text(encoding="utf-8")
    qa_lead_task_edit_migration = (ROOT / "supabase/migrations/20260729_qa_lead_task_edit_permissions.sql").read_text(encoding="utf-8")
    sync_script = (ROOT / "scripts/sync_testhub_local.py").read_text(encoding="utf-8")
    scheduled_sync_script = (ROOT / "scripts/run_scheduled_testhub_sync.ps1").read_text(encoding="utf-8")

    require(html, [
        '<script src="src/core/platform.js"></script>',
        '<script src="src/modules/feedback/index.js"></script>',
        '<link rel="stylesheet" href="src/modules/feedback/styles.css">',
        '<script src="src/modules/projects/index.js"></script>',
        '<link rel="stylesheet" href="src/modules/projects/styles.css">',
        '<script src="src/modules/tasks/index.js"></script>',
        '<link rel="stylesheet" href="src/modules/tasks/styles.css">',
        "window.HanntoQA.pageTitles",
        "window.HanntoQA.projectBusinessPages",
        "window.HanntoQA.projectUnitText",
        "function createModuleContext",
        "function destroyActiveRegisteredModule",
        "function renderRegisteredModule",
        "renderRegisteredModule('feedback')",
        "renderRegisteredModule('projects')",
        "renderRegisteredModule('tasks')",
        "renderTaskWorkspace: workspaceData => renderTaskRecords(workspaceData)",
        "function refreshTaskRecords",
        "function taskUsesTestHubProgress",
        "function renderTaskMemberDailyDetail",
        "function renderTaskMemberProgressSummary",
        "function taskMemberExecutedCases",
        "function taskMemberTargetCases",
        "function taskMemberDailyPlanOnDate",
        "save_qa_task_workflow",
        "admin_risk_actions",
        "TestHub 自动",
        "手工填报",
        "function filterTeamTaskRows",
        "function restoreTeamTaskViewState",
        "function rememberTaskExpansion",
        "function renderTaskDataWarnings",
        "function setResourceCapacityFilters",
        "function refreshDashboardSyncStatus",
        "function applyTaskTemplate",
        "function resourceCapacityTableHtml",
        "function changeResourceMetricMode",
        "Capacity color is based on the whole workday",
        "function rebuildTaskSchedule",
        "function taskMemberPeriodPlanOnDate",
        "const endCompare = String(a.allocation_end_date",
        "const endPeriodCompare = (a.allocation_end_period",
        "const completedCompare = (a.status === 'done'",
        "if (!taskScheduledPoints.has(dayKey))",
        "task.status !== 'cancelled'",
        "function syncProgressPercentToPoints",
        "function renderProgressBatchInputs",
        "function loadProgressBatchEntries",
        "function progressSavePreview",
        "function resolveProgressSavePreview",
        "function progressCompletionSnapshot",
        "save_qa_task_progress",
        "function openTaskDetailDrawer",
        "function closeTaskDetailDrawer",
        "function isResourceParticipant",
        "function canViewTeamTasks",
        "function memberTypeText",
        "function normalizeDuty",
        "function isSystemAdmin",
        "function canManageQa",
        "function memberDutySelectHtml",
        "function updateMemberDuty",
        "QA 负责人/项目负责人",
        "Hannto QA 管理平台",
        "function toggleSidebarGroup",
        "function restoreSidebarGroups",
        "function expandSidebarGroupForItem",
        "data-sidebar-group=\"projects\"",
        "项目管理",
        "sb-section-label",
        "projectBusinessTabs",
        "PROJECT_BUSINESS_PAGES",
        "function updateProjectBusinessTabs",
        "function switchProjectBusinessUnit",
        "data-business-unit=\"xiaomi\"",
        "hanntoQaProjectBusinessUnit",
        "function openQaProjectFromPortfolio",
        "打开项目逐日甘特图",
        "project-gantt-grid",
        "小米",
        "消费",
        "Other",
        "portfolioQaProject",
        "project_id:projectId",
        "function toggleMemberResourceParticipation",
        ".eq('resource_participant', true)",
        "function loadTaskPortfolioPlans",
        "function syncTaskProjectLink",
        "taskProjectLinkSummary",
        "newTaskPortfolioPlan",
        "portfolio_plan_id: portfolioPlanId",
        "function renderPortfolioPlanning",
        "function savePortfolioPlan",
        "function portfolioMonthWorkdays",
        "function portfolioMonthsBetween",
        "function portfolioPlanMonthlyDemand",
        "function renderPortfolioAllocationInputs",
        "function portfolioTaskActiveIntervals",
        "function portfolioTaskServerActualPoints",
        "sb.rpc('qa_server_now')",
        "所属版本 *",
        "选择版本后自动确定项目",
        "monthly_allocations:allocations",
        "portfolio-gantt-grid",
        "编辑月度人力",
        "portfolioPlanStartMonth",
        "portfolioPlanEndMonth",
        "const key = dashboardLocalDateKey(cursor)",
        "project_monthly_plans",
        "项目总排期",
        "事项累计完成度（选填）",
        "function focusTeamTaskAfterRefresh",
        "function resetTeamTaskFiltersForFocus",
        "function renderQualityWeeklyBrief",
        "function copyMemberWeeklyBrief",
        "function changeResourceStartDate",
        "function openResourceCellDetails",
        "testHubSyncDiagnostics",
        "function duplicateQaTask",
        "function locateTaskFromResource",
        "function renderTaskActivity",
        "function batchUpdateTaskStatus",
        "function batchUpdateTaskDeadline",
        "blocked_reason",
        "completion_note",
        "function renderReleaseManagement",
        "data-business-unit=\"${unit}\"",
        "<optgroup label=\"${label}\">",
        "function transitionRelease",
        "function addReleaseCheck",
        "transition_release_status",
        "function renderQualityReport",
        "function renderQualityReportResults",
        "function copyQualityReportSummary",
        "function downloadQualityReportCsv",
        "function renderBugManagement",
        "function saveQualityDefect",
        "function qualityDefectMatches",
        "BUG 复盘完成率",
        "function renderRetrospectiveReport",
        "function qualityRetrospectiveText",
        "function copyRetrospectiveReport",
        "function openRequirementTask",
        "function openPrdTask",
        "editingQaTaskPrdId",
        "newTaskRound",
        "editingQaTaskRequirementId",
        "defectRequirement",
        "defectTask",
        "qa_task_id",
        "function renderExternalQualityBrief",
        "function copyExternalQualityBrief",
        "defectReopenCount",
        "defectChangeInduced",
        "defectMissedTest",
        "function renderFeatureTestMap",
        "function renderFeatureTestMapRows",
        "function saveProductFeature",
        "function saveFeatureReleaseChange",
        "function saveFeatureTestAsset",
        "function importExistingPrdsAsFeatures",
        "feature-map-board",
        "feature-visual-card",
        "feature-change-alert",
        "app_pad:'APP + Pad'",
        "releasePlatformMatches",
        "featureQuickEdit",
        "覆盖缺口",
        "未关联 TestHub 计划",
        "function featureBatchToolbarHtml",
        "function applyFeatureBatchUpdate",
        "function mergeSelectedFeatures",
        "merge_product_features",
        "function openPrdFeatureTriage",
        "function renderPrdFeatureTriageList",
        "function linkPrdToFeatures",
        "function createFeatureFromPrd",
        "prd_feature_triage",
        "全功能测试地图",
        "function resourceWorkSlots",
        "newTaskAllocationStartPeriod",
        "function loadTestHubSuitesForSelection",
        "testhub_scope_suite_ids",
        "activeReleases",
        "<option value=\"pc\">PC</option>",
        "cachedScopedTotal",
        "function autoBindPingCodeMembers",
        "function clearPingCodeMapping",
        "function canCurrentUserUpdateTaskStatus",
        "function testHubSnapshotMatchesTask",
        "function testHubPlanProgressItems",
        "function taskCaseReconciliationStats",
        "function renderTaskCaseReconciliation",
        "function renderTaskPlanSyncStatus",
        "function openMemberCaseTrace",
        "function loadSavedTestHubPlans",
        "update_qa_task_status",
        "taskEditorStatusOnly",
        "task_testhub_daily_execution').select('executor_key,executor_name,synced_at')",
        "discoveredDirectoryRows",
        "已执行 ${executedCases} / 总 Case ${displayedTotalCases}",
    ], "main.html")
    require(projects_js, [
        "registerProjectsModule",
        "id: 'projects'",
        "async function render",
        "function renderDetail",
        "function monthDays",
        "function taskSlotLabel",
        "async function moveTaskSchedule",
        "function openEditor",
        "async function saveProject",
        "function openProject",
        "qa_project_data_health",
        "showArchived",
        "TestHub 执行率",
        "延期 / 阻塞",
        "BUG / 漏测",
        "data-project-open",
        "data-project-month",
        "data-project-task-open",
        "data-project-drop-date",
        "data-project-save",
        "返回项目列表",
    ], "projects module")
    require(projects_css, [
        ".projects-module",
        ".projects-module-editor",
        ".project-state.active",
        ".projects-module-member",
        ".project-gantt-task-button",
        ".project-gantt-drop-target",
    ], "projects module styles")
    for legacy_project_function in [
        "function renderProjectHub",
        "function renderQaProjectDetailPage",
        "function openQaProjectEditor",
        "function saveQaProject",
    ]:
        if legacy_project_function in html:
            raise AssertionError(f"main.html still contains legacy project implementation: {legacy_project_function}")
    require(platform_js, [
        "initializeHanntoQAPlatform",
        "const pageTitles",
        "const projectBusinessPages",
        "'bugs'",
        "const projectUnits",
        "function projectUnitText",
        "function registerModule",
        "function getModule",
        "function listModules",
        "global.HanntoQA",
    ], "platform core")
    require(feedback_js, [
        "registerFeedbackModule",
        "id: 'feedback'",
        "function renderFeedbackPage",
        "function submitFeedback",
        "function updateFeedbackTracking",
        "function deleteFeedback",
        "context.isSystemAdmin()",
        "context.sb.from('qa_feedback')",
        "仅系统管理员可以删除反馈",
        "data-feedback-update",
        "data-feedback-delete",
        "feedbackRetryBtn",
    ], "feedback module")
    require(feedback_css, [
        ".feedback-module",
        ".feedback-module-card",
        ".feedback-module-status",
    ], "feedback module styles")
    require(module_guide, [
        "模块契约",
        "Supabase 数据库迁移",
        "身份、职责与权限",
        "Git 与 PR 规则",
        "模块迁移交付清单",
        "合并验收底线",
    ], "module development guide")
    require(migration, [
        "create table if not exists public.qa_task_allocation_history",
        "create or replace function public.save_qa_task_with_assignees",
        "create table if not exists public.admin_risk_actions",
        "Assignee effort total must equal task effort",
    ], "workflow migration")
    require(closure_migration, [
        "create table if not exists public.qa_task_activity",
        "create or replace function public.save_qa_task_workflow",
        "'blocked'",
        "Blocked reason is required",
        "Completion note is required",
    ], "task management closure migration")
    require(release_migration, [
        "create or replace function public.transition_release_status",
        "Only administrators can change release status",
        "where status = 'active'",
    ], "release management migration")
    require(defect_migration, [
        "create table if not exists public.quality_defects",
        "exposed_stage in ('integration', 'production')",
        "review_status in ('pending', 'in_review', 'completed')",
        "quality_defects_update_owner_or_admin",
    ], "quality defect review migration")
    require(requirement_migration, [
        "add column if not exists release_id",
        "add column if not exists requirement_id",
        "refresh_requirement_delivery_status",
        "sync_qa_task_requirement_status",
        "target_requirement_id",
    ], "requirement delivery migration")
    require(prd_direct_migration, [
        "add column if not exists prd_id",
        "target_prd_id",
        "Requirement does not belong to selected PRD",
        "when target_prd_id is not null then 'prd'",
        "test_round integer not null default 1",
    ], "PRD direct delivery migration")
    require(defect_round_migration, [
        "add column if not exists qa_task_id",
        "quality_defects_qa_task_id_idx",
        "references public.qa_tasks(id)",
        "reopen_count integer not null default 0",
        "is_change_induced boolean not null default false",
        "is_missed_test boolean not null default false",
    ], "quality defect test round migration")
    require(feature_map_migration, [
        "create table if not exists public.product_features",
        "create table if not exists public.feature_release_changes",
        "create table if not exists public.feature_test_assets",
        "asset_type in ('xmind','document','link')",
        "asset_update_status in ('pending','updated','not_needed')",
        "feature_test_assets_read_authenticated",
        "product_features_active_identity_idx",
        "insert into storage.buckets",
        "qa-test-assets",
        "qa_test_assets_insert_own_folder",
    ], "global feature test map migration")
    require(pad_platform_migration, [
        "releases_platform_check",
        "product_features_platform_scope_check",
        "'pad'",
        "'mobile_all'",
        "'app'",
        "'app_pad'",
    ], "Pad platform support migration")
    require(feature_batch_migration, [
        "create or replace function public.merge_product_features",
        "Only administrators can merge product features",
        "update public.feature_release_changes",
        "update public.feature_test_assets",
        "status = 'deprecated'",
        "grant execute on function public.merge_product_features",
    ], "feature batch management migration")
    require(prd_triage_migration, [
        "create table if not exists public.prd_feature_triage",
        "status in ('pending', 'mapped', 'ignored')",
        "prd_feature_triage_read_authenticated",
        "prd_feature_triage_write_admin",
        "grant select, insert, update, delete",
    ], "PRD feature triage migration")
    require(task_scope_migration, [
        "allocation_start_period",
        "allocation_end_period",
        "testhub_scope_mode",
        "testhub_scope_suite_ids",
        "create table if not exists public.testhub_plan_suite_cache",
        "create or replace function public.save_qa_task_workflow",
    ], "task scope and half-day migration")
    require(release_currents_migration, [
        "'pc'",
        "target_platform",
        "platform in ('android','ios','both','app','mobile_all','app_pad')",
        "platform in ('pad','mobile_all','app_pad')",
        "platform = 'pc'",
        "independent current releases for APP, Pad and PC",
        "releases_one_active_app_idx",
        "releases_one_active_pad_idx",
        "releases_one_active_pc_idx",
    ], "release platform currents migration")
    require(release_indexes_fix_migration, [
        "drop index if exists public.releases_one_active_idx",
        "releases_one_active_app_idx",
        "releases_one_active_pad_idx",
        "releases_one_active_pc_idx",
    ], "release active indexes fix migration")
    require(assignee_status_migration, [
        "create or replace function public.update_qa_task_status",
        "security definer",
        "Only task assignees can update task status",
        "blocked_reason",
        "completion_note",
    ], "assignee task status migration")
    require(case_trace_migration, [
        "add column if not exists plan_id",
        "primary key (task_id, work_date, executor_key, plan_id)",
    ], "TestHub case trace migration")
    require(atomic_progress_migration, [
        "create or replace function public.save_qa_task_progress",
        "for update",
        "delete from public.task_progress_logs",
        "insert into public.task_progress_logs",
        "update public.qa_tasks",
    ], "atomic task progress migration")
    require(observer_profiles_migration, [
        "add column if not exists resource_participant",
        "resource_participant = false",
        "'xuguang.li'",
        "create or replace function public.is_resource_observer",
        "or public.is_resource_observer()",
        "or public.is_resource_observer());",
    ], "resource observer profiles migration")
    require(portfolio_planning_migration, [
        "create table if not exists public.project_monthly_plans",
        "required_person_months",
        "add column if not exists end_month",
        "add column if not exists monthly_allocations",
        "add column if not exists portfolio_plan_id",
        "qa_tasks_portfolio_plan_idx",
        "create or replace function public.qa_server_now()",
        "project_monthly_plans_end_month_check",
        "project_monthly_plans_allocations_check",
        "project_monthly_plans_read_authenticated",
        "project_monthly_plans_write_admin",
        "public.is_admin()",
    ], "project monthly planning migration")
    require(duty_permissions_migration, [
        "role in ('admin', 'qa_lead', 'tester')",
        "alter column role set default 'tester'",
        "create or replace function public.handle_new_user_profile()",
        "create or replace function public.is_system_admin()",
        "role in ('admin', 'qa_lead')",
        "create or replace function public.is_resource_observer()",
        "select false",
        "create or replace function public.can_view_qa_task",
        "using (public.is_system_admin())",
        "with check (public.is_system_admin())",
        "notify pgrst, 'reload schema'",
    ], "three-duty permissions migration")
    require(atomic_task_project_link_migration, [
        "create or replace function public.save_qa_task_workflow",
        "requested_release_id := nullif(task_payload ->> 'release_id', '')::uuid",
        "portfolio_plan_id = resolved_portfolio_plan_id",
        "No project schedule covers the task date range",
        "notify pgrst, 'reload schema'",
    ], "atomic task project link migration")
    require(qa_lead_task_edit_migration, [
        "save_qa_task_workflow(jsonb,jsonb)",
        "role in (''admin'', ''qa_lead'')",
        "Could not patch QA lead permission",
        "grant execute on function public.save_qa_task_workflow",
        "notify pgrst, 'reload schema'",
    ], "QA lead task edit permissions migration")
    require(direct_task_project_link_migration, [
        "add column if not exists project_id",
        "qa_tasks_project_id_idx",
        "new.project_id := release_project_id",
        "monthly plan is optional",
        "project_id = release_project_id",
        "notify pgrst, 'reload schema'",
    ], "direct task project link migration")
    require(projects_feedback_migration, [
        "create table if not exists public.qa_projects",
        "create table if not exists public.qa_project_members",
        "create or replace function public.can_view_qa_project",
        "add column if not exists project_id",
        "create table if not exists public.qa_feedback",
        "created_by = auth.uid() or public.is_system_admin()",
        "qa_feedback_update_system_admin",
        "('小米 BU', 'xiaomi'",
        "('消费 BU', 'consumer'",
        "('Other', 'other'",
        "notify pgrst, 'reload schema'",
    ], "projects and feedback migration")
    require(project_data_hub_migration, [
        "qa_projects_status_check",
        "'planned', 'active', 'paused', 'closed', 'archived'",
        "add column if not exists project_id uuid",
        "create or replace function public.validate_qa_task_project_chain()",
        "qa_tasks_validate_project_chain",
        "create policy qa_tasks_select_by_duty",
        "using (public.can_view_qa_task(id))",
        "create or replace function public.can_view_qa_project",
        "create policy releases_read_by_project",
        "create or replace view public.qa_project_data_health",
        "unassigned_bugs",
        "notify pgrst, 'reload schema'",
    ], "project data hub migration")
    require(prd_html, [
        "function requirementDelivery",
        "function createTaskForRequirement",
        "function createTaskForPrd",
        "function prdVersionGroup",
        "function prdDeliveryMetrics",
        "function refreshVersionFilter",
        "function toggleVersionGroup",
        "open-requirement-task",
        "requirementTasks",
        "upsert(inserts, {onConflict:'id'})",
        "交付版本",
        "只看有风险",
        "version-section",
        "验收范围（可选",
        "无需拆分",
        "测试轮次（",
        "新增下一轮",
    ], "prd.html")
    require(tasks_js, [
        "registerTasksModule",
        "id: 'tasks'",
        "projectAware: true",
        "loadWorkspaceData",
        "buildWorkspaceViewModel",
        "groupTaskAssignees",
        "context.canViewTeamTasks()",
        "context.businessUnit",
        "workspaceData.viewModel = buildWorkspaceViewModel",
        "function filterRows",
        "function restoreViewState",
        "function resetFiltersForFocus",
        "function focusAfterRefresh",
        "function renderListPage",
        "function taskSummaryHtml",
        "function taskFiltersHtml",
        "data-task-filter=\"member\"",
        "data-task-filter=\"status\"",
        "data-task-filter=\"progress\"",
        "function updateMultiFilterLabels",
        "function taskDetailDrawerHtml",
        "function taskStatusBadgeHtml",
        "function renderTaskRowHtml",
        "function taskDetailBodyHtml",
        "function openDetail",
        "function closeDetail",
        "selectedBatchTaskIds",
        "context.renderTaskWorkspace(workspaceData)",
        "refresh(context = state.context)",
        "data-task-module-retry",
    ], "tasks module")
    require(tasks_css, [
        ".tasks-module",
        ".tasks-module-error",
        ".task-multi-filter",
        ".task-multi-filter-menu",
    ], "tasks module styles")
    if "if (page === 'tasks') { renderTaskRecords(); return; }" in html:
        raise AssertionError("tasks page must render through the registered module")
    require(sync_script, [
        "RUN_PAGE_SIZE = 5",
        "def plan_recency_key",
        "mapped_executor_count",
        "unmapped_executor_count",
        "task_testhub_daily_execution",
        "def acquire_sync_lock",
        "def cache_plan_suites",
        "def filter_runs_for_task_scope",
        "def filter_plan_runs_for_shared_scope",
        "all_plans_complete",
        '"plans": [',
        '"--task-keyword"',
        "testhub_plan_suite_cache",
        "EXECUTED_STATUSES",
        "def upsert_pingcode_user_directory",
        "def auto_map_pingcode_profiles",
        "auto_mapped_profiles",
        "def sync_task_status_from_testhub",
        '"status": "in.(todo,in_progress,blocked)"',
        '"--plan-limit"',
        '"_liene_plan_id"',
        "on_conflict=task_id,work_date,executor_key,plan_id",
    ], "TestHub sync")
    require(scheduled_sync_script, [
        "--plan-limit 50",
        "--library-id '661e31a128d44167e325552c'",
    ], "scheduled TestHub sync")
    if "6214acdba2fa0b097f549d45" in scheduled_sync_script:
        raise AssertionError("scheduled TestHub sync must not pull the printer plan catalog")
    if "6746eb4a87e7da0dbd43c027" in scheduled_sync_script:
        raise AssertionError("scheduled TestHub sync must not pull the PC plan catalog")

    if html.count('id="newTaskModal"') != 1:
        raise AssertionError("main.html must keep a single shared task editor modal template")

    javascript = html[html.index("<script>", html.index("<body>")) + 8 : html.rindex("</script>")]
    subprocess.run(
        ["node", "-e", "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>new Function(s));"],
        cwd=ROOT,
        check=True,
        input=javascript,
        text=True,
        encoding="utf-8",
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(
        ["node", "--check", str(ROOT / "src/core/platform.js")],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(
        ["node", "--check", str(ROOT / "src/modules/feedback/index.js")],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(
        ["node", "--check", str(ROOT / "src/modules/projects/index.js")],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(
        ["node", "--check", str(ROOT / "src/modules/tasks/index.js")],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    task_module_test = r"""
let registeredModule;
let receivedWorkspace;
global.window = {
  HanntoQA: {
    registerModule(module) {
      registeredModule = module;
    }
  }
};
require('./src/modules/tasks/index.js');
const tableRows = {
  qa_tasks: [
    { id:'mine', title:'我的事项', assignee_id:'user-1', status:'todo', effort_person_days:1, project_id:'project-other', portfolio_plan_id:null },
    { id:'other', title:'他人事项', assignee_id:'user-2', status:'done', effort_person_days:1, project_id:'project-other', portfolio_plan_id:null }
  ],
  profiles: [
    { id:'user-1', name:'成员一', resource_participant:true },
    { id:'user-2', name:'成员二', resource_participant:true }
  ],
  qa_task_assignees: [],
  project_monthly_plans: [],
  qa_projects: [{ id:'project-other', business_unit:'other', status:'active' }]
};
const sb = {
  from(table) {
    const chain = {
      select() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      then(resolve) { resolve({ data:tableRows[table] || [], error:null }); }
    };
    return chain;
  }
};
const content = {
  dataset: {},
  style: {},
  innerHTML: '',
  querySelector() { return null; }
};
registeredModule.render({
  sb,
  currentUser: { id:'user-1' },
  businessUnit: 'other',
  canManageQa: () => true,
  canViewTeamTasks: () => false,
  isSystemAdmin: () => false,
  isResourceParticipant: profile => profile.resource_participant,
  todayKey: () => '2026-07-28',
  escapeHtml: String,
  showToast() {},
  content,
  renderTaskWorkspace(workspace) {
    receivedWorkspace = workspace;
    workspace.renderListPage({
      rows: [{
        id:'mine',
        title:'我的事项',
        canEdit:true,
        canUpdateStatus:true,
        memberIds:'user-1',
        status:'todo',
        progressMode:'manual',
        overdue:false,
        startDate:'2026-07-28',
        endDate:'2026-07-28',
        testRound:1,
        assigneeNames:['成员一'],
        assignmentCount:1,
        progressPercent:50,
        actualTotal:0.5,
        taskEffort:1,
        range:'2026-07-28 全天',
        syncText:'手工填报',
        testHubPlanCount:0
      }],
      taskDetails:new Map()
    });
  }
}).then(() => {
  const viewModel = receivedWorkspace?.viewModel;
  if (!viewModel
    || viewModel.visibleTasks.length !== 1
    || viewModel.visibleTasks[0].id !== 'mine'
    || viewModel.taskCounts.todo !== 1
    || !content.innerHTML.includes('data-task-id="mine"')
    || !content.innerHTML.includes('id="taskDetailDrawer"')) {
    process.exit(2);
  }
});
"""
    subprocess.run(
        ["node", "-e", task_module_test],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    prd_javascript = prd_html[prd_html.index("<script>", prd_html.index("<body>")) + 8 : prd_html.rindex("</script>")]
    subprocess.run(
        ["node", "-e", "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>new Function(s));"],
        cwd=ROOT,
        check=True,
        input=prd_javascript,
        text=True,
        encoding="utf-8",
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(
        [sys.executable, "-m", "py_compile", str(ROOT / "scripts/sync_testhub_local.py")],
        cwd=ROOT,
        check=True,
    )
    print("Hannto QA workflow self-check passed")


if __name__ == "__main__":
    main()
