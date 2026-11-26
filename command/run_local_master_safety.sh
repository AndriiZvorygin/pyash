#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DEFAULT_REPOSITORY=$(cd -- "$SCRIPT_DIR/.." && pwd)
REPOSITORY=${PYA_MASTER_SAFETY_REPOSITORY:-$DEFAULT_REPOSITORY}
REMOTE=${PYA_MASTER_SAFETY_REMOTE:-github}
BRANCH=${PYA_MASTER_SAFETY_BRANCH:-master}
DEV_BRANCH=${PYA_MASTER_SAFETY_DEV_BRANCH:-dev}
ADDITIONAL_SOURCE_BRANCHES=${PYA_MASTER_SAFETY_ADDITIONAL_SOURCE_BRANCHES:-dev-vocab dev-vliw-backend}
PUSH_REMOTES=${PYA_MASTER_SAFETY_PUSH_REMOTES:-origin github}
MODEL=${PYA_MASTER_SAFETY_MODEL:-gpt-6-luna}
REASONING=${PYA_MASTER_SAFETY_REASONING:-xhigh}
MAX_REPAIRS=${PYA_MASTER_SAFETY_MAX_REPAIRS:-2}
LOCK=${PYA_MASTER_SAFETY_LOCK:-/tmp/pyash-${BRANCH}-safety.lock}
WORKTREE_PARENT=${PYA_MASTER_SAFETY_WORKTREE_PARENT:-$(dirname -- "$REPOSITORY")}

export HOME=${HOME:-/home/htaf}
CARGO_BIN="$HOME/.cargo/bin"
if [[ -d "$CARGO_BIN" ]]; then
  case ":$PATH:" in
    *":$CARGO_BIN:"*) ;;
    *) export PATH="$CARGO_BIN:$PATH" ;;
  esac
fi
NVM_ROOT="$HOME/.nvm/versions/node"
if [[ -d "$NVM_ROOT" ]]; then
  while IFS= read -r node_version; do
    node_bin="$NVM_ROOT/$node_version/bin"
    if [[ -x "$node_bin/node" && -x "$node_bin/npm" ]]; then
      case ":$PATH:" in
        *":$node_bin:"*) ;;
        *) export PATH="$node_bin:$PATH" ;;
      esac
      break
    fi
  done < <(find "$NVM_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -Vr)
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
if ! [[ "$BRANCH" =~ ^[A-Za-z0-9._-]+$ ]]; then
  printf 'PYA_MASTER_SAFETY_BRANCH must be a simple branch name.\n' >&2
  exit 2
fi
if ! [[ "$DEV_BRANCH" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$DEV_BRANCH" == "$BRANCH" ]]; then
  printf 'PYA_MASTER_SAFETY_DEV_BRANCH must be a different simple branch name.\n' >&2
  exit 2
fi
read -r -a additional_source_branches <<< "$ADDITIONAL_SOURCE_BRANCHES"
source_branch_names=("$DEV_BRANCH" "${additional_source_branches[@]}")
declare -A source_branch_seen=()
for source_branch in "${source_branch_names[@]}"; do
  if ! [[ "$source_branch" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$source_branch" == "$BRANCH" ]]; then
    printf 'invalid promotion source branch: %s\n' "$source_branch" >&2
    exit 2
  fi
  if [[ -n "${source_branch_seen[$source_branch]:-}" ]]; then
    printf 'duplicate promotion source branch: %s\n' "$source_branch" >&2
    exit 2
  fi
  source_branch_seen[$source_branch]=1
done
SOURCE_BRANCH_LIST="${source_branch_names[*]}"

mkdir -p "$REPOSITORY/artifacts/local-$BRANCH-safety" "$WORKTREE_PARENT"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
ARTIFACT_DIR="$REPOSITORY/artifacts/local-$BRANCH-safety/$RUN_ID"
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
PROMOTED_COMMIT=''
PUSHED_REMOTES=''
KEEP_WORKTREE=0
KEEP_BRANCH=0
FINAL_STATUS=failed
BASE_SHA=''
DEV_SHA=''
TEST_SUMMARY=''
TIER_SUMMARY=''
MERGE_INPUTS=''
CONFLICT_RESOLUTION_ATTEMPT=0
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
    printf 'su name source branch list ob text "%s" ya\n' "$SOURCE_BRANCH_LIST"
    printf 'su name source dev branch ob text "%s" ya\n' "$DEV_BRANCH"
    printf 'su name source dev commit ob text "%s" ya\n' "$DEV_SHA"
    if [[ -n "$MERGE_INPUTS" ]]; then
      printf 'su name remote branch inputs ob text "%s" ya\n' "$MERGE_INPUTS"
    fi
    printf 'su name push remotes ob text "%s" ya\n' "$PUSH_REMOTES"
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
    if [[ -n "$PROMOTED_COMMIT" ]]; then
      printf 'su name promoted commit ob text "%s" ya\n' "$PROMOTED_COMMIT"
    fi
    if [[ -n "$PUSHED_REMOTES" ]]; then
      printf 'su name pushed remotes ob text "%s" ya\n' "$PUSHED_REMOTES"
    fi
    printf 'prah\n'
  } > "$ARTIFACT_DIR/result.pya"
}
trap finish EXIT

printf 'local master maintainer run %s\n' "$RUN_ID"
printf 'repository: %s\nsource remote: %s\nmaster: %s\npromotion source branches: %s\npush remotes: %s\nmodel: %s (%s)\n' \
  "$REPOSITORY" "$REMOTE" "$BRANCH" "$SOURCE_BRANCH_LIST" "$PUSH_REMOTES" "$MODEL" "$REASONING"

read -r -a push_remote_names <<< "$PUSH_REMOTES"
if (( ${#push_remote_names[@]} == 0 )); then
  printf 'no push remotes configured; refusing promotion\n' >&2
  FINAL_STATUS=configuration-error
  exit 2
fi
declare -A fetched_remotes=()
remote_names=()
for remote_name in "$REMOTE" "${push_remote_names[@]}"; do
  if ! [[ "$remote_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf 'invalid git remote name: %s\n' "$remote_name" >&2
    FINAL_STATUS=configuration-error
    exit 2
  fi
  if [[ -n "${fetched_remotes[$remote_name]:-}" ]]; then continue; fi
  if ! git -C "$REPOSITORY" remote get-url "$remote_name" >/dev/null 2>&1; then
    printf 'git remote is not configured: %s\n' "$remote_name" >&2
    FINAL_STATUS=configuration-error
    exit 2
  fi
  fetch_refspecs=("+refs/heads/$BRANCH:refs/remotes/$remote_name/$BRANCH")
  for source_branch in "${source_branch_names[@]}"; do
    fetch_refspecs+=("+refs/heads/$source_branch:refs/remotes/$remote_name/$source_branch")
  done
  git -C "$REPOSITORY" fetch --no-tags "$remote_name" "${fetch_refspecs[@]}"
  fetched_remotes[$remote_name]=1
  remote_names+=("$remote_name")
done

BASE_SHA=$(git -C "$REPOSITORY" rev-parse "refs/remotes/$REMOTE/$BRANCH")
DEV_SHA=$(git -C "$REPOSITORY" rev-parse "refs/remotes/$REMOTE/$DEV_BRANCH")
declare -A snapshot_shas=()
for branch_name in "$BRANCH" "${source_branch_names[@]}"; do
  for remote_name in "${remote_names[@]}"; do
    branch_sha=$(git -C "$REPOSITORY" rev-parse "refs/remotes/$remote_name/$branch_name")
    snapshot_shas["$remote_name/$branch_name"]=$branch_sha
    if [[ -n "$MERGE_INPUTS" ]]; then MERGE_INPUTS+=" "; fi
    MERGE_INPUTS+="$remote_name/$branch_name=$branch_sha"
  done
done
printf 'remote branch tips selected for merge: %s\n' "$MERGE_INPUTS"

SHORT_SHA=${DEV_SHA:0:12}
BRANCH_NAME="local-$BRANCH-safety/$SHORT_SHA-$RUN_ID"
WORKTREE="$WORKTREE_PARENT/.pyash-$BRANCH-safety-$RUN_ID"
printf 'testing proposed merge from branch inputs: %s\nworktree: %s\n' "$MERGE_INPUTS" "$WORKTREE"
git -C "$REPOSITORY" worktree add -b "$BRANCH_NAME" "$WORKTREE" "$BASE_SHA"

resolve_generated_pinyin_conflict() {
  local conflicted_path
  conflicted_path=$(git -C "$WORKTREE" diff --name-only --diff-filter=U)
  if [[ "$conflicted_path" != 'program/library/translation/kwon_chinese_pinyin.pya' ]]; then
    return 1
  fi

  printf 'regenerating the conflicted derived Pinyin index from merged source data\n'
  if ! (cd "$WORKTREE" && npm ci && node command/generate_kwon_chinese_pinyin_index.mjs); then
    printf 'generated Pinyin index could not be rebuilt; preserving conflict for review\n'
    return 1
  fi
  git -C "$WORKTREE" add -- "$conflicted_path"
  if [[ -n "$(git -C "$WORKTREE" diff --name-only --diff-filter=U)" ]]; then
    printf 'additional merge conflicts remain; preserving candidate for review\n'
    return 1
  fi
  git -C "$WORKTREE" -c user.name='Pyash Maintainer' -c user.email='pyash-maintainer@localhost' \
    commit --no-edit --allow-empty
  printf 'resolved generated Pinyin index and completed the merge commit\n'
}

resolve_remaining_merge_conflicts() {
  local -a conflicted_paths=()
  mapfile -t conflicted_paths < <(git -C "$WORKTREE" diff --name-only --diff-filter=U)
  if (( ${#conflicted_paths[@]} == 0 )); then
    return 1
  fi

  CONFLICT_RESOLUTION_ATTEMPT=$((CONFLICT_RESOLUTION_ATTEMPT + 1))
  local attempt prompt response codex_log codex_stderr before_head
  local before_index after_index before_worktree after_worktree before_untracked after_untracked
  attempt=$(printf '%02d' "$CONFLICT_RESOLUTION_ATTEMPT")
  prompt="$ARTIFACT_DIR/codex-merge-conflict-prompt-$attempt.md"
  response="$ARTIFACT_DIR/codex-merge-conflict-result-$attempt.md"
  codex_log="$ARTIFACT_DIR/codex-merge-conflict-$attempt.jsonl"
  codex_stderr="$ARTIFACT_DIR/codex-merge-conflict-$attempt.stderr.log"
  before_index="$ARTIFACT_DIR/merge-conflict-$attempt-index-before.patch"
  after_index="$ARTIFACT_DIR/merge-conflict-$attempt-index-after.patch"
  before_worktree="$ARTIFACT_DIR/merge-conflict-$attempt-worktree-before.patch"
  after_worktree="$ARTIFACT_DIR/merge-conflict-$attempt-worktree-after.patch"
  before_untracked="$ARTIFACT_DIR/merge-conflict-$attempt-untracked-before.txt"
  after_untracked="$ARTIFACT_DIR/merge-conflict-$attempt-untracked-after.txt"
  local -a exclude_conflicts=()
  local conflicted_path
  for conflicted_path in "${conflicted_paths[@]}"; do
    exclude_conflicts+=(":(exclude)$conflicted_path")
  done

  before_head=$(git -C "$WORKTREE" rev-parse HEAD)
  git -C "$WORKTREE" diff --binary --cached HEAD -- . "${exclude_conflicts[@]}" > "$before_index"
  git -C "$WORKTREE" diff --binary -- . "${exclude_conflicts[@]}" > "$before_worktree"
  git -C "$WORKTREE" ls-files --others --exclude-standard > "$before_untracked"
  {
    cat <<EOF
# Local master maintainer merge conflict resolution

The isolated candidate worktree is stopped during a merge of $merge_sha from $remote_name/$branch_name. Resolve this Git merge carefully so both branch histories and their valid independent changes are preserved.

Only edit the conflicted paths listed below. Inspect each side with Git's stage entries and relevant source, tests, or documentation. When an output file is generated from source data, use the repository's authoritative generator after resolving its source inputs. Do not guess generated data or discard valid additions from either side.

When a conflicted path is under documentation/specifications/, run `node command/spec_audit.mjs` after resolving it and keep every specification within the audit's 16 KiB file limit. Preserve the normative behavior while meeting that limit.

Do not stage files, commit, amend, merge, push, change remotes, or edit anything outside the listed conflicted paths. Do not inspect credentials or secret files. Do not invoke GPU, media, or long-running external-model pipelines. The outer runner will verify your changes, stage the resolved files, complete the merge commit, and run the full CI-tier suite before any promotion.

Conflicted paths:
EOF
    printf -- '- `%s`\n' "${conflicted_paths[@]}"
  } > "$prompt"

  printf 'asking Codex to resolve %s merge conflict(s) in the isolated candidate\n' "${#conflicted_paths[@]}"
  if timeout --signal=TERM --kill-after=60s "${PYA_MASTER_SAFETY_CONFLICT_TIMEOUT:-30m}" \
    "$CODEX" exec \
      --model "$MODEL" \
      --config "model_reasoning_effort=\"$REASONING\"" \
      --sandbox danger-full-access \
      --ignore-user-config \
      --cd "$WORKTREE" \
      --ephemeral \
      --json \
      --output-last-message "$response" \
      - < "$prompt" \
      > "$codex_log" \
      2> "$codex_stderr"; then
    :
  else
    local codex_status=$?
    printf 'Codex conflict resolver exited with status %s; preserving candidate for review\n' "$codex_status"
    return 1
  fi

  if [[ "$(git -C "$WORKTREE" rev-parse HEAD)" != "$before_head" ]]; then
    printf 'Codex changed candidate history; preserving candidate without promotion\n' >&2
    return 1
  fi
  git -C "$WORKTREE" diff --binary --cached HEAD -- . "${exclude_conflicts[@]}" > "$after_index"
  git -C "$WORKTREE" diff --binary -- . "${exclude_conflicts[@]}" > "$after_worktree"
  git -C "$WORKTREE" ls-files --others --exclude-standard > "$after_untracked"
  if ! cmp -s "$before_index" "$after_index" || ! cmp -s "$before_worktree" "$after_worktree" || ! cmp -s "$before_untracked" "$after_untracked"; then
    printf 'Codex changed paths outside the conflict set; preserving candidate without promotion\n' >&2
    return 1
  fi

  git -C "$WORKTREE" add -- "${conflicted_paths[@]}"
  local remaining_conflicts
  remaining_conflicts=$(git -C "$WORKTREE" diff --name-only --diff-filter=U)
  if [[ -n "$remaining_conflicts" ]]; then
    printf 'Codex left unresolved merge paths; preserving candidate for review:\n%s\n' "$remaining_conflicts"
    return 1
  fi
  if git -C "$WORKTREE" grep -n -e '^<<<<<<< ' -e '^=======$' -e '^>>>>>>> ' -e '^||||||| ' -- "${conflicted_paths[@]}"; then
    printf 'resolved paths still contain merge markers; preserving candidate\n'
    return 1
  fi
  if ! git -C "$WORKTREE" diff --cached --check -- "${conflicted_paths[@]}"; then
    printf 'resolved paths still contain merge markers or whitespace errors; preserving candidate\n'
    return 1
  fi
  if [[ -n "$(git -C "$WORKTREE" diff --name-only --diff-filter=U)" ]]; then
    printf 'merge paths remain unmerged after staging; preserving candidate for review\n'
    return 1
  fi
  if ! git -C "$WORKTREE" -c user.name='Pyash Maintainer' -c user.email='pyash-maintainer@localhost' \
    commit --no-edit --allow-empty; then
    printf 'could not complete the resolved merge commit; preserving candidate for review\n'
    return 1
  fi
  printf 'Codex-resolved conflicts passed scope checks and the merge commit completed\n'
}

for branch_name in "$BRANCH" "${source_branch_names[@]}"; do
  for remote_name in "${remote_names[@]}"; do
    merge_sha=$(git -C "$REPOSITORY" rev-parse "refs/remotes/$remote_name/$branch_name")
    printf 'merging %s/%s at %s into candidate\n' "$remote_name" "$branch_name" "$merge_sha"
    if ! git -C "$WORKTREE" -c user.name='Pyash Maintainer' -c user.email='pyash-maintainer@localhost' \
      merge --no-edit "$merge_sha"; then
      if resolve_generated_pinyin_conflict || resolve_remaining_merge_conflicts; then
        continue
      fi
      printf 'branch tip merge conflict could not be resolved safely; preserving the candidate worktree for review\n'
      KEEP_WORKTREE=1
      FINAL_STATUS=merge-conflict
      exit 1
    fi
  done
done
CANDIDATE_COMMIT=$(git -C "$WORKTREE" rev-parse HEAD)
printf 'proposed merge commit: %s\n' "$CANDIDATE_COMMIT"

suite_attempt=0
repair_attempt=0
run_candidate_suite() {
  printf '\n== dependency install ==\n'
  if ! (cd "$WORKTREE" && npm ci); then
    printf 'dependency install failed; preserving candidate for review\n'
    KEEP_WORKTREE=1
    FINAL_STATUS=dependency-install-failed
    return 1
  fi

  if [[ -f "$WORKTREE/package.json" ]]; then
    printf '\n== development CI toolchain bootstrap ==\n'
    if ! (cd "$WORKTREE" && npm run bootstrap -- --with-whisper); then
      printf 'CI toolchain bootstrap failed; preserving candidate for review\n'
      KEEP_WORKTREE=1
      FINAL_STATUS=toolchain-bootstrap-failed
      return 1
    fi

    sibling_repo="$WORKTREE_PARENT/pyachso2n"
    if [[ ! -f "$sibling_repo/English30k.txt" ]]; then
      if [[ -e "$sibling_repo" ]]; then
        printf 'sibling dictionary checkout exists but is incomplete: %s\n' "$sibling_repo" >&2
        KEEP_WORKTREE=1
        FINAL_STATUS=sibling-dictionary-incomplete
        return 1
      fi
      printf '\n== provision sibling dictionary checkout ==\n'
      if ! git clone --depth 1 https://gitlab.com/pyac/pyachso2n.git "$sibling_repo"; then
        printf 'sibling dictionary checkout failed; preserving candidate for review\n'
        KEEP_WORKTREE=1
        FINAL_STATUS=sibling-dictionary-checkout-failed
        return 1
      fi
    fi

    printf '\n== install Python CI dependency ==\n'
    if ! python3 -m pip install --quiet numpy && ! python3 -m pip install --quiet --break-system-packages numpy; then
      printf 'Python CI dependency install failed; preserving candidate for review\n'
      KEEP_WORKTREE=1
      FINAL_STATUS=python-dependency-install-failed
      return 1
    fi
  fi

  if [[ -f "$WORKTREE/rust/pyac/Cargo.toml" ]]; then
    printf '\n== Rust dictionary executable build ==\n'
    if ! (cd "$WORKTREE" && cargo build --locked --release --manifest-path rust/pyac/Cargo.toml --bin pyac-dictionary); then
      printf 'Rust dictionary executable build failed; preserving candidate for review\n'
      KEEP_WORKTREE=1
      FINAL_STATUS=rust-build-failed
      return 1
    fi
  fi

  while :; do
    suite_attempt=$((suite_attempt + 1))
    printf '\n== full test suite attempt %s ==\n' "$suite_attempt"
    suite_log="$ARTIFACT_DIR/test-suite-attempt-$(printf '%02d' "$suite_attempt").log"
    suite_status=0
    run_suite_command() {
      local label=$1
      shift
      printf '\n== %s ==\n' "$label" | tee -a "$suite_log"
      if (cd "$WORKTREE" && "$@") 2>&1 | tee -a "$suite_log"; then
        return 0
      fi
      local check_status=$?
      printf 'check failed (exit %s): %s\n' "$check_status" "$label" | tee -a "$suite_log"
      suite_status=1
      return 0
    }

    run_suite_command "full Node CI-tier tests" npm run test:ci
    if [[ -f "$WORKTREE/package.json" ]]; then
      run_suite_command "GPU Housekeeper tests" npm run test:gpu-housekeeper
      run_suite_command "documentation prose check" npm run doc:prose
      run_suite_command "import graph check" npm run imports:check
      run_suite_command "house API check" npm run house:api:check
      if [[ -f "$WORKTREE/command/run_rust_ci_checks.sh" ]]; then
        run_suite_command "Rust formatting, tests, and target builds" bash command/run_rust_ci_checks.sh
      else
        printf 'Rust CI check script is missing from the candidate\n' | tee -a "$suite_log"
        suite_status=1
      fi
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
      return 1
    fi

    repair_attempt=$((repair_attempt + 1))
    failure_log="$suite_log"
    prompt="$ARTIFACT_DIR/codex-repair-prompt-$(printf '%02d' "$repair_attempt").md"
    response="$ARTIFACT_DIR/codex-repair-result-$(printf '%02d' "$repair_attempt").md"
    evidence_relative="artifacts/local-safety-evidence/test-suite-attempt-$(printf '%02d' "$suite_attempt").log"
    mkdir -p "$WORKTREE/$(dirname -- "$evidence_relative")"
    cp "$failure_log" "$WORKTREE/$evidence_relative"
    cat > "$prompt" <<EOF
# Local master maintainer full-suite repair

This fresh local worktree contains the proposed promotion from these fetched branch inputs: $MERGE_INPUTS. Its full repository CI-tier suite failed; inspect this in-worktree test output:

$evidence_relative

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
        --output-last-message "$response" \
        - < "$prompt" \
        > "$ARTIFACT_DIR/codex-repair-attempt-$(printf '%02d' "$repair_attempt").jsonl" \
        2> "$ARTIFACT_DIR/codex-repair-attempt-$(printf '%02d' "$repair_attempt").stderr.log"; then
      printf 'Codex repair attempt completed.\n'
    else
      codex_status=$?
      printf 'Codex repair attempt exited with status %s; full suite will be rerun to verify current state.\n' "$codex_status"
    fi
  done

  if [[ "$FINAL_STATUS" != passed ]]; then
    return 1
  fi
  if [[ -n "$(git -C "$WORKTREE" status --porcelain --untracked-files=all)" ]]; then
    printf '\n== record verified repair on merge candidate ==\n'
    git -C "$WORKTREE" add -A
    forbidden=$(git -C "$WORKTREE" diff --cached --name-only | rg '(^|/)(\.env($|\.)|(secret|secrets)(/|\.|$)|.*\.key$|.*credentials.*|know/|artifacts/)' || true)
    if [[ -n "$forbidden" ]]; then
      printf 'refusing to promote protected paths; candidate left in worktree:\n%s\n' "$forbidden"
      KEEP_WORKTREE=1
      FINAL_STATUS=passed-uncommitted-protected-paths
      return 1
    elif ! git -C "$WORKTREE" -c user.name='Pyash Maintainer' -c user.email='pyash-maintainer@localhost' \
      commit -m "repair full-suite failures before promoting dev $SHORT_SHA"; then
      KEEP_WORKTREE=1
      KEEP_BRANCH=1
      FINAL_STATUS=repair-commit-failed
      return 1
    else
      git -C "$WORKTREE" diff --binary "$BASE_SHA" HEAD > "$ARTIFACT_DIR/verified-repair.patch"
      CANDIDATE_COMMIT=$(git -C "$WORKTREE" rev-parse HEAD)
      printf '%s\n' "$CANDIDATE_COMMIT" > "$ARTIFACT_DIR/candidate-commit.txt"
      printf 'verified repair is recorded on the tested merge candidate\n'
    fi
  fi
  CANDIDATE_COMMIT=$(git -C "$WORKTREE" rev-parse HEAD)
  printf 'full CI-tier suite passed for all fetched branch tips\n'
  return 0
}

if ! run_candidate_suite; then exit 1; fi

MAX_INPUT_REFRESHES=2
input_refreshes=0
while :; do
  changed_inputs=()
  for remote_name in "${remote_names[@]}"; do
    fetch_refspecs=("+refs/heads/$BRANCH:refs/remotes/$remote_name/$BRANCH")
    for branch_name in "${source_branch_names[@]}"; do
      fetch_refspecs+=("+refs/heads/$branch_name:refs/remotes/$remote_name/$branch_name")
    done
    git -C "$REPOSITORY" fetch --no-tags "$remote_name" "${fetch_refspecs[@]}"
  done

  latest_inputs=""
  for branch_name in "$BRANCH" "${source_branch_names[@]}"; do
    for remote_name in "${remote_names[@]}"; do
      input_key="$remote_name/$branch_name"
      latest_sha=$(git -C "$REPOSITORY" rev-parse "refs/remotes/$input_key")
      if [[ -n "$latest_inputs" ]]; then latest_inputs+=" "; fi
      latest_inputs+="$input_key=$latest_sha"
      if [[ "$latest_sha" != "${snapshot_shas[$input_key]}" ]]; then
        printf 'remote input advanced during validation: %s %s -> %s\n' \
          "$input_key" "${snapshot_shas[$input_key]}" "$latest_sha"
        snapshot_shas["$input_key"]=$latest_sha
        if ! git -C "$WORKTREE" merge-base --is-ancestor "$latest_sha" HEAD; then
          changed_inputs+=("$input_key=$latest_sha")
        fi
      fi
    done
  done
  MERGE_INPUTS=$latest_inputs
  if (( ${#changed_inputs[@]} == 0 )); then
    break
  fi
  if (( input_refreshes >= MAX_INPUT_REFRESHES )); then
    printf 'remote branches kept advancing during validation; preserving the tested candidate without promoting stale inputs\n'
    KEEP_WORKTREE=1
    KEEP_BRANCH=1
    FINAL_STATUS=stale-inputs
    exit 1
  fi

  input_refreshes=$((input_refreshes + 1))
  printf '\n== merge remote updates and revalidate (%s/%s) ==\n' "$input_refreshes" "$MAX_INPUT_REFRESHES"
  for changed_input in "${changed_inputs[@]}"; do
    IFS='=' read -r input_key merge_sha <<< "$changed_input"
    printf 'merging refreshed %s at %s into candidate\n' "$input_key" "$merge_sha"
    if ! git -C "$WORKTREE" -c user.name='Pyash Maintainer' -c user.email='pyash-maintainer@localhost' \
      merge --no-edit "$merge_sha"; then
      if resolve_generated_pinyin_conflict || resolve_remaining_merge_conflicts; then continue; fi
      printf 'refreshed branch tip conflict could not be resolved safely; preserving candidate for review\n'
      KEEP_WORKTREE=1
      FINAL_STATUS=merge-conflict
      exit 1
    fi
  done
  CANDIDATE_COMMIT=$(git -C "$WORKTREE" rev-parse HEAD)
  if ! run_candidate_suite; then exit 1; fi
done

if [[ "$FINAL_STATUS" == passed ]]; then
  PROMOTED_COMMIT=$(git -C "$WORKTREE" rev-parse HEAD)
  for push_remote in "${push_remote_names[@]}"; do
    printf '\n== atomically promote to %s and %s on %s ==\n' "$BRANCH" "$DEV_BRANCH" "$push_remote"
    if ! git -C "$WORKTREE" push --atomic "$push_remote" \
      "$PROMOTED_COMMIT:refs/heads/$BRANCH" \
      "$PROMOTED_COMMIT:refs/heads/$DEV_BRANCH"; then
      printf 'promotion push failed for %s; preserving tested candidate for safe retry\n' "$push_remote"
      KEEP_WORKTREE=1
      KEEP_BRANCH=1
      FINAL_STATUS=push-failed
      exit 1
    fi
    if [[ -n "$PUSHED_REMOTES" ]]; then PUSHED_REMOTES+=" "; fi
    PUSHED_REMOTES+="$push_remote"
  done
  CANDIDATE_COMMIT=$PROMOTED_COMMIT
  printf '%s\n' "$PROMOTED_COMMIT" > "$ARTIFACT_DIR/promoted-commit.txt"
  FINAL_STATUS=promoted
  printf 'promoted tested commit %s to %s and %s on: %s\n' "$PROMOTED_COMMIT" "$BRANCH" "$DEV_BRANCH" "$PUSHED_REMOTES"
fi

printf 'result: %s\n' "$FINAL_STATUS"
if [[ "$FINAL_STATUS" != promoted ]]; then
  exit 1
fi
