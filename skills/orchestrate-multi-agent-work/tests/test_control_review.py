import copy
from datetime import datetime, timedelta
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from task_control import GateError, atomic_write, load_ledger, mutate, register, register_window
from control_review import TZ, acknowledge, baseline, handoff, overview, prepare, read_state, redact_share, share_export, share_preview, snapshot


class ControlReviewTests(unittest.TestCase):
    def setUp(self):
        destination = ROOT / "outputs/control-upgrade-20261016/test-runs"
        destination.mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix="case-", dir=destination))
        atomic_write(self.root / "docs/task-ledger.md", "# Test\n\n## 当前长期与专项窗口\n\n| 业务域 | 长期窗口 | thread_id | 恢复入口 |\n| --- | --- | --- | --- |\n| 示例 | 新名称 | `owner-a` | `record.md` |\n\n## 其他说明\n\n保留原说明\n")
        self.cfg = {"schema_version": 1, "source_id": "sample-a", "timezone": "Asia/Shanghai", "max_changed_tasks": 2, "rule_files": [], "projects": [{"id": "demo", "name": "示例项目", "domains": ["示例"], "review_frequency": "weekly", "priority": "normal"}, {"id": "unassigned", "name": "待归属", "domains": [], "review_frequency": "weekly", "priority": "normal"}], "dependencies": {}}
        self.write_config()
        self.at = datetime(2026, 10, 19, 8, tzinfo=TZ)

    def write_config(self):
        atomic_write(self.root / "docs/control-projects.json", json.dumps(self.cfg, ensure_ascii=False))

    def create(self, batch="one", key=None):
        return register(self.root, {"业务域": "示例", "目标": "测试交付", "允许修改": "测试目录", "禁止修改": "生产数据", "负责窗口": "旧名称", "owner_thread_id": "owner-a", "execution_id": "exec-" + batch, "batch_key": batch, "验收标准": "测试", "下一步": "初始动作", "lock_keys": [key or "path:out/" + batch]})["task_id"]

    def change(self, task, values, action="update"):
        return mutate(self.root, task, "owner-a", load_ledger(self.root).find(task).revision, values, action)

    def test_no_change_and_weekly_retry_are_quiet_without_ledger_writes(self):
        self.create()
        before = (self.root / "docs/task-ledger.md").read_bytes()
        baseline(self.root)
        report = prepare(self.root, at=self.at)
        self.assertFalse(report["notify"])
        acknowledge(self.root, report["report_id"])
        self.assertEqual(prepare(self.root, at=self.at)["status"], "already_reviewed")
        self.assertTrue(acknowledge(self.root, report["report_id"])["duplicate"])
        self.assertEqual(before, (self.root / "docs/task-ledger.md").read_bytes())

    def test_ack_only_advances_captured_state_not_later_task_changes(self):
        task = self.create()
        baseline(self.root)
        self.change(task, {"下一步": "第一项变化"})
        report = prepare(self.root, at=self.at)
        self.change(task, {"下一步": "生成报告后的新变化"})
        acknowledge(self.root, report["report_id"])
        self.assertEqual(read_state(self.root, "weekly")["snapshot"]["tasks"][task]["fields"]["下一步"], "第一项变化")
        next_report = prepare(self.root, at=self.at + timedelta(days=7))
        self.assertEqual(next_report["changes"][0]["fields"]["下一步"], "生成报告后的新变化")

    def test_stale_ack_is_rejected(self):
        self.create()
        baseline(self.root)
        first, second = prepare(self.root, at=self.at), prepare(self.root, at=self.at)
        acknowledge(self.root, first["report_id"])
        with self.assertRaises(GateError):
            acknowledge(self.root, second["report_id"])

    def test_daily_disabled_until_project_is_selected_and_does_not_ack_weekly(self):
        task = self.create()
        baseline(self.root)
        self.assertEqual(prepare(self.root, "daily")["status"], "disabled")
        self.cfg["projects"][0]["review_frequency"] = "daily"
        self.write_config()
        self.change(task, {"下一步": "每天指定项目的变化"})
        report = prepare(self.root, "daily", at=self.at)
        acknowledge(self.root, report["report_id"])
        self.assertEqual(len(prepare(self.root, at=self.at)["changes"]), 1)

    def test_budget_deferred_changes_are_preserved(self):
        tasks = [self.create(str(i)) for i in range(3)]
        baseline(self.root)
        for task in tasks:
            self.change(task, {"下一步": "变化"})
        report = prepare(self.root, at=self.at)
        self.assertEqual(report["deferred_count"], 1)
        self.assertEqual(len(report["changes"]), 2)
        acknowledge(self.root, report["report_id"])
        self.assertEqual(len(prepare(self.root, at=self.at + timedelta(days=7))["changes"]), 1)

    def test_time_only_update_is_not_a_change(self):
        task = self.create()
        baseline(self.root)
        self.change(task, {"最后更新时间": "2001-01-01"})
        self.assertFalse(prepare(self.root, at=self.at)["notify"])
        with self.assertRaises(GateError):
            baseline(self.root)

    def test_canonical_owner_explicit_project_and_handoff_guard(self):
        task = self.create()
        self.cfg["projects"].append({"id": "specific", "name": "独立项目", "domains": [], "task_ids": [task], "review_frequency": "manual", "priority": "normal"})
        self.write_config()
        result = handoff(self.root, task)
        self.assertEqual(result["owner"], "新名称")
        self.assertEqual(result["project_id"], "specific")
        self.assertIn("不转移执行权", result["execution_permission"])
        self.assertFalse(prepare(self.root, "daily")["notify"])

    def test_share_redaction_and_foreign_preview_never_writes_ledger(self):
        task = self.create()
        self.change(task, {"下一步": r"联系13800138000 test@example.com，文件E:\private\x.txt，token=secret123 https://private.feishu.cn/x"})
        before = (self.root / "docs/task-ledger.md").read_bytes()
        value = share_export(self.root, "demo")
        content = json.dumps(value, ensure_ascii=False)
        for forbidden in ["13800138000", "test@example.com", "E:\\private", "secret123", "private.feishu.cn", "owner-a"]:
            self.assertNotIn(forbidden, content)
        with self.assertRaises(GateError):
            share_preview(self.root, value)
        value["source_id"] = "sample-colleague"
        self.assertFalse(share_preview(self.root, value)["writes_to_ledger"])
        self.assertEqual(share_preview(self.root, value)["external_key"], "sample-colleague:demo")
        self.assertEqual(before, (self.root / "docs/task-ledger.md").read_bytes())

    def test_dependency_requires_business_acceptance_and_rejects_cycles(self):
        first, second = self.create("a"), self.create("b")
        self.cfg["dependencies"] = {second: [first]}
        self.write_config()
        self.assertNotIn(second, overview(self.root)["projects"][0]["ready_tasks"])
        self.change(first, {"当前阶段": "业务验收通过", "验收证据": "fixture", "验收结论": "通过"}, "close")
        self.assertIn(second, overview(self.root)["projects"][0]["ready_tasks"])
        self.cfg["dependencies"][first] = [second]
        self.write_config()
        with self.assertRaises(GateError):
            snapshot(self.root)

    def test_register_window_requires_owner_lock_and_is_idempotent(self):
        task = self.create(key="path:docs/task-ledger.md")
        self.change(task, {}, "start")
        current = load_ledger(self.root).find(task)
        entry = {"业务域": "示例", "长期窗口": "第二窗口", "thread_id": "owner-b", "恢复入口": "other.md"}
        with self.assertRaises(GateError):
            register_window(self.root, task, "owner-b", current.revision, entry)
        self.assertTrue(register_window(self.root, task, "owner-a", current.revision, entry)["registered"])
        self.assertFalse(register_window(self.root, task, "owner-a", current.revision, entry)["registered"])
        self.assertIn("保留原说明", (self.root / "docs/task-ledger.md").read_text(encoding="utf-8"))

    def test_window_changes_without_ledger_changes_are_detected(self):
        self.create()
        initial = [{"id": "owner-a", "title": "新名称", "updated_at": 100}]
        baseline(self.root, initial)
        changed = [{"id": "owner-a", "title": "新名称", "updated_at": 200}]
        report = prepare(self.root, at=self.at, thread_activity=changed)
        self.assertEqual(report["changes"], [])
        self.assertEqual(report["changed_windows"], changed)
        acknowledge(self.root, report["report_id"])
        self.assertFalse(prepare(self.root, at=self.at + timedelta(days=7), thread_activity=changed)["notify"])

    def test_unregistered_and_excluded_threads_are_not_reviewed(self):
        self.create()
        self.cfg["excluded_review_threads"] = ["owner-a"]
        self.write_config()
        activity = [{"id": "owner-a", "title": "总控", "updated_at": 1}, {"id": "unrelated", "title": "无关私人对话", "updated_at": 3}]
        self.assertEqual(snapshot(self.root, activity)["thread_activity"], {})


if __name__ == "__main__":
    unittest.main()

