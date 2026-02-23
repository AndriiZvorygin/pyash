#!/usr/bin/env bash
set -euo pipefail

parse_arg_value() {
  local flag="$1"
  shift || true
  local args=("$@")
  local i
  for ((i=0; i<${#args[@]}; i++)); do
    if [[ "${args[$i]}" == "$flag" ]]; then
      if (( i + 1 < ${#args[@]} )); then
        printf "%s" "${args[$((i + 1))]}"
        return 0
      fi
      break
    fi
  done
  return 1
}

has_flag() {
  local flag="$1"
  shift || true
  local arg
  for arg in "$@"; do
    if [[ "$arg" == "$flag" ]]; then
      return 0
    fi
  done
  return 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(parse_arg_value --repo-root "$@" || true)"
if [[ -z "${REPO_ROOT:-}" ]]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
fi

AGENT_NAME="$(parse_arg_value --agent "$@" || true)"
AGENT_NAME="${AGENT_NAME:-parity coder}"
WORLD_ROOT="$(parse_arg_value --world-root "$@" || true)"
WORLD_ROOT="${WORLD_ROOT:-$REPO_ROOT/world}"
MATRIX_ROOM="$(parse_arg_value --matrix-room "$@" || true)"
TIMEOUT_MINUTES="$(parse_arg_value --timeout-minutes "$@" || true)"
TIMEOUT_MINUTES="${TIMEOUT_MINUTES:-120}"

SKIP_CODEX=false
SKIP_PARITY=false
SKIP_NOTIFY=false
if has_flag --skip-codex "$@"; then SKIP_CODEX=true; fi
if has_flag --skip-parity "$@"; then SKIP_PARITY=true; fi
if has_flag --skip-notify "$@"; then SKIP_NOTIFY=true; fi

RUN_ID="$(date -u +%Y%m%d-%H%M%S)-parity-skill-cycle"
AGENT_HOUSE="$WORLD_ROOT/house/$AGENT_NAME"
ARTIFACT_DIR="$AGENT_HOUSE/artifacts/$RUN_ID"
LOCK_FILE="$AGENT_HOUSE/.parity-skill-cycle.lock"
mkdir -p "$ARTIFACT_DIR"
mkdir -p "$AGENT_HOUSE"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "parity-skill-cycle: another run is active; exiting."
  exit 0
fi

STAGE_LOG="$ARTIFACT_DIR/stages.log"
PROMPT_FILE="$ARTIFACT_DIR/codex-prompt.txt"
SUMMARY_FILE="$ARTIFACT_DIR/summary.txt"
NOTIFY_JSON="$ARTIFACT_DIR/notify.json"

{
  echo "run_id=$RUN_ID"
  echo "agent=$AGENT_NAME"
  echo "repo_root=$REPO_ROOT"
  echo "world_root=$WORLD_ROOT"
  echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$STAGE_LOG"

PARITY_CODE=0
CODEX_CODE=0

echo "[1/4] parity-run-and-report" | tee -a "$STAGE_LOG"
if [[ "$SKIP_PARITY" == "false" ]]; then
  set +e
  (
    cd "$REPO_ROOT"
    ./parity-run-and-report.sh
  ) > "$ARTIFACT_DIR/parity-run-and-report.log" 2>&1
  PARITY_CODE=$?
  set -e
else
  echo "parity run skipped (--skip-parity)" > "$ARTIFACT_DIR/parity-run-and-report.log"
fi
echo "parity_code=$PARITY_CODE" | tee -a "$STAGE_LOG"

cat > "$PROMPT_FILE" <<'PROMPT'
Use the local skill at skills/pyash-parity/SKILL.md and execute a parity gap improvement loop.

Hard requirements:
- Input parity snapshot: documentation/parity/status.json
- Build/update: documentation/parity/gap-targets.json
- Build/update: documentation/parity/gap-iteration-report.md
- Work only where run=success and (runjs failed or runc failed)
- Do not run parity-run-and-report.sh or parity-run.sh during this loop
- Re-run only targeted files/runners from gap targets
- Iterate while parity improves; stop on plateau or high churn risk
- Provide detailed root-cause explanations for remaining gaps
- Keep edits focused to deterministic parity improvements

When complete:
- Commit focused code/docs changes if any improvements were made
- Print a short final summary with what improved and what remains
PROMPT

if [[ "$SKIP_CODEX" == "false" ]]; then
  echo "[2/4] codex full auto parity skill" | tee -a "$STAGE_LOG"
  set +e
  (
    cd "$REPO_ROOT"
    if command -v timeout >/dev/null 2>&1; then
      timeout "${TIMEOUT_MINUTES}m" codex --full-auto "$(cat "$PROMPT_FILE")"
    else
      codex --full-auto "$(cat "$PROMPT_FILE")"
    fi
  ) > "$ARTIFACT_DIR/codex.log" 2>&1
  CODEX_CODE=$?
  set -e
else
  echo "[2/4] codex skipped (--skip-codex)" | tee -a "$STAGE_LOG"
fi
echo "codex_code=$CODEX_CODE" | tee -a "$STAGE_LOG"

echo "[3/4] summarize" | tee -a "$STAGE_LOG"
node - "$REPO_ROOT" "$AGENT_NAME" "$RUN_ID" "$PARITY_CODE" "$CODEX_CODE" > "$SUMMARY_FILE" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [repoRoot, agentName, runId, parityCodeRaw, codexCodeRaw] = process.argv.slice(2);
const parityCode = Number(parityCodeRaw || 1);
const codexCode = Number(codexCodeRaw || 1);
const statusPath = path.join(repoRoot, "documentation", "parity", "status.json");
const targetsPath = path.join(repoRoot, "documentation", "parity", "gap-targets.json");
const reportPath = path.join(repoRoot, "documentation", "parity", "gap-iteration-report.md");

let status = {};
let targets = {};
try { status = JSON.parse(fs.readFileSync(statusPath, "utf8")); } catch {}
try { targets = JSON.parse(fs.readFileSync(targetsPath, "utf8")); } catch {}

const parity = status?.parity || {};
const details = status?.details || {};
const red = Array.isArray(parity.red) ? parity.red.length : 0;
const green = Array.isArray(parity.green) ? parity.green.length : 0;
const gapCount = Number(targets?.count || 0);
const statusStamp = status?.lastRun || "unknown";
const reportExists = fs.existsSync(reportPath);

const lines = [
  `[parity-agent] run ${runId}`,
  `agent: ${agentName}`,
  `status snapshot: ${statusStamp}`,
  `parity red: ${red}`,
  `parity green: ${green}`,
  `gap targets (run green + runjs/runc red): ${gapCount}`,
  `parity-run-and-report exit: ${parityCode}`,
  `codex full-auto exit: ${codexCode}`,
  `gap report present: ${reportExists ? "yes" : "no"}`
];

const sample = Object.entries(details)
  .filter(([, info]) => info?.run?.status === "success" && (info?.runjs?.status !== "success" || info?.runc?.status !== "success"))
  .slice(0, 5)
  .map(([file, info]) => {
    const js = info?.runjs?.status || "unknown";
    const c = info?.runc?.status || "unknown";
    return `- ${file} (runjs=${js}, runc=${c})`;
  });
if (sample.length) {
  lines.push("sample remaining gaps:");
  lines.push(...sample);
}

process.stdout.write(lines.join("\n") + "\n");
NODE

if [[ "$SKIP_NOTIFY" == "false" ]]; then
  echo "[4/4] notify matrix channel" | tee -a "$STAGE_LOG"
  set +e
  if [[ -n "${MATRIX_ROOM:-}" ]]; then
    node "$REPO_ROOT/command/send_parity_channel_report.mjs" \
      --repo-root "$REPO_ROOT" \
      --world-root "$WORLD_ROOT" \
      --agent "$AGENT_NAME" \
      --matrix-room "$MATRIX_ROOM" \
      --summary-file "$SUMMARY_FILE" \
      --strict > "$NOTIFY_JSON" 2>&1
  else
    node "$REPO_ROOT/command/send_parity_channel_report.mjs" \
      --repo-root "$REPO_ROOT" \
      --world-root "$WORLD_ROOT" \
      --agent "$AGENT_NAME" \
      --summary-file "$SUMMARY_FILE" \
      --strict > "$NOTIFY_JSON" 2>&1
  fi
  NOTIFY_CODE=$?
  set -e
  echo "notify_code=$NOTIFY_CODE" | tee -a "$STAGE_LOG"
else
  echo "[4/4] notify skipped (--skip-notify)" | tee -a "$STAGE_LOG"
fi

echo "finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$STAGE_LOG"
echo "artifact_dir=$ARTIFACT_DIR" | tee -a "$STAGE_LOG"
cat "$SUMMARY_FILE"
