#!/usr/bin/env python3
"""Regression tests for TestHub module scoping across multiple plans."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import sync_testhub_local as sync  # noqa: E402


def make_run(plan: str, index: int, suite_id: str, path: list[str]) -> dict:
    return {
        "id": f"{plan}-{index}",
        "suite": {"id": suite_id, "name": path[-1]},
        "case": {"suite": {"id": suite_id, "name": path[-1], "paths": path}},
    }


class TestSharedSuiteScope(unittest.TestCase):
    def test_every_result_except_untested_counts_as_executed(self) -> None:
        statuses = [
            "未测试",
            "未测",
            "not_run",
            "通过",
            "失败",
            "阻塞",
            "不适用",
            "自定义结果",
        ]
        runs = [{"latest_executed_status": {"name": status}} for status in statuses]

        summary = sync.summarize_runs(runs)

        self.assertEqual(8, summary["total"])
        self.assertEqual(5, summary["executed"])
        self.assertAlmostEqual(5 / 8, summary["ratio"])

    def test_selected_module_uses_path_not_whole_plan_or_leaf_name(self) -> None:
        plans: dict[str, list[dict]] = {"windows": [], "mac": []}
        for plan_id, suite_prefix in (("windows", "win"), ("mac", "mac")):
            plans[plan_id].extend(
                make_run(
                    plan_id,
                    index,
                    f"{suite_prefix}-selected",
                    ["Liene Photo PC", "2.5", "打开元素模板展示对应分类列表"],
                )
                for index in range(57)
            )
            # Same leaf name under another parent must not leak into the selection.
            plans[plan_id].extend(
                make_run(
                    plan_id,
                    100 + index,
                    f"{suite_prefix}-duplicate",
                    ["历史版本", "2.4", "打开元素模板展示对应分类列表"],
                )
                for index in range(272)
            )

        scoped = sync.filter_plan_runs_for_shared_scope(
            {
                "testhub_scope_mode": "suite",
                "testhub_scope_suite_ids": ["win-selected"],
            },
            plans,
        )

        self.assertEqual(57, len(scoped["windows"]))
        self.assertEqual(57, len(scoped["mac"]))
        self.assertEqual(114, sum(len(runs) for runs in scoped.values()))

    def test_leaf_identity_is_not_replaced_by_richer_parent_projection(self) -> None:
        run = {
            "suite": {"id": "leaf-id", "name": "元素"},
            "case": {
                "suite": {
                    "id": "parent-id",
                    "name": "模板",
                    "paths": ["2.5", "模板"],
                }
            },
        }
        payload = sync.run_suite_payload(run)
        self.assertEqual("leaf-id", payload["id"])
        self.assertEqual("元素", payload["name"])
        self.assertEqual(["2.5", "模板", "元素"], payload["paths"])


if __name__ == "__main__":
    unittest.main()
