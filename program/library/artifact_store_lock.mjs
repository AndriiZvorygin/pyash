import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const LOCK_DIRECTORY = ".maintenance-lock";
const ACTIVE_RUNS_DIRECTORY = ".active-runs";
const LOCK_WAIT_MS = 30 * 1000;
const LOCK_POLL_MS = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function parseLockOwner(text) {
  const pid = String(text ?? "").match(/^su name process id ob num (\d+) be number ya$/mu)?.[1];
  const token = String(text ?? "").match(/^su name lock token ob text "([a-f0-9]+)" be text ya$/mu)?.[1];
  return { pid: Number(pid), token };
}

/**
 * Take the artifact store lock.
 *
 * The lock is held for moments at a time, while a run registers itself. Runs
 * that start together — the learn pipeline runs four children at once — would
 * otherwise race for it and the loser would die over a lock that was free a
 * millisecond later. So a lock held by a living process is waited for, and
 * only a lock that is still held when the wait is over is a failure.
 */
export async function acquireArtifactStoreLock(root, { waitMs = LOCK_WAIT_MS, pollMs = LOCK_POLL_MS } = {}) {
  const artifactsRoot = path.resolve(root, "artifacts");
  await fs.mkdir(artifactsRoot, { recursive: true });
  const lockPath = path.join(artifactsRoot, LOCK_DIRECTORY);
  const deadline = Date.now() + Math.max(0, waitMs);

  for (;;) {
    try {
      await fs.mkdir(lockPath);
      const token = crypto.randomBytes(12).toString("hex");
      const ownerPath = path.join(lockPath, "owner.pya");
      const owner = [
        "su name artifact store maintenance lock be json map def",
        `su name process id ob num ${process.pid} be number ya`,
        `su name lock token ob text "${token}" be text ya`,
        "prah",
        ""
      ].join("\n");
      await fs.writeFile(ownerPath, owner, { flag: "wx" });
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          const current = parseLockOwner(await fs.readFile(ownerPath, "utf8"));
          if (current.pid === process.pid && current.token === token) {
            await fs.rm(lockPath, { recursive: true, force: true });
          }
        } catch {
          // A missing or replaced lock is not ours to remove.
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner = null;
      try {
        owner = parseLockOwner(await fs.readFile(path.join(lockPath, "owner.pya"), "utf8"));
      } catch {
        // The lock is there but its owner is not written yet: the run that
        // holds it is still starting up.
        owner = null;
      }
      if (owner && !processIsAlive(owner.pid)) {
        await fs.rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`artifact store is locked by process ${owner?.pid ?? "unknown"}: ${lockPath}`);
      }
      await sleep(pollMs);
    }
  }
}

export async function registerArtifactRun({ root, runId, onExitCleanup = true } = {}) {
  const resolvedRoot = path.resolve(String(root ?? process.cwd()));
  const safeRunId = String(runId ?? "run").replace(/[\\/\s]+/gu, "-");
  const releaseLock = await acquireArtifactStoreLock(resolvedRoot);
  let markerPath;
  try {
    const activeRoot = path.join(resolvedRoot, "artifacts", ACTIVE_RUNS_DIRECTORY);
    await fs.mkdir(activeRoot, { recursive: true });
    const markerId = crypto.randomBytes(6).toString("hex");
    markerPath = path.join(activeRoot, `${process.pid}-${markerId}-${safeRunId}.pya`);
    const marker = [
      "su name active artifact run be json map def",
      `su name process id ob num ${process.pid} be number ya`,
      `su name run id ob text ${JSON.stringify(safeRunId)} be text ya`,
      `su name started at ob text ${JSON.stringify(new Date().toISOString())} be text ya`,
      "prah",
      ""
    ].join("\n");
    await fs.writeFile(markerPath, marker, { flag: "wx" });
  } finally {
    await releaseLock();
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      fsSync.unlinkSync(markerPath);
    } catch {
      // A stale marker is safely recognized by its process id during cleanup.
    }
  };
  if (onExitCleanup) process.once("exit", cleanup);
  return { markerPath, cleanup };
}

export function activeRunMarkerDirectory(root) {
  return path.join(path.resolve(root, "artifacts"), ACTIVE_RUNS_DIRECTORY);
}
