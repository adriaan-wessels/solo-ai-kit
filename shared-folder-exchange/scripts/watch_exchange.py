"""Shared-folder exchange, protocol version 2: deliver, acknowledge, gate, publish.

  python watch_exchange.py <exdir> <me> [timeout_s]      deliver the oldest unacknowledged
                                                          counterpart message, or wait
  python watch_exchange.py <exdir> <me> --ack <round|file> <sha256>
  python watch_exchange.py <exdir> <me> --may-write
  python watch_exchange.py <exdir> --publish <name.md.part>     the ONLY way a message is published
  python watch_exchange.py <exdir> --close-ack <proposal.md>    writes and publishes the close_ack
  python watch_exchange.py <exdir> --check-ruling <Rnn> | --check-control <Cnn>
  python watch_exchange.py --selftest

Every rule the reader applies, the publisher applies first (W-06). Author and round are DERIVED
from the filename and a disagreeing header is refused, never rewritten. The publisher writes the
pin table itself from `changes:` and `relies-on:`; nobody types a hash. A refused candidate stays
`.part` and costs no round. An accepted message is immutable; mistakes are corrected in the next
message (P-09). There is no blocked state and no retract (P-01, C-07).
"""
import json
import os
import re
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exchange_common as X  # noqa: E402


# ------------------------------------------------------------------- state
def state_path(exdir, me):
    return os.path.join(exdir, f".watch_state.{me}.json")


def load_state(exdir, me):
    p = state_path(exdir, me)
    try:
        return json.loads(X.read(p))
    except (OSError, ValueError):
        return {"acked": {}, "delivered": {}}


def save_state(exdir, me, st):
    p = state_path(exdir, me)
    tmp = p + ".part"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(st, fh, indent=2)
    os.replace(tmp, p)


# ---------------------------------------------------------------- delivery
def acked_integrity(exdir, st):
    """The reader's own record: bytes it acknowledged must be the bytes on disk (V001, second layer -
    catches a message that reached the folder without the publisher and so has no registry line)."""
    for f, h in st.get("acked", {}).items():
        p = os.path.join(exdir, f)
        if not os.path.exists(p):
            return (f, "an acknowledged message has vanished")
        if X.sha(p) != h:
            return (f, "an acknowledged message changed after acknowledgement")
    return None


def next_delivery(exdir, me, st, mf):
    ie = X.integrity_errors(exdir) or ([acked_integrity(exdir, st)] if acked_integrity(exdir, st) else [])
    if ie:
        return {"reason": "integrity", "file": ie[0][0], "detail": ie[0][1] + " - the thread stops until the researcher acts"}
    acc, rejected = X.accepted_messages(exdir, mf)
    for f, why in rejected:
        m = X.MSG_RE.match(f)
        if m and m.group(2) != me and f not in st["acked"]:
            return {"reason": "invalid", "file": f, "detail": why}
    for m in acc:
        if m["from_name"] == me or m["file"] in st["acked"]:
            continue
        h = X.sha(m["path"])
        st.setdefault("delivered", {})[m["file"]] = h
        save_state(exdir, me, st)
        hd = X.header(m["path"])
        return {"reason": hd.get("state", "continue"), "file": m["file"], "round": m["round"],
                "from": m["from_name"], "state": hd.get("state"), "sha256": h}
    return None


def watch(exdir, me, timeout_s):
    mf = X.manifest(exdir)
    st = load_state(exdir, me)
    t0 = time.time()
    while True:
        if os.path.exists(os.path.join(exdir, "STOP")):
            return {"reason": "STOP"}
        d = next_delivery(exdir, me, st, mf)
        if d:
            d["waited"] = round(time.time() - t0, 1)
            return d
        eff = X.effective(exdir, mf)
        if eff["status"] != "active":
            return {"reason": eff["status"], "detail": "matched control acks", "waited": round(time.time() - t0, 1)}
        if time.time() - t0 >= timeout_s:
            return {"reason": "timeout", "waited": round(time.time() - t0, 1)}
        time.sleep(min(20, max(1, timeout_s - (time.time() - t0))))


def ack(exdir, me, which, delivered_sha):
    st = load_state(exdir, me)
    target = None
    for m in X.messages(exdir):
        if m["file"] == which or m["round"] == which.zfill(3):
            target = m
    if not target:
        raise SystemExit(f"no message {which!r}")
    if target["from_name"] == me:
        raise SystemExit("you do not acknowledge your own message")
    known = st.get("delivered", {}).get(target["file"])
    if not known:
        raise SystemExit("acknowledge only what the watcher delivered")
    if delivered_sha.upper() != known or X.sha(target["path"]) != known:
        raise SystemExit("refusing: the file changed since delivery, or the hash you gave is not the delivered one")
    mf = X.manifest(exdir)
    acc, _ = X.accepted_messages(exdir, mf)
    if target["file"] not in {m["file"] for m in acc}:
        raise SystemExit("refusing: an invalid message cannot be acknowledged; its author publishes a corrected round")
    st["acked"][target["file"]] = known
    save_state(exdir, me, st)
    return target["file"]


def my_turn(exdir, me):
    mf = X.manifest(exdir)
    if os.path.exists(os.path.join(exdir, "STOP")):
        return False, "STOP file present"
    ie = X.integrity_errors(exdir) or ([acked_integrity(exdir, load_state(exdir, me))] if acked_integrity(exdir, load_state(exdir, me)) else [])
    if ie:
        return False, f"integrity: {ie[0][0]} {ie[0][1]}"
    acc, _ = X.accepted_messages(exdir, mf)
    eff = X.effective(exdir, mf)
    if eff["status"] != "active":
        return False, f"thread is {eff['status']}"
    if not acc:
        return (me == mf.get("first_speaker", me)), "thread is empty"
    last = acc[-1]
    if X.header(last["path"]).get("state") == "close_ack":
        return False, "thread is closed"
    if last["from_name"] == me:
        return False, f"newest message {last['round']} is yours; wait for the counterpart"
    st = load_state(exdir, me)
    if last["file"] not in st["acked"]:
        return False, f"acknowledge {last['file']} first"
    nxt = int(last["round"]) + 1
    if nxt > eff["max_rounds"] and X.header(last["path"]).get("state") != "propose_close":
        return False, f"max_rounds: {nxt} > {eff['max_rounds']}"
    return True, f"reply to {last['file']} as round {nxt:03d}"


# ---------------------------------------------------------------- publish
def publish(exdir, part_path):
    if not part_path.endswith(".md.part"):
        raise SystemExit("publish expects <name>.md.part")
    mf = X.manifest(exdir)
    final = os.path.basename(part_path)[:-5]
    fm = X.MSG_RE.match(final)
    if not fm:
        raise SystemExit("filename must be NNN-from-<participant>-<topic>.md.part")
    rnd, author = fm.group(1), fm.group(2)
    if author not in mf["participants"]:
        raise SystemExit(f"{author!r} is not a participant")
    text = X.read(part_path)
    h = X.header(part_path)
    if not h:
        raise SystemExit("refusing: no parseable header (first fenced block, three backticks)")
    if h.get("round") != rnd or h.get("from") != author:
        raise SystemExit(f"refusing: header round/from disagree with the filename ({rnd}/{author}); fix the header")
    ok, why = my_turn(exdir, author)
    if not ok and not (h.get("state") == "close_ack" and "max_rounds" in why):
        raise SystemExit(f"refusing: not {author}'s turn: {why}")
    # generate the pin table from the declared lists (P-11); hand-typed pins are replaced
    declared = X.split_list(h.get("changes", "")) + X.split_list(h.get("relies-on", ""))
    dup = sorted({d for d in declared if declared.count(d) > 1})
    if dup:
        raise SystemExit(f"refusing: path declared twice: {dup}")
    root = X.root_of(exdir)
    for rel in declared:
        p = os.path.join(root, rel.replace("/", os.sep))
        if os.path.isfile(p) and rel.endswith((".md", ".py", ".csv", ".json", ".txt")):
            raw = open(p, "rb").read()
            if b"\r\n" in raw and b"\n" in raw.replace(b"\r\n", b""):
                print(f"warning: {rel} has mixed line endings (hash basis unchanged)", file=sys.stderr)
    # remove any author-written basis block (only a standalone heading counts), then insert ours
    text = re.sub(r"^## Review basis[ \t]*\n(?:\n|\| file \| SHA-256 \|\n|\|---\|---\|\n|\| `[^`]+` \| `[0-9A-Fa-f]{64}` \|\n)*", "", text, flags=re.M)
    table = X.make_pin_table(root, declared) if declared else "| file | SHA-256 |\n|---|---|"
    block = "## Review basis\n\n" + table + "\n\n"
    if h.get("state") == "close_ack" and not X.LEDGER_HEADING.search(text):
        text = text.rstrip("\n") + "\n\n" + block
    else:
        try:
            i = X.ledger_section(text)                      # V010: the one standalone heading, never a substring
        except X.ProtocolError as e:
            raise SystemExit(f"refusing to publish: {e}")
        text = text[:i] + block + text[i:]
    tmp_part = part_path + ".candidate"
    with open(tmp_part, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    # validate the candidate in a temporary view of the thread with the reader's own function
    view = tempfile.mkdtemp()
    try:
        for f in os.listdir(exdir):
            s = os.path.join(exdir, f)
            if os.path.isfile(s) and (X.MSG_RE.match(f) or X.ACK_RE.match(f) or f in ("thread.json", "findings.seed.csv", X.REGISTRY)):
                shutil.copy2(s, os.path.join(view, f))
        shutil.copy2(tmp_part, os.path.join(view, final))
        X.register(view, final, X.sha(tmp_part))            # V011: explicit candidate registration in the dry-run view only
        prior, _ = X.accepted_messages(exdir, mf)
        # pins must match the REAL root, so validate against exdir's root with the candidate text
        cand_real = {"file": final, "path": tmp_part, "round": rnd, "from_name": author}
        err = X.validate(exdir, cand_real, mf, prior, is_candidate=True)
        if err:
            raise SystemExit(f"refusing to publish: {err}")
        # replay the ledger with the candidate included; a bad delta row refuses publication
        shutil.copy2(os.path.join(exdir, "findings.seed.csv"), os.path.join(view, "findings.seed.csv")) \
            if os.path.exists(os.path.join(exdir, "findings.seed.csv")) else None
        _, applied, rejected = X.rebuild(view, mf)
        bad = [why for f, why in rejected if f == final]
        if bad:
            raise SystemExit(f"refusing to publish: the ledger rejects this message on replay: {bad[0]}")
    finally:
        shutil.rmtree(view, ignore_errors=True)
    # V011 fail-safe order: register the bytes FIRST, then make the file visible. A crash between the two
    # leaves a registry line with no file, which reads as 'vanished' (integrity), never as an admitted
    # unregistered message.
    X.register(exdir, final, X.sha(tmp_part))
    os.replace(tmp_part, os.path.join(exdir, final))
    os.remove(part_path)
    X.rebuild(exdir, mf)
    return final


def close_ack(exdir, proposal):
    mf = X.manifest(exdir)
    prop = [m for m in X.messages(exdir) if m["file"] == os.path.basename(proposal)]
    if not prop:
        raise SystemExit("no such proposal")
    prop = prop[0]
    if X.header(prop["path"]).get("state") != "propose_close":
        raise SystemExit("that message is not a propose_close")
    me = X.counterpart(mf, prop["from_name"])
    rnd = f"{int(prop['round']) + 1:03d}"
    name = f"{rnd}-from-{me}-close-ack.md.part"
    body = (f"```text\nto: {prop['from_name']}\nfrom: {me}\nround: {rnd}\nre: {prop['file']}\n"
            f"state: close_ack\nchanges: none\nrelies-on: none\n```\n\n# close_ack\n\nClosure accepted.\n")
    p = os.path.join(exdir, name)
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    return publish(exdir, p)


# ----------------------------------------------------------------- selftest
def selftest():
    import datetime as dt
    res = []

    def case(name, fn):
        try:
            ok = bool(fn())
        except (Exception, SystemExit) as e:  # noqa: BLE001
            ok = False
            name += f"  [{type(e).__name__}: {str(e)[:80]}]"
        res.append((name, ok))

    def thread(*msgs, mf_extra=None, files=None):
        d = tempfile.mkdtemp()
        mf = {"protocol_version": 2, "participants": ["claude", "reviewer"], "first_speaker": "claude",
              "max_rounds": 12, "deadline": "2099-01-01T00:00:00Z", "finding_prefix": "P"}
        mf.update(mf_extra or {})
        json.dump(mf, open(os.path.join(d, "thread.json"), "w"))
        open(os.path.join(d, "findings.seed.csv"), "w").write(",".join(X.LEDGER_COLS) + "\n")
        for rel, content in (files or {}).items():
            with open(os.path.join(os.path.dirname(d), rel), "w") as fh:
                fh.write(content)
        for fname, (to, frm, rnd, re_, st, delta) in msgs:
            with open(os.path.join(d, fname), "w", encoding="utf-8", newline="\n") as fh:
                fh.write(f"```text\nto: {to}\nfrom: {frm}\nround: {rnd}\nre: {re_}\nstate: {st}\n"
                         f"changes: none\nrelies-on: none\n```\n\nbody\n\n## Review basis\n\n| file | SHA-256 |\n|---|---|\n\n"
                         f"## Ledger delta\n\n| id | status | note |\n|---|---|---|\n{delta}\n")
            X.register(d, fname, X.sha(os.path.join(d, fname)))     # fixtures stand in for the publisher
        return d

    R1 = "| P001 | position=unresolved evidence=unchecked remediation=pending | NEW: something |"

    def t_publish_out_of_turn():  # I01
        d = thread(("001-from-claude-a.md", ("reviewer", "claude", "001", "none", "continue", R1)))
        try:
            p = os.path.join(d, "002-from-claude-b.md.part")
            open(p, "w").write("```text\nto: reviewer\nfrom: claude\nround: 002\nre: 001-from-claude-a.md\nstate: continue\nchanges: none\nrelies-on: none\n```\n\n## Ledger delta\n\n| id | status | note |\n|---|---|---|\n")
            try:
                publish(d, p); return False
            except SystemExit as e:
                return "turn" in str(e) and os.path.exists(p)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("I01: publisher refuses an out-of-turn message; .part survives", t_publish_out_of_turn)

    def t_header_mismatch():  # I08-class: identity derived and validated, never rewritten
        d = thread()
        try:
            p = os.path.join(d, "001-from-claude-a.md.part")
            open(p, "w").write("```text\nto: reviewer\nfrom: reviewer\nround: 001\nre: none\nstate: continue\nchanges: none\nrelies-on: none\n```\n\n## Ledger delta\n\n| id | status | note |\n|---|---|---|\n")
            try:
                publish(d, p); return False
            except SystemExit as e:
                return "disagree" in str(e)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("identity: header disagreeing with filename is refused, not rewritten", t_header_mismatch)

    def t_bad_fence():  # I07
        d = thread()
        try:
            p = os.path.join(d, "001-from-claude-a.md.part")
            open(p, "w").write("`text\nto: reviewer\nfrom: claude\nround: 001\n`\n")
            try:
                publish(d, p); return False
            except SystemExit as e:
                return "header" in str(e) and os.path.exists(p)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("I07: a bad fence fails while still .part and costs no round", t_bad_fence)

    def t_bad_delta_row():  # I03 trigger: the ledger replay refuses at publish
        d = thread()
        try:
            p = os.path.join(d, "001-from-claude-a.md.part")
            open(p, "w").write("```text\nto: reviewer\nfrom: claude\nround: 001\nre: none\nstate: continue\nchanges: none\nrelies-on: none\n```\n\n## Ledger delta\n\n| id | status | note |\n|---|---|---|\n| P001 | position=bogus | x |\n")
            try:
                publish(d, p); return False
            except SystemExit as e:
                return "position" in str(e)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("a malformed delta row is refused at publish", t_bad_delta_row)

    def t_generated_pins():  # P-11: publisher writes the pin table; hand pins replaced
        d = thread(files={"pinned.txt": "hello"})
        try:
            p = os.path.join(d, "001-from-claude-a.md.part")
            open(p, "w").write("```text\nto: reviewer\nfrom: claude\nround: 001\nre: none\nstate: continue\nchanges: none\nrelies-on: pinned.txt\n```\n\nbody\n\n## Ledger delta\n\n| id | status | note |\n|---|---|---|\n" + R1 + "\n")
            f = publish(d, p)
            t = X.read(os.path.join(d, f))
            return dict(X.pins(t)) == {"pinned.txt": X.sha_text("hello")}
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("P-11: publisher generates the pin table from relies-on", t_generated_pins)

    def t_two_party():
        d = thread(("001-from-claude-a.md", ("reviewer", "claude", "001", "none", "continue", R1)),
                   ("002-from-reviewer-b.md", ("claude", "reviewer", "002", "001-from-claude-a.md", "continue",
                                               "| P001 | remediation=implemented | did it |")),
                   ("003-from-claude-c.md", ("reviewer", "claude", "003", "002-from-reviewer-b.md", "continue",
                                             "| P001 | remediation=verified | verified by counterpart |")),
                   ("004-from-reviewer-d.md", ("claude", "reviewer", "004", "003-from-claude-c.md", "continue",
                                               "| P001 | position=agreed | |")))
        try:
            led, applied, rejected = X.rebuild(d)
            ok1 = led["P001"]["verified_by"] == "claude" and "003-from-claude-c.md" in applied
            # self-verification refused
            d2 = thread(("001-from-claude-a.md", ("reviewer", "claude", "001", "none", "continue", R1)),
                        ("002-from-reviewer-b.md", ("claude", "reviewer", "002", "001-from-claude-a.md", "continue",
                                                    "| P001 | remediation=implemented | did it |")),
                        ("003-from-claude-c.md", ("reviewer", "claude", "003", "002-from-reviewer-b.md", "continue", "| P001 | position=agreed | |")),
                        ("004-from-reviewer-d.md", ("claude", "reviewer", "004", "003-from-claude-c.md", "continue",
                                                    "| P001 | remediation=verified | self |")))
            _, _, rej2 = X.rebuild(d2)
            shutil.rmtree(d2, ignore_errors=True)
            return ok1 and any("004" in f for f, _ in rej2)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("two-party closure: counterpart verifies; self-verification rejects the whole message", t_two_party)

    def t_control_pause():  # P-02/P-07: pause only via matched control acks; unmatched is pending
        d = thread(("001-from-claude-a.md", ("reviewer", "claude", "001", "none", "continue", R1)))
        try:
            s = "Control C01: pause"
            for who in ("claude", "reviewer"):
                open(os.path.join(d, f"control-ack-from-{who}-C01.md"), "w").write(f"```\n{s}\n```\nsha256: {X.sha_text(s)}\n")
            mf = X.manifest(d)
            paused = X.effective(d, mf)["status"] == "paused" and X.check_ack(d, mf, "control", "C01")[0] == "match"
            # mismatch does not pause
            open(os.path.join(d, "control-ack-from-reviewer-C01.md"), "w").write(f"```\n{s} now\n```\nsha256: {X.sha_text(s + ' now')}\n")
            unp = X.effective(d, mf)["status"] == "active" and X.check_ack(d, mf, "control", "C01")[0] == "mismatch"
            return paused and unp
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("I05/I06: a pause takes effect only on MATCHED control acks; mismatch changes nothing", t_control_pause)

    def t_ruling_pending():
        d = thread()
        try:
            s = "Ruling R01 (scope): approve."
            open(os.path.join(d, "ruling-ack-from-claude-R01.md"), "w").write(f"```\n{s}\n```\nsha256: {X.sha_text(s)}\n")
            return X.check_ack(d, X.manifest(d), "ruling", "R01")[0] == "pending"
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("I05: one ack alone is pending, never a ruling", t_ruling_pending)

    def t_cap_close_ack():
        d = thread(("001-from-claude-a.md", ("reviewer", "claude", "001", "none", "continue", R1)),
                   ("002-from-reviewer-b.md", ("claude", "reviewer", "002", "001-from-claude-a.md", "propose_close", "")),
                   mf_extra={"max_rounds": 2})
        try:
            ok, why = my_turn(d, "claude")
            st = load_state(d, "claude"); st["acked"]["002-from-reviewer-b.md"] = X.sha(os.path.join(d, "002-from-reviewer-b.md")); save_state(d, "claude", st)
            f = close_ack(d, os.path.join(d, "002-from-reviewer-b.md"))
            return f == "003-from-claude-close-ack.md" and X.accepted_messages(d)[1] == []
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("W-04: --close-ack publishes the one message permitted past the cap", t_cap_close_ack)

    def t_policy_marker():
        d = thread(mf_extra={"review_policy": {"table_cell_marker": {"if_any_word": ["examiner"], "require": "[inference"}}})
        try:
            p = os.path.join(d, "001-from-claude-a.md.part")
            open(p, "w").write("```text\nto: reviewer\nfrom: claude\nround: 001\nre: none\nstate: continue\nchanges: none\nrelies-on: none\n```\n\n| a | an examiner would say |\n\n## Ledger delta\n\n| id | status | note |\n|---|---|---|\n" + R1 + "\n")
            try:
                publish(d, p); return False
            except SystemExit as e:
                return "review_policy" in str(e)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("P-10: a declarative review_policy invariant refuses at publish", t_policy_marker)

    def t_wrong_version():
        d = thread(mf_extra={"protocol_version": 1})
        try:
            X.manifest(d); return False
        except X.ProtocolError as e:
            return "protocol_version" in str(e)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("W-07: a version-1 manifest is refused by version-2 scripts", t_wrong_version)

    def t_ack_mutation():
        d = thread(("001-from-claude-a.md", ("reviewer", "claude", "001", "none", "continue", R1)))
        try:
            dd = watch(d, "reviewer", 0)
            open(os.path.join(d, dd["file"]), "a").write("mutated\n")
            try:
                ack(d, "reviewer", dd["file"], dd["sha256"]); return False
            except SystemExit as e:
                return "changed" in str(e)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("ack refuses a file that changed after delivery", t_ack_mutation)

    # --- first independent verification of version 2: nine defects, one named case each
    def pub(d, name, hdr_extra, body, delta):
        p = os.path.join(d, name + ".part")
        open(p, "w", encoding="utf-8", newline="\n").write(hdr_extra + "\n\n" + body + ("\n\n## Ledger delta\n\n| id | status | note |\n|---|---|---|\n" + delta + "\n" if delta is not None else "\n"))
        return publish(d, p)
    H = lambda to, frm, rnd, re_, st: f"```text\nto: {to}\nfrom: {frm}\nround: {rnd}\nre: {re_}\nstate: {st}\nchanges: none\nrelies-on: none\n```"
    def t_v001():
        d = thread()
        try:
            pub(d, "001-from-claude-a.md", H("reviewer", "claude", "001", "none", "continue"), "body", R1)
            dd = watch(d, "reviewer", 0); ack(d, "reviewer", "001", dd["sha256"])
            open(os.path.join(d, "001-from-claude-a.md"), "a", encoding="utf-8").write("\nprose changed\n")
            w1 = watch(d, "reviewer", 0)
            try:
                X.rebuild(d); replay_stopped = False
            except X.IntegrityError:
                replay_stopped = True
            return w1["reason"] == "integrity" and replay_stopped and not my_turn(d, "reviewer")[0]
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("V001: one changed byte in a published message is fatal to delivery, replay and writing", t_v001)
    def t_v002():
        d = thread()
        try:
            pub(d, "001-from-claude-a.md", H("reviewer", "claude", "001", "none", "continue"), "body", R1)
            s = "Control C01: pause"
            for who in ("claude", "reviewer"):
                open(os.path.join(d, f"control-ack-from-{who}-C01.md"), "w").write(f"```\n{s}\n```\nsha256: {X.sha_text(s)}\n")
            acc, rej = X.accepted_messages(d)
            mf = json.load(open(os.path.join(d, "thread.json"))); mf["deadline"] = "2000-01-01T00:00:00Z"; json.dump(mf, open(os.path.join(d, "thread.json"), "w"))
            acc2, rej2 = X.accepted_messages(d)
            return len(acc) == 1 and not rej and len(acc2) == 1 and not rej2 and not my_turn(d, "reviewer")[0]
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("V002: pause and expired deadline stop new work but never invalidate accepted history", t_v002)
    def t_v003():
        d = thread(("001-from-reviewer-a.md", ("claude", "reviewer", "001", "none", "continue", R1)))
        d2 = thread(("001-from-claude-a.md", ("reviewer", "claude", "001", "none", "close_ack", "")))
        try:
            return X.accepted_messages(d)[0] == [] and X.accepted_messages(d2)[0] == []
        finally:
            shutil.rmtree(d, ignore_errors=True); shutil.rmtree(d2, ignore_errors=True)
    case("V003: reader rejects a wrong first speaker and an orphan round-001 close_ack", t_v003)
    def t_v004():
        d = thread(("001-from-claude-a.md", ("reviewer", "claude", "001", "none", "continue", R1)),
                   ("002-from-reviewer-b.md", ("claude", "reviewer", "002", "001-from-claude-a.md", "continue",
                                               "| P001 | position=agreed | row one |\n| P001 | remediation=verified | no implementer |")))
        try:
            led, applied, rejected = X.rebuild(d)
            return led["P001"]["position"] == "unresolved" and applied == ["001-from-claude-a.md"] and any("002" in f for f, _ in rejected)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("V004: a failing later row leaves earlier rows untouched (whole-message transaction)", t_v004)
    def t_v007():
        d = thread(("001-from-claude-a.md", ("reviewer", "claude", "001", "none", "continue",
                                             "| X001 | position=unresolved evidence=unchecked remediation=pending | NEW: wrong prefix |")), mf_extra={"finding_prefix": "P"})
        try:
            acc, rej = X.accepted_messages(d); return acc == [] and "prefix" in rej[0][1]
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("V007: a finding id with the wrong prefix is rejected at read and publish", t_v007)
    def t_v008():
        d = thread()
        try:
            p = os.path.join(d, "001-from-claude-a.md.part")
            open(p, "w").write(H("reviewer", "claude", "001", "none", "continue") + "\n\nno table\n")
            try:
                publish(d, p); return False
            except SystemExit as e:
                return "Ledger delta" in str(e)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("V008: an ordinary message without a Ledger delta section is refused", t_v008)
    def t_v009():
        d = thread(mf_extra={"review_policy": {"tier": "not-a-tier"}})
        try:
            X.manifest(d); return False
        except X.ProtocolError as e:
            return "tier" in str(e)
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("V009: review_policy.tier must be science or procedural", t_v009)

    def t_v010():
        d = thread()
        try:
            body = "The phrase ## Ledger delta appears inline here and must survive."
            pub(d, "001-from-claude-a.md", H("reviewer", "claude", "001", "none", "continue"), body, R1)
            t = X.read(os.path.join(d, "001-from-claude-a.md"))
            one_basis = len(X.BASIS_HEADING.findall(t)) == 1 and len(X.LEDGER_HEADING.findall(t)) == 1
            order = t.index("## Review basis") < X.ledger_section(t) and body in t
            p = os.path.join(d, "002-from-reviewer-b.md.part")
            open(p, "w").write(H("claude", "reviewer", "002", "001-from-claude-a.md", "continue") + "\n\n## Ledger delta\n\nx\n\n## Ledger delta\n\n| id | status | note |\n|---|---|---|\n")
            dd = watch(d, "reviewer", 0); ack(d, "reviewer", "001", dd["sha256"])
            try:
                publish(d, p); dup_refused = False
            except SystemExit as e:
                dup_refused = "exactly one" in str(e)
            return one_basis and order and dup_refused
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("V010: inline mention survives; one basis before the one real heading; duplicate headings refused", t_v010)
    def t_v011():
        d = thread()
        try:
            open(os.path.join(d, "001-from-claude-a.md"), "w", encoding="utf-8", newline="\n").write(
                H("reviewer", "claude", "001", "none", "continue") + "\n\nbody\n\n## Ledger delta\n\n| id | status | note |\n|---|---|---|\n" + R1 + "\n")
            w1 = watch(d, "reviewer", 0)
            try:
                X.rebuild(d); replay_ok = True
            except X.IntegrityError:
                replay_ok = False
            return w1["reason"] == "integrity" and not replay_ok and not my_turn(d, "reviewer")[0]
        finally:
            shutil.rmtree(d, ignore_errors=True)
    case("V011: a correctly shaped message with no registry entry is fatal to delivery, replay and writing", t_v011)

    for n, ok in res:
        print(f"  {'pass' if ok else 'FAIL'}  {n}")
    bad = [n for n, ok in res if not ok]
    print(f"\n{len(res) - len(bad)} of {len(res)} watcher self-test cases pass")
    return 1 if bad else 0


# ---------------------------------------------------------------------- CLI
if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        sys.exit(selftest())
    exdir = a[0]
    try:
        if "--publish" in a:
            print(publish(exdir, a[a.index("--publish") + 1])); sys.exit(0)
        if "--close-ack" in a:
            print(close_ack(exdir, a[a.index("--close-ack") + 1])); sys.exit(0)
        for kind, flag in (("ruling", "--check-ruling"), ("control", "--check-control")):
            if flag in a:
                st, have = X.check_ack(exdir, X.manifest(exdir), kind, a[a.index(flag) + 1])
                print(json.dumps({"result": st, "acks": sorted(have)})); sys.exit(0 if st == "match" else 3)
        me = a[1]
        if "--ack" in a:
            k = a.index("--ack"); print(f"{me} acknowledged {ack(exdir, me, a[k + 1], a[k + 2])}"); sys.exit(0)
        if "--may-write" in a:
            ok, why = my_turn(exdir, me); print(json.dumps({"may_write": ok, "why": why})); sys.exit(0 if ok else 3)
        tmo = float(a[2]) if len(a) > 2 else 1500
        print(json.dumps(watch(exdir, me, tmo), indent=2))
    except X.ProtocolError as e:
        raise SystemExit(f"protocol: {e}")
