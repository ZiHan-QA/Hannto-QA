#!/usr/bin/env python3
"""Pull TestHub data locally and cache it in Supabase without persisting secrets."""

from __future__ import annotations

import argparse
import atexit
import base64
import getpass
import json
import os
import random
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

from windows_credentials import read_credential


if hasattr(sys.stdout, "buffer"):
    sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1, closefd=False)
if hasattr(sys.stderr, "buffer"):
    sys.stderr = open(sys.stderr.fileno(), mode="w", encoding="utf-8", buffering=1, closefd=False)


PINGCODE_BASE_URL = "https://ai.hanntonb.com/third-party-proxy/pingcode"
SUPABASE_URL = "https://pgpnyrglrromqqjnvaix.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBncG55cmdscnJvbXFxam52YWl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MjY2OTgsImV4cCI6MjA5NjIwMjY5OH0."
    "TmkrxS2mY_95aBC2UL2BARLU7gqNb_gSpHP6ynofDsE"
)
DEFAULT_LIBRARY_ID = "661e31a128d44167e325552c"
PINGCODE_CREDENTIAL = "LieneQA/HanntonbApiKey"
SUPABASE_CREDENTIAL = "LieneQA/SupabaseSyncAccount"
PLAN_PAGE_SIZE = 100
RUN_PAGE_SIZE = 5
UNTESTED_STATUSES = {
    "", "未测试", "untested", "not_tested", "not tested", "not_run", "not run", "pending"
}
EXECUTED_STATUSES = {
    "通过", "失败", "跳过", "不适用", "条件通过", "阻塞", "受阻",
    "pass", "passed", "failure", "failed", "skip", "skipped", "block", "blocked",
    "not_applicable", "not applicable", "conditional_pass", "condition_pass",
}
SYNC_LOCK_MAX_AGE_SECONDS = 2 * 60 * 60


def acquire_sync_lock() -> None:
    """Prevent the scheduled task and a manual launch from syncing concurrently."""
    lock_dir = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    lock_path = os.path.join(lock_dir, "LieneQA", "testhub-sync.lock")
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    if os.path.exists(lock_path):
        age = time.time() - os.path.getmtime(lock_path)
        if age < SYNC_LOCK_MAX_AGE_SECONDS:
            raise SystemExit("已有 TestHub 同步正在运行，本次任务已安全跳过")
        try:
            os.remove(lock_path)
        except OSError:
            raise SystemExit("旧同步锁仍被占用，请稍后重试") from None
    try:
        descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise SystemExit("已有 TestHub 同步正在运行，本次任务已安全跳过") from None
    os.write(descriptor, str(os.getpid()).encode("ascii"))

    def cleanup() -> None:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            os.remove(lock_path)
        except OSError:
            pass

    atexit.register(cleanup)


class HttpStatusError(RuntimeError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: Any = None,
    retries: int = 3,
) -> Any:
    payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request_headers = {"Accept": "application/json", **(headers or {})}
    if payload is not None:
        request_headers["Content-Type"] = "application/json"

    last_error: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(url, data=payload, headers=request_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                return json.loads(raw.decode(response.headers.get_content_charset() or "utf-8")) if raw else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace").strip().replace("\n", " ")[:500]
            last_error = HttpStatusError(error.code, f"HTTP {error.code}: {detail or error.reason}")
            if 400 <= error.code < 500 and error.code != 429:
                raise last_error from error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
        if attempt + 1 < retries:
            time.sleep((2**attempt) + random.uniform(0, 0.25))
    raise RuntimeError(f"请求失败（已重试 {retries} 次）：{last_error}") from last_error


def pingcode_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "User-Agent": "codex-pingcode-data-fetcher/1.0",
    }


def supabase_headers(access_token: str, *, prefer: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {access_token}",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def authenticate_supabase(email: str, password: str) -> tuple[str, str]:
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    data = request_json(
        url,
        method="POST",
        headers={"apikey": SUPABASE_ANON_KEY},
        body={"email": email, "password": password},
        retries=1,
    )
    token = str((data or {}).get("access_token") or "")
    user_id = str(((data or {}).get("user") or {}).get("id") or "")
    if not token or not user_id:
        raise RuntimeError("Supabase 登录成功但未返回用户会话")
    return token, user_id


def validate_supabase_access_token(access_token: str) -> tuple[str, str]:
    try:
        encoded_payload = access_token.split(".")[1]
        padding = "=" * (-len(encoded_payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(encoded_payload + padding).decode("utf-8"))
    except (IndexError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError("Supabase 同步授权格式无效") from error

    user_id = str(claims.get("sub") or "")
    email = str(claims.get("email") or "")
    expires_at = int(claims.get("exp") or 0)
    if not user_id or expires_at <= int(time.time()):
        raise RuntimeError("Supabase 同步授权已过期，请回到管理平台重新登录")

    query = urllib.parse.urlencode(
        {"select": "id,name,role", "id": f"eq.{user_id}", "limit": 1},
        safe=",.*",
    )
    profiles = request_json(
        f"{SUPABASE_URL}/rest/v1/profiles?{query}",
        headers=supabase_headers(access_token),
        retries=1,
    ) or []
    profile = profiles[0] if profiles else None
    if not profile or profile.get("role") != "admin":
        raise RuntimeError("当前管理平台授权不是有效的管理员权限")
    return user_id, email or str(profile.get("name") or "")


def read_clipboard_secret() -> str:
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        return result.stdout.strip().strip('"').strip("'")
    finally:
        subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", "Set-Clipboard -Value ''"],
            check=False,
            capture_output=True,
            timeout=10,
        )


def read_clipboard_pingcode_token() -> str:
    token = read_clipboard_secret()
    if token.lower().startswith("hanntonb api key:"):
        token = token.split(":", 1)[1].strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if token.count(".") == 2 and token.startswith("eyJ"):
        raise RuntimeError("剪贴板里是管理平台同步授权，不是 Hanntonb API Key")
    if len(token) < 16 or any(character.isspace() for character in token):
        raise RuntimeError("剪贴板中不是完整的 Hanntonb API Key，请重新复制原始 Key")
    return token


def read_clipboard_access_token() -> str:
    token = read_clipboard_secret()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if token.count(".") != 2 or any(character.isspace() for character in token):
        raise RuntimeError("剪贴板中不是完整的管理平台同步授权，请回到页面重新点击复制")
    return token


def validate_pingcode_token(token: str) -> None:
    query = urllib.parse.urlencode({"page_size": PLAN_PAGE_SIZE, "page_index": 1})
    request_json(
        f"{PINGCODE_BASE_URL}/v1/testhub/libraries/{DEFAULT_LIBRARY_ID}/plans?{query}",
        headers=pingcode_headers(token),
        retries=1,
    )


def fetch_all_plans(library_id: str, token: str, limit: int | None = None) -> list[dict[str, Any]]:
    plans: dict[str, dict[str, Any]] = {}
    page_size = min(PLAN_PAGE_SIZE, limit) if limit else PLAN_PAGE_SIZE
    for page in range(1, 1001):
        query = urllib.parse.urlencode({"page_size": page_size, "page_index": page})
        url = f"{PINGCODE_BASE_URL}/v1/testhub/libraries/{library_id}/plans?{query}"
        data = request_json(url, headers=pingcode_headers(token))
        values = (data or {}).get("values") or []
        for plan in values:
            plan_id = str(plan.get("id") or "")
            if plan_id:
                plans[plan_id] = plan
        print(f"  计划第 {page} 页：{len(values)} 条，累计去重 {len(plans)} 条")
        if limit and len(plans) >= limit:
            return list(plans.values())[:limit]
        if len(values) < page_size:
            return list(plans.values())
    raise RuntimeError("计划分页达到安全上限，未写入不完整结果")


def plan_cache_rows(
    library_id: str,
    plans: list[dict[str, Any]],
    user_id: str,
    synced_at: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for plan in plans:
        plan_id = str(plan.get("id") or "")
        if not plan_id:
            continue
        rows.append({
            "library_id": library_id,
            "plan_id": plan_id,
            "name": str(plan.get("name") or "未命名计划"),
            "short_id": str(plan.get("short_id") or "") or None,
            "status": str(plan.get("status") or "") or None,
            "state_name": str((plan.get("state") or {}).get("name") or "") or None,
            "assignee_name": str((plan.get("assignee") or {}).get("display_name") or "") or None,
            "start_at": plan.get("start_at"),
            "end_at": plan.get("end_at"),
            "html_url": str(plan.get("html_url") or "") or None,
            "synced_at": synced_at,
            "synced_by": user_id,
        })
    return rows


def upsert_plan_cache(rows: list[dict[str, Any]], access_token: str) -> None:
    url = f"{SUPABASE_URL}/rest/v1/testhub_plan_cache?on_conflict=library_id,plan_id"
    headers = supabase_headers(access_token, prefer="resolution=merge-duplicates,return=minimal")
    for start in range(0, len(rows), 200):
        batch = rows[start : start + 200]
        request_json(url, method="POST", headers=headers, body=batch, retries=2)
        print(f"  已写入计划缓存：{min(start + len(batch), len(rows))}/{len(rows)}")


def update_sync_health(
    access_token: str,
    user_id: str,
    status: str,
    *,
    cached_plan_count: int | None = None,
    progress_success: int | None = None,
    progress_failed: int | None = None,
    execution_record_count: int | None = None,
    mapped_executor_count: int | None = None,
    unmapped_executor_count: int | None = None,
    error_message: str | None = None,
) -> None:
    """Best-effort heartbeat; sync still runs when the optional health table is absent."""
    now = datetime.now(timezone.utc)
    query = urllib.parse.urlencode({"select": "*", "sync_name": "eq.testhub_local", "limit": 1}, safe=",.*")
    try:
        existing = request_json(
            f"{SUPABASE_URL}/rest/v1/testhub_sync_status?{query}",
            headers=supabase_headers(access_token),
            retries=1,
        ) or []
        row = dict(existing[0]) if existing else {}
        row.update({
            "sync_name": "testhub_local",
            "status": status,
            "next_expected_at": (now + timedelta(minutes=30)).isoformat(),
            "error_message": (error_message or "")[:500] or None,
            "updated_by": user_id,
            "updated_at": now.isoformat(),
        })
        if status == "running":
            row["last_started_at"] = now.isoformat()
            row["error_message"] = None
        elif status == "success":
            row["last_success_at"] = now.isoformat()
            row["error_message"] = None
        elif status == "failed":
            row["last_failure_at"] = now.isoformat()
        if cached_plan_count is not None:
            row["cached_plan_count"] = max(cached_plan_count, 0)
        if progress_success is not None:
            row["progress_success"] = max(progress_success, 0)
        if progress_failed is not None:
            row["progress_failed"] = max(progress_failed, 0)
        if execution_record_count is not None:
            row["execution_record_count"] = max(execution_record_count, 0)
        if mapped_executor_count is not None:
            row["mapped_executor_count"] = max(mapped_executor_count, 0)
        if unmapped_executor_count is not None:
            row["unmapped_executor_count"] = max(unmapped_executor_count, 0)
        request_json(
            f"{SUPABASE_URL}/rest/v1/testhub_sync_status?on_conflict=sync_name",
            method="POST",
            headers=supabase_headers(access_token, prefer="resolution=merge-duplicates,return=minimal"),
            body=row,
            retries=1,
        )
    except Exception as error:
        print(f"  同步健康状态暂未写入：{error}", file=sys.stderr)


def fetch_open_tasks(access_token: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({
        "select": "id,title,status,testhub_library_id,testhub_plan_id,testhub_plan_ids,testhub_scope_mode,testhub_scope_suite_ids",
        "status": "in.(todo,in_progress,blocked)",
        "testhub_library_id": "not.is.null",
    }, safe="(),.*")
    url = f"{SUPABASE_URL}/rest/v1/qa_tasks?{query}"
    return request_json(url, headers=supabase_headers(access_token), retries=2) or []


def sync_task_status_from_testhub(
    task: dict[str, Any], total: int, executed: int, all_plans_complete: bool, access_token: str
) -> str:
    """Keep a linked task state aligned with its scoped TestHub execution."""
    target_status = "done" if all_plans_complete else "in_progress" if executed > 0 else "todo"
    if str(task.get("status") or "todo") == target_status:
        return target_status
    query = urllib.parse.urlencode({"id": f"eq.{task['id']}"})
    payload: dict[str, Any] = {
        "status": target_status,
        "completed_at": datetime.now(timezone.utc).isoformat() if target_status == "done" else None,
        "completion_note": f"TestHub 自动同步：已执行 {executed}/{total} Case" if target_status == "done" else None,
        "blocked_reason": None,
        "blocked_owner_id": None,
        "blocked_until": None,
    }
    request_json(
        f"{SUPABASE_URL}/rest/v1/qa_tasks?{query}",
        method="PATCH",
        headers=supabase_headers(access_token, prefer="return=minimal"),
        body=payload,
        retries=2,
    )
    task["status"] = target_status
    return target_status


def fetch_profile_directory(access_token: str) -> dict[str, dict[str, str]]:
    query = urllib.parse.urlencode(
        {"select": "id,name,pingcode_user_id,pingcode_display_name"}, safe=",.*"
    )
    profiles = request_json(
        f"{SUPABASE_URL}/rest/v1/profiles?{query}",
        headers=supabase_headers(access_token),
        retries=2,
    ) or []
    return {
        str(profile.get("pingcode_user_id")): {
            "member_id": str(profile.get("id") or ""),
            "name": str(profile.get("name") or profile.get("pingcode_display_name") or "未命名成员"),
        }
        for profile in profiles
        if profile.get("pingcode_user_id") and profile.get("id")
    }


def fetch_plan_runs(library_id: str, plan_id: str, token: str) -> list[dict[str, Any]]:
    runs: dict[str, dict[str, Any]] = {}
    for page in range(1, 5001):
        query = urllib.parse.urlencode({"page_size": RUN_PAGE_SIZE, "page_index": page})
        url = f"{PINGCODE_BASE_URL}/v1/testhub/libraries/{library_id}/plans/{plan_id}/runs?{query}"
        data = request_json(url, headers=pingcode_headers(token))
        values = (data or {}).get("values") or []
        if not values:
            return list(runs.values())
        for run in values:
            run_id = str(run.get("id") or "")
            if not run_id:
                raise RuntimeError(f"计划 {plan_id} 第 {page} 页存在无 ID 执行记录")
            runs[run_id] = run
    raise RuntimeError(f"计划 {plan_id} 执行记录达到分页安全上限")


def summarize_runs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    executed = 0
    for run in runs:
        status = str(((run.get("latest_executed_status") or {}).get("name") or run.get("status") or "")).strip()
        counts[status or "未测试"] = counts.get(status or "未测试", 0) + 1
        if status.casefold() in EXECUTED_STATUSES:
            executed += 1
    total = len(runs)
    return {"total": total, "executed": executed, "ratio": executed / total if total else 0, "counts": counts}


def run_suite(run: dict[str, Any]) -> tuple[str, str]:
    suite = run.get("suite") or (run.get("case") or {}).get("suite") or {}
    if not isinstance(suite, dict):
        return "", ""
    return str(suite.get("id") or "").strip(), str(suite.get("name") or "未命名模块").strip()


def cache_plan_suites(
    library_id: str,
    plan_id: str,
    runs: list[dict[str, Any]],
    access_token: str,
) -> None:
    suites: dict[str, dict[str, Any]] = {}
    for run in runs:
        suite_id, suite_name = run_suite(run)
        if not suite_id:
            continue
        row = suites.setdefault(suite_id, {
            "library_id": library_id,
            "plan_id": plan_id,
            "suite_id": suite_id,
            "suite_name": suite_name,
            "case_count": 0,
            "synced_at": datetime.now(timezone.utc).isoformat(),
        })
        row["case_count"] += 1
    delete_query = urllib.parse.urlencode({"library_id": f"eq.{library_id}", "plan_id": f"eq.{plan_id}"})
    request_json(
        f"{SUPABASE_URL}/rest/v1/testhub_plan_suite_cache?{delete_query}",
        method="DELETE",
        headers=supabase_headers(access_token, prefer="return=minimal"),
        retries=2,
    )
    if suites:
        request_json(
            f"{SUPABASE_URL}/rest/v1/testhub_plan_suite_cache?on_conflict=library_id,plan_id,suite_id",
            method="POST",
            headers=supabase_headers(access_token, prefer="resolution=merge-duplicates,return=minimal"),
            body=list(suites.values()),
            retries=2,
        )


def filter_runs_for_task_scope(task: dict[str, Any], runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if str(task.get("testhub_scope_mode") or "all") != "suite":
        return runs
    selected = {str(value) for value in (task.get("testhub_scope_suite_ids") or []) if value}
    return [run for run in runs if run_suite(run)[0] in selected]


def normalize_suite_name(value: Any) -> str:
    return "".join(str(value or "").split()).casefold()


def filter_plan_runs_for_shared_scope(
    task: dict[str, Any], plan_runs: dict[str, list[dict[str, Any]]]
) -> dict[str, list[dict[str, Any]]]:
    """Apply one module selection across plans whose equivalent suites have different IDs."""
    if str(task.get("testhub_scope_mode") or "all") != "suite":
        return plan_runs
    selected_ids = {str(value) for value in (task.get("testhub_scope_suite_ids") or []) if value}
    selected_names = {
        normalize_suite_name(suite_name)
        for runs in plan_runs.values()
        for run in runs
        for suite_id, suite_name in [run_suite(run)]
        if suite_id in selected_ids and suite_name
    }
    return {
        plan_id: [
            run for run in runs
            if run_suite(run)[0] in selected_ids
            or normalize_suite_name(run_suite(run)[1]) in selected_names
        ]
        for plan_id, runs in plan_runs.items()
    }


def parse_run_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)) or str(value).isdigit():
            numeric = float(value)
            if numeric > 10_000_000_000:
                numeric /= 1000
            return datetime.fromtimestamp(numeric, timezone.utc)
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError, OSError):
        return None


def run_executor_and_date(run: dict[str, Any]) -> tuple[str, str, str, str]:
    actor: dict[str, Any] = {}
    for key in ("latest_executor", "latest_executed_by", "executed_by", "executor", "operator", "assignee"):
        candidate = run.get(key)
        if isinstance(candidate, dict) and candidate:
            actor = candidate
            break
    latest = run.get("latest_execution") or run.get("latest_executed_result") or {}
    if not actor and isinstance(latest, dict):
        for key in ("executor", "executed_by", "operator", "user"):
            candidate = latest.get(key)
            if isinstance(candidate, dict) and candidate:
                actor = candidate
                break
    executor_id = str(actor.get("id") or actor.get("user_id") or actor.get("uid") or "").strip()
    executor_name = str(actor.get("display_name") or actor.get("name") or actor.get("username") or "未识别执行人").strip()
    date_value = None
    for source in (run, latest if isinstance(latest, dict) else {}):
        for key in ("latest_executed_at", "executed_at", "completed_at", "updated_at", "created_at"):
            if source.get(key) not in (None, ""):
                date_value = source.get(key)
                break
        if date_value is not None:
            break
    executed_at = parse_run_datetime(date_value) or datetime.now(timezone.utc)
    work_date = (executed_at + timedelta(hours=8)).date().isoformat()
    executor_key = executor_id or f"unmapped:{executor_name.casefold()}"
    return executor_key, executor_id, executor_name, work_date


def normalize_person_name(value: Any) -> str:
    return "".join(str(value or "").split()).casefold()


def upsert_pingcode_user_directory(
    runs: list[dict[str, Any]], access_token: str
) -> int:
    discovered: dict[str, dict[str, Any]] = {}
    seen_at = datetime.now(timezone.utc).isoformat()
    for run in runs:
        _, executor_id, executor_name, _ = run_executor_and_date(run)
        if not executor_id:
            continue
        discovered[executor_id] = {
            "pingcode_user_id": executor_id,
            "display_name": executor_name,
            "source": "testhub",
            "last_seen_at": seen_at,
        }
    if discovered:
        request_json(
            f"{SUPABASE_URL}/rest/v1/pingcode_user_directory?on_conflict=pingcode_user_id",
            method="POST",
            headers=supabase_headers(access_token, prefer="resolution=merge-duplicates,return=minimal"),
            body=list(discovered.values()),
            retries=2,
        )
    return len(discovered)


def auto_map_pingcode_profiles(access_token: str) -> int:
    profiles = request_json(
        f"{SUPABASE_URL}/rest/v1/profiles?select=id,name,pingcode_user_id",
        headers=supabase_headers(access_token),
        retries=2,
    ) or []
    directory = request_json(
        f"{SUPABASE_URL}/rest/v1/pingcode_user_directory?select=pingcode_user_id,display_name",
        headers=supabase_headers(access_token),
        retries=2,
    ) or []
    candidates: dict[str, list[dict[str, Any]]] = {}
    for user in directory:
        normalized = normalize_person_name(user.get("display_name"))
        if normalized:
            candidates.setdefault(normalized, []).append(user)
    mapped = 0
    for profile in profiles:
        if profile.get("pingcode_user_id"):
            continue
        matches = candidates.get(normalize_person_name(profile.get("name")), [])
        unique_ids = {str(item.get("pingcode_user_id") or "") for item in matches if item.get("pingcode_user_id")}
        if len(unique_ids) != 1:
            continue
        candidate = next(item for item in matches if str(item.get("pingcode_user_id") or "") in unique_ids)
        profile_id = urllib.parse.quote(str(profile.get("id") or ""), safe="")
        request_json(
            f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{profile_id}",
            method="PATCH",
            headers=supabase_headers(access_token, prefer="return=minimal"),
            body={
                "pingcode_user_id": candidate["pingcode_user_id"],
                "pingcode_display_name": candidate.get("display_name") or profile.get("name") or "",
            },
            retries=2,
        )
        mapped += 1
    return mapped


def replace_daily_execution(
    task_id: str,
    runs: list[dict[str, Any]],
    profile_directory: dict[str, dict[str, str]],
    access_token: str,
) -> tuple[int, set[str], set[str]]:
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for run in runs:
        status = str(((run.get("latest_executed_status") or {}).get("name") or run.get("status") or "")).strip()
        if status.casefold() not in EXECUTED_STATUSES:
            continue
        executor_key, pingcode_user_id, executor_name, work_date = run_executor_and_date(run)
        profile = profile_directory.get(pingcode_user_id)
        plan_id = str(run.get("_liene_plan_id") or "")
        key = (work_date, executor_key, plan_id)
        row = grouped.setdefault(key, {
            "task_id": task_id,
            "work_date": work_date,
            "executor_key": executor_key,
            "plan_id": plan_id,
            "member_id": profile["member_id"] if profile else None,
            "executor_name": profile["name"] if profile else executor_name,
            "executed_cases": 0,
            "synced_at": datetime.now(timezone.utc).isoformat(),
        })
        row["executed_cases"] += 1
    delete_query = urllib.parse.urlencode({"task_id": f"eq.{task_id}"})
    request_json(
        f"{SUPABASE_URL}/rest/v1/task_testhub_daily_execution?{delete_query}",
        method="DELETE",
        headers=supabase_headers(access_token, prefer="return=minimal"),
        retries=2,
    )
    if grouped:
        try:
            request_json(
                f"{SUPABASE_URL}/rest/v1/task_testhub_daily_execution?on_conflict=task_id,work_date,executor_key,plan_id",
                method="POST",
                headers=supabase_headers(access_token, prefer="resolution=merge-duplicates,return=minimal"),
                body=list(grouped.values()),
                retries=2,
            )
        except HttpStatusError as error:
            if error.status != 400:
                raise
            # Backward-compatible fallback before the plan-trace migration is
            # applied: keep the legacy member/day aggregate without plan_id.
            legacy: dict[tuple[str, str], dict[str, Any]] = {}
            for row in grouped.values():
                key = (row["work_date"], row["executor_key"])
                if key not in legacy:
                    legacy[key] = {
                        name:value for name, value in row.items() if name != "plan_id"
                    }
                else:
                    legacy[key]["executed_cases"] = (
                        int(legacy[key].get("executed_cases") or 0)
                        + int(row.get("executed_cases") or 0)
                    )
            request_json(
                f"{SUPABASE_URL}/rest/v1/task_testhub_daily_execution?on_conflict=task_id,work_date,executor_key",
                method="POST",
                headers=supabase_headers(access_token, prefer="resolution=merge-duplicates,return=minimal"),
                body=list(legacy.values()),
                retries=2,
            )
    mapped = {row["executor_key"] for row in grouped.values() if row.get("member_id")}
    unmapped = {row["executor_key"] for row in grouped.values() if not row.get("member_id")}
    return sum(int(row["executed_cases"]) for row in grouped.values()), mapped, unmapped


def sync_task_progress(tasks: list[dict[str, Any]], pingcode_token: str, access_token: str) -> dict[str, int]:
    success = 0
    failed = 0
    execution_records = 0
    mapped_executors: set[str] = set()
    unmapped_executors: set[str] = set()
    auto_mapped_profiles = 0
    upsert_url = f"{SUPABASE_URL}/rest/v1/task_testhub_progress?on_conflict=task_id"
    upsert_headers = supabase_headers(access_token, prefer="resolution=merge-duplicates,return=minimal")
    profile_directory = fetch_profile_directory(access_token)
    for task in tasks:
        plan_ids = [str(value) for value in (task.get("testhub_plan_ids") or []) if value]
        legacy_id = str(task.get("testhub_plan_id") or "")
        if legacy_id and legacy_id not in plan_ids:
            plan_ids.append(legacy_id)
        library_id = str(task.get("testhub_library_id") or "")
        if not library_id or not plan_ids:
            continue
        try:
            plan_runs_by_id: dict[str, list[dict[str, Any]]] = {}
            for plan_id in plan_ids:
                plan_runs = fetch_plan_runs(library_id, plan_id, pingcode_token)
                plan_runs_by_id[plan_id] = plan_runs
                cache_plan_suites(library_id, plan_id, plan_runs, access_token)
            scoped_runs_by_id = filter_plan_runs_for_shared_scope(task, plan_runs_by_id)
            summaries: list[dict[str, Any]] = []
            all_runs: list[dict[str, Any]] = []
            scope_suite_names: set[str] = set()
            for plan_id in plan_ids:
                scoped_runs = scoped_runs_by_id.get(plan_id, [])
                scope_suite_names.update(name for _, name in map(run_suite, scoped_runs) if name)
                summary = summarize_runs(scoped_runs)
                summary["plan_id"] = plan_id
                summaries.append(summary)
                all_runs.extend({**run, "_liene_plan_id": plan_id} for run in scoped_runs)
            upsert_pingcode_user_directory(all_runs, access_token)
            newly_mapped = auto_map_pingcode_profiles(access_token)
            if newly_mapped:
                auto_mapped_profiles += newly_mapped
                profile_directory = fetch_profile_directory(access_token)
            total = sum(item["total"] for item in summaries)
            executed = sum(item["executed"] for item in summaries)
            all_plans_complete = len(summaries) == len(plan_ids) and all(
                item["total"] > 0 and item["executed"] >= item["total"] for item in summaries
            )
            counts: dict[str, int] = {}
            for item in summaries:
                for status, count in item["counts"].items():
                    counts[status] = counts.get(status, 0) + count
            status_details: dict[str, Any] = {
                "aggregate": counts,
                "plans": [
                    {
                        "plan_id": item["plan_id"],
                        "total": item["total"],
                        "executed": item["executed"],
                        "complete": item["total"] > 0 and item["executed"] >= item["total"],
                    }
                    for item in summaries
                ],
            }
            row = {
                "task_id": task["id"],
                "library_id": library_id,
                "plan_id": plan_ids[0],
                "plan_ids": plan_ids,
                "total_cases": total,
                "executed_cases": executed,
                "progress_ratio": executed / total if total else 0,
                "status_counts": status_details,
                "scope_mode": str(task.get("testhub_scope_mode") or "all"),
                "scope_suite_ids": [str(value) for value in (task.get("testhub_scope_suite_ids") or []) if value],
                "scope_suite_names": sorted(scope_suite_names) if task.get("testhub_scope_mode") == "suite" else [],
                "sync_status": "synced",
                "sync_error": None,
                "synced_at": datetime.now(timezone.utc).isoformat(),
            }
            request_json(upsert_url, method="POST", headers=upsert_headers, body=row, retries=2)
            synced_task_status = sync_task_status_from_testhub(
                task, total, executed, all_plans_complete, access_token
            )
            task_records, task_mapped, task_unmapped = replace_daily_execution(
                str(task["id"]), all_runs, profile_directory, access_token
            )
            execution_records += task_records
            mapped_executors.update(task_mapped)
            unmapped_executors.update(task_unmapped)
            success += 1
            for item in summaries:
                print(f"    plan {item['plan_id']}: {item['executed']}/{item['total']}")
            scope_text = "指定模块" if task.get("testhub_scope_mode") == "suite" else "整个计划"
            print(f"  ✓ {task.get('title') or task['id']}：{executed}/{total}（{scope_text}）")
        except Exception as error:
            failed += 1
            print(f"  ✗ {task.get('title') or task['id']}：{error}", file=sys.stderr)
    return {
        "success": success,
        "failed": failed,
        "execution_records": execution_records,
        "mapped_executors": len(mapped_executors),
        "unmapped_executors": len(unmapped_executors),
        "auto_mapped_profiles": auto_mapped_profiles,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="本地拉取 TestHub，并安全写入 Liene QA Supabase 缓存")
    parser.add_argument("--library-id", action="append", dest="library_ids", help="可重复指定；默认消费类用例库")
    parser.add_argument("--plan-limit", type=int, help="每个用例库仅刷新最近 N 个计划；省略时刷新完整目录")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument("--skip-progress", action="store_true", help="只同步计划目录，不同步已关联任务进度")
    mode_group.add_argument("--progress-only", action="store_true", help="只同步已关联任务进度，不重复拉取计划目录")
    parser.add_argument("--stored-credentials", action="store_true", help="从当前 Windows 用户的凭据管理器读取授权")
    parser.add_argument("--task-keyword", help="Only sync linked tasks whose title contains this keyword")
    args = parser.parse_args()
    if args.plan_limit is not None and args.plan_limit < 1:
        parser.error("--plan-limit 必须大于 0")
    acquire_sync_lock()

    stored_email = stored_password = ""
    if args.stored_credentials:
        _, pingcode_token = read_credential(PINGCODE_CREDENTIAL)
        stored_email, stored_password = read_credential(SUPABASE_CREDENTIAL)
    else:
        pingcode_token = os.environ.get("PINGCODE_TOKEN", "").strip()
    if not pingcode_token and not args.stored_credentials:
        input("请先复制 Hanntonb API Key，然后按回车读取并清空剪贴板: ")
        pingcode_token = read_clipboard_pingcode_token()
    if not pingcode_token:
        raise SystemExit("缺少 PingCode Key")

    if not args.progress_only:
        print("正在验证 Hanntonb API Key…")
        try:
            validate_pingcode_token(pingcode_token)
        except HttpStatusError as error:
            if error.status in (401, 403):
                raise SystemExit("Hanntonb API Key 无效或无权限；请使用已验证成功的同一个公司 Key") from None
            raise
        print("Hanntonb API Key 验证成功")

    if args.stored_credentials:
        print("正在使用 Windows 凭据登录 Supabase…")
        access_token, user_id = authenticate_supabase(stored_email, stored_password)
        validated_user_id, email = validate_supabase_access_token(access_token)
        if validated_user_id != user_id:
            raise RuntimeError("Supabase 用户验证不一致")
        stored_password = ""
    else:
        access_token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not args.stored_credentials and access_token:
        user_id, email = validate_supabase_access_token(access_token)
    elif not args.stored_credentials:
        mode = input("Supabase 授权方式 [1=粘贴管理平台同步授权（推荐），2=邮箱密码]，默认 1: ").strip() or "1"
        if mode == "2":
            email = os.environ.get("SUPABASE_EMAIL", "").strip() or input("Supabase 登录邮箱: ").strip()
            password = os.environ.get("SUPABASE_PASSWORD", "") or getpass.getpass("Supabase 登录密码: ")
            if not email or not password:
                raise SystemExit("缺少 Supabase 登录信息")
            print("正在登录 Supabase…")
            access_token, user_id = authenticate_supabase(email, password)
        else:
            input("确认已在管理平台点击“复制本地同步授权”，然后按回车读取剪贴板: ")
            access_token = read_clipboard_access_token()
            user_id, email = validate_supabase_access_token(access_token)
    print(f"Supabase 授权成功：{email or user_id}")
    update_sync_health(access_token, user_id, "running")
    synced_at = datetime.now(timezone.utc).isoformat()
    library_ids = list(dict.fromkeys(args.library_ids or [DEFAULT_LIBRARY_ID]))
    total_cached = 0
    progress_success = progress_failed = 0
    execution_record_count = mapped_executor_count = unmapped_executor_count = auto_mapped_profile_count = 0

    try:
        if not args.progress_only:
            for library_id in library_ids:
                print(f"正在拉取 TestHub 计划：{library_id}")
                plans = fetch_all_plans(library_id, pingcode_token, limit=args.plan_limit)
                rows = plan_cache_rows(library_id, plans, user_id, synced_at)
                upsert_plan_cache(rows, access_token)
                total_cached += len(rows)

        if not args.skip_progress:
            print("正在同步已关联工作事项的 TestHub 执行进度…")
            tasks = fetch_open_tasks(access_token)
            if args.task_keyword:
                keyword = args.task_keyword.casefold()
                tasks = [task for task in tasks if keyword in str(task.get("title") or "").casefold()]
                print(f"  task filter: {args.task_keyword} ({len(tasks)} matched)")
            progress_metrics = sync_task_progress(tasks, pingcode_token, access_token)
            progress_success = progress_metrics["success"]
            progress_failed = progress_metrics["failed"]
            execution_record_count = progress_metrics["execution_records"]
            mapped_executor_count = progress_metrics["mapped_executors"]
            unmapped_executor_count = progress_metrics["unmapped_executors"]
            auto_mapped_profile_count = progress_metrics["auto_mapped_profiles"]

        print("\n同步完成")
        print(f"  用例库：{', '.join(library_ids)}")
        print(f"  计划缓存：{'本次跳过' if args.progress_only else f'{total_cached} 条'}")
        if not args.skip_progress:
            print(f"  任务进度：成功 {progress_success}，失败 {progress_failed}")
            print(f"  执行记录：{execution_record_count} 条；已映射执行人 {mapped_executor_count}，未映射 {unmapped_executor_count}")
            if auto_mapped_profile_count:
                print(f"  自动绑定成员：{auto_mapped_profile_count} 人")
        if progress_failed:
            update_sync_health(
                access_token,
                user_id,
                "failed",
                cached_plan_count=total_cached if not args.progress_only else None,
                progress_success=progress_success,
                progress_failed=progress_failed,
                execution_record_count=execution_record_count,
                mapped_executor_count=mapped_executor_count,
                unmapped_executor_count=unmapped_executor_count,
                error_message=f"{progress_failed} 个关联任务进度同步失败",
            )
            raise SystemExit(2)
        update_sync_health(
            access_token,
            user_id,
            "success",
            cached_plan_count=total_cached if not args.progress_only else None,
            progress_success=progress_success,
            progress_failed=0,
            execution_record_count=execution_record_count,
            mapped_executor_count=mapped_executor_count,
            unmapped_executor_count=unmapped_executor_count,
        )
    except SystemExit:
        raise
    except Exception as error:
        update_sync_health(
            access_token,
            user_id,
            "failed",
            cached_plan_count=total_cached if not args.progress_only else None,
            progress_success=progress_success,
            progress_failed=max(progress_failed, 1),
            execution_record_count=execution_record_count,
            mapped_executor_count=mapped_executor_count,
            unmapped_executor_count=unmapped_executor_count,
            error_message=str(error),
        )
        raise


if __name__ == "__main__":
    main()
