"""Shared-folder Communications Protocol (SCP): two AI agents taking turns through numbered Markdown files in a shared folder.

For one person running two agents (for example Claude and ChatGPT) on the same computer. The person wants the agents
to pass messages over the walls of their separate products. Standard library only. All state is derived
from the files in the thread folder, so nothing is lost if an agent or its session restarts.
See PROTOCOL.md for the rules and their limits.

  python scp.py init    <thread> --participants A,B --first A --max-rounds N --deadline 2026-10-10T12:00:00Z --purpose "..."
  python scp.py status  <thread> <me>          whose turn, what is unread, and why
  python scp.py publish <thread> <draft.md>    check a draft and publish it (never overwrites)
  python scp.py watch   <folder> <me> <minutes> [--interval 60]
                                                     wait until it is <me>'s turn in any thread under <folder>,
                                                     a thread there is damaged, or every one is finished
  python scp.py check   <thread>               list any damage to the history (edits, missing or extra files, gaps)
  python scp.py selftest

Exit codes:
  0  ok / your turn
  1  refused or error
  2  watch timed out
  3  every watched thread is finished (closed, stopped, or past its cap or deadline with no live proposal).
     A finished thread is not necessarily closed by agreement.
  4  a watched thread has damaged history and no thread is ready.
     On exit 0, damaged threads are listed with the ready ones.
"""
import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
import time

STATES = ("continue", "propose_close", "close_ack")
NAME_RE = re.compile(r"^(\d{3})-from-([a-z0-9_]+)-[a-z0-9-]+\.md$")
LOG = "published.log"


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def parse_time(s):
    try:
        t = datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else None


def sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def header(text):
    """Parse the front-matter block: the text must start with '---', key: value lines, '---'."""
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or lines[0].strip() != "---":
        return None
    h = {}
    for ln in lines[1:]:
        if ln.strip() == "---":
            return h
        if ":" not in ln:
            return None
        k, v = ln.split(":", 1)
        h[k.strip()] = v.strip()
    return None


def manifest(thread):
    with open(os.path.join(thread, "thread.json"), encoding="utf-8") as fh:
        return json.load(fh)


MAX_CAP = 998            # three-digit rounds: a close_ack one past the cap is at most 999
ANY_MSG_RE = re.compile(r"^\d+-from-")
LOCK = ".publish.lock"


def check_manifest(mf):
    probs = []
    parts = mf.get("participants")
    if not (isinstance(parts, list) and len(parts) == 2 and all(isinstance(p, str) and re.fullmatch(r"[a-z0-9_]+", p) for p in parts)
            and parts[0] != parts[1]):
        probs.append("thread.json: participants must be two different lower-case names")
    elif mf.get("first_speaker") not in parts:
        probs.append("thread.json: first_speaker must be a participant")
    mr = mf.get("max_rounds")
    if not (isinstance(mr, int) and not isinstance(mr, bool) and 2 <= mr <= MAX_CAP):
        probs.append(f"thread.json: max_rounds must be an integer from 2 to {MAX_CAP}")
    if parse_time(mf.get("deadline")) is None:
        probs.append("thread.json: deadline must be an ISO time with a zone")
    return probs


LOG_LINE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)  ([0-9a-f]{64})  (\d{3}-from-[a-z0-9_]+-[a-z0-9-]+\.md)$")
STALE_LOCK_S = 600


def read_log(thread):
    """Returns (entries, problems). Every line must be complete and well formed; the file must end with a
    newline. A truncated or malformed line is damage, never skipped."""
    lp = os.path.join(thread, LOG)
    if not os.path.exists(lp):
        return [], []
    with open(lp, "rb") as fh:
        raw = fh.read()
    probs, logged = [], []
    if not raw:
        return [], []                                  # an empty log (for example, created then a failed write) holds no entries
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return [], [f"{LOG}: not valid UTF-8"]
    if text and not text.endswith("\n"):
        probs.append(f"{LOG}: the last line is incomplete (an interrupted write)")
    for i, ln in enumerate(text.split("\n")[:-1] if text.endswith("\n") else text.split("\n"), 1):
        m = LOG_LINE_RE.match(ln)
        if m:
            logged.append((m.group(3), m.group(2)))
        else:
            probs.append(f"{LOG} line {i}: malformed: {ln[:80]!r}")
    return logged, probs


def publish_in_progress(thread, own_lock=False):
    """(True, detail) while a live publish holds the lock; stale locks are not 'in progress'.
    own_lock=True is used by the publisher itself, which holds the lock while validating."""
    lp = os.path.join(thread, LOCK)
    if own_lock or not os.path.exists(lp):
        return False, None
    age = time.time() - os.path.getmtime(lp)
    if age > STALE_LOCK_S:
        return False, f"{LOCK} is {int(age)} s old: a publish probably crashed"
    return True, f"a publish is in progress ({LOCK}, {int(age)} s)"


RECHECK_S = 0.3
RECHECK_TRIES = 5


def inspect(thread, own_lock=False):
    """Messages in round order, plus every problem with the thread's history. Any problem means the
    history is damaged: nothing more is published until the operator repairs it (PROTOCOL.md sec. 2).
    A single pass reads the folder listing and the log at slightly different moments, so a publish that
    completes in between can look like damage. So after a pass that finds problems, it looks again 0.3 s
    later, up to five times: it returns as soon as a pass is clean or two consecutive passes find the same
    problems. If the problems keep changing through every recheck, it returns the last pass's problems.
    This is a bounded best effort, not an atomic snapshot; stable damage is always reported."""
    ms, probs = inspect_once(thread, own_lock)
    for _ in range(RECHECK_TRIES):
        if not probs:
            return ms, probs
        time.sleep(RECHECK_S)
        ms2, probs2 = inspect_once(thread, own_lock)
        if probs2 == probs:
            return ms2, probs2
        ms, probs = ms2, probs2
    return ms, probs


def inspect_once(thread, own_lock=False):
    """One unsynchronised pass over the folder and the log (see inspect)."""
    mf = manifest(thread)
    probs = check_manifest(mf)
    names = sorted(os.listdir(thread))
    ms = []
    for f in names:
        m = NAME_RE.match(f)
        if m:
            with open(os.path.join(thread, f), "rb") as fh:
                h = header(fh.read().decode("utf-8", "replace")) or {}
            ms.append({"file": f, "round": int(m.group(1)), "from": m.group(2), "state": h.get("state")})
        elif ANY_MSG_RE.match(f):
            probs.append(f"{f}: looks like a message but its name is not NNN-from-<name>-<title>.md")
    rounds = [m["round"] for m in ms]
    if rounds != list(range(1, len(ms) + 1)):
        probs.append(f"rounds are not 001 to {len(ms):03d} without gaps or duplicates: {', '.join(f'{r:03d}' for r in rounds)}")
    logged, lprobs = read_log(thread)
    busy_now = publish_in_progress(thread, own_lock)[0]
    if busy_now:                                       # an unfinished last line is an append in progress, not damage
        lprobs = [p for p in lprobs if "last line is incomplete" not in p and not (p.startswith(f"{LOG} line ") and p == lprobs[-1])]
    probs += lprobs
    logged_names = [n for n, _ in logged]
    present = {m["file"] for m in ms}
    busy, busy_detail = publish_in_progress(thread, own_lock)
    for n, hsh in logged:
        p = os.path.join(thread, n)
        if n not in present:
            if busy and os.path.exists(os.path.join(thread, f".pending-{n}")) and n == logged_names[-1]:
                continue                                   # the healthy log-to-rename window of a live publish
            probs.append(f"{n}: in {LOG} but missing from the folder")
        elif sha256(p) != hsh:
            probs.append(f"{n}: changed after publication")
    for m in ms:
        if m["file"] not in logged_names:
            probs.append(f"{m['file']}: not in {LOG}")
    if len(set(logged_names)) != len(logged_names):
        probs.append(f"{LOG}: a file is logged twice")
    if not busy and busy_detail:
        probs.append(busy_detail)
    return ms, probs


def messages(thread):
    return inspect(thread)[0]


def state(thread, me=None, own_lock=False):
    """Everything the rules need, derived from the files alone."""
    mf = manifest(thread)
    ms, probs = inspect(thread, own_lock)
    last = ms[-1] if ms else None
    closed = bool(last and last["state"] == "close_ack")
    stopped = os.path.exists(os.path.join(thread, "STOP"))
    deadline = parse_time(mf.get("deadline"))
    expired = bool(deadline and now_utc() > deadline)
    next_round = (last["round"] + 1) if last else 1
    parts = mf.get("participants") or []
    others = [p for p in parts if last and p != last["from"]]
    next_speaker = mf.get("first_speaker") if not last else (others[0] if others else None)
    live_proposal = bool(last and last["state"] == "propose_close")
    s = {"thread": thread, "rounds_used": len(ms), "max_rounds": mf.get("max_rounds"), "deadline": mf.get("deadline"),
         "last": last["file"] if last else None, "last_state": last["state"] if last else None,
         "next_round": next_round, "next_speaker": next_speaker, "closed": closed, "stopped": stopped,
         "expired": expired, "live_proposal": live_proposal, "damaged": probs,
         "busy": publish_in_progress(thread, own_lock)[0]}
    if me is not None:
        mine = [m["round"] for m in ms if m["from"] == me]
        s["unread"] = [m["file"] for m in ms if m["from"] != me and m["round"] > (max(mine) if mine else 0)]
        busy, busy_detail = publish_in_progress(thread, own_lock)
        if probs:
            s["your_turn"], s["why"] = False, "history damaged, the operator must repair it: " + probs[0]
        elif busy:
            s["your_turn"], s["why"] = False, busy_detail + "; check again shortly"
        elif closed:
            s["your_turn"], s["why"] = False, "thread is closed"
        elif stopped:
            s["your_turn"], s["why"] = False, "STOP file present"
        elif next_speaker != me:
            s["your_turn"], s["why"] = False, f"waiting for {next_speaker}"
        elif expired and not live_proposal:
            s["your_turn"], s["why"] = False, "deadline passed; only a close_ack to a live proposal may be sent"
        elif next_round > mf["max_rounds"] and not live_proposal:
            s["your_turn"], s["why"] = False, "round cap reached; only a close_ack to a live proposal may be sent"
        else:
            s["your_turn"] = True
            s["why"] = ("answer the proposal with close_ack or continue" if live_proposal and next_round <= mf["max_rounds"]
                        and not expired else "only close_ack is allowed now" if live_proposal else f"write round {next_round:03d}")
    return s


def validate(thread, data, own_lock=False):
    """Check draft BYTES (the exact bytes that will be published). Returns (problems, target_name)."""
    probs = []
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return ["the draft must be UTF-8 text"], None
    h = header(text)
    if h is None:
        return ["the draft must start with a '---' header block closed by '---'"], None
    mf = manifest(thread)
    parts = mf.get("participants") or []
    for k in ("to", "from", "round", "re", "state"):
        if k not in h:
            probs.append(f"header is missing '{k}:'")
    if probs:
        return probs, None
    me = h["from"]
    if me not in parts:
        return [f"from: {me!r} is not a participant"], None
    s = state(thread, me, own_lock)
    if s["damaged"]:
        return [s["why"]], None
    other = [p for p in parts if p != me][0]
    if h["to"] != other:
        probs.append(f"to: must be {other!r}")
    if h["state"] not in STATES:
        probs.append(f"state: must be one of {', '.join(STATES)}")
    if not s["your_turn"]:
        probs.append(f"not your turn: {s['why']}")
    if h["round"] != f"{s['next_round']:03d}":
        probs.append(f"round: must be {s['next_round']:03d}")
    if h["re"] != (s["last"] or "none"):
        probs.append(f"re: must be {s['last'] or 'none'}")
    if s["next_round"] == 1 and h["state"] != "continue":
        probs.append("round 001 must be state: continue")
    if h["state"] == "close_ack" and not s["live_proposal"]:
        probs.append("close_ack is only allowed in reply to a propose_close")
    if s["live_proposal"] and (s["expired"] or s["next_round"] > s["max_rounds"]) and h["state"] != "close_ack":
        probs.append("past the cap or deadline, only close_ack is allowed")
    slug = re.sub(r"[^a-z0-9]+", "-", (h.get("title") or h["state"]).lower()).strip("-")[:40] or "message"
    return probs, f"{s['next_round']:03d}-from-{me}-{slug}.md"


def append_log(thread, line):
    with open(os.path.join(thread, LOG), "a", encoding="utf-8", newline="\n") as fh:
        fh.write(line)  # one write call per line
        fh.flush()
        os.fsync(fh.fileno())


def publish(thread, draft_path):
    """Publish a draft. Serialised by a lock file in the thread folder, so two publishes on the same
    computer cannot both take one turn. The draft is read ONCE and those exact bytes are validated and
    published. Order: pending copy, then the log line, then the pending copy becomes the message; a failure
    before the last step leaves nothing visible; a failure at the last step leaves a logged-but-missing
    message, which every later status reports as damaged history."""
    lock = os.path.join(thread, LOCK)
    try:
        fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    except FileExistsError:
        held = open(lock, encoding="utf-8", errors="replace").read().strip()
        return False, (f"refused: another publish holds {LOCK} ({held}). If no publish is running, the operator "
                       f"may delete {LOCK} and retry")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(f"pid {os.getpid()} since {now_utc().strftime('%Y-%m-%dT%H:%M:%SZ')}")
    pending = None
    try:
        with open(draft_path, "rb") as fh:
            data = fh.read()
        probs, target = validate(thread, data, own_lock=True)
        if probs:
            return False, "refused: " + "; ".join(probs)
        dst = os.path.join(thread, target)
        pending = os.path.join(thread, f".pending-{target}")
        pfd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        with os.fdopen(pfd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        lp = os.path.join(thread, LOG)
        size0 = os.path.getsize(lp) if os.path.exists(lp) else 0
        try:
            append_log(thread, f"{now_utc().strftime('%Y-%m-%dT%H:%M:%SZ')}  {hashlib.sha256(data).hexdigest()}  {target}\n")
        except OSError as e:
            size1 = os.path.getsize(lp) if os.path.exists(lp) else 0
            if size1 == size0:
                os.remove(pending)
                pending = None
                return False, f"error: could not write {LOG} ({e}); the log is unchanged and nothing was published; retry"
            pending = None                                 # keep .pending-<target> as recovery evidence
            return False, (f"error: interrupted while writing {LOG} ({e}). The log changed but the message was not made "
                           f"visible, so the thread now reports damaged history. Recovery evidence: .pending-{target} "
                           f"(the exact bytes) and the last line of {LOG}. The operator repairs the log or renames the "
                           f"pending file, then runs check")
        try:
            if os.path.exists(dst):
                raise FileExistsError(dst)
            os.rename(pending, dst)          # the name was checked free under the lock
            pending = None
        except OSError as e:
            return False, (f"error: {target} is logged but could not be made visible ({e}); the thread now reports "
                           f"damaged history. The operator can rename .pending-{target} to {target} to repair it")
        return True, target
    finally:
        try:
            os.remove(lock)
        except OSError:
            pass


def check(thread):
    """Every problem with the thread's history (edits, missing or unlogged messages, gaps, bad names)."""
    return inspect(thread)[1]


def init(thread, participants, first, max_rounds, deadline, purpose):
    mf = {"protocol": "SCP 1.5.6", "purpose": purpose, "participants": participants, "first_speaker": first,
          "max_rounds": max_rounds, "deadline": deadline}
    probs = check_manifest(mf)
    if probs:
        raise SystemExit("; ".join(probs))
    os.makedirs(thread, exist_ok=False)
    with open(os.path.join(thread, "thread.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(mf, fh, indent=2)


def threads_under(folder):
    out = []
    for dp, dns, fns in os.walk(folder):
        if "thread.json" in fns:
            try:
                if str(manifest(dp).get("protocol", "")).startswith(("SCP ", "sfcp-lite")):   # sfcp-lite: the name before 1.4.2
                    out.append(dp)
            except (OSError, ValueError, KeyError):
                pass
    return sorted(out)


def finished(s):
    """True when a thread can take no further message from anyone: closed, stopped, or past its cap or deadline
    with no live proposal. This is not the same as closed by agreement."""
    return bool(s["closed"] or s["stopped"]
                or ((s["expired"] or s["next_round"] > s["max_rounds"]) and not s["live_proposal"]))


def watch(folder, me, minutes, interval=60):
    """Poll until it is me's turn somewhere (0), a thread naming me has damaged history (4), every thread naming me
    is finished (3), or timeout (2). A turn comes before damage, so other threads keep moving. Exit 0 includes both
    ready and damaged thread states; exit 4 returns damaged states when no thread is ready. Exit 3 means finished
    or inactive, not closed by agreement (see finished). Turn state is recomputed from the files on every pass, so
    a message that arrived before the watch started is found on the first pass. The caller still ends the watch at
    the operator's deadline; a live proposal past a limit keeps the thread open for a late close_ack, not the
    caller's watch."""
    t_end = time.time() + 60 * minutes
    while True:
        mine = [t for t in threads_under(folder) if me in manifest(t)["participants"]]
        ss = [state(t, me) for t in mine]
        ready = [s for s in ss if s["your_turn"]]
        damaged = [s for s in ss if s["damaged"]]
        if ready:
            return 0, ready + damaged
        if damaged:
            return 4, damaged
        if ss and all(finished(s) for s in ss):
            return 3, ss
        if time.time() >= t_end:
            return 2, [s for s in ss if not finished(s)]
        time.sleep(interval)


def selftest():
    res = []

    def case(name, ok):
        res.append((name, bool(ok)))

    # Ordinary folder, not tempfile.mkdtemp: on some Windows hosts mkdtemp's owner-only folder
    # cannot hold subfolders when Python runs without site initialisation (-S).
    root = os.path.join(tempfile.gettempdir(), f"scp-test-{os.getpid()}-{time.time_ns()}")
    os.makedirs(root)
    tomorrow = (now_utc() + datetime.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    th = os.path.join(root, "t")
    init(th, ["alice", "bob"], "alice", 3, tomorrow, "test")

    def draft(frm, to, rnd, re_, st, title="note"):
        p = os.path.join(root, f"d-{frm}-{rnd}-{st}.md")
        with open(p, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(f"---\nto: {to}\nfrom: {frm}\nround: {rnd}\nre: {re_}\nstate: {st}\ntitle: {title}\n---\n\nBody.\n")
        return p

    case("bob cannot open a thread alice starts", not publish(th, draft("bob", "alice", "001", "none", "continue"))[0])
    case("round 001 cannot propose closure", not publish(th, draft("alice", "bob", "001", "none", "propose_close"))[0])
    ok, f1 = publish(th, draft("alice", "bob", "001", "none", "continue", "please check"))
    case("alice publishes 001", ok and f1 == "001-from-alice-please-check.md")
    case("alice cannot write twice in a row", not publish(th, draft("alice", "bob", "002", f1, "continue"))[0])
    s = state(th, "bob")
    case("bob sees 001 unread and it is his turn", s["unread"] == [f1] and s["your_turn"])
    case("wrong round is refused", not publish(th, draft("bob", "alice", "003", f1, "continue"))[0])
    case("wrong re: is refused", not publish(th, draft("bob", "alice", "002", "none", "continue"))[0])
    case("close_ack without a proposal is refused", not publish(th, draft("bob", "alice", "002", f1, "close_ack"))[0])
    ok, f2 = publish(th, draft("bob", "alice", "002", f1, "continue", "checked"))
    case("bob publishes 002", ok)
    open(os.path.join(th, "STOP"), "w").close()
    case("STOP blocks publication", not publish(th, draft("alice", "bob", "003", f2, "propose_close"))[0])
    os.remove(os.path.join(th, "STOP"))
    ok, f3 = publish(th, draft("alice", "bob", "003", f2, "propose_close", "done"))
    case("alice proposes closure at the cap", ok)
    case("past the cap, continue is refused", not publish(th, draft("bob", "alice", "004", f3, "continue"))[0])
    ok, f4 = publish(th, draft("bob", "alice", "004", f3, "close_ack", "agreed"))
    case("close_ack is allowed one past the cap", ok)
    case("thread is closed for both", not state(th, "alice")["your_turn"] and not state(th, "bob")["your_turn"])
    case("nothing can be written after closure", not publish(th, draft("alice", "bob", "005", f4, "continue"))[0])
    case("check passes on untouched files", check(th) == [])
    with open(os.path.join(th, f2), "a", encoding="utf-8") as fh:
        fh.write("edited\n")
    case("check detects an edit after publication", any(f2 in b for b in check(th)))
    th2 = os.path.join(root, "late")
    init(th2, ["alice", "bob"], "alice", 4, "2020-01-01T00:00:00Z", "expired")
    case("an expired thread refuses a new message", not publish(th2, draft("alice", "bob", "001", "none", "continue"))[0])
    th3 = os.path.join(root, "w")
    init(th3, ["alice", "bob"], "alice", 4, tomorrow, "watch")
    rc, _ = watch(th3, "alice", 0.01, 1)
    case("watch finds alice's turn at once", rc == 0)
    rc, _ = watch(th3, "bob", 0.01, 1)
    case("watch times out for bob", rc == 2)
    publish(th3, draft("alice", "bob", "001", "none", "continue"))
    rc, r = watch(root, "bob", 0.01, 1)
    case("watch over a parent folder finds a message that arrived before it started", rc == 0 and any(x["thread"] == th3 for x in r))
    # --- version 1.1: the R-lite review attacks (L002-L004)
    th4 = os.path.join(root, "lock")
    init(th4, ["alice", "bob"], "alice", 4, tomorrow, "lock")
    open(os.path.join(th4, LOCK), "w").write("pid 0 since test")
    case("L002 a held lock refuses a second publish", not publish(th4, draft("alice", "bob", "001", "none", "continue", "a"))[0])
    os.remove(os.path.join(th4, LOCK))
    ok_a, fa = publish(th4, draft("alice", "bob", "001", "none", "continue", "first"))
    ok_b, fb = publish(th4, draft("alice", "bob", "001", "none", "continue", "second"))
    case("L002 a second round 001 with another title is refused", ok_a and not ok_b)
    case("L002 the lock is released after publishing", not os.path.exists(os.path.join(th4, LOCK)))
    reads = {"n": 0}
    real_open = open
    dpath = draft("bob", "alice", "002", fa, "continue", "once")

    def counting_open(path, *args, **kw):
        if os.path.abspath(str(path)) == os.path.abspath(dpath):
            reads["n"] += 1
        return real_open(path, *args, **kw)
    globals()["open"] = counting_open
    try:
        ok, fb2 = publish(th4, dpath)
    finally:
        globals()["open"] = real_open
    case("L002 the draft is read once, so the validated bytes are the published bytes", ok and reads["n"] == 1)
    real_append = globals()["append_log"]

    def failing_append(thread, line):
        raise OSError("injected log failure")
    globals()["append_log"] = failing_append
    try:
        ok, msg_ = publish(th4, draft("alice", "bob", "003", fb2, "continue", "logfail"))
    finally:
        globals()["append_log"] = real_append
    s4 = state(th4, "alice")
    case("L002 a failed log write publishes nothing and keeps the turn",
         not ok and s4["next_round"] == 3 and s4["your_turn"] and not any(f.startswith(".pending") for f in os.listdir(th4)))
    th5 = os.path.join(root, "lost")
    init(th5, ["alice", "bob"], "alice", 4, tomorrow, "lost")
    ok, f51 = publish(th5, draft("alice", "bob", "001", "none", "continue", "gone"))
    os.remove(os.path.join(th5, f51))
    s5 = state(th5, "alice")
    case("L003 a deleted logged message is reported", any("missing" in p for p in check(th5)))
    case("L003 damaged history is not a fresh turn", not s5["your_turn"] and "damaged" in s5["why"])
    case("L003 damaged history refuses publication", not publish(th5, draft("alice", "bob", "001", "none", "continue", "again"))[0])
    th6 = os.path.join(root, "dup")
    init(th6, ["alice", "bob"], "alice", 4, tomorrow, "dup")
    ok, f61 = publish(th6, draft("alice", "bob", "001", "none", "continue", "one"))
    with open(os.path.join(th6, f61), "rb") as fh:
        blob = fh.read()
    with open(os.path.join(th6, "001-from-alice-one-conflicted-copy.md"), "wb") as fh:
        fh.write(blob)
    case("L003 a duplicate round (for example a sync conflict copy) is damage", not state(th6, "bob")["your_turn"])
    th7 = os.path.join(root, "four")
    init(th7, ["alice", "bob"], "alice", 4, tomorrow, "four")
    with open(os.path.join(th7, "1000-from-alice-x.md"), "w", encoding="utf-8") as fh:
        fh.write("x")
    case("L004 a four-digit message file is damage, not invisible", any("looks like a message" in p for p in check(th7)))
    th8 = os.path.join(root, "crash")
    init(th8, ["alice", "bob"], "alice", 4, tomorrow, "crash")
    append_log(th8, f"{now_utc().strftime('%Y-%m-%dT%H:%M:%SZ')}  {'0' * 64}  001-from-alice-crashed.md\n")
    case("L002 a crash after logging is reported as damage", not state(th8, "bob")["your_turn"] and not state(th8, "alice")["your_turn"])
    th9 = os.path.join(root, "stopclose")
    init(th9, ["alice", "bob"], "alice", 2, tomorrow, "stopclose")
    ok, g1 = publish(th9, draft("alice", "bob", "001", "none", "continue", "a"))
    ok, g2 = publish(th9, draft("bob", "alice", "002", g1, "propose_close", "b"))
    open(os.path.join(th9, "STOP"), "w").close()
    case("STOP blocks even a close_ack", not publish(th9, draft("alice", "bob", "003", g2, "close_ack", "c"))[0])
    os.remove(os.path.join(th9, "STOP"))
    case("without STOP, close_ack one past the cap closes", publish(th9, draft("alice", "bob", "003", g2, "close_ack", "c"))[0])
    for label, args in (("duplicate participant names", (["alice", "alice"], "alice", 4)),
                        (f"max_rounds {MAX_CAP + 1}", (["alice", "bob"], "alice", MAX_CAP + 1))):
        try:
            init(os.path.join(root, "bad-" + label.replace(" ", "-")), *args, tomorrow, "x")
            case(f"L004 {label} refused", False)
        except SystemExit:
            case(f"L004 {label} refused", True)
    init(os.path.join(root, "cap998"), ["alice", "bob"], "alice", MAX_CAP, tomorrow, "x")
    case(f"max_rounds {MAX_CAP} accepted", True)
    # --- version 1.2: the 004 re-review cases
    def fault_after(nbytes):
        def f(thread, line):
            with open(os.path.join(thread, LOG), "a", encoding="utf-8", newline="\n") as fh:
                fh.write(line[:nbytes] if nbytes is not None else line)
            raise OSError("injected fault")
        return f
    for label, nb in (("a partial log write", 20), ("a failure after the full line (fsync)", None)):
        tp = os.path.join(root, "fault-" + ("partial" if nb else "fsync"))
        init(tp, ["alice", "bob"], "alice", 4, tomorrow, "fault")
        globals()["append_log"] = fault_after(nb)
        try:
            ok, msg_ = publish(tp, draft("alice", "bob", "001", "none", "continue", "f"))
        finally:
            globals()["append_log"] = real_append
        sp = state(tp, "alice")
        case(f"L002 {label}: reported as interrupted, not as nothing published", not ok and "interrupted" in msg_)
        case(f"L002 {label}: the turn is NOT handed back", not sp["your_turn"] and sp["damaged"])
        case(f"L002 {label}: the exact bytes are kept as recovery evidence", any(f.startswith(".pending-") for f in os.listdir(tp)))
        case(f"L002 {label}: a retry is refused", not publish(tp, draft("alice", "bob", "001", "none", "continue", "retry"))[0])
    tm_ = os.path.join(root, "malformed")
    init(tm_, ["alice", "bob"], "alice", 4, tomorrow, "m")
    ok, h1 = publish(tm_, draft("alice", "bob", "001", "none", "continue", "a"))
    with open(os.path.join(tm_, LOG), "a", encoding="utf-8", newline="\n") as fh:
        fh.write("garbage line\n")
    case("L003 a malformed log line is reported", any("malformed" in p for p in check(tm_)))
    case("L003 a malformed log line blocks the next message", not publish(tm_, draft("bob", "alice", "002", h1, "continue", "b"))[0])
    tw = os.path.join(root, "window")
    init(tw, ["alice", "bob"], "alice", 4, tomorrow, "w")
    fake = "001-from-alice-inflight.md"
    with open(os.path.join(tw, f".pending-{fake}"), "w", encoding="utf-8") as fh:
        fh.write("x")
    append_log(tw, f"{now_utc().strftime('%Y-%m-%dT%H:%M:%SZ')}  {'0' * 64}  {fake}\n")
    with open(os.path.join(tw, LOCK), "w") as fh:
        fh.write("pid 0")
    sw = state(tw, "bob")
    case("L002 the healthy log-to-rename window is 'in progress', not damage", sw["busy"] and not sw["damaged"] and "in progress" in sw["why"])
    old_t = time.time() - STALE_LOCK_S - 5
    os.utime(os.path.join(tw, LOCK), (old_t, old_t))
    sw = state(tw, "bob")
    case("a stale lock with a half-finished publish is reported as damage", not sw["busy"] and sw["damaged"])
    # --- version 1.3: the two residuals from review 006
    te = os.path.join(root, "emptylog")
    init(te, ["alice", "bob"], "alice", 4, tomorrow, "e")

    def create_then_fail(thread, line):
        open(os.path.join(thread, LOG), "a", encoding="utf-8").close()
        raise OSError("injected fault before writing")
    globals()["append_log"] = create_then_fail
    try:
        ok, msg_ = publish(te, draft("alice", "bob", "001", "none", "continue", "e"))
    finally:
        globals()["append_log"] = real_append
    case("L002 an empty log after a failed create: clean refusal", not ok and "unchanged" in msg_)
    case("L002 an empty log after a failed create: the retry succeeds", publish(te, draft("alice", "bob", "001", "none", "continue", "e2"))[0])
    tpa = os.path.join(root, "partialappend")
    init(tpa, ["alice", "bob"], "alice", 4, tomorrow, "p")
    ok, q1 = publish(tpa, draft("alice", "bob", "001", "none", "continue", "a"))
    nm = "002-from-bob-b.md"
    with open(os.path.join(tpa, f".pending-{nm}"), "w", encoding="utf-8") as fh:
        fh.write("x")
    with open(os.path.join(tpa, LOCK), "w") as fh:
        fh.write("pid 0")
    with open(os.path.join(tpa, LOG), "a", encoding="utf-8", newline="\n") as fh:
        fh.write(f"{now_utc().strftime('%Y-%m-%dT%H:%M:%SZ')}  {'0' * 20}")
    sq = state(tpa, "alice")
    case("L002 a partial append seen during a fresh lock is 'in progress', not damage", sq["busy"] and not sq["damaged"])
    os.remove(os.path.join(tpa, LOCK))
    case("the same partial append without a lock is damage", bool(state(tpa, "alice")["damaged"]))
    # --- version 1.4: review-2 finding L007 (a publish completing between listing and log read)
    tr = os.path.join(root, "race")
    init(tr, ["alice", "bob"], "alice", 4, tomorrow, "race")
    real_listdir = os.listdir
    armed = {"on": True}
    race_draft = draft("alice", "bob", "001", "none", "continue", "raced")

    def racing_listdir(path):
        names = real_listdir(path)
        if armed["on"] and os.path.abspath(path) == os.path.abspath(tr):
            armed["on"] = False
            publish(tr, race_draft)                  # completes fully after the listing was taken
        return names
    os.listdir = racing_listdir
    try:
        once_probs = inspect_once(tr)[1]
    finally:
        os.listdir = real_listdir
    case("L007 control: a single pass is fooled by the race", any("missing" in p for p in once_probs))
    os.remove(os.path.join(tr, [f for f in real_listdir(tr) if f.startswith("001-")][0]))
    os.remove(os.path.join(tr, LOG))
    armed["on"] = True
    os.listdir = racing_listdir
    try:
        sr = state(tr, "bob")
    finally:
        os.listdir = real_listdir
    case("L007 with the recheck, the race is not reported as damage", not sr["damaged"] and sr["your_turn"])
    ts = os.path.join(root, "stable")
    init(ts, ["alice", "bob"], "alice", 4, tomorrow, "stable")
    ok, u1 = publish(ts, draft("alice", "bob", "001", "none", "continue", "u"))
    os.remove(os.path.join(ts, u1))
    case("L007 stable damage is still reported after the recheck", any("missing" in p for p in state(ts, "bob")["damaged"]))
    for bad in (2.9, True, 1):
        try:
            init(os.path.join(root, f"bad{bad}"), ["alice", "bob"], "alice", bad, tomorrow, "x")
            case(f"max_rounds {bad!r} refused", False)
        except SystemExit:
            case(f"max_rounds {bad!r} refused", True)
    # watch: terminal states (1.5.6). minutes=0 and interval=0 give exactly one pass.
    wroot = os.path.join(root, "watch")

    def wthread(group, name, cap, states):
        t = os.path.join(wroot, group, name)
        init(t, ["alice", "bob"], "alice", cap, tomorrow, name)
        prev = "none"
        for i, st in enumerate(states, 1):
            frm, to = ("alice", "bob") if i % 2 else ("bob", "alice")
            ok, prev = publish(t, draft(frm, to, f"{i:03d}", prev, st, f"w{i}"))
            if not ok:
                raise RuntimeError(f"watch fixture {group}/{name}: {prev}")
        return t

    def wrc(group, me):
        return watch(os.path.join(wroot, group), me, 0, 0)

    def damage(t):
        with open(os.path.join(t, sorted(f for f in os.listdir(t) if f[:3].isdigit())[-1]), "a", encoding="utf-8") as fh:
            fh.write("edited\n")

    open(os.path.join(wthread("stop", "t", 4, ["continue"]), "STOP"), "w").close()
    case("watch: a STOP thread is finished (3)", wrc("stop", "alice")[0] == 3)
    wthread("cap", "t", 2, ["continue", "continue"])
    case("watch: a thread at its cap with no proposal is finished (3)", wrc("cap", "alice")[0] == 3)
    wthread("acked", "t", 4, ["continue", "propose_close", "close_ack"])
    case("watch: an acknowledged close is finished (3)", wrc("acked", "alice")[0] == 3)
    wthread("pcap", "t", 2, ["continue", "propose_close"])
    case("watch: live proposal at the cap, its respondent is woken (0)", wrc("pcap", "alice")[0] == 0)
    case("watch: live proposal at the cap, its proposer keeps waiting (2)", wrc("pcap", "bob")[0] == 2)
    open(os.path.join(wthread("pstop", "t", 4, ["continue", "propose_close"]), "STOP"), "w").close()
    case("watch: STOP ends a thread even with a live proposal (3, respondent)", wrc("pstop", "alice")[0] == 3)
    case("watch: STOP ends a thread even with a live proposal (3, proposer)", wrc("pstop", "bob")[0] == 3)
    wthread("mixed", "closed", 4, ["continue", "propose_close", "close_ack"])
    wthread("mixed", "dead", 2, ["continue", "continue"])
    case("watch: closed and dead threads together are finished (3)", wrc("mixed", "alice")[0] == 3)
    wthread("active", "dead", 2, ["continue", "continue"])
    wthread("active", "live", 4, ["continue"])
    case("watch: a live thread beside a dead one keeps the watch waiting (2)", wrc("active", "alice")[0] == 2)
    damage(wthread("dmg", "t", 4, ["continue", "continue"]))
    rc_d, r_d = wrc("dmg", "alice")
    case("watch: damaged history returns 4", rc_d == 4 and len(r_d) == 1 and r_d[0]["damaged"])
    damage(wthread("dmgready", "bad", 4, ["continue", "continue"]))
    wthread("dmgready", "ready", 4, ["continue", "continue"])
    rc_r, r_r = wrc("dmgready", "alice")
    case("watch: a turn comes before damage (0), and the damaged thread is listed",
         rc_r == 0 and len(r_r) == 2 and sum(bool(s["damaged"]) for s in r_r) == 1)
    damage(wthread("dmgdone", "bad", 4, ["continue", "continue"]))
    wthread("dmgdone", "done", 2, ["continue", "continue"])
    case("watch: damage is reported before finished (4)", wrc("dmgdone", "alice")[0] == 4)
    wthread("late", "none", 4, ["continue"])
    wthread("latep", "t", 4, ["continue", "propose_close"])
    g = globals()
    real_now = g["now_utc"]
    g["now_utc"] = lambda: real_now() + datetime.timedelta(days=2)
    try:
        case("watch: past the deadline with no proposal is finished (3)", wrc("late", "bob")[0] == 3)
        case("watch: live proposal past the deadline, its respondent is woken (0)", wrc("latep", "alice")[0] == 0)
        case("watch: live proposal past the deadline, its proposer keeps waiting (2)", wrc("latep", "bob")[0] == 2)
    finally:
        g["now_utc"] = real_now
    n = sum(ok for _, ok in res)
    for name, ok in res:
        print(("  ok    " if ok else "  FAIL  ") + name)
    print(f"{n} of {len(res)} SCP self-test cases pass")
    return n == len(res)


def main(a):
    if not a:
        raise SystemExit(__doc__)
    cmd = a[0]
    if cmd == "selftest":
        return 0 if selftest() else 1
    if cmd == "init":
        g = lambda k: a[a.index(k) + 1]
        init(a[1], g("--participants").split(","), g("--first"), int(g("--max-rounds")), g("--deadline"), g("--purpose"))
        print(json.dumps(state(a[1]), indent=1))
        return 0
    if cmd == "status":
        s = state(a[1], a[2])
        print(json.dumps(s, indent=1))
        return 0 if s["your_turn"] else 1
    if cmd == "publish":
        ok, msg = publish(a[1], a[2])
        print(msg)
        return 0 if ok else 1
    if cmd == "watch":
        iv = int(a[a.index("--interval") + 1]) if "--interval" in a else 60
        rc, r = watch(a[1], a[2], float(a[3]), iv)
        print(json.dumps(r, indent=1))
        return rc
    if cmd == "check":
        bad = check(a[1])
        print(json.dumps(bad, indent=1))
        return 0 if not bad else 1
    raise SystemExit(__doc__)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
