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

test("local maintainer tests configured development branches in an isolated worktree", () => {
  const runner = read("run_local_master_safety.sh");
  const tierRunner = fs.readFileSync(path.join(repoRoot, "command", "run_test_tiers.mjs"), "utf8");
  assert.match(runner, /refs\/heads\/\$source_branch:refs\/remotes\/\$remote_name\/\$source_branch/u);
  assert.match(runner, /PYA_MASTER_SAFETY_ADDITIONAL_SOURCE_BRANCHES:-dev-vocab dev-vliw-backend/u);
  assert.match(runner, /worktree add -b "\$BRANCH_NAME" "\$WORKTREE" "\$BASE_SHA"/u);
  assert.match(runner, /merge --no-edit "\$merge_sha"/u);
  assert.match(runner, /resolve_generated_pinyin_conflict/u);
  assert.match(runner, /node command\/generate_kwon_chinese_pinyin_index\.mjs/u);
  assert.match(runner, /remote input advanced during validation/u);
  assert.match(runner, /MAX_INPUT_REFRESHES=2/u);
  assert.match(tierRunner, /concurrency: CI_TEST_CONCURRENCY/u);
  assert.match(runner, /for branch_name in "\$BRANCH" "\$\{source_branch_names\[@\]\}"/u);
  assert.match(runner, /remote branch tips selected for merge/u);
  assert.doesNotMatch(runner, /FINAL_STATUS=remote-divergence/u);
  assert.match(runner, /npm run test:ci/u);
  assert.match(runner, /git -C "\$WORKTREE" push --atomic "\$push_remote"/u);
  assert.match(runner, /\$PROMOTED_COMMIT:refs\/heads\/\$BRANCH/u);
  assert.match(runner, /\$PROMOTED_COMMIT:refs\/heads\/\$DEV_BRANCH/u);
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
  assert.match(runner, /Do not change Git remotes, push, merge, or commit/u);
});

test("runner adds the latest NVM toolchain even when cron already has system Node and npm", () => {
  const runner = read("run_local_master_safety.sh");
  assert.match(runner, /NVM_ROOT="\$HOME\/\.nvm\/versions\/node"[\s\S]*?sort -Vr/u);
  assert.match(runner, /node_bin="\$NVM_ROOT\/\$node_version\/bin"[\s\S]*?node_bin\/node[\s\S]*?node_bin\/npm/u);
  assert.doesNotMatch(runner, /if ! command -v node[\s\S]*?NVM_ROOT/u);
});

test("runner adds an installed Cargo toolchain to cron PATH", () => {
  const runner = read("run_local_master_safety.sh");
  assert.match(runner, /CARGO_BIN="\$HOME\/\.cargo\/bin"[\s\S]*?\*":\$CARGO_BIN:"\*\)[\s\S]*?export PATH="\$CARGO_BIN:\$PATH"/u);
});

test("runner finds NVM Codex in a cron-like PATH that already contains system Node and npm", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-master-safety-cron-path-"));
  const nvmBin = path.join(tempRoot, ".nvm", "versions", "node", "v99.0.0", "bin");
  fs.mkdirSync(nvmBin, { recursive: true });
  for (const name of ["node", "npm", "codex"]) {
    const binary = path.join(nvmBin, name);
    fs.writeFileSync(binary, "#!/usr/bin/env bash\nexit 0\n");
    fs.chmodSync(binary, 0o755);
  }

  try {
    const result = execFileSync("bash", [path.join(repoRoot, "command", "run_local_master_safety.sh")], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        HOME: tempRoot,
        PATH: "/usr/bin:/bin",
        PYA_MASTER_SAFETY_REPOSITORY: path.join(tempRoot, "missing-repository")
      },
      stdio: "pipe"
    });
    assert.fail(`runner unexpectedly succeeded: ${result}`);
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`;
    assert.match(output, /Pyash repository not found/u);
    assert.doesNotMatch(output, /Codex executable not found/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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
  assert.doesNotMatch(installer, /flock/u);
  assert.match(read("run_local_master_safety.sh"), /exec 9>"\$LOCK"[\s\S]*?flock -n 9/u);
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
    assert.ok(crontab.split(/\r?\n/u).includes(`0 4 * * * ${path.join(repoRoot, "command", "run_local_master_safety.sh")}`));
    assert.doesNotMatch(crontab, /flock.*run_local_master_safety/u);
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
  git(["checkout", "-b", "dev"]);
  fs.writeFileSync(path.join(repository, "dev-change.txt"), "ready\n");
  git(["add", "dev-change.txt"]);
  git(["commit", "--quiet", "-m", "fixture dev change"]);
  const devCommit = git(["rev-parse", "HEAD"]);
  git(["checkout", "-b", "dev-vocab"]);
  fs.writeFileSync(path.join(repository, "vocab-change.txt"), "bounded vocab ready\n");
  git(["add", "vocab-change.txt"]);
  git(["commit", "--quiet", "-m", "fixture vocab change"]);
  const vocabCommit = git(["rev-parse", "HEAD"]);
  git(["checkout", "-b", "dev-vliw-backend"]);
  fs.writeFileSync(path.join(repository, "vliw-change.txt"), "bounded vliw ready\n");
  git(["add", "vliw-change.txt"]);
  git(["commit", "--quiet", "-m", "fixture vliw change"]);
  const vliwCommit = git(["rev-parse", "HEAD"]);
  git(["checkout", "master"]);
  execFileSync("git", ["clone", "--bare", "--quiet", repository, bare], { stdio: "pipe" });
  git(["remote", "add", "github", bare]);
  git(["remote", "add", "origin", bare]);

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
        PYA_MASTER_SAFETY_BRANCH: "master",
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
    assert.equal(resultMap.status.text, "promoted");
    assert.equal(resultMap["test summary"].text, "tests 5; pass 5; fail 0; skipped 0; todo 0; duration_ms 12.5");
    assert.match(resultMap["tier summary"].text, /gating 10 files/u);
    assert.equal(resultMap["source branch list"].text, "dev dev-vocab dev-vliw-backend");
    assert.equal(resultMap["source dev commit"].text, devCommit);
    assert.equal(resultMap["promoted commit"].text, vliwCommit);
    assert.equal(git(["--git-dir", bare, "rev-parse", "refs/heads/master"]), vliwCommit);
    assert.equal(git(["--git-dir", bare, "rev-parse", "refs/heads/dev"]), vliwCommit);
    assert.equal(git(["--git-dir", bare, "rev-parse", "refs/heads/dev-vocab"]), vocabCommit);
    assert.equal(git(["--git-dir", bare, "rev-parse", "refs/heads/dev-vliw-backend"]), vliwCommit);
    git(["merge-base", "--is-ancestor", devCommit, vliwCommit]);
    git(["merge-base", "--is-ancestor", vocabCommit, vliwCommit]);
    assert.equal(fs.existsSync(resultMap["worktree path"].text), false);
    assert.match(fs.readFileSync(path.join(artifactDir, "run.log"), "utf8"), /promoted tested commit/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runner regenerates the derived Pinyin index when merged vocabularies conflict", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-master-safety-pinyin-conflict-"));
  const repository = path.join(tempRoot, "repo");
  const bare = path.join(tempRoot, "remote.git");
  const fakeBin = path.join(tempRoot, "bin");
  fs.mkdirSync(path.join(repository, "command"), { recursive: true });
  fs.mkdirSync(path.join(repository, "program", "library", "translation"), { recursive: true });
  fs.mkdirSync(fakeBin);

  const git = (args, cwd = repository) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git(["init", "--quiet"]);
  git(["config", "user.name", "Safety Fixture"]);
  git(["config", "user.email", "safety-fixture@example.test"]);
  fs.copyFileSync(path.join(repoRoot, "command", "run_local_master_safety.sh"), path.join(repository, "command", "run_local_master_safety.sh"));
  fs.chmodSync(path.join(repository, "command", "run_local_master_safety.sh"), 0o755);
  fs.writeFileSync(path.join(repository, ".gitignore"), "artifacts/\n");
  fs.writeFileSync(path.join(repository, "program", "library", "translation", "kwon_chinese_pinyin.pya"), "base index\n");
  fs.writeFileSync(path.join(repository, "command", "generate_kwon_chinese_pinyin_index.mjs"), `
import fs from "node:fs";
fs.writeFileSync("program/library/translation/kwon_chinese_pinyin.pya", "regenerated from merged sources\\n");
`);
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "fixture master"]);
  git(["branch", "-M", "master"]);

  git(["checkout", "-b", "dev"]);
  fs.writeFileSync(path.join(repository, "program", "library", "translation", "kwon_chinese_pinyin.pya"), "dev index\n");
  git(["add", "program/library/translation/kwon_chinese_pinyin.pya"]);
  git(["commit", "--quiet", "-m", "fixture dev index"]);
  const devCommit = git(["rev-parse", "HEAD"]);

  git(["checkout", "-b", "dev-vocab", "master"]);
  fs.writeFileSync(path.join(repository, "program", "library", "translation", "kwon_chinese_pinyin.pya"), "vocab index\n");
  fs.writeFileSync(path.join(repository, "vocab-source.txt"), "vocab source\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "fixture vocab index"]);
  const vocabCommit = git(["rev-parse", "HEAD"]);
  git(["branch", "dev-vliw-backend", "master"]);
  git(["checkout", "master"]);
  execFileSync("git", ["clone", "--bare", "--quiet", repository, bare], { stdio: "pipe" });
  git(["remote", "add", "github", bare]);
  git(["remote", "add", "origin", bare]);

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
        PYA_MASTER_SAFETY_BRANCH: "master",
        PYA_MASTER_SAFETY_REPOSITORY: repository,
        PYA_MASTER_SAFETY_WORKTREE_PARENT: tempRoot,
        PYA_MASTER_SAFETY_CODEX_BIN: "/bin/true",
        PYA_MASTER_SAFETY_LOCK: path.join(tempRoot, "safety.lock")
      },
      stdio: "pipe"
    });
    const runRoot = path.join(repository, "artifacts", "local-master-safety");
    const [runId] = fs.readdirSync(runRoot);
    const result = await pyaFileToJson(path.join(runRoot, runId, "result.pya"));
    const resultMap = result.memory[0]?.ob?.map;
    const promoted = resultMap["promoted commit"].text;
    assert.equal(resultMap.status.text, "promoted");
    assert.equal(git(["--git-dir", bare, "show", `${promoted}:program/library/translation/kwon_chinese_pinyin.pya`]), "regenerated from merged sources");
    assert.equal(git(["--git-dir", bare, "show", `${promoted}:vocab-source.txt`]), "vocab source");
    git(["merge-base", "--is-ancestor", devCommit, promoted]);
    git(["merge-base", "--is-ancestor", vocabCommit, promoted]);
    assert.match(fs.readFileSync(path.join(runRoot, runId, "run.log"), "utf8"), /resolved generated Pinyin index/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runner asks Codex to resolve other merge conflicts and verifies the clean merge before promotion", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-master-safety-codex-conflict-"));
  const repository = path.join(tempRoot, "repo");
  const bare = path.join(tempRoot, "remote.git");
  const fakeBin = path.join(tempRoot, "bin");
  const promptCapture = path.join(tempRoot, "conflict-prompt.md");
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
  fs.writeFileSync(path.join(repository, "curated.txt"), "shared base\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "fixture master"]);
  git(["branch", "-M", "master"]);
  const masterCommit = git(["rev-parse", "HEAD"]);

  git(["checkout", "--quiet", "-b", "dev"]);
  fs.writeFileSync(path.join(repository, "curated.txt"), "development entry\n");
  fs.writeFileSync(path.join(repository, "dev-only.txt"), "keep development entry\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "fixture dev changes"]);
  const devCommit = git(["rev-parse", "HEAD"]);

  git(["checkout", "--quiet", "-b", "dev-vocab", masterCommit]);
  fs.writeFileSync(path.join(repository, "curated.txt"), "vocabulary entry\n");
  fs.writeFileSync(path.join(repository, "vocab-only.txt"), "keep vocabulary entry\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "fixture vocab changes"]);
  const vocabCommit = git(["rev-parse", "HEAD"]);
  git(["branch", "dev-vliw-backend", masterCommit]);
  git(["checkout", "--quiet", "master"]);
  execFileSync("git", ["clone", "--bare", "--quiet", repository, bare], { stdio: "pipe" });
  git(["remote", "add", "github", bare]);
  git(["remote", "add", "origin", bare]);

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
printf '%s\\n' "$prompt" > "${promptCapture}"
[[ "$prompt" == *'curated.txt'* ]]
printf 'combined entry from both branches\\n' > "$worktree/curated.txt"
printf 'fixture conflict resolution\\n' > "$last_message"
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
        PYA_MASTER_SAFETY_BRANCH: "master",
        PYA_MASTER_SAFETY_REPOSITORY: repository,
        PYA_MASTER_SAFETY_WORKTREE_PARENT: tempRoot,
        PYA_MASTER_SAFETY_CODEX_BIN: fakeCodex,
        PYA_MASTER_SAFETY_LOCK: path.join(tempRoot, "conflict.lock")
      },
      stdio: "pipe"
    });
    const runRoot = path.join(repository, "artifacts", "local-master-safety");
    const [runId] = fs.readdirSync(runRoot);
    const artifactDir = path.join(runRoot, runId);
    const result = await pyaFileToJson(path.join(artifactDir, "result.pya"));
    const resultMap = result.memory[0]?.ob?.map;
    const promoted = resultMap["promoted commit"].text;
    assert.equal(resultMap.status.text, "promoted");
    assert.equal(git(["--git-dir", bare, "show", `${promoted}:curated.txt`]), "combined entry from both branches");
    assert.equal(git(["--git-dir", bare, "show", `${promoted}:dev-only.txt`]), "keep development entry");
    assert.equal(git(["--git-dir", bare, "show", `${promoted}:vocab-only.txt`]), "keep vocabulary entry");
    git(["merge-base", "--is-ancestor", devCommit, promoted]);
    git(["merge-base", "--is-ancestor", vocabCommit, promoted]);
    assert.match(fs.readFileSync(promptCapture, "utf8"), /Only edit the conflicted paths/u);
    assert.match(fs.readFileSync(path.join(artifactDir, "codex-merge-conflict-result-01.md"), "utf8"), /fixture conflict resolution/u);
    assert.match(fs.readFileSync(path.join(artifactDir, "run.log"), "utf8"), /Codex-resolved conflicts passed scope checks/u);
    assert.equal(fs.existsSync(resultMap["worktree path"].text), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runner merges and retests a source branch that advances during CI", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-master-safety-stale-input-"));
  const repository = path.join(tempRoot, "repo");
  const bare = path.join(tempRoot, "remote.git");
  const fakeBin = path.join(tempRoot, "bin");
  const testCount = path.join(tempRoot, "test-count");
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
  fs.writeFileSync(path.join(repository, "base.txt"), "base\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "fixture master"]);
  git(["branch", "-M", "master"]);

  git(["checkout", "-b", "dev"]);
  fs.writeFileSync(path.join(repository, "dev-source.txt"), "dev\n");
  git(["add", "dev-source.txt"]);
  git(["commit", "--quiet", "-m", "fixture dev"]);

  git(["checkout", "-b", "dev-vocab", "master"]);
  fs.writeFileSync(path.join(repository, "vocab-initial.txt"), "initial vocab\n");
  git(["add", "vocab-initial.txt"]);
  git(["commit", "--quiet", "-m", "fixture initial vocab"]);
  const initialVocabCommit = git(["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(repository, "vocab-late.txt"), "late vocab update\n");
  git(["add", "vocab-late.txt"]);
  git(["commit", "--quiet", "-m", "fixture late vocab"]);
  const lateVocabCommit = git(["rev-parse", "HEAD"]);
  git(["branch", "late-vocab-holder", lateVocabCommit]);
  git(["checkout", "master"]);
  git(["branch", "-f", "dev-vocab", initialVocabCommit]);
  git(["branch", "dev-vliw-backend", "master"]);
  execFileSync("git", ["clone", "--bare", "--quiet", repository, bare], { stdio: "pipe" });
  git(["remote", "add", "github", bare]);
  git(["remote", "add", "origin", bare]);

  const fakeNpm = path.join(fakeBin, "npm");
  fs.writeFileSync(fakeNpm, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == ci ]]; then exit 0; fi
if [[ "$1 $2" == "run test:ci" ]]; then
  count=0
  if [[ -f "${testCount}" ]]; then read -r count < "${testCount}"; fi
  count=$((count + 1))
  printf '%s\\n' "$count" > "${testCount}"
  if (( count == 1 )); then
    git --git-dir "${bare}" update-ref refs/heads/dev-vocab "${lateVocabCommit}"
  fi
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
        PYA_MASTER_SAFETY_BRANCH: "master",
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
    const promoted = resultMap["promoted commit"].text;
    assert.equal(resultMap.status.text, "promoted");
    assert.equal(fs.readFileSync(testCount, "utf8").trim(), "2");
    assert.equal(git(["--git-dir", bare, "show", `${promoted}:vocab-late.txt`]), "late vocab update");
    git(["merge-base", "--is-ancestor", lateVocabCommit, promoted]);
    assert.match(fs.readFileSync(path.join(artifactDir, "run.log"), "utf8"), /merge remote updates and revalidate \(1\/2\)/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runner merges divergent master and development tips from both remotes before promotion", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-master-safety-divergent-remotes-"));
  const repository = path.join(tempRoot, "repo");
  const originBare = path.join(tempRoot, "origin.git");
  const githubBare = path.join(tempRoot, "github.git");
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
  fs.writeFileSync(path.join(repository, "base.txt"), "common base\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "fixture common base"]);
  git(["branch", "-M", "master"]);
  const commonBase = git(["rev-parse", "HEAD"]);

  fs.writeFileSync(path.join(repository, "origin-master.txt"), "origin master\n");
  git(["add", "origin-master.txt"]);
  git(["commit", "--quiet", "-m", "origin master change"]);
  const originMaster = git(["rev-parse", "HEAD"]);

  git(["checkout", "--quiet", "-b", "dev", commonBase]);
  fs.writeFileSync(path.join(repository, "origin-dev.txt"), "origin dev\n");
  git(["add", "origin-dev.txt"]);
  git(["commit", "--quiet", "-m", "origin dev change"]);
  const originDev = git(["rev-parse", "HEAD"]);

  git(["checkout", "--quiet", "-b", "origin-vocab", commonBase]);
  fs.writeFileSync(path.join(repository, "origin-vocab.txt"), "origin vocab\n");
  git(["add", "origin-vocab.txt"]);
  git(["commit", "--quiet", "-m", "origin vocab change"]);
  const originVocab = git(["rev-parse", "HEAD"]);

  git(["checkout", "--quiet", "-b", "origin-vliw", commonBase]);
  fs.writeFileSync(path.join(repository, "origin-vliw.txt"), "origin vliw\n");
  git(["add", "origin-vliw.txt"]);
  git(["commit", "--quiet", "-m", "origin vliw change"]);
  const originVliw = git(["rev-parse", "HEAD"]);

  git(["checkout", "--quiet", "-b", "github-master", commonBase]);
  fs.writeFileSync(path.join(repository, "github-master.txt"), "github master\n");
  git(["add", "github-master.txt"]);
  git(["commit", "--quiet", "-m", "github master change"]);
  const githubMaster = git(["rev-parse", "HEAD"]);

  git(["checkout", "--quiet", "-b", "github-dev", commonBase]);
  fs.writeFileSync(path.join(repository, "github-dev.txt"), "github dev\n");
  git(["add", "github-dev.txt"]);
  git(["commit", "--quiet", "-m", "github dev change"]);
  const githubDev = git(["rev-parse", "HEAD"]);

  git(["checkout", "--quiet", "-b", "github-vocab", commonBase]);
  fs.writeFileSync(path.join(repository, "github-vocab.txt"), "github vocab\n");
  git(["add", "github-vocab.txt"]);
  git(["commit", "--quiet", "-m", "github vocab change"]);
  const githubVocab = git(["rev-parse", "HEAD"]);

  git(["checkout", "--quiet", "-b", "github-vliw", commonBase]);
  fs.writeFileSync(path.join(repository, "github-vliw.txt"), "github vliw\n");
  git(["add", "github-vliw.txt"]);
  git(["commit", "--quiet", "-m", "github vliw change"]);
  const githubVliw = git(["rev-parse", "HEAD"]);
  git(["checkout", "--quiet", "master"]);

  for (const bare of [originBare, githubBare]) {
    execFileSync("git", ["clone", "--bare", "--quiet", repository, bare], { stdio: "pipe" });
  }
  git(["--git-dir", originBare, "update-ref", "refs/heads/master", originMaster]);
  git(["--git-dir", originBare, "update-ref", "refs/heads/dev", originDev]);
  git(["--git-dir", originBare, "update-ref", "refs/heads/dev-vocab", originVocab]);
  git(["--git-dir", originBare, "update-ref", "refs/heads/dev-vliw-backend", originVliw]);
  git(["--git-dir", githubBare, "update-ref", "refs/heads/master", githubMaster]);
  git(["--git-dir", githubBare, "update-ref", "refs/heads/dev", githubDev]);
  git(["--git-dir", githubBare, "update-ref", "refs/heads/dev-vocab", githubVocab]);
  git(["--git-dir", githubBare, "update-ref", "refs/heads/dev-vliw-backend", githubVliw]);
  git(["remote", "add", "origin", originBare]);
  git(["remote", "add", "github", githubBare]);

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
        PYA_MASTER_SAFETY_BRANCH: "master",
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
    const promoted = resultMap["promoted commit"].text;
    assert.equal(resultMap.status.text, "promoted");
    assert.match(resultMap["remote branch inputs"].text, new RegExp(`github/master=${githubMaster}`, "u"));
    assert.match(resultMap["remote branch inputs"].text, new RegExp(`origin/dev=${originDev}`, "u"));
    assert.match(resultMap["remote branch inputs"].text, new RegExp(`github/dev-vocab=${githubVocab}`, "u"));
    assert.match(resultMap["remote branch inputs"].text, new RegExp(`origin/dev-vocab=${originVocab}`, "u"));
    assert.match(resultMap["remote branch inputs"].text, new RegExp(`github/dev-vliw-backend=${githubVliw}`, "u"));
    assert.match(resultMap["remote branch inputs"].text, new RegExp(`origin/dev-vliw-backend=${originVliw}`, "u"));
    for (const remote of [originBare, githubBare]) {
      assert.equal(git(["--git-dir", remote, "rev-parse", "refs/heads/master"]), promoted);
      assert.equal(git(["--git-dir", remote, "rev-parse", "refs/heads/dev"]), promoted);
    }
    assert.equal(git(["--git-dir", originBare, "rev-parse", "refs/heads/dev-vocab"]), originVocab);
    assert.equal(git(["--git-dir", githubBare, "rev-parse", "refs/heads/dev-vocab"]), githubVocab);
    assert.equal(git(["--git-dir", originBare, "rev-parse", "refs/heads/dev-vliw-backend"]), originVliw);
    assert.equal(git(["--git-dir", githubBare, "rev-parse", "refs/heads/dev-vliw-backend"]), githubVliw);
    for (const input of [originMaster, originDev, originVocab, originVliw, githubMaster, githubDev, githubVocab, githubVliw]) {
      git(["merge-base", "--is-ancestor", input, promoted]);
    }
    assert.equal(git(["--git-dir", originBare, "show", `${promoted}:origin-vocab.txt`]), "origin vocab");
    assert.equal(git(["--git-dir", githubBare, "show", `${promoted}:github-vocab.txt`]), "github vocab");
    assert.equal(git(["--git-dir", originBare, "show", `${promoted}:origin-vliw.txt`]), "origin vliw");
    assert.equal(git(["--git-dir", githubBare, "show", `${promoted}:github-vliw.txt`]), "github vliw");
    assert.equal(fs.existsSync(resultMap["worktree path"].text), false);
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
  git(["checkout", "-b", "dev"]);
  fs.writeFileSync(path.join(repository, "dev-change.txt"), "ready\n");
  git(["add", "dev-change.txt"]);
  git(["commit", "--quiet", "-m", "fixture dev change"]);
  git(["branch", "dev-vocab"]);
  git(["branch", "dev-vliw-backend"]);
  git(["checkout", "master"]);
  execFileSync("git", ["clone", "--bare", "--quiet", repository, bare], { stdio: "pipe" });
  git(["remote", "add", "github", bare]);
  git(["remote", "add", "origin", bare]);

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
        PYA_MASTER_SAFETY_BRANCH: "master",
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
    assert.equal(resultMap.status.text, "promoted");
    assert.equal(resultMap["source branch list"].text, "dev dev-vocab dev-vliw-backend");
    assert.ok(resultMap["candidate commit"].text);
    assert.equal(resultMap["promoted commit"].text, resultMap["candidate commit"].text);
    assert.equal(git(["--git-dir", bare, "rev-parse", "refs/heads/master"]), resultMap["promoted commit"].text);
    assert.equal(git(["--git-dir", bare, "rev-parse", "refs/heads/dev"]), resultMap["promoted commit"].text);
    assert.equal(fs.existsSync(path.join(artifactDir, "verified-repair.patch")), true);
    assert.match(fs.readFileSync(path.join(artifactDir, "test-suite-attempt-01.log"), "utf8"), /not ok 1/u);
    assert.match(fs.readFileSync(path.join(artifactDir, "test-suite-attempt-02.log"), "utf8"), /# pass 5/u);
    assert.match(fs.readFileSync(path.join(artifactDir, "codex-repair-prompt-01.md"), "utf8"), /artifacts\/local-safety-evidence/u);
    assert.match(fs.readFileSync(path.join(artifactDir, "codex-repair-result-01.md"), "utf8"), /fixture repair verified/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
