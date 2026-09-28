"""Shared-folder exchange, protocol version 2: rebuild findings.csv from the message files.

  python exchange_ledger.py <exdir>        rebuild; exit 2 if any accepted message was rejected on replay
  python exchange_ledger.py --selftest

All parsing and the two-party rule live in exchange_common.py, shared with the publisher, so a
message the ledger would reject is refused before it is ever published.
"""
import os
import sys
import json
import shutil
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exchange_common as X  # noqa: E402


def main(exdir):
    ledger, applied, rejected = X.rebuild(exdir)
    open_rows = [r for r in ledger.values() if not (r["position"] in ("agreed", "withdrawn") and r["remediation"] in ("verified", "pending") and r["position"] == "withdrawn")]
    need = [r for r in ledger.values() if r["remediation"] != "verified" and r["position"] != "withdrawn"]
    print(f"messages applied: {len(applied)}  findings: {len(ledger)}  still needing work: {len(need)}")
    for f, why in rejected:
        print(f"REJECTED {f}: {why}")
    return 2 if rejected else 0


def selftest():
    res = []

    def case(name, fn):
        try:
            ok = bool(fn())
        except Exception as e:  # noqa: BLE001
            ok, name = False, name + f"  [{type(e).__name__}: {str(e)[:80]}]"
        res.append((name, ok))

    def mk(rows_by_msg):
        d = tempfile.mkdtemp()
        json.dump({"protocol_version": 2, "participants": ["claude", "reviewer"], "first_speaker": "claude",
                   "max_rounds": 12, "finding_prefix": "P"}, open(os.path.join(d, "thread.json"), "w"))
        open(os.path.join(d, "findings.seed.csv"), "w").write(",".join(X.LEDGER_COLS) + "\n")
        prev = "none"
        for i, (frm, delta) in enumerate(rows_by_msg, 1):
            to = "reviewer" if frm == "claude" else "claude"
            f = f"{i:03d}-from-{frm}-m.md"
            open(os.path.join(d, f), "w", encoding="utf-8", newline="\n").write(
                f"```text\nto: {to}\nfrom: {frm}\nround: {i:03d}\nre: {prev}\nstate: continue\nchanges: none\nrelies-on: none\n```\n\n"
                f"## Ledger delta\n\n| id | status | note |\n|---|---|---|\n{delta}\n")
            X.register(d, f, X.sha(os.path.join(d, f)))
            prev = f
        return d

    def t_new_requires_NEW():
        d = mk([("claude", "| P001 | position=agreed | not marked new |")])
        try:
            _, applied, rejected = X.rebuild(d); return not applied and rejected
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("an unknown finding without NEW: rejects the whole message", t_new_requires_NEW)

    def t_whole_message():
        d = mk([("claude", "| P001 | position=unresolved evidence=unchecked remediation=pending | NEW: a |\n| P002 | position=nonsense | NEW: b |")])
        try:
            led, applied, rejected = X.rebuild(d); return "P001" not in led and rejected
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("one bad row rejects the whole message; the good row is not applied", t_whole_message)

    def t_replay_order():
        d = mk([("claude", "| P001 | position=unresolved evidence=unchecked remediation=pending | NEW: a |"),
                ("reviewer", "| P001 | position=disputed | no |"),
                ("claude", "| P001 | position=agreed | yes |")])
        try:
            led, applied, rejected = X.rebuild(d); return led["P001"]["position"] == "agreed" and led["P001"]["last_round"] == "003" and not rejected
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("deltas replay in round order; last write wins", t_replay_order)

    def t_atomic_output():
        d = mk([("claude", "| P001 | position=unresolved evidence=unchecked remediation=pending | NEW: a |")])
        try:
            X.rebuild(d); return os.path.exists(os.path.join(d, "findings.csv")) and not os.path.exists(os.path.join(d, "findings.csv.part"))
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("findings.csv is written atomically", t_atomic_output)

    for n, ok in res:
        print(f"  {'pass' if ok else 'FAIL'}  {n}")
    bad = [n for n, ok in res if not ok]
    print(f"\n{len(res) - len(bad)} of {len(res)} ledger self-test cases pass")
    return 1 if bad else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    sys.exit(main(sys.argv[1]))
