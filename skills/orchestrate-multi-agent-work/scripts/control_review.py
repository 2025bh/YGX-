"""Incremental control summaries. No model calls, business APIs, or task writes."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sys
import uuid

from task_control import GateError, TERMINAL, atomic_write, clean, default_root, digest, load_ledger, mutex, read_json, require

TZ = timezone(timedelta(hours=8), "Asia/Shanghai")
FIELDS = ("目标", "当前阶段", "owner_thread_id", "已完成", "剩余工作", "下一步", "阻塞原因", "待决策", "验收结论", "验收证据", "正式结果文件", "飞书结果链接", "工作焦点", "对象锁状态")
ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")


def timestamp():
    return datetime.now(TZ).isoformat(timespec="seconds")


def config(root):
    value = read_json(Path(root) / "docs/control-projects.json")
    require(value.get("schema_version") == 1 and ID.fullmatch(value.get("source_id", "")), "项目配置版本或来源不合法")
    require(value.get("timezone") == "Asia/Shanghai", "本适配层使用北京时间")
    require(isinstance(value.get("max_changed_tasks"), int) and 1 <= value["max_changed_tasks"] <= 20, "每次变化摘要上限须在1至20之间")
    ids, domains, tasks = set(), set(), set()
    for project in value["projects"]:
        pid = project["id"]
        require(ID.fullmatch(pid) and pid not in ids, "项目编号不合法或重复")
        ids.add(pid)
        require(project.get("review_frequency") in {"weekly", "daily", "manual"}, "复盘策略不合法")
        require(project.get("priority") in {"high", "normal", "low"}, "优先级不合法")
        for domain in project.get("domains", []):
            normalized = re.sub(r"\s", "", domain)
            require(normalized not in domains, "业务域映射重复")
            domains.add(normalized)
        for task in project.get("task_ids", []):
            require(task not in tasks, "任务被指定给多个项目")
            tasks.add(task)
    require("unassigned" in ids, "必须保留待归属项目")
    return value


def windows(ledger):
    require("## 当前长期与专项窗口" in ledger.header, "缺少窗口登记")
    section = ledger.header.split("## 当前长期与专项窗口", 1)[1].split("\n## ", 1)[0]
    output = {}
    for line in section.splitlines():
        if not line.startswith("|"):
            continue
        cells = [clean(c.strip()) for c in line.strip("|").split("|")]
        if len(cells) != 4 or cells[2] in {"thread_id", "---"}:
            continue
        require(cells[2] not in output, "窗口标识重复")
        output[cells[2]] = {"name": cells[1], "entry": cells[3]}
    return output


def project_for(task, cfg):
    explicit = [p for p in cfg["projects"] if task.id in p.get("task_ids", [])]
    domain = re.sub(r"\s", "", task.get("业务域"))
    matches = explicit or [p for p in cfg["projects"] if domain in [re.sub(r"\s", "", d) for d in p.get("domains", [])]]
    return matches[0]["id"] if matches else "unassigned"


def snapshot(root, thread_activity=None):
    root = Path(root)
    cfg, ledger = config(root), load_ledger(root)
    owners = windows(ledger)
    tasks, issues = {}, []
    for task in ledger.tasks:
        pid = project_for(task, cfg)
        fields = {key: task.get(key) for key in FIELDS}
        tasks[task.id] = {"project_id": pid, "fingerprint": digest({"project_id": pid, **fields}), "revision": task.revision, "updated_at": task.get("最后更新时间"), "owner": owners.get(task.get("owner_thread_id"), {}).get("name", "未登记窗口"), "fields": fields}
        if task.get("当前阶段") not in TERMINAL:
            if task.get("owner_thread_id") not in owners:
                issues.append({"task_id": task.id, "reason": "负责人窗口未登记"})
            if pid == "unassigned":
                issues.append({"task_id": task.id, "reason": "项目待归属"})
    dependencies = cfg.get("dependencies", {})
    for task, parents in dependencies.items():
        require(task in tasks and isinstance(parents, list) and len(parents) == len(set(parents)), "依赖的任务不存在或依赖列表重复")
        require(all(p in tasks and p != task for p in parents), "依赖任务不存在或自依赖")
    visited, active = set(), set()
    def visit(task):
        require(task not in active, "项目依赖存在循环")
        if task in visited:
            return
        active.add(task)
        for parent in dependencies.get(task, []):
            visit(parent)
        active.remove(task)
        visited.add(task)
    for task in dependencies:
        visit(task)
    rules = {}
    for name in cfg.get("rule_files", []):
        path = (root / name).resolve()
        require(path.is_relative_to(root.resolve()), "规则引用超出工作区")
        rules[name] = digest(path.read_bytes().hex()) if path.is_file() else "missing"
    rules["project-routing"] = digest(cfg)
    activity = {}
    if thread_activity is not None:
        require(isinstance(thread_activity, list), "窗口动态须为数组")
        for item in thread_activity:
            require(isinstance(item, dict) and set(item) == {"id", "title", "updated_at"}, "窗口动态只接收编号、标题、更新时间")
            require(isinstance(item["title"], str) and len(item["title"]) <= 256 and isinstance(item["updated_at"], (int, float)), "窗口动态格式不合法")
            if item["id"] in owners and item["id"] not in cfg.get("excluded_review_threads", []):
                activity[item["id"]] = item
    return {"schema_version": 1, "source_id": cfg["source_id"], "captured_at": timestamp(), "tasks": tasks, "rules": rules, "issues": issues, "windows": owners, "thread_activity": activity, "thread_check": "provided" if thread_activity is not None else "not_provided"}


def overview(root, snap=None):
    cfg, snap = config(root), snap or snapshot(root)
    output = []
    for project in cfg["projects"]:
        items = {k: t for k, t in snap["tasks"].items() if t["project_id"] == project["id"]}
        if not items:
            continue
        current = {k: t for k, t in items.items() if t["fields"]["当前阶段"] not in TERMINAL}
        unmet = {k: [d for d in cfg.get("dependencies", {}).get(k, []) if snap["tasks"][d]["fields"]["当前阶段"] != "业务验收通过"] for k in current}
        output.append({"project_id": project["id"], "name": project["name"], "review_frequency": project["review_frequency"], "priority": project["priority"], "task_count": len(items), "open_count": len(current), "stages": dict(Counter(t["fields"]["当前阶段"] for t in current.values())), "owners": sorted({t["owner"] for t in current.values()}), "ready_tasks": [k for k, t in current.items() if not unmet[k] and t["fields"]["当前阶段"] in {"已确认", "执行中"} and t["fields"]["对象锁状态"] == "占用中"], "unmet_dependencies": {k: v for k, v in unmet.items() if v}})
    return {"captured_at": snap["captured_at"], "projects": output, "registration_issues": snap["issues"], "runtime_status": "未采集；账本焦点不等于进程正在运行"}


def state_path(root, scope):
    return Path(root) / f"docs/.task-control/review/{scope}.json"


def read_state(root, scope):
    path = state_path(root, scope)
    if path.exists():
        return read_json(path)
    if scope in {"manual", "daily"} and state_path(root, "weekly").exists():
        value = read_json(state_path(root, "weekly"))
        return {**value, "periods": {}}
    raise GateError("先运行 baseline 初始化历史基线；不要把全部旧任务当作本周新增")


def baseline(root, thread_activity=None):
    with mutex(root):
        path = state_path(root, "weekly")
        require(not path.exists(), "基线已存在，不能覆盖历史复盘水位")
        snap = snapshot(root, thread_activity)
        atomic_write(path, json.dumps({"snapshot": snap, "periods": {}, "last_ack_at": None}, ensure_ascii=False, indent=2))
        return {"initialized": True, "tasks": len(snap["tasks"]), "registration_issues": snap["issues"], "captured_at": snap["captured_at"]}


def period(scope, at):
    at = at.astimezone(TZ)
    year, week, _ = at.isocalendar()
    return f"weekly-{year}-W{week:02d}" if scope == "weekly" else f"{scope}-{at.date().isoformat()}"


def short(value, limit=180):
    return value if len(value) <= limit else value[:limit] + "…（详见任务入口）"


def prepare(root, scope="weekly", project_id=None, at=None, thread_activity=None):
    require(scope in {"weekly", "daily", "manual"}, "复盘范围不合法")
    with mutex(root):
        cfg = config(root)
        require(project_id is None or any(p["id"] == project_id for p in cfg["projects"]), "项目不存在")
        require(project_id is None or scope == "manual", "定时复盘按项目策略选择范围，单项目请使用manual")
        selected = {p["id"] for p in cfg["projects"] if (scope == "manual" or p["review_frequency"] in ({"weekly", "daily"} if scope == "weekly" else {"daily"})) and (project_id is None or p["id"] == project_id)}
        if not selected:
            return {"status": "disabled", "notify": False}
        state = read_state(root, scope)
        token = period(scope, at or datetime.now(TZ))
        if scope != "manual" and token in state["periods"]:
            return {"status": "already_reviewed", "notify": False, "period": token}
        snap = snapshot(root, thread_activity)
        previous = state["snapshot"]
        changed = [k for k, t in snap["tasks"].items() if t["project_id"] in selected and t["fingerprint"] != previous["tasks"].get(k, {}).get("fingerprint")]
        changed.sort(key=lambda k: (0 if snap["tasks"][k]["fields"]["阻塞原因"] or snap["tasks"][k]["fields"]["待决策"] else 1, {"high": 0, "normal": 1, "low": 2}[next(p["priority"] for p in cfg["projects"] if p["id"] == snap["tasks"][k]["project_id"])], k))
        included = changed[:cfg["max_changed_tasks"]]
        missing = [k for k, t in previous["tasks"].items() if t["project_id"] in selected and k not in snap["tasks"] and not t.get("missing")]
        rule_changes = [k for k, v in snap["rules"].items() if v != previous.get("rules", {}).get(k)]
        relevant_owners = {t["fields"]["owner_thread_id"] for t in snap["tasks"].values() if t["project_id"] in selected}
        changed_windows = [k for k, v in snap["thread_activity"].items() if k in relevant_owners and v != previous.get("thread_activity", {}).get(k)]
        included_windows = changed_windows[:3]
        packet = {"status": "changes" if changed or missing or rule_changes or changed_windows else "no_changes", "notify": bool(changed or missing or rule_changes or changed_windows), "scope": scope, "period": token, "captured_at": snap["captured_at"], "rule_changes": rule_changes, "missing_tasks": missing, "deferred_count": len(changed) - len(included), "thread_check": snap["thread_check"], "changed_windows": [snap["thread_activity"][k] for k in included_windows], "deferred_windows": len(changed_windows) - len(included_windows), "changes": [{"task_id": k, "project_id": snap["tasks"][k]["project_id"], "owner": snap["tasks"][k]["owner"], "fields": {f: short(snap["tasks"][k]["fields"][f]) for f in ("目标", "当前阶段", "已完成", "剩余工作", "下一步", "阻塞原因", "待决策", "正式结果文件") if snap["tasks"][k]["fields"][f]}} for k in included]}
        report_id = uuid.uuid4().hex
        report = {"report_id": report_id, "scope": scope, "base_revision": digest(state), "included": included, "included_windows": included_windows, "missing": missing, "snapshot": snap, "packet": packet}
        atomic_write(Path(root) / f"docs/.task-control/review/reports/{report_id}.json", json.dumps(report, ensure_ascii=False, indent=2))
        return {**packet, "report_id": report_id}


def acknowledge(root, report_id):
    require(bool(re.fullmatch(r"[a-f0-9]{32}", report_id)), "报告编号不合法")
    with mutex(root):
        report = read_json(Path(root) / f"docs/.task-control/review/reports/{report_id}.json")
        state = read_state(root, report["scope"])
        if state.get("last_report_id") == report_id:
            return {"acknowledged": True, "duplicate": True}
        require(digest(state) == report["base_revision"], "另一份复盘已提交，重新读取增量，不覆盖水位")
        for task_id in report["included"]:
            state["snapshot"]["tasks"][task_id] = report["snapshot"]["tasks"][task_id]
        for task_id in report["missing"]:
            state["snapshot"]["tasks"][task_id]["missing"] = True
        state["snapshot"]["rules"] = report["snapshot"]["rules"]
        for thread_id in report.get("included_windows", []):
            state["snapshot"].setdefault("thread_activity", {})[thread_id] = report["snapshot"]["thread_activity"][thread_id]
        if report["scope"] != "manual":
            state["periods"][report["packet"]["period"]] = report_id
        state["last_report_id"], state["last_ack_at"] = report_id, timestamp()
        atomic_write(state_path(root, report["scope"]), json.dumps(state, ensure_ascii=False, indent=2))
        return {"acknowledged": True, "duplicate": False, "deferred_count": report["packet"]["deferred_count"]}


def handoff(root, task_id):
    ledger, cfg = load_ledger(root), config(root)
    task = ledger.find(task_id)
    owner = windows(ledger).get(task.get("owner_thread_id"), {})
    return {"task_id": task.id, "project_id": project_for(task, cfg), "owner_thread_id": task.get("owner_thread_id"), "owner": owner.get("name", "未登记窗口"), "recovery_entry": owner.get("entry", ""), "revision": task.revision, "目标": task.get("目标"), "阶段": task.get("当前阶段"), "范围与授权依据": {k: task.get(k) for k in ("允许修改", "禁止修改", "输入依据")}, "已完成": task.get("已完成"), "剩余工作": task.get("剩余工作"), "下一步": task.get("下一步"), "验收标准": task.get("验收标准"), "证据入口": task.get("验收证据") or task.get("正式结果文件"), "rule_files": cfg["rule_files"], "execution_permission": "此摘要不转移执行权；写入仍须start与assert-owner；其他窗口只读"}


def redact_share(value):
    value = re.sub(r"(?i)\b[A-Z]:[\\/][^\s，。；;<>\"|]+|\\\\[^\s，。；;<>\"|]+", "[本地路径已隐藏]", value)
    value = re.sub(r"(?<!\d)1\d{10}(?!\d)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[联系方式已隐藏]", value)
    value = re.sub(r"(?i)(?:https?://|file://|plugin://|codex://)[^\s<>\"，。；]+", "[链接默认不共享]", value)
    value = re.sub(r"(?i)(?:token|secret|password|api[_-]?key)\s*[:=：]\s*\S+", "[凭据已隐藏]", value)
    value = re.sub(r"(?<![\w-])[a-f0-9]{8}-[a-f0-9-]{27,}(?![\w-])", "[内部标识已隐藏]", value)
    return short(value, 240)


def share_export(root, project_id):
    snap, cfg = snapshot(root), config(root)
    row = next((p for p in overview(root, snap)["projects"] if p["project_id"] == project_id), None)
    require(row is not None, "项目不存在或没有任务")
    tasks = [t for t in snap["tasks"].values() if t["project_id"] == project_id and t["fields"]["当前阶段"] not in TERMINAL]
    return {"schema_version": 1, "source_id": cfg["source_id"], "project_id": project_id, "source_revision": digest({"tasks": tasks, "name": row["name"]}), "generated_at": timestamp(), "name": redact_share(row["name"]), "status_counts": row["stages"], "next_steps": [redact_share(t["fields"]["下一步"]) for t in tasks[:5] if t["fields"]["下一步"]], "results": [], "authorization": "仅共享项目进度；不授权接管任务或访问源机器", "review_required": True}


def share_preview(root, value):
    fields = {"schema_version", "source_id", "project_id", "source_revision", "generated_at", "name", "status_counts", "next_steps", "results", "authorization", "review_required"}
    require(isinstance(value, dict) and set(value) == fields and value["schema_version"] == 1, "共享包字段或版本不合法")
    require(ID.fullmatch(value["source_id"]) and ID.fullmatch(value["project_id"]), "共享来源或项目编号不合法")
    require(value["source_id"] != config(root)["source_id"], "本来源进度包不能冒充同事项目导入")
    require(isinstance(value["status_counts"], dict) and all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in value["status_counts"].values()), "状态数量不合法")
    require(isinstance(value["next_steps"], list) and len(value["next_steps"]) <= 5 and all(isinstance(v, str) for v in value["next_steps"]), "下一步格式不合法")
    require(value["results"] == [] and value["review_required"] is True, "第一版不自动导入成果链接")
    return {"preview_only": True, "external_key": f"{value['source_id']}:{value['project_id']}", "source_revision": value["source_revision"], "name": redact_share(value["name"]), "status_counts": value["status_counts"], "next_steps": [redact_share(s) for s in value["next_steps"]], "writes_to_ledger": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=default_root())
    parser.add_argument("command", choices=["overview", "baseline", "prepare", "ack", "handoff", "share-export", "share-preview"])
    parser.add_argument("--scope", choices=["weekly", "daily", "manual"], default="weekly")
    parser.add_argument("--project")
    parser.add_argument("--task")
    parser.add_argument("--report")
    parser.add_argument("--file", type=Path)
    parser.add_argument("--threads-file", type=Path)
    args = parser.parse_args()
    if args.command == "baseline":
        result = baseline(args.root, read_json(args.threads_file) if args.threads_file else None)
    elif args.command == "prepare":
        result = prepare(args.root, args.scope, args.project, thread_activity=read_json(args.threads_file) if args.threads_file else None)
    elif args.command == "ack":
        result = acknowledge(args.root, args.report)
    elif args.command == "overview":
        result = overview(args.root)
    elif args.command == "handoff":
        result = handoff(args.root, args.task)
    elif args.command == "share-export":
        result = share_export(args.root, args.project)
    else:
        require(args.file and args.file.stat().st_size <= 1024 * 1024, "共享包过大或缺少文件")
        result = share_preview(args.root, read_json(args.file))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except (GateError, ValueError, TypeError, KeyError, OSError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

