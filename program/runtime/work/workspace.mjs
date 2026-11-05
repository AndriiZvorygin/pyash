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

export function isInsideDirectory(directory, target) {
  const relative = path.relative(path.resolve(directory), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function resolveWorktreePath({
  repositoryRoot = process.cwd(),
  worldRoot = "",
  taskId = "",
  worktreePath = "",
  worktreeRoot = "",
  env = process.env
} = {}) {
  const requestedPath = String(worktreePath || "").trim();
  if (requestedPath) return path.resolve(requestedPath);

  const repository = path.resolve(String(repositoryRoot || process.cwd()));
  const configuredRoot = String(worktreeRoot || env?.PYA_WORKTREE_ROOT || "").trim();
  const root = configuredRoot
    ? path.resolve(configuredRoot)
    : path.join(path.dirname(repository), `${path.basename(repository)}-worktrees`);
  if (worldRoot && isInsideDirectory(path.join(worldRoot, "holding"), root)) {
    throw new Error("worktree root must be outside world/holding");
  }
  return path.resolve(root, String(taskId));
}

export async function prepareWorktree({
  repositoryRoot,
  worldRoot,
  taskId,
  baseRevision = "",
  baseRef = "",
  worktreePath: requestedWorktreePath = "",
  worktreeRoot = "",
  gitRunner = null
} = {}) {
  const repository = path.resolve(String(repositoryRoot || process.cwd()));
  const worktreePath = resolveWorktreePath({
    repositoryRoot: repository,
    worldRoot,
    taskId,
    worktreePath: requestedWorktreePath,
    worktreeRoot
  });
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
  const status = String(statusResult?.stdout ?? "").trimEnd();
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
