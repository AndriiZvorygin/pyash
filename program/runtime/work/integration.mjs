import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function text(value) {
  return String(value ?? "").trim();
}

function iso(now) {
  const value = typeof now === "function" ? now() : now || new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

async function git({ cwd, args, gitRunner }) {
  if (gitRunner) return gitRunner({ cwd, args });
  return execFileAsync("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
}

function output(result) {
  return text(result?.stdout);
}

export async function integrateAcceptedWork({
  repositoryRoot,
  worktreePath,
  baseRevision,
  branch = "automation/roadmap",
  push = false,
  pushRemotes = ["origin", "github"],
  gitRunner = null,
  now = () => new Date()
} = {}) {
  const repository = text(repositoryRoot);
  const worktree = text(worktreePath);
  const targetBranch = text(branch) || "automation/roadmap";
  if (!repository || !worktree || !text(baseRevision)) {
    throw new Error("accepted work integration requires repository, worktree, and base revision");
  }
  const taskCommit = output(await git({ cwd: worktree, args: ["rev-parse", "HEAD"], gitRunner }));
  if (!taskCommit) throw new Error("accepted work integration found no task commit");
  if (taskCommit === text(baseRevision)) {
    throw new Error("accepted work integration found no commit beyond the task base");
  }
  let currentBranch = "";
  try {
    currentBranch = output(await git({
      cwd: repository,
      args: ["rev-parse", `refs/heads/${targetBranch}`],
      gitRunner
    }));
  } catch {
    currentBranch = "";
  }
  if (currentBranch && currentBranch !== text(baseRevision)) {
    throw new Error(`automation branch ${targetBranch} advanced from task base ${text(baseRevision)}`);
  }
  await git({ cwd: repository, args: ["merge-base", "--is-ancestor", text(baseRevision), taskCommit], gitRunner });
  const refArgs = ["update-ref", `refs/heads/${targetBranch}`, taskCommit];
  if (currentBranch) refArgs.push(text(baseRevision));
  await git({ cwd: repository, args: refArgs, gitRunner });
  const pushed = [];
  if (push) {
    for (const remote of pushRemotes) {
      await git({
        cwd: repository,
        args: ["push", remote, `refs/heads/${targetBranch}:refs/heads/${targetBranch}`],
        gitRunner
      });
      pushed.push(remote);
    }
  }
  return {
    branch: targetBranch,
    baseRevision: text(baseRevision),
    commit: taskCommit,
    status: "integrated",
    integratedAt: iso(now),
    pushed: pushed.length > 0,
    remotes: pushed
  };
}
