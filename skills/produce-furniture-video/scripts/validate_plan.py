"""Validate declared edit-plan invariants; never claim media or native review."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re
import sys


def validate(plan):
    errors = []

    def require(condition, message):
        if not condition:
            errors.append(message)

    def number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    if not isinstance(plan, dict):
        return ["plan must be a JSON object"]
    for key in ("task_id", "project_id", "account_id"):
        require(isinstance(plan.get(key), str) and bool(plan[key].strip()), f"missing {key}")
    require(plan.get("output_aspect") == "9:16", "output must be 9:16")
    fps = plan.get("fps")
    if not number(fps) or fps <= 0:
        return errors + ["fps must be positive and finite"]
    shots = plan.get("shots")
    if not isinstance(shots, list) or not shots:
        return errors + ["shots must be a nonempty array"]
    ids, hashes, shot_ids = set(), set(), set()
    previous_end = 0
    for index, shot in enumerate(shots, 1):
        label = f"shot {index}"
        if not isinstance(shot, dict):
            errors.append(f"{label}: must be an object")
            continue
        for field, seen in (("shot_id", shot_ids), ("source_id", ids), ("source_sha256", hashes)):
            value = shot.get(field)
            require(isinstance(value, str) and bool(value), f"{label}: missing {field}")
            if isinstance(value, str):
                normalized = value.lower() if field == "source_sha256" else value
                require(normalized not in seen, f"{label}: repeated {field}")
                seen.add(normalized)
        require(bool(re.fullmatch(r"[0-9a-fA-F]{64}", str(shot.get("source_sha256", "")))), f"{label}: invalid SHA256")
        path = shot.get("source_path")
        require(isinstance(path, str) and bool(path.strip()), f"{label}: missing source path")
        require("\u6682\u65f6\u4e0d\u53ef\u7528" not in str(path), f"{label}: excluded folder")
        require(shot.get("source_aspect") == "9:16", f"{label}: source must be 9:16")
        for field in ("caption", "visible_evidence"):
            require(isinstance(shot.get(field), str) and bool(shot[field].strip()), f"{label}: missing {field}")
        start, end = shot.get("start_frame"), shot.get("end_frame")
        if not all(isinstance(v, int) and not isinstance(v, bool) for v in (start, end)):
            errors.append(f"{label}: frame boundaries must be integers")
            continue
        require(start == previous_end and end > start, f"{label}: gap, overlap or invalid duration")
        previous_end = end
        seconds = (end - start) / fps
        require(seconds <= 4 + 1e-8, f"{label}: duration exceeds 4 seconds")
        quick = shot.get("quick_cut")
        require(isinstance(quick, bool), f"{label}: quick_cut must be boolean")
        if quick is True:
            products = shot.get("listed_products")
            valid_products = isinstance(products, list) and all(isinstance(p, str) and p.strip() for p in products)
            require(valid_products and len(set(products)) >= 2, f"{label}: quick cut needs distinct product list")
            if valid_products:
                require(all(p in shot.get("caption", "") for p in products), f"{label}: product list absent from caption")
                require(shot.get("matched_product") in products, f"{label}: unmatched quick-cut product")
            require(bool(shot.get("quick_cut_reason")), f"{label}: missing quick-cut reason")
        else:
            require(seconds >= 1.5 - 1e-8, f"{label}: ordinary shot below 1.5 seconds")
        a, b, duration = (shot.get(k) for k in ("source_start_seconds", "source_end_seconds", "source_duration_seconds"))
        if not all(number(v) for v in (a, b, duration)):
            errors.append(f"{label}: invalid source time metadata")
            continue
        require(0 <= a < b <= duration, f"{label}: source interval out of bounds")
        require(abs((b - a) - seconds) <= 1 / fps + 1e-8, f"{label}: source and output duration differ; no hidden retiming")
        pretrimmed = shot.get("pretrimmed_verified", False)
        require(isinstance(pretrimmed, bool), f"{label}: invalid pretrimmed flag")
        if pretrimmed is True:
            require(bool(shot.get("trim_evidence")), f"{label}: pretrimmed source lacks provenance")
        else:
            margin_ok = a >= 1 - 1e-8 and b <= duration - 1 + 1e-8
            exception = shot.get("short_source_exception")
            approved = isinstance(exception, dict) and exception.get("approved") is True and bool(exception.get("evidence"))
            require(margin_ok or approved, f"{label}: head/tail margin missing or exception unapproved")
    total = plan.get("total_frames")
    require(isinstance(total, int) and not isinstance(total, bool) and total == previous_end and total > 0, "total_frames mismatch")
    texts = plan.get("texts")
    require(isinstance(texts, list) and bool(texts), "texts must be a nonempty array")
    material_ids, segment_ids = set(), set()
    if isinstance(texts, list):
        for index, item in enumerate(texts, 1):
            if not isinstance(item, dict):
                errors.append(f"text {index}: must be an object")
                continue
            for key, seen in (("material_id", material_ids), ("segment_id", segment_ids)):
                value = item.get(key)
                require(isinstance(value, str) and bool(value), f"text {index}: missing {key}")
                if isinstance(value, str):
                    require(value not in seen, f"text {index}: linked/repeated {key}")
                    seen.add(value)
            require(item.get("subtitle_sync") is False and item.get("lyrics_sync") is False, f"text {index}: sync must be explicitly false")
            require(item.get("group_id") in (None, ""), f"text {index}: grouped text")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text(encoding="utf-8-sig"))
        errors = validate(plan)
    except (OSError, ValueError, TypeError) as error:
        errors = [str(error)]
    print(json.dumps({"passed": not errors, "scope": "declared-plan-only; media, semantic and native review are separate", "errors": errors}, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
