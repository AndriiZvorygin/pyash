import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "../../understand/index.mjs";
import { splitSentences } from "../../library/sentenceSplitter.mjs";

const execFileAsync = promisify(execFile);

async function git({ cwd, args, gitRunner = null }) {
  if (gitRunner) return gitRunner({ cwd, args });
  return execFileAsync("git", args, {
    cwd,
    maxBuffer: 4 * 1024 * 1024
  });
}

function stdout(result) {
  return String(result?.stdout ?? "").trim();
}

async function gitStatus(repositoryRoot, gitRunner) {
  return String((await git({
    cwd: repositoryRoot,
    args: ["status", "--porcelain", "--untracked-files=normal"],
    gitRunner
  }))?.stdout ?? "").trim();
}

async function currentBranch(repositoryRoot) {
  return stdout(await git({ cwd: repositoryRoot, args: ["symbolic-ref", "--short", "-q", "HEAD"] }));
}

function leaseOwner(raw) {
  const owner = {};
  for (const source of splitSentences(String(raw ?? ""))) {
    try {
      const sentence = parse(source.trim());
      if (sentence?.su?.name === "number") owner.pid = Number(sentence?.ob?.num) || 0;
      if (sentence?.su?.name === "machine") owner.host = String(sentence?.ob?.text ?? "");
    } catch {}
  }
  return owner;
}

async function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readLease(lockPath) {
  try {
    return leaseOwner(await fs.readFile(lockPath, "utf8"));
  } catch {
    return {};
  }
}

async function staleMalformedLease(lockPath) {
  try {
    const stat = await fs.stat(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs > 30_000;
  } catch {
    return true;
  }
}

export async function acquireSharedWorkspaceLease({ repositoryRoot, worldRoot } = {}) {
  const repository = path.resolve(String(repositoryRoot || process.cwd()));
  const root = path.resolve(String(worldRoot || "world"));
  const lockPath = path.join(root, "holding", "work", "runtime", "shared-workspace.lock.pya");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = await readLease(lockPath);
      if (!owner.pid && await staleMalformedLease(lockPath)) {
        await fs.rm(lockPath, { force: true });
        continue;
      }
      if (owner.host !== os.hostname() || await processExists(owner.pid)) {
        return { status: "busy", reason: "another agent owns the shared repository" };
      }
      await fs.rm(lockPath, { force: true });
    }
  }
  if (!handle) return { status: "busy", reason: "another agent owns the shared repository" };

  const leaseContents = [
    "su name workspace be map def",
    `su name machine ob text ${JSON.stringify(os.hostname())} ya`,
    `su name number ob num ${process.pid} ya`,
    "prah",
    ""
  ].join("\n");
  await handle.writeFile(leaseContents, "utf8");
  await handle.close();

  let originalBranch = "";
  let originalRevision = "";

  const release = async () => {
    const owner = await readLease(lockPath);
    if (owner.pid === process.pid && owner.host === os.hostname()) {
      try {
        const dirty = originalRevision ? await gitStatus(repository) : "unavailable";
        if (originalRevision && !dirty) {
          const branch = await currentBranch(repository);
          if ((originalBranch && branch !== originalBranch) || (!originalBranch && branch)) {
            await git({
              cwd: repository,
              args: originalBranch
                ? ["switch", "--quiet", originalBranch]
                : ["switch", "--quiet", "--detach", originalRevision]
            });
          }
        }
      } catch {
        // A failed restoration leaves the checkout where the worker stopped.
      } finally {
        await fs.rm(lockPath, { force: true });
      }
    }
  };

  try {
    const top = stdout(await git({ cwd: repository, args: ["rev-parse", "--show-toplevel"] }));
    if (!top) {
      await release();
      return { status: "invalid-repository", reason: "shared workspace is not a Git repository" };
    }
    originalBranch = await currentBranch(repository);
    originalRevision = stdout(await git({ cwd: repository, args: ["rev-parse", "HEAD"] }));
    const dirty = await gitStatus(repository);
    if (dirty) {
      await release();
      return {
        status: "dirty",
        reason: "shared repository has uncommitted changes; agent work is deferred to preserve them",
        changedPaths: dirty.split("\n").map((line) => line.slice(3).trim()).filter(Boolean)
      };
    }
  } catch (error) {
    await release();
    throw error;
  }

  return { status: "acquired", repositoryRoot: repository, release };
}

export async function prepareSharedCheckout({
  repositoryRoot,
  baseRef = "",
  gitRunner = null
} = {}) {
  const repository = path.resolve(String(repositoryRoot || process.cwd()));
  const top = stdout(await git({ cwd: repository, args: ["rev-parse", "--show-toplevel"], gitRunner }));
  if (!top) throw new Error("shared workspace is not a Git repository");
  const dirty = await gitStatus(repository, gitRunner);
  if (dirty) throw new Error(`dirty shared repository: ${dirty.split("\n").map((line) => line.slice(3).trim()).join(", ")}`);
  const requestedBranch = String(baseRef || "").trim();
  if (requestedBranch) {
    const target = stdout(await git({ cwd: repository, args: ["rev-parse", "--verify", `refs/heads/${requestedBranch}`], gitRunner }));
    if (!target) throw new Error(`shared repository branch does not exist: ${requestedBranch}`);
    const current = await currentBranch(repository);
    if (current !== requestedBranch) {
      await git({ cwd: repository, args: ["switch", "--quiet", requestedBranch], gitRunner });
    }
  }
  const revision = stdout(await git({ cwd: repository, args: ["rev-parse", "HEAD"], gitRunner }));
  if (!revision) throw new Error("shared repository has no HEAD revision");
  const branch = stdout(await git({ cwd: repository, args: ["branch", "--show-current"], gitRunner })) || "detached";
  return {
    repository,
    baseRevision: revision,
    branch,
    worktreePath: repository,
    mode: "shared-checkout"
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
