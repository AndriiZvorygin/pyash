#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

branch=$(git symbolic-ref --quiet --short HEAD || true)
if [[ -z "$branch" ]]; then
  printf '%s\n' "push_all: detached HEAD; checkout a branch first" >&2
  exit 1
fi

# Uncommitted work is not part of what we push, so a dirty worktree is
# reported rather than fatal: another agent may be mid-edit in this repo.
if [[ -n "$(git status --porcelain)" ]]; then
  printf '%s\n' "push_all: worktree has uncommitted changes; pushing committed work only" >&2
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  printf '%s\n' "push_all: no origin remote configured" >&2
  exit 1
fi

github_repo_path="AndriiZvorygin/pyash.git"
canonical_github_url="git@github.com:${github_repo_path}"

if git remote get-url github >/dev/null 2>&1; then
  configured_github_url=$(git remote get-url github)
else
  git remote add github "$canonical_github_url"
  configured_github_url=$canonical_github_url
fi

# Accept the canonical URL or a ~/.ssh/config alias that resolves to
# github.com; reject anything else before pushing.
if ! node command/push_all_check.mjs "$configured_github_url"; then
  exit 1
fi

printf 'push_all: pushing %s to origin\n' "$branch"
git push origin "$branch"
printf 'push_all: pushing %s to github (%s)\n' "$branch" "$configured_github_url"
git push github "$branch"
printf 'push_all: done\n'
