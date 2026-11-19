import fs from "node:fs/promises";
import path from "node:path";

function describeEntry(linkStats, targetStats = linkStats) {
  if (linkStats.isSymbolicLink()) {
    if (!targetStats) return "symbolic link with an unavailable target";
    if (targetStats.isDirectory()) return "symbolic link to a directory";
    if (targetStats.isFile()) return "symbolic link to a regular file";
    return "symbolic link";
  }
  if (targetStats.isDirectory()) return "directory";
  if (targetStats.isFile()) return "regular file";
  if (targetStats.isBlockDevice()) return "block device";
  if (targetStats.isCharacterDevice()) return "character device";
  if (targetStats.isFIFO()) return "FIFO";
  if (targetStats.isSocket()) return "socket";
  return "filesystem entry of unknown type";
}

export async function inspectFilesystemPath(targetPath) {
  const absolute = path.resolve(String(targetPath ?? "."));
  const root = path.parse(absolute).root;
  const components = absolute.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  let lastExistingPath = root;

  for (const component of components) {
    current = path.join(current, component);
    let linkStats;
    try {
      linkStats = await fs.lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { status: "missing", path: current, lastExistingPath };
      }
      return {
        status: "unavailable",
        path: current,
        lastExistingPath,
        errorCode: String(error?.code ?? ""),
        syscall: String(error?.syscall ?? "")
      };
    }

    let targetStats = linkStats;
    if (linkStats.isSymbolicLink()) {
      try {
        targetStats = await fs.stat(current);
      } catch {
        targetStats = null;
      }
    }
    const type = describeEntry(linkStats, targetStats);
    if (!targetStats?.isDirectory()) {
      return { status: "not-directory", path: current, type, lastExistingPath };
    }
    lastExistingPath = current;
  }

  return { status: "directory", path: absolute, type: "directory", lastExistingPath };
}

export async function buildFilesystemPathDiagnostic({
  operation,
  targetPath,
  expected = "a directory",
  inspectPath = targetPath,
  error = null,
  nextSteps = []
} = {}) {
  const target = path.resolve(String(targetPath ?? "."));
  const inspected = path.resolve(String(inspectPath ?? target));
  const inspection = await inspectFilesystemPath(inspected);
  const lines = [`Cannot ${operation || "access path"} "${target}".`];
  const errorCode = String(error?.code ?? "").trim();
  const syscall = String(error?.syscall ?? "").trim();
  if (errorCode) {
    lines.push(`Filesystem error: ${errorCode}${syscall ? ` during ${syscall}` : ""}.`);
  }

  if (inspection.status === "not-directory") {
    if (inspection.path === target) {
      lines.push(`Found a ${inspection.type} at "${inspection.path}"; expected ${expected}.`);
    } else {
      lines.push(`Blocking path component: "${inspection.path}" is ${inspection.type}; expected a directory at this path component.`);
    }
  } else if (inspection.status === "missing") {
    if (inspection.path === inspected) {
      lines.push(`Path does not exist: "${inspection.path}".`);
    } else {
      lines.push(`Required directory is missing: "${inspection.path}".`);
    }
  } else if (inspection.status === "unavailable") {
    const detail = [inspection.errorCode, inspection.syscall].filter(Boolean).join(" during ");
    lines.push(`Could not inspect path component "${inspection.path}"${detail ? ` (${detail})` : ""}.`);
  } else if (errorCode) {
    lines.push(`The path exists as a ${inspection.type}, but the operation still failed.`);
  }

  const steps = typeof nextSteps === "function" ? nextSteps(inspection) : nextSteps;
  if (steps?.length) {
    lines.push(`Next steps: ${steps.join(" ")}`);
  }

  return {
    message: lines.join("\n"),
    details: {
      operation: String(operation ?? "access path"),
      target,
      expected,
      errorCode: errorCode || undefined,
      syscall: syscall || undefined,
      pathStatus: inspection.status,
      pathComponent: inspection.path,
      found: inspection.type,
      lastExistingPath: inspection.lastExistingPath
    }
  };
}
