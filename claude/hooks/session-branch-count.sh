#!/usr/bin/env bash
# session-branch-count.sh — SessionStart tripwire. Plain stdout = context
# injection (systemMessage is user-only). Pure local git: no fetch, no gh.
set -u
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
branches=$(git for-each-ref refs/heads --format='x' | wc -l)
worktrees=$(( $(git worktree list 2>/dev/null | wc -l) - 1 ))
echo "Repo hygiene: $branches local branch(es), $worktrees extra worktree(s)."
if [ "$branches" -gt 15 ] || [ "$worktrees" -gt 2 ]; then
  echo "Branch cruft is accumulating — consider running: bash .claude/hooks/branch-sweep.sh apply (report mode first if unsure)."
fi
exit 0
