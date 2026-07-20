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
    migration = (ROOT / "supabase/migrations/20260717_task_workflow_hardening.sql").read_text(encoding="utf-8")
    sync_script = (ROOT / "scripts/sync_testhub_local.py").read_text(encoding="utf-8")

    require(html, [
        "function taskUsesTestHubProgress",
        "function renderTaskMemberDailyDetail",
        "function taskMemberDailyPlanOnDate",
        "save_qa_task_with_assignees",
        "admin_risk_actions",
        "TestHub 自动",
        "手工填报",
        "function filterTeamTaskRows",
        "function setResourceCapacityFilters",
        "function refreshDashboardSyncStatus",
        "function applyTaskTemplate",
        "function resourceCapacityTableHtml",
    ], "main.html")
    require(migration, [
        "create table if not exists public.qa_task_allocation_history",
        "create or replace function public.save_qa_task_with_assignees",
        "create table if not exists public.admin_risk_actions",
        "Assignee effort total must equal task effort",
    ], "workflow migration")
    require(sync_script, [
        "RUN_PAGE_SIZE = 5",
        "mapped_executor_count",
        "unmapped_executor_count",
        "task_testhub_daily_execution",
        "def acquire_sync_lock",
    ], "TestHub sync")

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
        [sys.executable, "-m", "py_compile", str(ROOT / "scripts/sync_testhub_local.py")],
        cwd=ROOT,
        check=True,
    )
    print("Liene QA workflow self-check passed")


if __name__ == "__main__":
    main()
