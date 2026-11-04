import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pyaFileToJson } from "../program/library/pya_to_json.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(repoRoot, "command", name), "utf8");

test("local master safety fetches master and runs the full CI tier in an isolated worktree", () => {
  const runner = read("run_local_master_safety.sh");
  assert.ok(runner.includes('fetch --no-tags "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"'));
  assert.match(runner, /worktree add -b "\$BRANCH_NAME" "\$WORKTREE" "\$BASE_SHA"/u);
  assert.match(runner, /npm run test:ci/u);
  assert.match(runner, /artifacts\/local-\$BRANCH-safety/u);
  assert.match(runner, /local-\$BRANCH-safety\//u);
  assert.match(runner, /MAX_REPAIRS=\$\{PYA_MASTER_SAFETY_MAX_REPAIRS:-2\}/u);
});

test("Codex repair uses the requested Luna xhigh full-access profile and verification gate", () => {
  const runner = read("run_local_master_safety.sh");
  assert.match(runner, /MODEL=\$\{PYA_MASTER_SAFETY_MODEL:-gpt-6-luna\}/u);
  assert.match(runner, /REASONING=\$\{PYA_MASTER_SAFETY_REASONING:-xhigh\}/u);
  assert.match(runner, /--sandbox danger-full-access/u);
  assert.match(runner, /--config "model_reasoning_effort=/u);
  assert.match(runner, /cp "\$failure_log" "\$WORKTREE\/\$evidence_relative"/u);
  assert.match(runner, /evidence_relative="artifacts\/local-safety-evidence/u);
  assert.match(runner, /printf 'prah\\n'/u);
  assert.match(runner, /su name test summary/u);
  assert.match(runner, /su name tier summary/u);
  assert.match(runner, /Do not weaken, delete, skip, or broaden tests/u);
  assert.match(runner, /git -C "\$WORKTREE" diff --binary "\$BASE_SHA" HEAD/u);
  assert.doesNotMatch(runner, /git -C "\$WORKTREE" push\b/u);
});

test("the local cron installer replaces only its own marked block", () => {
  const installer = fs.readFileSync(path.join(repoRoot, "command", "install_local_master_safety_cron.sh"), "utf8");
  const uninstaller = fs.readFileSync(path.join(repoRoot, "command", "uninstall_local_master_safety_cron.sh"), "utf8");
  for (const script of [installer, uninstaller]) {
    assert.match(script, /BEGIN PYASH LOCAL MASTER SAFETY/u);
    assert.match(script, /END PYASH LOCAL MASTER SAFETY/u);
    assert.match(script, /!skip \{ print \}/u);
  }
  assert.match(installer, /0 4 \* \* \*/u);
  assert.match(installer, /flock -n \/tmp\/pyash-master-safety\.lock/u);
});

test("install and uninstall preserve unrelated crontab entries", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-master-safety-cron-"));
  const bin = path.join(tempRoot, "bin");
  const state = path.join(tempRoot, "crontab.txt");
  fs.mkdirSync(bin);
  fs.writeFileSync(state, "MAILTO=operator@example.test\n*/7 * * * * echo keep-me\n");
  const fakeCrontab = path.join(bin, "crontab");
  fs.writeFileSync(fakeCrontab, `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == -l ]]; then
  cat "${state}"
else
  cp "$1" "${state}"
fi
`);
  fs.chmodSync(fakeCrontab, 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const installer = path.join(repoRoot, "command", "install_local_master_safety_cron.sh");
  const uninstaller = path.join(repoRoot, "command", "uninstall_local_master_safety_cron.sh");
  try {
    execFileSync("bash", [installer], { cwd: repoRoot, env, stdio: "pipe" });
    execFileSync("bash", [installer], { cwd: repoRoot, env, stdio: "pipe" });
    let crontab = fs.readFileSync(state, "utf8");
    assert.equal((crontab.match(/keep-me/gu) || []).length, 1);
    assert.equal((crontab.match(/BEGIN PYASH LOCAL MASTER SAFETY/gu) || []).length, 1);
    assert.equal((crontab.match(/0 4 \* \* \*/gu) || []).length, 1);
    execFileSync("bash", [uninstaller], { cwd: repoRoot, env, stdio: "pipe" });
    crontab = fs.readFileSync(state, "utf8");
    assert.match(crontab, /MAILTO=operator@example\.test/u);
    assert.match(crontab, /echo keep-me/u);
    assert.doesNotMatch(crontab, /PYASH LOCAL MASTER SAFETY/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runner completes a local fake-master run and emits a parseable result map", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-master-safety-run-"));
  const repository = path.join(tempRoot, "repo");
  const bare = path.join(tempRoot, "remote.git");
  const fakeBin = path.join(tempRoot, "bin");
  fs.mkdirSync(path.join(repository, "command"), { recursive: true });
  fs.mkdirSync(fakeBin);

  const git = (args, cwd = repository) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git(["init", "--quiet"]);
  git(["config", "user.name", "Safety Fixture"]);
  git(["config", "user.email", "safety-fixture@example.test"]);
  fs.copyFileSync(path.join(repoRoot, "command", "run_local_master_safety.sh"), path.join(repository, "command", "run_local_master_safety.sh"));
  fs.chmodSync(path.join(repository, "command", "run_local_master_safety.sh"), 0o755);
  fs.writeFileSync(path.join(repository, ".gitignore"), "artifacts/\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "fixture master"]);
  git(["branch", "-M", "master"]);
  execFileSync("git", ["clone", "--bare", "--quiet", repository, bare], { stdio: "pipe" });
  git(["remote", "add", "github", bare]);

  const fakeNpm = path.join(fakeBin, "npm");
  fs.writeFileSync(fakeNpm, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == ci ]]; then exit 0; fi
if [[ "$1 $2" == "run test:ci" ]]; then
  printf '  gating 10 files, reporting 2 without gating, excluding 1\\n'
  printf '# tests 5\\n# pass 5\\n# fail 0\\n# skipped 0\\n# todo 0\\n# duration_ms 12.5\\n'
  exit 0
fi
exit 2
`);
  fs.chmodSync(fakeNpm, 0o755);

  try {
    execFileSync("bash", [path.join(repository, "command", "run_local_master_safety.sh")], {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        PYA_MASTER_SAFETY_REMOTE: "github",
        PYA_MASTER_SAFETY_REPOSITORY: repository,
        PYA_MASTER_SAFETY_WORKTREE_PARENT: tempRoot,
        PYA_MASTER_SAFETY_CODEX_BIN: "/bin/true",
        PYA_MASTER_SAFETY_LOCK: path.join(tempRoot, "safety.lock")
      },
      stdio: "pipe"
    });
    const runRoot = path.join(repository, "artifacts", "local-master-safety");
    const [runId] = fs.readdirSync(runRoot);
    const artifactDir = path.join(runRoot, runId);
    const result = await pyaFileToJson(path.join(artifactDir, "result.pya"));
    const resultMap = result.memory[0]?.ob?.map;
    assert.equal(resultMap.status.text, "passed");
    assert.equal(resultMap["test summary"].text, "tests 5; pass 5; fail 0; skipped 0; todo 0; duration_ms 12.5");
    assert.match(resultMap["tier summary"].text, /gating 10 files/u);
    assert.equal(fs.existsSync(resultMap["worktree path"].text), false);
    assert.match(fs.readFileSync(path.join(artifactDir, "run.log"), "utf8"), /full CI-tier suite passed/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runner gives Codex failure evidence inside its worktree and verifies a repair with the full suite", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-master-safety-repair-"));
  const repository = path.join(tempRoot, "repo");
  const bare = path.join(tempRoot, "remote.git");
  const fakeBin = path.join(tempRoot, "bin");
  fs.mkdirSync(path.join(repository, "command"), { recursive: true });
  fs.mkdirSync(fakeBin);

  const git = (args, cwd = repository) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git(["init", "--quiet"]);
  git(["config", "user.name", "Safety Fixture"]);
  git(["config", "user.email", "safety-fixture@example.test"]);
  fs.copyFileSync(path.join(repoRoot, "command", "run_local_master_safety.sh"), path.join(repository, "command", "run_local_master_safety.sh"));
  fs.chmodSync(path.join(repository, "command", "run_local_master_safety.sh"), 0o755);
  fs.writeFileSync(path.join(repository, ".gitignore"), "artifacts/\n");
  fs.writeFileSync(path.join(repository, "repair.flag"), "unfixed\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "fixture master"]);
  git(["branch", "-M", "master"]);
  execFileSync("git", ["clone", "--bare", "--quiet", repository, bare], { stdio: "pipe" });
  git(["remote", "add", "github", bare]);

  const fakeNpm = path.join(fakeBin, "npm");
  fs.writeFileSync(fakeNpm, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == ci ]]; then exit 0; fi
if [[ "$1 $2" == "run test:ci" ]]; then
  if [[ "$(cat repair.flag)" != verified ]]; then
    printf 'not ok 1 - fixture full suite failure\\n'
    exit 1
  fi
  printf '  gating 10 files, reporting 2 without gating, excluding 1\\n'
  printf '# tests 5\\n# pass 5\\n# fail 0\\n# skipped 0\\n# todo 0\\n# duration_ms 12.5\\n'
  exit 0
fi
exit 2
`);
  fs.chmodSync(fakeNpm, 0o755);

  const fakeCodex = path.join(fakeBin, "codex");
  fs.writeFileSync(fakeCodex, `#!/usr/bin/env bash
set -euo pipefail
worktree=''
last_message=''
while (($#)); do
  case "$1" in
    --cd) worktree="$2"; shift 2 ;;
    --output-last-message) last_message="$2"; shift 2 ;;
    *) shift ;;
  esac
done
prompt=$(cat)
[[ "$prompt" == *'artifacts/local-safety-evidence/test-suite-attempt-01.log'* ]]
[[ -s "$worktree/artifacts/local-safety-evidence/test-suite-attempt-01.log" ]]
grep -q 'not ok 1' "$worktree/artifacts/local-safety-evidence/test-suite-attempt-01.log"
printf 'verified\\n' > "$worktree/repair.flag"
printf 'fixture repair verified\\n' > "$last_message"
printf '{"type":"turn.completed"}\\n'
`);
  fs.chmodSync(fakeCodex, 0o755);

  try {
    execFileSync("bash", [path.join(repository, "command", "run_local_master_safety.sh")], {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        PYA_MASTER_SAFETY_REMOTE: "github",
        PYA_MASTER_SAFETY_REPOSITORY: repository,
        PYA_MASTER_SAFETY_WORKTREE_PARENT: tempRoot,
        PYA_MASTER_SAFETY_CODEX_BIN: fakeCodex,
        PYA_MASTER_SAFETY_LOCK: path.join(tempRoot, "repair.lock")
      },
      stdio: "pipe"
    });
    const runRoot = path.join(repository, "artifacts", "local-master-safety");
    const [runId] = fs.readdirSync(runRoot);
    const artifactDir = path.join(runRoot, runId);
    const result = await pyaFileToJson(path.join(artifactDir, "result.pya"));
    const resultMap = result.memory[0]?.ob?.map;
    assert.equal(resultMap.status.text, "passed");
    assert.ok(resultMap["candidate commit"].text);
    assert.equal(fs.existsSync(path.join(artifactDir, "verified-repair.patch")), true);
    assert.match(fs.readFileSync(path.join(artifactDir, "test-suite-attempt-01.log"), "utf8"), /not ok 1/u);
    assert.match(fs.readFileSync(path.join(artifactDir, "test-suite-attempt-02.log"), "utf8"), /# pass 5/u);
    assert.match(fs.readFileSync(path.join(artifactDir, "codex-repair-prompt-01.md"), "utf8"), /artifacts\/local-safety-evidence/u);
    assert.match(fs.readFileSync(path.join(artifactDir, "codex-repair-result-01.md"), "utf8"), /fixture repair verified/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
