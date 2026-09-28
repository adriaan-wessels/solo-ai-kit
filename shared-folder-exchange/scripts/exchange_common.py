"""Shared-folder exchange protocol, version 2 - the one set of rules both scripts use.

Everything the reader checks, the publisher checks first (DIFF v002, W-06). There is
one header parser, one delta parser, one validator and one ledger replay, so the two
scripts cannot disagree.

Trust model: nothing on the shared disk proves who wrote it. Filenames let an
inconsistent claim be detected. Researcher rulings and control changes are made by
matching acknowledgement files that each agent writes from what it received in its
OWN private chat (P-07). No agent edits thread.json after the thread opens; effective
status, deadline and cap are DERIVED from matched control acknowledgements.
"""
import csv
import datetime as _dt
import hashlib
import json
import os
import re

PROTOCOL_VERSION = 2
STATES = ("continue", "propose_close", "close_ack")
MSG_RE = re.compile(r"^(\d{3})-from-([a-z0-9_]+)-[a-z0-9_-]+\.md$")
HDR_KEYS = ("to", "from", "round", "re", "state", "changes", "relies-on")
HDR_RE = re.compile(r"^(to|from|round|re|state|changes|relies-on):\s*(.*)$", re.M)
PIN_ROW = re.compile(r"^\| `([^`]+)` \| `([0-9A-Fa-f]{64})` \|\s*$", re.M)
DELTA_ROW = re.compile(r"^\|\s*([A-Z]\d{3})\s*\|\s*([^|]*?)\s*\|\s*(.*?)\s*\|\s*$")
ACK_RE = re.compile(r"^(ruling|control)-ack-from-([a-z0-9_]+)-([A-Za-z]\d{2,3})\.md$")
STATUS_KEYS = ("position", "evidence", "remediation")
POSITIONS = ("unresolved", "agreed", "disputed", "withdrawn")
EVIDENCE = ("unchecked", "reproduced", "failed")
REMEDIATION = ("pending", "implemented", "verified")
TIERS = ("science", "procedural")


class ProtocolError(Exception):
    pass


class IntegrityError(ProtocolError):
    """A published message changed or vanished. The thread stops until the researcher acts."""


# ----------------------------------------------------------------- primitives
def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest().upper()


def sha_text(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest().upper()


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def root_of(exdir):
    return os.path.dirname(os.path.abspath(exdir))


def now_utc():
    return _dt.datetime.now(_dt.timezone.utc)


def parse_iso(s):
    return _dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


# ------------------------------------------------------------------- manifest
def manifest(exdir):
    p = os.path.join(exdir, "thread.json")
    if not os.path.exists(p):
        raise ProtocolError("no thread.json in the exchange folder")
    mf = json.loads(read(p))
    v = mf.get("protocol_version")
    if v != PROTOCOL_VERSION:
        raise ProtocolError(f"thread.json declares protocol_version {v!r}; these scripts implement "
                            f"{PROTOCOL_VERSION}. Archived threads keep the scripts of their own version.")
    parts = mf.get("participants") or []
    if len(parts) != 2:
        raise ProtocolError("participants must name exactly two agents")
    tier = (mf.get("review_policy") or {}).get("tier", "procedural")
    if tier not in TIERS:
        raise ProtocolError(f"review_policy.tier {tier!r} must be one of {TIERS}. The tier is a validated "
                            f"label; enforcement comes from the policy arrays.")
    px = mf.get("finding_prefix", "F")
    if not re.fullmatch(r"[A-Z]", px):
        raise ProtocolError("finding_prefix must be one capital letter")
    return mf


def counterpart(mf, me):
    a, b = mf["participants"]
    if me not in (a, b):
        raise ProtocolError(f"{me!r} is not a participant ({a}, {b})")
    return b if me == a else a


# ------------------------------------------------------------- control records
CONTROL_RE = re.compile(
    r"^Control (C\d{2,3}):\s*(pause|resume|extend deadline to (\S+)|raise cap to (\d+))\.?$", re.I)
RULING_RE = re.compile(r"^Ruling (R\d{2,3}) \(([^)]*)\):\s*(.+)$")


def ack_files(exdir, kind, cid=None):
    out = {}
    for f in os.listdir(exdir):
        m = ACK_RE.match(f)
        if m and m.group(1) == kind and (cid is None or m.group(3) == cid):
            out.setdefault(m.group(3), {})[m.group(2)] = os.path.join(exdir, f)
    return out


def read_ack(path):
    """An ack file holds exactly one fenced block with the sentence, then `sha256: <hex>`."""
    t = read(path)
    m = re.search(r"```\n(.*?)\n```", t, re.S)
    h = re.search(r"^sha256:\s*([0-9A-Fa-f]{64})\s*$", t, re.M)
    if not m or not h:
        return None
    sentence = m.group(1).strip()
    if sha_text(sentence) != h.group(1).upper():
        return None
    return sentence


def check_ack(exdir, mf, kind, cid):
    """pending | match | mismatch for one ruling/control id. Never creates anything."""
    files = ack_files(exdir, kind, cid).get(cid, {})
    parts = mf["participants"]
    have = {p: read_ack(files[p]) for p in parts if p in files}
    if len(have) < 2:
        return "pending", have
    vals = list(have.values())
    if None in vals:
        return "mismatch", have
    return ("match" if vals[0] == vals[1] else "mismatch"), have


def effective(exdir, mf=None):
    """Manifest plus every MATCHED control acknowledgement, applied in id order.
    Returns dict with status, deadline, max_rounds. thread.json itself is never edited."""
    mf = mf or manifest(exdir)
    eff = {"status": mf.get("status", "active"), "deadline": mf.get("deadline"),
           "max_rounds": int(mf.get("max_rounds", 12)), "controls": []}
    for cid in sorted(ack_files(exdir, "control")):
        st, have = check_ack(exdir, mf, "control", cid)
        if st != "match":
            continue
        sent = next(iter(have.values()))
        cm = CONTROL_RE.match(sent)
        if not cm or cm.group(1) != cid:
            continue
        op = cm.group(2).lower()
        if op == "pause":
            eff["status"] = "paused"
        elif op == "resume":
            eff["status"] = "active"
        elif op.startswith("extend deadline"):
            eff["deadline"] = cm.group(3)
        elif op.startswith("raise cap"):
            eff["max_rounds"] = int(cm.group(4))
        eff["controls"].append((cid, sent))
    return eff


# ------------------------------------------------------------------ registry
REGISTRY = "published.sha256"


def registry(exdir):
    """file -> sha256 of the bytes at publication. Append-only; written by the publisher."""
    p = os.path.join(exdir, REGISTRY)
    out = {}
    if os.path.exists(p):
        for line in read(p).split("\n"):
            if line.strip():
                h, f = line.split(None, 1)
                out[f.strip()] = h.upper()
    return out


def register(exdir, fname, h):
    with open(os.path.join(exdir, REGISTRY), "a", encoding="utf-8", newline="\n") as fh:
        fh.write(f"{h.upper()}  {fname}\n")


def integrity_errors(exdir):
    """A published message whose bytes differ from the registry, or that vanished, is an integrity
    error for the whole thread (V001). Nothing after it is processed."""
    errs = []
    reg = registry(exdir)
    for m in messages(exdir):
        if m["file"] not in reg:
            errs.append((m["file"], "unregistered: on disk but not in published.sha256, so it never passed the publisher (manual rename or copy)"))
    for f, h in reg.items():
        p = os.path.join(exdir, f)
        if not os.path.exists(p):
            errs.append((f, "published message has vanished"))
        elif sha(p) != h:
            errs.append((f, "published message bytes changed after publication"))
    return errs


LEDGER_HEADING = re.compile(r"^## Ledger delta[ \t]*$", re.M)
BASIS_HEADING = re.compile(r"^## Review basis[ \t]*$", re.M)


def ledger_section(text):
    """Offset of the ONE standalone '## Ledger delta' heading. Raises on none or several (V010):
    an inline mention in prose or code is never an anchor."""
    hits = [m.start() for m in LEDGER_HEADING.finditer(text)]
    if len(hits) != 1:
        raise ProtocolError(f"expected exactly one standalone '## Ledger delta' heading, found {len(hits)}")
    return hits[0]


# -------------------------------------------------------------------- messages
def header(path):
    t = read(path)
    m = re.search(r"^```(?:text)?\n(.*?)\n```", t, re.S | re.M)
    if not m:
        return {}
    return {k: v.strip() for k, v in HDR_RE.findall(m.group(1))}


def messages(exdir):
    out = []
    for f in os.listdir(exdir):
        m = MSG_RE.match(f)
        if m:
            out.append({"file": f, "path": os.path.join(exdir, f), "round": m.group(1), "from_name": m.group(2)})
    return sorted(out, key=lambda x: (x["round"], x["file"]))


def split_list(v):
    return [x.strip() for x in (v or "").split(",") if x.strip() and x.strip().lower() != "none"]


def parse_status(s):
    out = {}
    for tok in s.split():
        if "=" not in tok:
            raise ProtocolError(f"bad status token {tok!r}")
        k, v = tok.split("=", 1)
        if k not in STATUS_KEYS:
            raise ProtocolError(f"unknown status axis {k!r}")
        allowed = {"position": POSITIONS, "evidence": EVIDENCE, "remediation": REMEDIATION}[k]
        if v not in allowed:
            raise ProtocolError(f"{k}={v!r} is not one of {allowed}")
        out[k] = v
    return out


def parse_deltas(text):
    """The ledger-delta table is the only machine-read part of a message. One shared parser.
    Returns list of (id, statusdict, note). Raises on any malformed row."""
    try:
        i = ledger_section(text)
    except ProtocolError:
        if not LEDGER_HEADING.search(text):
            return []
        raise
    rows = []
    for line in text[i:].split("\n")[1:]:
        s = line.strip()
        if not s:
            continue
        if not s.startswith("|"):
            if rows:
                break
            continue
        if re.match(r"^\|\s*id\s*\|", s) or re.match(r"^\|[-\s|]+\|$", s):
            continue
        m = DELTA_ROW.match(s)
        if not m:
            raise ProtocolError(f"malformed ledger-delta row: {s[:80]}")
        rows.append((m.group(1), parse_status(m.group(2)), m.group(3)))
    ids = [r[0] for r in rows]
    dup = sorted({x for x in ids if ids.count(x) > 1})
    if dup:
        raise ProtocolError(f"finding touched twice in one message: {dup}")
    return rows


def pins(text):
    return PIN_ROW.findall(text)


def make_pin_table(root, paths):
    lines = ["| file | SHA-256 |", "|---|---|"]
    for rel in paths:
        p = os.path.join(root, rel.replace("/", os.sep))
        if not os.path.exists(p):
            raise ProtocolError(f"pinned path does not exist: {rel}")
        lines.append(f"| `{rel}` | `{sha(p)}` |")
    return "\n".join(lines)


# ------------------------------------------------------------------- validator
def validate(exdir, msg, mf, published, now=None, is_candidate=False):
    """Structural validity of msg given the accepted prefix `published`. The SAME function for
    reader and publisher. Live gates (pause, deadline, cap) apply to a CANDIDATE only (V002):
    history is judged by the rules in force when it was written, never by the clock now."""
    h = header(msg["path"])
    for k in HDR_KEYS:
        if k not in h:
            return f"header lacks {k}: (first fenced block must carry all of {', '.join(HDR_KEYS)})"
    if h["round"] != msg["round"] or h["from"] != msg["from_name"]:
        return f"header round/from ({h['round']}/{h['from']}) disagree with the filename"
    if h["from"] not in mf["participants"]:
        return f"author {h['from']!r} is not a participant"
    if h["to"] != counterpart(mf, h["from"]):
        return f"to: must name the counterpart {counterpart(mf, h['from'])!r}"
    if h["state"] not in STATES:
        return f"state {h['state']!r} is not one of {STATES}"
    earlier = [m for m in published if m["round"] < msg["round"]]
    if earlier and int(msg["round"]) != int(earlier[-1]["round"]) + 1:
        return f"round {msg['round']} does not follow {earlier[-1]['round']}"
    if earlier and earlier[-1]["from_name"] == msg["from_name"]:
        return f"{msg['from_name']} wrote {earlier[-1]['round']} and {msg['round']} consecutively"
    if not earlier:
        if msg["round"] != "001":
            return "the first message of a thread is round 001"
        if h["re"].lower() != "none":
            return "round 001 carries re: none"
        if msg["from_name"] != mf.get("first_speaker", msg["from_name"]):
            return f"round 001 must come from first_speaker {mf.get('first_speaker')!r}"          # V003
        if h["state"] != "continue":
            return "round 001 must be state: continue"                                             # V003
    else:
        theirs = [m for m in earlier if m["from_name"] != msg["from_name"]]
        if not theirs or h["re"] != theirs[-1]["file"]:
            return f"re: must name the counterpart's newest message {theirs[-1]['file'] if theirs else ''}"
        prev_state = header(earlier[-1]["path"]).get("state")
        if h["state"] == "close_ack" and prev_state != "propose_close":
            return "close_ack must answer a propose_close"
        if prev_state == "close_ack":
            return "thread is closed"
    text = read(msg["path"])
    n_led = len(LEDGER_HEADING.findall(text))
    if n_led == 0 and h["state"] != "close_ack":
        return "every message ends with a ## Ledger delta table (a generated close_ack is the one exception)"  # V008
    if n_led > 1 or len(BASIS_HEADING.findall(text)) > 1:
        return "more than one standalone Ledger delta or Review basis heading"                                # V010
    # V011: every message in a version-2 thread has a registry entry matching its bytes
    reg = registry(exdir)
    if not is_candidate:
        if msg["file"] not in reg:
            return "not in published.sha256: this file did not pass the publisher (manual rename or copy)"
        if reg[msg["file"]] != sha(msg["path"]):
            return "bytes differ from the registry entry"
    declared = split_list(h["changes"]) + split_list(h["relies-on"])
    table = dict(pins(text))
    root = root_of(exdir)
    for rel in declared:
        if rel not in table:
            return f"declared path not pinned: {rel} (the publisher writes the pin table)"
        if is_candidate:
            p = os.path.join(root, rel.replace("/", os.sep))
            if not os.path.exists(p):
                return f"pinned path missing on disk: {rel}"
            if sha(p) != table[rel].upper():
                return f"pin for {rel} does not match the file on disk"
    for rel in table:
        if rel not in declared:
            return f"pinned but not declared in changes:/relies-on: {rel}"
    try:
        for fid, _, _ in parse_deltas(text):
            if fid[0] != mf.get("finding_prefix", "F"):
                return f"finding {fid} does not carry this thread's prefix {mf.get('finding_prefix', 'F')!r}"   # V007
    except ProtocolError as e:
        return str(e)
    err = policy_error(text, mf.get("review_policy", {}) or {})
    if err:
        return err
    if is_candidate:
        return live_gate(exdir, mf, msg, h, now)
    return None


def live_gate(exdir, mf, msg, h, now=None):
    """Stop NEW publication only. Never applied to history (V002)."""
    eff = effective(exdir, mf)
    if eff["status"] == "paused":
        return "thread is paused (matched control ack); only a matched resume reopens it"
    if eff["status"] == "closed":
        return "thread is closed by manifest"
    if int(msg["round"]) > eff["max_rounds"] and h["state"] != "close_ack":
        return f"max_rounds: {int(msg['round'])} > {eff['max_rounds']}"
    now = now or now_utc()
    if eff["deadline"] and now > parse_iso(eff["deadline"]) and h["state"] != "close_ack":
        return f"deadline {eff['deadline']} has passed"
    return None


def policy_error(text, pol):
    """Safe, declarative review_policy invariants only (P-10). Never executes anything."""
    for marker in pol.get("required_markers", []):
        if marker not in text:
            return f"review_policy: required marker missing: {marker!r}"
    for phrase in pol.get("forbidden_phrases", []):
        if phrase in text:
            return f"review_policy: forbidden phrase present: {phrase!r}"
    rule = pol.get("table_cell_marker")
    if rule:
        words, marker = rule.get("if_any_word", []), rule.get("require", "")
        for line in text.split("\n"):
            if line.startswith("|") and marker not in line and any(w in line for w in words):
                return f"review_policy: a table cell mentions {words} without {marker!r}"
    return None


def accepted_messages(exdir, mf=None):
    """Walk the thread in order; a message is accepted only if valid given the accepted prefix."""
    mf = mf or manifest(exdir)
    acc, rejected = [], []
    bad = dict(integrity_errors(exdir))
    for m in messages(exdir):
        if m["file"] in bad:
            rejected.append((m["file"], "integrity: " + bad[m["file"]]))
            continue
        err = validate(exdir, m, mf, acc)
        if err:
            rejected.append((m["file"], err))
        else:
            acc.append(m)
    return acc, rejected


# ----------------------------------------------------------------------- ledger
LEDGER_COLS = ("id", "raised_by", "round", "claim", "position", "evidence", "remediation",
               "implemented_by", "verified_by", "last_round", "note")


def load_seed(exdir):
    p = os.path.join(exdir, "findings.seed.csv")
    rows = {}
    if os.path.exists(p):
        with open(p, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                rows[r["id"]] = {c: r.get(c, "") for c in LEDGER_COLS}
    return rows


def rebuild(exdir, mf=None):
    """Replay every accepted message's delta table in order. Rejects a WHOLE message on one bad
    row. Two-party rule: remediation=verified is recorded only by the counterpart of whoever
    implemented it. Writes findings.csv atomically. Returns (ledger, accepted, rejected)."""
    mf = mf or manifest(exdir)
    ie = integrity_errors(exdir)
    if ie:
        raise IntegrityError("; ".join(f"{f}: {w}" for f, w in ie))       # replay stops; nothing is written
    ledger = load_seed(exdir)
    acc, rejected = accepted_messages(exdir, mf)
    applied = []
    import copy as _copy
    for m in acc:
        text = read(m["path"])
        work = _copy.deepcopy(ledger)                       # V004: commit only if every row passes
        try:
            rows = parse_deltas(text)
            for fid, st, note in rows:
                if fid[0] != mf.get("finding_prefix", "F"):
                    raise ProtocolError(f"{fid} does not carry prefix {mf.get('finding_prefix', 'F')!r}")
                if fid not in work:
                    if not note.startswith("NEW:"):
                        raise ProtocolError(f"{fid} is unknown and the note does not start with NEW:")
                    work[fid] = {c: "" for c in LEDGER_COLS}
                    work[fid].update(id=fid, raised_by=m["from_name"], round=m["round"],
                                       claim=note[4:].split("·")[0].strip(), position="unresolved",
                                       evidence="unchecked", remediation="pending")
                row = work[fid]
                if st.get("remediation") == "verified":
                    if row.get("implemented_by") == m["from_name"] or not row.get("implemented_by"):
                        raise ProtocolError(f"{fid} -> remediation=verified: only the counterpart of the "
                                            f"implementer may verify (implemented_by={row.get('implemented_by') or 'nobody'})")
                    row["verified_by"] = m["from_name"]
                if st.get("remediation") == "implemented":
                    row["implemented_by"] = m["from_name"]
                for k in STATUS_KEYS:
                    if k in st:
                        row[k] = st[k]
                row["last_round"], row["note"] = m["round"], note
        except ProtocolError as e:
            rejected.append((m["file"], f"REJECTED - nothing applied: {e}"))
            continue
        ledger = work
        applied.append(m["file"])
    out = os.path.join(exdir, "findings.csv")
    tmp = out + ".part"
    with open(tmp, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=LEDGER_COLS)
        w.writeheader()
        for fid in sorted(ledger):
            w.writerow(ledger[fid])
    os.replace(tmp, out)
    return ledger, applied, rejected
