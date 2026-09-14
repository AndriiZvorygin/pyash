#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

branch=$(git symbolic-ref --quiet --short HEAD || true)
if [[ -z "$branch" ]]; then
  printf '%s\n' "push_all: detached HEAD; checkout a branch first" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  printf '%s\n' "push_all: worktree is not clean; commit or resolve changes first" >&2
  exit 1
fi

git remote get-url origin >/dev/null

github_url="git@github.com:AndriiZvorygin/pyash.git"
if git remote get-url github >/dev/null 2>&1; then
  configured_github_url=$(git remote get-url github)
  if [[ "$configured_github_url" != "$github_url" ]]; then
    printf 'push_all: github remote points to %s, expected %s\n' "$configured_github_url" "$github_url" >&2
    exit 1
  fi
else
  git remote add github "$github_url"
fi

printf 'push_all: pushing %s to origin\n' "$branch"
git push origin "$branch"
printf 'push_all: pushing %s to github\n' "$branch"
git push github "$branch"
