#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DEFAULT_REPOSITORY=$(cd -- "$SCRIPT_DIR/.." && pwd)
REPOSITORY=${PYA_MASTER_SAFETY_REPOSITORY:-$DEFAULT_REPOSITORY}
REMOTE=${PYA_MASTER_SAFETY_REMOTE:-github}
BRANCH=${PYA_MASTER_SAFETY_BRANCH:-master}
MODEL=${PYA_MASTER_SAFETY_MODEL:-gpt-6-luna}
REASONING=${PYA_MASTER_SAFETY_REASONING:-xhigh}
MAX_REPAIRS=${PYA_MASTER_SAFETY_MAX_REPAIRS:-2}
LOCK=${PYA_MASTER_SAFETY_LOCK:-/tmp/pyash-master-safety.lock}
WORKTREE_PARENT=${PYA_MASTER_SAFETY_WORKTREE_PARENT:-$(dirname -- "$REPOSITORY")}

export HOME=${HOME:-/home/htaf}
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  NVM_ROOT="$HOME/.nvm/versions/node"
  if [[ -d "$NVM_ROOT" ]]; then
    LATEST_NODE=$(find "$NVM_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V | tail -1)
    if [[ -n "$LATEST_NODE" ]]; then
      export PATH="$NVM_ROOT/$LATEST_NODE/bin:$PATH"
    fi
  fi
fi
CODEX=${PYA_MASTER_SAFETY_CODEX_BIN:-$(command -v codex || true)}
if [[ -z "$CODEX" || ! -x "$CODEX" ]]; then
  printf 'Codex executable not found; configure PYA_MASTER_SAFETY_CODEX_BIN.\n' >&2
  exit 2
fi

if [[ ! -d "$REPOSITORY/.git" && ! -f "$REPOSITORY/.git" ]]; then
  printf 'Pyash repository not found: %s\n' "$REPOSITORY" >&2
  exit 2
fi
if ! [[ "$MAX_REPAIRS" =~ ^[0-2]$ ]]; then
  printf 'PYA_MASTER_SAFETY_MAX_REPAIRS must be between 0 and 2.\n' >&2
  exit 2
fi

mkdir -p "$REPOSITORY/artifacts/local-master-safety" "$WORKTREE_PARENT"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
ARTIFACT_DIR="$REPOSITORY/artifacts/local-master-safety/$RUN_ID"
mkdir -m 700 "$ARTIFACT_DIR"
LOG="$ARTIFACT_DIR/run.log"
exec > >(tee -a "$LOG") 2>&1

exec 9>"$LOCK"
if ! flock -n 9; then
  printf 'SKIP: another local master safety run holds %s\n' "$LOCK"
  exit 0
fi

WORKTREE=''
BRANCH_NAME=''
CANDIDATE_COMMIT=''
KEEP_WORKTREE=0
KEEP_BRANCH=0
FINAL_STATUS=failed
BASE_SHA=''
TEST_SUMMARY=''
TIER_SUMMARY=''
finish() {
  local exit_code=$?
  trap - EXIT
  if [[ -n "$WORKTREE" && -d "$WORKTREE" && "$KEEP_WORKTREE" -eq 0 ]]; then
    git -C "$REPOSITORY" worktree remove --force "$WORKTREE" || true
  fi
  if [[ -n "$BRANCH_NAME" && "$KEEP_WORKTREE" -eq 0 && "$KEEP_BRANCH" -eq 0 ]]; then
    git -C "$REPOSITORY" branch -D "$BRANCH_NAME" >/dev/null 2>&1 || true
  fi
  write_result "$FINAL_STATUS" "$exit_code"
  exit "$exit_code"
}
write_result() {
  local status="$1" exit_code="$2" escaped
  escaped=${WORKTREE//\\/\\\\}; escaped=${escaped//\"/\\\"}
  {
    printf 'su name local master safety run %s be json map def\n' "$RUN_ID"
    printf 'su name status ob text "%s" ya\n' "$status"
    printf 'su name exit code ob num %s ya\n' "$exit_code"
    printf 'su name source remote ob text "%s" ya\n' "$REMOTE"
    printf 'su name source branch ob text "%s" ya\n' "$BRANCH"
    printf 'su name source commit ob text "%s" ya\n' "$BASE_SHA"
    printf 'su name codex model ob text "%s" ya\n' "$MODEL"
    printf 'su name reasoning effort ob text "%s" ya\n' "$REASONING"
    printf 'su name repair limit ob num %s ya\n' "$MAX_REPAIRS"
    if [[ -n "$TEST_SUMMARY" ]]; then
      printf 'su name test summary ob text "%s" ya\n' "$TEST_SUMMARY"
    fi
    if [[ -n "$TIER_SUMMARY" ]]; then
      printf 'su name tier summary ob text "%s" ya\n' "$TIER_SUMMARY"
    fi
    printf 'su name worktree path ob text "%s" ya\n' "$escaped"
    printf 'su name log path ob filename "%s" ya\n' "$LOG"
    if [[ -n "$BRANCH_NAME" ]]; then
      printf 'su name candidate branch ob text "%s" ya\n' "$BRANCH_NAME"
    fi
    if [[ -n "$CANDIDATE_COMMIT" ]]; then
      printf 'su name candidate commit ob text "%s" ya\n' "$CANDIDATE_COMMIT"
    fi
    printf 'prah\n'
  } > "$ARTIFACT_DIR/result.pya"
}
trap finish EXIT

printf 'local master safety run %s\n' "$RUN_ID"
printf 'repository: %s\nremote: %s\nbranch: %s\nmodel: %s (%s)\n' "$REPOSITORY" "$REMOTE" "$BRANCH" "$MODEL" "$REASONING"

git -C "$REPOSITORY" fetch --no-tags "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"
BASE_SHA=$(git -C "$REPOSITORY" rev-parse "refs/remotes/$REMOTE/$BRANCH")
SHORT_SHA=${BASE_SHA:0:12}
BRANCH_NAME="local-master-safety/$SHORT_SHA-$RUN_ID"
WORKTREE="$WORKTREE_PARENT/.pyash-master-safety-$RUN_ID"
printf 'testing fetched commit: %s\nworktree: %s\n' "$BASE_SHA" "$WORKTREE"
git -C "$REPOSITORY" worktree add -b "$BRANCH_NAME" "$WORKTREE" "$BASE_SHA"

printf '\n== dependency install ==\n'
(cd "$WORKTREE" && npm ci)

suite_attempt=0
repair_attempt=0
while :; do
  suite_attempt=$((suite_attempt + 1))
  printf '\n== full test suite attempt %s ==\n' "$suite_attempt"
  suite_log="$ARTIFACT_DIR/test-suite-attempt-$(printf '%02d' "$suite_attempt").log"
  suite_status=0
  if (cd "$WORKTREE" && npm run test:ci) 2>&1 | tee "$suite_log"; then
    suite_status=0
  else
    suite_status=$?
  fi
  TEST_SUMMARY=$(sed -n -E 's/^.* (tests|pass|fail|skipped|todo) ([0-9]+)$/\1 \2/p; s/^.* duration_ms ([0-9.]+)$/duration_ms \1/p' "$suite_log" | awk 'NF { if (summary) summary = summary "; "; summary = summary $0 } END { print summary }')
  TIER_SUMMARY=$(sed -n -E '/^  gating [0-9]+ files, reporting [0-9]+ without gating, excluding [0-9]+$/p' "$suite_log" | tail -1)
  if (( suite_status == 0 )); then
    FINAL_STATUS=passed
    break
  fi

  if (( repair_attempt >= MAX_REPAIRS )); then
    printf 'full suite failed after %s repair attempts; preserving candidate worktree for review\n' "$repair_attempt"
    KEEP_WORKTREE=1
    FINAL_STATUS=failed-needs-review
    break
  fi

  repair_attempt=$((repair_attempt + 1))
  failure_log="$suite_log"
  prompt="$ARTIFACT_DIR/codex-repair-attempt-$(printf '%02d' "$repair_attempt").md"
  cat > "$prompt" <<EOF
# Local master full-suite repair

This fresh local worktree is based on GitHub $BRANCH at commit $BASE_SHA. Its full repository CI-tier suite failed; inspect the test output at:

$failure_log

Repair the actual underlying code or test defect with the smallest appropriate change. Do not weaken, delete, skip, or broaden tests just to obtain a pass. Do not access or modify files outside this worktree. Do not inspect credentials or secret files. Do not change Git remotes, push, merge, or commit. Do not invoke GPU, media, or long-running external-model pipelines. Keep scratch files under /tmp or the ignored artifacts directory, not as untracked repository files. Run focused tests for your fix and report changed files and exact commands. The outer runner will rerun the entire suite and only preserve a repair if that full run passes.

If the failure is environmental, nondeterministic, or cannot be safely repaired from the evidence, leave the code unchanged and explain why rather than guessing.
EOF
  printf '\n== Luna repair attempt %s ==\n' "$repair_attempt"
  if timeout --signal=TERM --kill-after=60s "${PYA_MASTER_SAFETY_CODEX_TIMEOUT:-90m}" \
    "$CODEX" exec \
      --model "$MODEL" \
      --config "model_reasoning_effort=\"$REASONING\"" \
      --sandbox danger-full-access \
      --ignore-user-config \
      --cd "$WORKTREE" \
      --ephemeral \
      --json \
      --output-last-message "$ARTIFACT_DIR/codex-repair-attempt-$(printf '%02d' "$repair_attempt").md" \
      - < "$prompt" \
      > "$ARTIFACT_DIR/codex-repair-attempt-$(printf '%02d' "$repair_attempt").jsonl" \
      2> "$ARTIFACT_DIR/codex-repair-attempt-$(printf '%02d' "$repair_attempt").stderr.log"; then
    printf 'Codex repair attempt completed.\n'
  else
    codex_status=$?
    printf 'Codex repair attempt exited with status %s; full suite will be rerun to verify current state.\n' "$codex_status"
  fi
done

if [[ "$FINAL_STATUS" == passed ]]; then
  if [[ -n "$(git -C "$WORKTREE" status --porcelain --untracked-files=all)" ]]; then
    printf '\n== review and record verified local candidate ==\n'
    git -C "$WORKTREE" add -A
    forbidden=$(git -C "$WORKTREE" diff --cached --name-only | rg '(^|/)(\.env($|\.)|(secret|secrets)(/|\.|$)|.*\.key$|.*credentials.*|know/|artifacts/)' || true)
    if [[ -n "$forbidden" ]]; then
      printf 'refusing to commit protected paths; candidate left in worktree:\n%s\n' "$forbidden"
      KEEP_WORKTREE=1
      FINAL_STATUS=passed-uncommitted-protected-paths
    else
      git -C "$WORKTREE" -c user.name='Pyash Local Safety' -c user.email='pyash-local-safety@localhost' \
        commit -m "repair full-suite failures on master $SHORT_SHA"
      git -C "$WORKTREE" diff --binary "$BASE_SHA" HEAD > "$ARTIFACT_DIR/verified-repair.patch"
      CANDIDATE_COMMIT=$(git -C "$WORKTREE" rev-parse HEAD)
      printf '%s\n' "$CANDIDATE_COMMIT" > "$ARTIFACT_DIR/candidate-commit.txt"
      KEEP_BRANCH=1
      printf 'verified repair commit is local only on %s\n' "$BRANCH_NAME"
    fi
  fi
  printf 'full CI-tier suite passed for %s\n' "$BASE_SHA"
fi

printf 'result: %s\n' "$FINAL_STATUS"
if [[ "$FINAL_STATUS" != passed ]]; then
  exit 1
fi
