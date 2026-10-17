"""Repository-local task ledger gate. No business API calls are made here."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
import os
import posixpath
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

STAGES = {"待澄清", "已确认", "执行中", "本地验证通过", "已部署", "业务验收通过", "阻塞", "已停用"}
TERMINAL = {"业务验收通过", "已停用"}
LOCK_STATES = {"占用中", "保留待核实", "已释放", "未申请"}
HEADING = re.compile(r"^## (TASK-\d{8}-\d{3})\s*$", re.M)
PROPERTY = re.compile(r"^- ([^：\n]+)：([^\n]*)$", re.M)
PROTECTED = {"任务编号", "owner_thread_id", "execution_id", "batch_key", "负责窗口", "lock_keys", "对象锁状态", "工作焦点", "恢复卡", "登记指纹"}


class GateError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def digest(value):
    data = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def clean(value):
    value = value.strip()
    return value[1:-1] if re.fullmatch(r"`[^`]*`", value) else value


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def default_root():
    if os.environ.get("TASK_CONTROL_ROOT"):
        return Path(os.environ["TASK_CONTROL_ROOT"]).resolve()
    root = Path(__file__).resolve().parents[1]
    try:
        process = subprocess.run(["git", "-C", str(root), "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True, timeout=5)
        common = Path(process.stdout.strip())
        if process.returncode == 0 and common.name == ".git" and (common.parent / "docs/task-ledger.md").exists():
            return common.parent.resolve()
    except (OSError, subprocess.TimeoutExpired):
        pass
    return root


def atomic_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with temporary.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


@contextmanager
def mutex(root, timeout=15):
    # The file persists; the OS releases the byte lock even after a process crash.
    path = Path(root) / "docs/.task-control/writer.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if path.stat().st_size == 0:
            handle.write(b"0")
            handle.flush()
        deadline = time.monotonic() + timeout
        while True:
            try:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                require(time.monotonic() < deadline, "账本正在被其他进程写入；稍后重试，不能另建任务。")
                time.sleep(0.05)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


class Task:
    def __init__(self, task_id, body, strict=True):
        self.id, self.body = task_id, body
        self.values = {}
        for match in PROPERTY.finditer(body):
            key, value = match.groups()
            require(not strict or key not in self.values, f"{task_id} 重复字段：{key}")
            self.values[key] = clean(value)

    @property
    def revision(self):
        return digest(self.id + self.body)[:16]

    def get(self, key, default=""):
        return self.values.get(key, default)

    def set(self, key, value):
        require(isinstance(key, str) and key == key.strip() and bool(key) and not re.search(r"[:：\r\n]", key), "字段名必须是无冒号、无换行的单行名称")
        require(isinstance(value, str) and "\n" not in value and "\r" not in value, f"{key} 必须是单行字符串")
        pattern = re.compile(r"^- " + re.escape(key) + r"：[^\n]*$", re.M)
        line = f"- {key}：{value}"
        if pattern.search(self.body):
            self.body = pattern.sub(lambda _: line, self.body)
        else:
            self.body = self.body.rstrip() + "\n" + line + "\n\n"
        self.values[key] = clean(value)

    def lock_keys(self):
        keys = json.loads(self.get("lock_keys", "[]"))
        require(isinstance(keys, list) and all(isinstance(k, str) and k.strip() for k in keys), f"{self.id} lock_keys 必须是非空字符串数组")
        normalized = [normalize_key(k) for k in keys]
        require(len(normalized) == len(set(normalized)), f"{self.id} 对象键重复")
        return normalized

    def summary(self):
        keys = ("目标", "业务域", "负责窗口", "当前阶段", "工作焦点", "对象锁状态", "下一步", "正式结果文件", "飞书结果链接", "核实说明", "恢复卡")
        return {"task_id": self.id, "revision": self.revision, **{k: self.get(k) for k in keys if self.get(k)}}


def normalize_key(key):
    require(isinstance(key, str) and not re.search(r"[\r\n]", key), "对象键必须是单行字符串")
    key = key.strip().replace("\\", "/").rstrip("/").casefold()
    if key.startswith("path:"):
        path = posixpath.normpath(key[5:])
        require(path not in {"", ".", ".."} and not path.startswith("../"), "路径锁必须明确且不能逃出项目根目录")
        key = "path:" + path
    require(key.startswith(("path:", "resource:")) and len(key.split(":", 1)[1]) > 0, "对象键必须以 path: 或 resource: 开头")
    return key


def overlaps(a, b):
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")


class Ledger:
    def __init__(self, text, strict=True):
        matches = list(HEADING.finditer(text))
        self.header = text[:matches[0].start()] if matches else text
        self.tasks = [Task(m[1], text[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(text)], strict) for i, m in enumerate(matches)]

    def find(self, task_id):
        found = [t for t in self.tasks if t.id == task_id]
        require(len(found) == 1, f"任务不存在或重号：{task_id}")
        return found[0]

    def validate(self):
        ids, batches, executions, focuses, locks = set(), {}, {}, {}, []
        for task in self.tasks:
            require(task.id not in ids, f"任务编号重复：{task.id}")
            ids.add(task.id)
            require(task.get("任务编号") == task.id, f"{task.id} 标题与任务编号不一致")
            require(task.get("当前阶段") in STAGES, f"{task.id} 非法阶段：{task.get('当前阶段')}")
            require(task.get("对象锁状态") in LOCK_STATES, f"{task.id} 缺少明确对象锁状态")
            require(task.get("工作焦点") in {"是", "否"}, f"{task.id} 缺少工作焦点状态")
            for key, seen in (("batch_key", batches), ("execution_id", executions)):
                value = task.get(key)
                require(value and value not in seen, f"{task.id} {key} 缺失或重复")
                seen[value] = task.id
            require(task.get("owner_thread_id"), f"{task.id} 缺少负责人")
            stage = task.get("当前阶段")
            require(stage not in TERMINAL or task.get("对象锁状态") in {"已释放", "未申请"}, f"{task.id} 已终结但仍持锁")
            if task.get("工作焦点") == "是":
                owner = task.get("owner_thread_id")
                require(stage not in TERMINAL and owner not in focuses, f"{task.id} 同一窗口有多个工作焦点或焦点已终结")
                focuses[owner] = task.id
            if task.get("对象锁状态") in {"占用中", "保留待核实"}:
                require(task.lock_keys(), f"{task.id} 持锁但没有规范对象键")
                for key in task.lock_keys():
                    for other_key, other in locks:
                        require(other == task.id or not overlaps(key, other_key), f"对象冲突：{task.id} 与 {other}：{key}")
                    locks.append((key, task.id))
        return {"tasks": len(ids), "active_focus": list(focuses.values()), "held_tasks": sorted({t for _, t in locks})}

    def render(self):
        return self.header.rstrip() + "\n\n" + "".join(f"## {t.id}\n{t.body.rstrip()}\n\n" for t in self.tasks)


def load_ledger(root):
    ledger = Ledger((Path(root) / "docs/task-ledger.md").read_text(encoding="utf-8-sig"))
    ledger.validate()
    return ledger


def persist(root, ledger):
    ledger.validate()
    rendered = ledger.render()
    Ledger(rendered).validate()
    atomic_write(Path(root) / "docs/task-ledger.md", rendered)


def card(task):
    fields = ("目标", "负责窗口", "owner_thread_id", "当前阶段", "工作焦点", "已完成", "剩余工作", "下一步", "正式结果文件", "验收证据", "阻塞原因")
    return f"# {task.id} 恢复卡\n\n自动生成的只读视图；事实主源为 docs/task-ledger.md。\n\n版本：{task.revision}\n\n" + "\n".join(f"- {k}：{task.get(k) or '未登记'}" for k in fields) + "\n"


def refresh_cards(root, ledger):
    for task in ledger.tasks:
        if task.get("恢复卡"):
            expected = f"docs/tasks/{task.id}.md"
            require(task.get("恢复卡") == expected, "恢复卡路径不合法")
            atomic_write(Path(root) / expected, card(task))


def register(root, spec):
    require(isinstance(spec, dict), "任务书必须是对象")
    required = ("业务域", "目标", "允许修改", "禁止修改", "负责窗口", "owner_thread_id", "execution_id", "batch_key", "验收标准", "下一步", "lock_keys")
    require(all(spec.get(k) for k in required), "任务书缺少必填字段")
    for key, value in spec.items():
        if key not in {"lock_keys", "complex"}:
            require(isinstance(value, str) and "\n" not in value and "\r" not in value, "任务字段必须为单行字符串")
    with mutex(root):
        ledger = load_ledger(root)
        previous = [t for t in ledger.tasks if t.get("batch_key") == spec["batch_key"]]
        if previous:
            task = previous[0]
            require(task.get("登记指纹") == digest(spec), "同一批次的任务书发生变化；必须核对原任务，不得再次登记")
            return {"created": False, **task.summary()}
        prefix = "TASK-" + datetime.now().strftime("%Y%m%d") + "-"
        sequence = max([int(t.id[-3:]) for t in ledger.tasks if t.id.startswith(prefix)] + [0]) + 1
        require(sequence <= 999, "当日任务序号用尽")
        task = Task(prefix + f"{sequence:03}", "\n")
        for key, value in spec.items():
            if key not in {"lock_keys", "complex"}:
                require(key not in {"任务编号", "当前阶段", "对象锁状态", "工作焦点", "恢复卡", "登记指纹"}, f"登记时不可自定义 {key}")
                task.set(key, value)
        for key, value in {"任务编号": task.id, "当前阶段": "已确认", "对象锁状态": "占用中", "lock_keys": json.dumps(spec["lock_keys"], ensure_ascii=False), "工作焦点": "否", "登记指纹": digest(spec), "最后更新时间": now()}.items():
            task.set(key, value)
        if spec.get("complex"):
            task.set("恢复卡", f"docs/tasks/{task.id}.md")
        ledger.tasks.append(task)
        persist(root, ledger)
        refresh_cards(root, ledger)
        return {"created": True, **task.summary()}


def mutate(root, task_id, owner, revision, changes, action="update", target="", checkpoint=None):
    with mutex(root):
        ledger = load_ledger(root)
        task = ledger.find(task_id)
        require(task.get("owner_thread_id") == owner, "不是本任务唯一执行负责人")
        require(task.revision == revision, "任务版本已变化；重新读取，不能覆盖新状态")
        require(not PROTECTED.intersection(changes), "受保护字段不可通过普通更新修改")
        require(task.get("当前阶段") not in TERMINAL, "已终结任务不能重新执行；新需求另建任务")
        for key, value in changes.items():
            task.set(key, value)
        require(action == "close" or task.get("当前阶段") not in TERMINAL, "终结任务只能使用 close，并提供验收结论")
        if action == "start":
            require(task.get("对象锁状态") == "占用中", "锁未确认，不允许开始写入")
            require(task.get("当前阶段") != "阻塞", "阻塞未解除，不允许开始")
            task.set("工作焦点", "是")
            task.set("当前阶段", "执行中")
        elif action == "claim":
            require(task.get("验收证据") and task.get("核实说明"), "续办前必须记录核对依据和证据；历史状态不能直接当作当前事实")
            task.set("对象锁状态", "占用中")
        elif action in {"pause", "switch"}:
            require(checkpoint and all(checkpoint.get(k) for k in ("已完成", "剩余工作", "下一步", "验收证据")), "切换前需保存已完成、剩余、下一步和证据入口")
            for key, value in checkpoint.items():
                require(key in {"已完成", "剩余工作", "下一步", "验收证据"}, "检查点字段不合法")
                task.set(key, value)
            task.set("工作焦点", "否")
            if action == "switch":
                other = ledger.find(target)
                require(other.id != task.id and other.get("owner_thread_id") == owner, "只能切换到同一负责人名下的另一任务")
                require(other.get("当前阶段") not in TERMINAL | {"阻塞"} and other.get("对象锁状态") == "占用中", "目标任务不可开始")
                other.set("工作焦点", "是")
                other.set("当前阶段", "执行中")
                other.set("最后更新时间", now())
        elif action == "release":
            require(task.get("验收证据") and task.get("释放依据"), "释放锁必须提供验收证据和释放依据")
            task.set("对象锁状态", "已释放")
            task.set("工作焦点", "否")
        require(action != "update" or task.get("当前阶段") not in TERMINAL, "完成/停用必须使用 close，并提供证据")
        if action == "close":
            require(task.get("当前阶段") in TERMINAL and task.get("验收证据") and task.get("验收结论"), "完成必须指定终态、验收证据与结论")
            require(task.get("当前阶段") != "业务验收通过" or task.get("验收结论") == "通过", "业务验收未通过")
            task.set("对象锁状态", "已释放")
            task.set("工作焦点", "否")
        task.set("最后更新时间", now())
        persist(root, ledger)
        refresh_cards(root, ledger)
        return task.summary()


def transfer(root, task_id, owner, revision, new_owner, new_name, acknowledgement):
    with mutex(root):
        ledger = load_ledger(root)
        task = ledger.find(task_id)
        require(task.get("owner_thread_id") == owner and task.revision == revision, "原负责人或版本不匹配")
        require(task.get("当前阶段") not in TERMINAL and task.get("工作焦点") == "否", "先由原执行方保存检查点并停止写入")
        require(all(task.get(k) for k in ("已完成", "剩余工作", "下一步", "验收证据")) and acknowledgement, "缺少原执行方停止回执和恢复检查点")
        task.set("转交依据", acknowledgement)
        task.set("owner_thread_id", new_owner)
        task.set("负责窗口", new_name)
        task.set("最后更新时间", now())
        persist(root, ledger)
        refresh_cards(root, ledger)
        return task.summary()


def register_window(root, task_id, owner, revision, entry):
    keys = ("业务域", "长期窗口", "thread_id", "恢复入口")
    require(isinstance(entry, dict) and set(entry) == set(keys), "窗口登记字段不完整")
    require(all(isinstance(entry[k], str) and entry[k].strip() and not re.search(r"[|\r\n]", entry[k]) for k in keys), "窗口登记必须为无换行、无竖线的字符串")
    with mutex(root):
        ledger = load_ledger(root)
        task = ledger.find(task_id)
        require(task.get("owner_thread_id") == owner and task.revision == revision, "负责人或版本不匹配")
        require(task.get("工作焦点") == "是" and task.get("对象锁状态") == "占用中" and task.get("当前阶段") == "执行中", "当前没有登记写入权")
        require("path:docs/task-ledger.md" in task.lock_keys(), "任务未锁定中央登记表")
        marker = "## 当前长期与专项窗口"
        require(marker in ledger.header, "缺少窗口登记表")
        before, section = ledger.header.split(marker, 1)
        table, after = section.split("\n## ", 1) if "\n## " in section else (section, None)
        rows = [line for line in table.splitlines() if line.startswith("|")]
        expected = f"| {entry['业务域']} | {entry['长期窗口']} | `{entry['thread_id']}` | `{entry['恢复入口']}` |"
        found = [line for line in rows[2:] if clean(line.split("|")[3].strip()) == entry["thread_id"]]
        require(len(found) <= 1, "窗口标识重复，需核对")
        if found:
            require(found[0] == expected, "窗口已存在但登记不同，请核实后单独更新")
            return {"registered": False, "thread_id": entry["thread_id"]}
        require(len(rows) >= 2, "窗口表结构不完整")
        table = table.rstrip() + "\n" + expected + "\n\n"
        ledger.header = before + marker + table + ("## " + after if after is not None else "")
        persist(root, ledger)
        return {"registered": True, "thread_id": entry["thread_id"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=default_root())
    parser.add_argument("command", choices=["check", "list", "show", "register", "register-window", "update", "claim", "start", "pause", "switch", "release", "close", "transfer", "assert-owner", "refresh-cards"])
    parser.add_argument("--task")
    parser.add_argument("--owner")
    parser.add_argument("--revision")
    parser.add_argument("--spec", type=Path)
    parser.add_argument("--patch", type=Path)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--to")
    parser.add_argument("--new-owner")
    parser.add_argument("--new-name")
    parser.add_argument("--ack")
    parser.add_argument("--execution")
    parser.add_argument("--batch")
    args = parser.parse_args()
    if args.command == "register":
        result = register(args.root, read_json(args.spec))
    elif args.command == "register-window":
        result = register_window(args.root, args.task, args.owner, args.revision, read_json(args.spec))
    elif args.command == "transfer":
        result = transfer(args.root, args.task, args.owner, args.revision, args.new_owner, args.new_name, args.ack)
    elif args.command in {"update", "claim", "start", "pause", "switch", "release", "close"}:
        result = mutate(args.root, args.task, args.owner, args.revision, read_json(args.patch) if args.patch else {}, args.command, args.to, read_json(args.checkpoint) if args.checkpoint else None)
    else:
        with mutex(args.root):
            ledger = load_ledger(args.root)
            if args.command == "check":
                result = ledger.validate()
            elif args.command == "list":
                result = [t.summary() for t in ledger.tasks if t.get("当前阶段") not in TERMINAL and (not args.owner or t.get("owner_thread_id") == args.owner)]
            elif args.command == "refresh-cards":
                refresh_cards(args.root, ledger)
                result = {"refreshed": True}
            else:
                task = ledger.find(args.task)
                if args.command == "assert-owner":
                    require(task.get("owner_thread_id") == args.owner and task.get("execution_id") == args.execution and task.get("batch_key") == args.batch, "负责人或执行批次不匹配")
                    require(task.get("对象锁状态") == "占用中" and task.get("工作焦点") == "是" and task.get("当前阶段") not in TERMINAL | {"阻塞"}, "当前没有写入权")
                    result = {"allowed": True, "task_id": task.id, "revision": task.revision}
                else:
                    result = {**task.summary(), "fields": task.values}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except (GateError, ValueError, OSError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

