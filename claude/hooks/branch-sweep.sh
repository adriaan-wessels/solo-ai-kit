#!/usr/bin/env bash
# branch-sweep.sh — mechanical cleanup of provably-dead branches/worktrees.
#
# Root cause this exists for: squash-merge auto-deletes only the REMOTE
# branch, so every merged PR strands a local one unless something deletes
# it. The primary mechanism is a standing rule (delete the local branch in
# the same step the merge is confirmed — templates/CLAUDE.md); this script
# is the mechanical backstop for what that rule misses.
#
# Modes:
#   auto    SubagentStop hook: rate-limited (60 min) + atomic lock, deletes
#           only the provably-safe class, silent when there is nothing to do.
#           ALWAYS exits 0 (exit 2 on SubagentStop would block the stop).
#   apply   Same deletions, no rate-limit/lock. For a periodic hygiene pass.
#   report  Classification only (TSV to stdout), deletes nothing.
#
# Provably-safe (auto-deletable) means ONE of:
#   contained  — branch head is an ancestor of the remote default branch
#                (zero info loss)
#   squashed   — upstream is gone AND a merged PR exists for the head name
#                AND no open PR reuses that name
# Everything else is FLAGGED and never touched here — judgment cases belong
# to a human-approved hygiene pass, not to a hook.
# Worktrees are removed only when completely clean AND their branch is safe.
# Every deletion is appended to .claude/state/branch-sweep.log with its SHA:
# restore with  git branch <name> <sha>.

set -u
MODE="${1:-report}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT" || exit 0
STATE=".claude/state"
mkdir -p "$STATE"
LOG="$STATE/branch-sweep.log"
LOCK="$STATE/branch-sweep.lock"
MARKER="$STATE/branch-sweep.last"
MAXGH=12   # bound gh lookups per run (auto mode fires mid-wave)

# Default branch: origin/HEAD when set, else main/master by existence.
DEFAULT="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)"
DEFAULT="${DEFAULT#origin/}"
if [ -z "$DEFAULT" ]; then
  if git show-ref --verify --quiet refs/remotes/origin/main; then
    DEFAULT="main"
  else
    DEFAULT="master"
  fi
fi

if [ "$MODE" = "auto" ]; then
  # Rate limit: at most one real run per hour.
  if [ -f "$MARKER" ] && [ -n "$(find "$MARKER" -mmin -60 2>/dev/null)" ]; then
    exit 0
  fi
  # Atomic create-exclusive lock + staleness takeover (SubagentStop can burst).
  if ! ( set -C; echo "$$" > "$LOCK" ) 2>/dev/null; then
    if [ -n "$(find "$LOCK" -mmin +10 2>/dev/null)" ]; then
      rm -f "$LOCK"
      ( set -C; echo "$$" > "$LOCK" ) 2>/dev/null || exit 0
    else
      exit 0
    fi
  fi
  trap 'rm -f "$LOCK"' EXIT
  touch "$MARKER"
fi

git fetch --prune --quiet 2>/dev/null || true

# Branches checked out in ANY worktree are never candidates.
CHECKED_OUT="$(git worktree list --porcelain | sed -n 's/^branch refs\/heads\///p')"
GH_OK=0; command -v gh >/dev/null 2>&1 && GH_OK=1
GH_USED=0
DELETED=0

is_checked_out() { echo "$CHECKED_OUT" | grep -qx "$1"; }

log_del() { # type name sha reason
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" >> "$LOG"
}

emit() { # CLASS name sha reason  (report mode only)
  [ "$MODE" = "report" ] && printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4"
}

# Worktree path for a branch, if any (empty when not checked out).
wt_path_for() {
  git worktree list --porcelain | awk -v b="refs/heads/$1" '
    /^worktree /{p=substr($0,10)} /^branch /{if (substr($0,8)==b) print p}'
}

for b in $(git for-each-ref refs/heads --format='%(refname:short)'); do
  case "$b" in "$DEFAULT"|master|main) continue;; esac
  sha="$(git rev-parse --short "$b")"
  safe=""; reason=""
  if git merge-base --is-ancestor "$b" "origin/$DEFAULT" 2>/dev/null; then
    safe=1; reason="contained-in-$DEFAULT"
  else
    track="$(git for-each-ref "refs/heads/$b" --format='%(upstream:track)')"
    up="$(git for-each-ref "refs/heads/$b" --format='%(upstream:short)')"
    if [ "$track" = "[gone]" ]; then
      if [ "$GH_OK" = 1 ] && [ "$GH_USED" -lt "$MAXGH" ]; then
        GH_USED=$((GH_USED+1))
        head="${up#origin/}"; [ -n "$head" ] || head="$b"
        merged="$(gh pr list --state merged --head "$head" --limit 1 --json number --jq '.[0].number // empty' 2>/dev/null)"
        open="$(gh pr list --state open --head "$head" --limit 1 --json number --jq '.[0].number // empty' 2>/dev/null)"
        if [ -n "$merged" ] && [ -z "$open" ]; then
          safe=1; reason="squash-merged-pr-$merged"
        else
          emit FLAGGED "$b" "$sha" "upstream-gone-no-merged-pr"
        fi
      else
        emit FLAGGED "$b" "$sha" "upstream-gone-unverified"
      fi
    elif [ -n "$up" ]; then
      emit FLAGGED "$b" "$sha" "remote-branch-still-exists"
    else
      emit FLAGGED "$b" "$sha" "local-only-no-pr"
    fi
  fi
  [ -n "$safe" ] || continue
  if is_checked_out "$b"; then
    wt="$(wt_path_for "$b")"
    if [ -n "$wt" ] && [ "$wt" != "$ROOT" ] && [ -z "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
      if [ "$MODE" = "report" ]; then
        emit SAFE "$b" "$sha" "$reason+clean-worktree"
      else
        git worktree remove "$wt" 2>/dev/null || continue
        git branch -D "$b" >/dev/null 2>&1 && { log_del branch+worktree "$b" "$sha" "$reason"; DELETED=$((DELETED+1)); }
      fi
    else
      emit FLAGGED "$b" "$sha" "safe-but-worktree-dirty-or-main"
    fi
    continue
  fi
  if [ "$MODE" = "report" ]; then
    emit SAFE "$b" "$sha" "$reason"
  else
    git branch -D "$b" >/dev/null 2>&1 && { log_del branch "$b" "$sha" "$reason"; DELETED=$((DELETED+1)); }
  fi
done

# Stale review refs (refs/remotes/pr/N) whose PR merged. Only present when
# the project's review flow fetches PR heads to refs/remotes/pr/N; harmless
# no-op otherwise.
for ref in $(git for-each-ref 'refs/remotes/pr/' --format='%(refname)'); do
  n="${ref##*/}"
  sha="$(git rev-parse --short "$ref")"
  if [ "$GH_OK" = 1 ] && [ "$GH_USED" -lt "$MAXGH" ]; then
    GH_USED=$((GH_USED+1))
    state="$(gh pr view "$n" --json state --jq .state 2>/dev/null)"
    if [ "$state" = "MERGED" ]; then
      if [ "$MODE" = "report" ]; then
        emit SAFE "pr/$n" "$sha" "review-ref-pr-merged"
      else
        git update-ref -d "$ref" && { log_del ref "pr/$n" "$sha" "review-ref-pr-merged"; DELETED=$((DELETED+1)); }
      fi
    else
      emit FLAGGED "pr/$n" "$sha" "review-ref-pr-$state"
    fi
  else
    emit FLAGGED "pr/$n" "$sha" "review-ref-unverified"
  fi
done

git worktree prune 2>/dev/null || true

if [ "$MODE" != "report" ] && [ "$DELETED" -gt 0 ]; then
  echo "branch-sweep: removed $DELETED dead branch(es)/ref(s); ledger in $LOG"
fi
exit 0
