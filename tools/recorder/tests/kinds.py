"""Shared by the pipeline tests. Read tests/README.md at the repo root first: every check is one of two kinds.

  guard(name, cond, detail)     true whatever the design is (mechanics, data integrity, honesty, safety).
                                A failed guard fails the run (exit code 1).
  behavior(name, cond, detail)  describes today's pencil design (a threshold, a wording, a policy). It is REPORTED as
                                "pass" or "changed" and NEVER changes the exit code. When the design changes on purpose,
                                rewrite or delete the behavior check; never bend the design to keep it green.

A check that mixes both is two checks. finish() prints the summary line tools/run_checks.py reads and exits.
"""
import sys

try:  # the tests run as `python -I` (ignores PYTHONUTF8), so say it here
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

_n = {"gp": 0, "gf": 0, "bm": 0, "bc": 0}
_rules = set()  # distinct guard names; gp/gf count every time one is checked


def guard(name, cond, detail=""):
    ok = bool(cond)
    _rules.add(name)
    _n["gp" if ok else "gf"] += 1
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))
    return ok


def behavior(name, cond, detail=""):
    ok = bool(cond)
    _n["bm" if ok else "bc"] += 1
    print(f"BEHAVIOR (current, pencil): {'pass' if ok else 'changed'} — {name}" + (f"  ({detail})" if detail and not ok else ""))
    return ok


def finish():
    print(f"GUARDS: {len(_rules)} rules, checked {_n['gp'] + _n['gf']} times: {_n['gp']} passed, {_n['gf']} failed. BEHAVIOR: {_n['bm']} matching, {_n['bc']} changed (reported only).")
    print(f"SUMMARY guards_passed={_n['gp']} guards_failed={_n['gf']} behavior_matching={_n['bm']} behavior_changed={_n['bc']} guard_rules={len(_rules)}")
    sys.exit(1 if _n["gf"] else 0)
