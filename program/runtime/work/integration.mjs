import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

async function removeWorktree(repository, worktree, gitRunner) {
  try {
    await git({ cwd: repository, args: ["worktree", "remove", "--force", worktree], gitRunner });
  } catch {}
}

async function mergeOrCherryPickIntoBranch({
  repositoryRoot,
  branchRevision,
  sourceRevision,
  operation,
  gitRunner = null
}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-automation-"));
  try {
    await git({ cwd: repositoryRoot, args: ["worktree", "add", "--detach", temporary, branchRevision], gitRunner });
    await git({ cwd: temporary, args: operation, gitRunner });
    return output(await git({ cwd: temporary, args: ["rev-parse", "HEAD"], gitRunner }));
  } catch (error) {
    try {
      await git({ cwd: temporary, args: ["cherry-pick", "--abort"], gitRunner });
    } catch {}
    throw error;
  } finally {
    await removeWorktree(repositoryRoot, temporary, gitRunner);
    try {
      await fs.rm(temporary, { recursive: true, force: true });
    } catch {}
  }
}

async function updateBranchRef({ repositoryRoot, branch, nextRevision, expectedRevision, gitRunner }) {
  const args = ["update-ref", `refs/heads/${branch}`, nextRevision];
  if (expectedRevision) args.push(expectedRevision);
  await git({ cwd: repositoryRoot, args, gitRunner });
}

export async function synchronizeAutomationBranch({
  repositoryRoot,
  branch = "automation/roadmap",
  masterRef = "master",
  push = false,
  pushRemotes = ["origin", "github"],
  gitRunner = null,
  now = () => new Date()
} = {}) {
  const repository = text(repositoryRoot);
  const targetBranch = text(branch) || "automation/roadmap";
  const sourceRef = text(masterRef) || "master";
  if (!repository) throw new Error("automation baseline sync requires a repository");
  const branchRevision = output(await git({ cwd: repository, args: ["rev-parse", `refs/heads/${targetBranch}`], gitRunner }));
  const masterRevision = output(await git({ cwd: repository, args: ["rev-parse", sourceRef], gitRunner }));
  if (!branchRevision || !masterRevision) throw new Error("automation baseline sync could not resolve both branches");
  try {
    await git({ cwd: repository, args: ["merge-base", "--is-ancestor", masterRevision, branchRevision], gitRunner });
    return {
      branch: targetBranch,
      masterRef: sourceRef,
      branchRevision,
      masterRevision,
      commit: branchRevision,
      status: "up-to-date",
      integratedAt: iso(now),
      pushed: false,
      remotes: []
    };
  } catch {}
  let nextRevision;
  try {
    await git({ cwd: repository, args: ["merge-base", "--is-ancestor", branchRevision, masterRevision], gitRunner });
    nextRevision = masterRevision;
  } catch {
    nextRevision = await mergeOrCherryPickIntoBranch({
      repositoryRoot: repository,
      branchRevision,
      sourceRevision: masterRevision,
      operation: ["merge", "--no-edit", masterRevision],
      gitRunner
    });
  }
  await updateBranchRef({
    repositoryRoot: repository,
    branch: targetBranch,
    nextRevision,
    expectedRevision: branchRevision,
    gitRunner
  });
  const pushed = [];
  if (push) {
    for (const remote of pushRemotes) {
      await git({ cwd: repository, args: ["push", remote, `refs/heads/${targetBranch}:refs/heads/${targetBranch}`], gitRunner });
      pushed.push(remote);
    }
  }
  return {
    branch: targetBranch,
    masterRef: sourceRef,
    branchRevision,
    masterRevision,
    commit: nextRevision,
    status: "synchronized",
    integratedAt: iso(now),
    pushed: pushed.length > 0,
    remotes: pushed
  };
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
  await git({ cwd: repository, args: ["merge-base", "--is-ancestor", text(baseRevision), taskCommit], gitRunner });
  let branchCommit = taskCommit;
  let strategy = "fast-forward";
  if (currentBranch && currentBranch !== text(baseRevision)) {
    try {
      await git({ cwd: repository, args: ["merge-base", "--is-ancestor", text(baseRevision), currentBranch], gitRunner });
      await git({ cwd: repository, args: ["merge-base", "--is-ancestor", taskCommit, currentBranch], gitRunner });
      branchCommit = currentBranch;
      strategy = "already integrated";
    } catch {
      branchCommit = await mergeOrCherryPickIntoBranch({
        repositoryRoot: repository,
        branchRevision: currentBranch,
        sourceRevision: taskCommit,
        operation: ["cherry-pick", `${text(baseRevision)}..${taskCommit}`],
        gitRunner
      });
      strategy = "cherry-pick task history onto synchronized branch";
    }
  }
  await updateBranchRef({
    repositoryRoot: repository,
    branch: targetBranch,
    nextRevision: branchCommit,
    expectedRevision: currentBranch || "",
    gitRunner
  });
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
    branchCommit,
    status: "integrated",
    strategy,
    integratedAt: iso(now),
    pushed: pushed.length > 0,
    remotes: pushed
  };
}
