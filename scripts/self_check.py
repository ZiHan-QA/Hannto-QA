#!/usr/bin/env python3
"""Static smoke checks for the Liene QA dashboard workflow."""

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
    sync_script = (ROOT / "scripts/sync_testhub_local.py").read_text(encoding="utf-8")

    require(html, [
        "function taskUsesTestHubProgress",
        "function renderTaskMemberDailyDetail",
        "function taskMemberDailyPlanOnDate",
        "save_qa_task_workflow",
        "admin_risk_actions",
        "TestHub 自动",
        "手工填报",
        "function filterTeamTaskRows",
        "function setResourceCapacityFilters",
        "function refreshDashboardSyncStatus",
        "function applyTaskTemplate",
        "function resourceCapacityTableHtml",
        "function openResourceCellDetails",
        "testHubSyncDiagnostics",
        "function duplicateQaTask",
        "function locateTaskFromResource",
        "teamTaskProgressModeFilter",
        "function renderTaskActivity",
        "function batchUpdateTaskStatus",
        "function batchUpdateTaskDeadline",
        "blocked_reason",
        "completion_note",
        "function renderReleaseManagement",
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
    ], "main.html")
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
    ], "release platform currents migration")
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
    require(sync_script, [
        "RUN_PAGE_SIZE = 5",
        "mapped_executor_count",
        "unmapped_executor_count",
        "task_testhub_daily_execution",
        "def acquire_sync_lock",
        "def cache_plan_suites",
        "def filter_runs_for_task_scope",
        "testhub_plan_suite_cache",
    ], "TestHub sync")

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
    print("Liene QA workflow self-check passed")


if __name__ == "__main__":
    main()
