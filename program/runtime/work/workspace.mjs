import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git({ cwd, args, gitRunner = null }) {
  if (gitRunner) return gitRunner({ cwd, args });
  return execFileAsync("git", args, {
    cwd,
    maxBuffer: 4 * 1024 * 1024
  });
}

async function exists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

function stdout(result) {
  return String(result?.stdout ?? "").trim();
}

export async function prepareWorktree({
  repositoryRoot,
  worldRoot,
  taskId,
  baseRevision = "",
  baseRef = "",
  gitRunner = null
} = {}) {
  const repository = path.resolve(String(repositoryRoot || process.cwd()));
  const worktreePath = path.join(
    path.resolve(String(worldRoot)),
    "holding",
    "work",
    "worktrees",
    String(taskId)
  );
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  const revision = String(baseRevision || stdout(await git({
    cwd: repository,
    args: ["rev-parse", baseRef || "HEAD"],
    gitRunner
  }))).trim();
  if (!revision) throw new Error("worktree requires a base revision");

  if (!(await exists(worktreePath))) {
    await git({
      cwd: repository,
      args: ["worktree", "add", "--detach", worktreePath, revision],
      gitRunner
    });
  } else {
    const top = stdout(await git({
      cwd: worktreePath,
      args: ["rev-parse", "--show-toplevel"],
      gitRunner
    }));
    if (!top) throw new Error(`existing worktree is not a git worktree: ${worktreePath}`);
  }
  return {
    repository,
    baseRevision: revision,
    branch: baseRef || "detached",
    worktreePath,
    mode: "git-worktree"
  };
}

export async function collectGitEvidence({ worktreePath, gitRunner = null } = {}) {
  const [diffResult, namesResult, statusResult, revisionResult] = await Promise.all([
    git({ cwd: worktreePath, args: ["diff", "--no-ext-diff"], gitRunner }),
    git({ cwd: worktreePath, args: ["diff", "--name-only", "--no-ext-diff"], gitRunner }),
    git({ cwd: worktreePath, args: ["status", "--short"], gitRunner }),
    git({ cwd: worktreePath, args: ["rev-parse", "HEAD"], gitRunner })
  ]);
  const status = stdout(statusResult);
  const trackedNames = stdout(namesResult).split("\n").map((value) => value.trim()).filter(Boolean);
  const statusNames = status.split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  return {
    diff: String(diffResult?.stdout ?? "").slice(0, 250000),
    changedFiles: [...new Set([...trackedNames, ...statusNames])],
    status,
    revision: stdout(revisionResult)
  };
}
