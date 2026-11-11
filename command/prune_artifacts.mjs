#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "../program/understand/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { readNewspaperLimits } from "../program/agent/newspaper_retention.mjs";

export const ARTIFACT_RETENTION_DAYS = 30;

const RUN_DIRECTORY_PATTERN = /^(?:\d{8}-(?:\d{3,4}-)?[A-Za-z0-9][A-Za-z0-9._-]*|\d{8}T\d{6,}(?:Z)?-\d+-.+)$/u;
const LOG_EXTENSIONS = new Set([".pya"]);
const TEXT_EXTENSIONS = new Set([
  ".csv", ".js", ".json", ".log", ".md", ".mjs", ".pya", ".sh",
  ".srt", ".toml", ".txt", ".yaml", ".yml",
]);
const PYA_SENTENCE_PREFIX = /^(?:exists|su|ob|from|to|as|via|through|with|be|at|during|when|while|la|ko|prah|ret|can|pi7|que|def|do|ya|vyah)\b/u;
const SHA256_PATTERN = /\b[a-f0-9]{64}\b/giu;
const CONTENT_OBJECT_PATTERN = /^([a-f0-9]{64})(?:\.[a-z0-9._-]+)?$/iu;
const SKIP_DIRECTORY_NAMES = new Set([".cache", "node_modules", "target"]);
const MAX_REFERENCE_FILE_BYTES = 64 * 1024 * 1024;

function addIssue(state, message) {
  state.issueCount += 1;
  if (state.issues.length < 30) state.issues.push(message);
  state.referenceScanComplete = false;
}

function isInHolding(root, candidate) {
  return path.relative(root, candidate).split(path.sep).slice(0, 2).join(path.sep) === path.join("world", "holding");
}

function isSecretPath(relative) {
  const parts = relative.split(path.sep);
  return parts.some((part) => part === ".env" || part === "secret" || part === "secrets")
    || parts.some((part) => /^secret\./iu.test(part));
}

function isTextFile(filePath, relative, { inArtifact, inNewspaper }) {
  if (isSecretPath(relative)) return false;
  const extension = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();
  if (inNewspaper) return LOG_EXTENSIONS.has(extension) || /^text-\d{6}\.txt$/iu.test(basename);
  if (inArtifact) return TEXT_EXTENSIONS.has(extension);
  return extension === ".pya"
    || ((basename.includes("metadata") || basename.includes("manifest")) && TEXT_EXTENSIONS.has(extension));
}

function walkWorkspace(root) {
  const state = {
    artifactRoots: [],
    newspaperRoots: [],
    contentStores: [],
    gitRoots: new Set(),
    referenceFiles: new Set(),
    issues: [],
    issueCount: 0,
    referenceScanComplete: true,
  };
  const stack = [{ directory: root, inArtifact: false, inNewspaper: false }];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch (error) {
      addIssue(state, `cannot read ${path.relative(root, current.directory) || "."}: ${error.code || error.message}`);
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current.directory, entry.name);
      const relative = path.relative(root, entryPath);
      if (entry.name === ".git") {
        state.gitRoots.add(current.directory);
        continue;
      }
      if (entry.isSymbolicLink()) {
        const name = entry.name.toLowerCase();
        if (!isSecretPath(relative)
          && (current.inArtifact || current.inNewspaper || name.endsWith(".pya") || name.includes("metadata") || name.includes("manifest"))) {
          addIssue(state, `skipping symlink in reference area: ${relative}`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        const inArtifact = current.inArtifact || entry.name === "artifacts";
        const inNewspaper = current.inNewspaper || entry.name === "newspaper";
        if (entry.name === "artifacts") state.artifactRoots.push(entryPath);
        if (entry.name === "newspaper") state.newspaperRoots.push(entryPath);
        if (inArtifact && entry.name === "sha256") {
          state.contentStores.push(entryPath);
          continue;
        }
        if (SKIP_DIRECTORY_NAMES.has(entry.name)) continue;
        stack.push({ directory: entryPath, inArtifact, inNewspaper });
      } else if (entry.isFile() && isTextFile(entryPath, relative, current)) {
        state.referenceFiles.add(entryPath);
      }
    }
  }

  return state;
}

function trackedFiles(root, state) {
  const files = new Set();
  for (const repository of state.gitRoots) {
    const result = spawnSync("git", ["-C", repository, "ls-files", "-z"], { encoding: "buffer" });
    if (result.error || result.status !== 0) {
      addIssue(state, `cannot enumerate tracked files in ${path.relative(root, repository) || "."}`);
      continue;
    }
    for (const item of result.stdout.toString("utf8").split("\0")) {
      if (!item) continue;
      const absolute = path.resolve(repository, item);
      if (!isSecretPath(path.relative(root, absolute))) files.add(absolute);
    }
  }
  return files;
}

function trackedDirectoryIndex(tracked) {
  const directories = new Set();
  for (const file of tracked) {
    let directory = path.dirname(file);
    while (directory !== path.dirname(directory)) {
      directories.add(directory);
      directory = path.dirname(directory);
    }
  }
  return directories;
}

function trackedTextFiles(tracked) {
  return new Set([...tracked].filter((file) => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())));
}

function inspectTree(root, directory) {
  const result = { newestMtimeMs: 0, logicalBytes: 0, fileCount: 0, hasLock: false, containsGit: false, inodes: new Map(), rootDev: null, rootIno: null, error: null };
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
      const stat = fs.lstatSync(current);
      if (current === directory) {
        result.rootDev = stat.dev;
        result.rootIno = stat.ino;
      }
      result.newestMtimeMs = Math.max(result.newestMtimeMs, stat.mtimeMs);
    } catch (error) {
      result.error = `${path.relative(root, current)}: ${error.code || error.message}`;
      return result;
    }
    for (const entry of entries) {
      if (entry.name === ".git") {
        result.containsGit = true;
        continue;
      }
      const entryPath = path.join(current, entry.name);
      let stat;
      try {
        stat = fs.lstatSync(entryPath);
      } catch (error) {
        result.error = `${path.relative(root, entryPath)}: ${error.code || error.message}`;
        return result;
      }
      result.newestMtimeMs = Math.max(result.newestMtimeMs, stat.mtimeMs);
      if (/(?:^|[._-])(?:active|lock|running)(?:[._-]|$)|\.pid$/iu.test(entry.name)) result.hasLock = true;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        result.fileCount += 1;
        result.logicalBytes += stat.size;
        if (stat.nlink > 1) {
          const key = `${stat.dev}:${stat.ino}`;
          result.inodes.set(key, (result.inodes.get(key) || 0) + 1);
        }
      }
    }
  }
  return result;
}

function collectNewspaperCandidates(root, roots, cutoffMs, tracked) {
  const candidates = [];
  const issues = [];
  const stack = [...roots];
  while (stack.length) {
    const directory = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      issues.push(`${path.relative(root, directory)}: ${error.code || error.message}`);
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile() || (!LOG_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !/^text-\d{6}\.txt$/iu.test(entry.name))) continue;
      if (tracked.has(entryPath) || isInHolding(root, entryPath)) continue;
      try {
        const stat = fs.lstatSync(entryPath);
        if (stat.mtimeMs >= cutoffMs) continue;
        candidates.push({
          path: entryPath,
          relative: path.relative(root, entryPath),
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          inode: stat.nlink > 1 ? `${stat.dev}:${stat.ino}` : null,
          dev: stat.dev,
          ino: stat.ino,
          nlink: stat.nlink,
        });
      } catch (error) {
        issues.push(`${path.relative(root, entryPath)}: ${error.code || error.message}`);
      }
    }
  }
  return { candidates, issues };
}

function normalizeRunReference(value) {
  const id = String(value ?? "").replaceAll("\\", "/").split("/")[0];
  return RUN_DIRECTORY_PATTERN.test(id) ? id : "";
}

function artifactRunReference(value) {
  const normalized = String(value ?? "").replaceAll("\\", "/");
  const match = normalized.match(/(?:^|\/)artifacts\/([^/]+)(?:\/|$)/u);
  return normalizeRunReference(match?.[1]);
}

function retainedRunReferences(root, newspaperRoots, expiredPaths, state) {
  const references = new Set();
  const stack = [...newspaperRoots];
  let complete = true;
  while (stack.length) {
    const directory = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      addIssue(state, `cannot inspect retained newspapers ${path.relative(root, directory)}: ${error.code || error.message}`);
      complete = false;
      continue;
    }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(filename);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".pya" || expiredPaths.has(filename)) continue;
      let source;
      try {
        source = fs.readFileSync(filename, "utf8");
      } catch (error) {
        addIssue(state, `cannot read retained newspaper ${path.relative(root, filename)}: ${error.code || error.message}`);
        complete = false;
        continue;
      }
      const baseReference = normalizeRunReference(path.basename(filename, ".pya"));
      if (baseReference) references.add(baseReference);
      for (const rawSentence of splitSentences(source, { includeThen: true })) {
        const sentenceText = rawSentence.trim();
        if (!sentenceText || !PYA_SENTENCE_PREFIX.test(sentenceText)) continue;
        let sentence;
        try {
          sentence = parse(sentenceText);
        } catch {
          if (/\bbe\s+(?:run|artifact)\b/u.test(sentenceText)) {
            addIssue(state, `cannot parse retained newspaper run reference: ${path.relative(root, filename)}`);
            complete = false;
          }
          continue;
        }
        if (sentence?.be === "run") {
          const reference = normalizeRunReference(sentence?.su?.name);
          if (reference) references.add(reference);
        }
        if (sentence?.be === "artifact") {
          const reference = artifactRunReference(sentence?.to?.filename ?? sentence?.ob?.filename);
          if (reference) references.add(reference);
        }
      }
    }
  }
  return { references, complete };
}

function collectRunCandidates(root, artifactRoots, cutoffMs, trackedDirectories, retainedRuns, state) {
  const candidates = [];
  if (!retainedRuns.complete) return candidates;
  for (const artifactRoot of artifactRoots) {
    let entries;
    try {
      entries = fs.readdirSync(artifactRoot, { withFileTypes: true });
    } catch (error) {
      addIssue(state, `cannot read ${path.relative(root, artifactRoot)}: ${error.code || error.message}`);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !RUN_DIRECTORY_PATTERN.test(entry.name)) continue;
      const directory = path.join(artifactRoot, entry.name);
      if (isInHolding(root, directory)) continue;
      if (trackedDirectories.has(directory)) continue;
      if (retainedRuns.references.has(entry.name)) continue;
      const info = inspectTree(root, directory);
      if (info.error) {
        addIssue(state, `cannot inspect run directory ${info.error}`);
        continue;
      }
      if (info.hasLock || info.containsGit || info.newestMtimeMs >= cutoffMs) continue;
      candidates.push({
        path: directory,
        relative: path.relative(root, directory),
        newestMtimeMs: info.newestMtimeMs,
        rootDev: info.rootDev,
        rootIno: info.rootIno,
        logicalBytes: info.logicalBytes,
        fileCount: info.fileCount,
        inodes: info.inodes,
      });
    }
  }
  return candidates;
}

function collectContentObjects(root, stores, cutoffMs, state) {
  const objects = [];
  for (const store of stores) {
    const stack = [store];
    while (stack.length) {
      const directory = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch (error) {
        addIssue(state, `cannot inspect content store ${path.relative(root, directory)}: ${error.code || error.message}`);
        continue;
      }
      for (const entry of entries) {
        const filePath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push(filePath);
          continue;
        }
        if (!entry.isFile()) continue;
        const match = CONTENT_OBJECT_PATTERN.exec(entry.name);
        if (!match) continue;
        try {
          const stat = fs.lstatSync(filePath);
          if (stat.mtimeMs >= cutoffMs) continue;
          objects.push({
            path: filePath,
            relative: path.relative(root, filePath),
            hash: match[1].toLowerCase(),
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            dev: stat.dev,
            ino: stat.ino,
            nlink: stat.nlink,
            inode: `${stat.dev}:${stat.ino}`,
          });
        } catch (error) {
          addIssue(state, `cannot stat content object ${path.relative(root, filePath)}: ${error.code || error.message}`);
        }
      }
    }
  }
  return objects;
}

function scanReferences(root, files, excludedPaths, state) {
  const hashes = new Set();
  for (const filePath of files) {
    if (hasExcludedAncestor(filePath, excludedPaths)) continue;
    let stat;
    let readablePath = filePath;
    try {
      stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        readablePath = fs.realpathSync(filePath);
        stat = fs.statSync(readablePath);
      }
      if (!stat.isFile()) {
        if (stat.isDirectory()) addIssue(state, `text reference resolves to a directory: ${path.relative(root, filePath)}`);
        continue;
      }
      if (stat.size > MAX_REFERENCE_FILE_BYTES) {
        addIssue(state, `reference file exceeds scan limit: ${path.relative(root, filePath)}`);
        continue;
      }
      const content = fs.readFileSync(readablePath, "utf8");
      for (const match of content.matchAll(SHA256_PATTERN)) hashes.add(match[0].toLowerCase());
    } catch (error) {
      addIssue(state, `cannot scan reference ${path.relative(root, filePath)}: ${error.code || error.message}`);
    }
  }
  return hashes;
}

function mergeInodes(target, source) {
  for (const [key, count] of source) target.set(key, (target.get(key) || 0) + count);
}

function hasExcludedAncestor(filePath, excludedPaths) {
  let current = filePath;
  while (true) {
    if (excludedPaths.has(current)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function createArtifactRetentionPlan({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  now = Date.now(),
  retentionDays = ARTIFACT_RETENTION_DAYS,
  includeExpiredReferences = false,
} = {}) {
  const workspace = path.resolve(root);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs) || !Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error("invalid retention clock or days");
  }
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const state = walkWorkspace(workspace);
  const tracked = trackedFiles(workspace, state);
  const trackedText = trackedTextFiles(tracked);
  const trackedDirectories = trackedDirectoryIndex(tracked);
  const newspaperResult = collectNewspaperCandidates(workspace, state.newspaperRoots, cutoffMs, tracked);
  for (const issue of newspaperResult.issues) addIssue(state, issue);
  const expiredNewspaperPaths = new Set(newspaperResult.candidates.map((item) => item.path));
  const retainedRuns = retainedRunReferences(workspace, state.newspaperRoots, expiredNewspaperPaths, state);
  const runDirectories = collectRunCandidates(workspace, state.artifactRoots, cutoffMs, trackedDirectories, retainedRuns, state);

  const removedPaths = new Set([
    ...runDirectories.map((item) => item.path),
    ...newspaperResult.candidates.map((item) => item.path),
  ]);
  const referenceExclusions = includeExpiredReferences ? new Set() : removedPaths;
  const references = scanReferences(workspace, new Set([...state.referenceFiles, ...trackedText]), referenceExclusions, state);

  const removedInodes = new Map();
  let logicalBytesInRunDirectories = 0;
  for (const directory of runDirectories) {
    logicalBytesInRunDirectories += directory.logicalBytes;
    mergeInodes(removedInodes, directory.inodes);
  }
  for (const file of newspaperResult.candidates) {
    if (!file.inode) continue;
    removedInodes.set(file.inode, (removedInodes.get(file.inode) || 0) + 1);
  }

  const oldContentObjects = collectContentObjects(workspace, state.contentStores, cutoffMs, state);
  const potentiallyEligibleContentObjects = [];
  let referencedContentObjectCount = 0;
  let linkedContentObjectCount = 0;
  for (const object of oldContentObjects) {
    const remainingLinks = object.nlink - (removedInodes.get(object.inode) || 0);
    if (references.has(object.hash)) {
      referencedContentObjectCount += 1;
      continue;
    }
    if (remainingLinks !== 1) {
      linkedContentObjectCount += 1;
      continue;
    }
    potentiallyEligibleContentObjects.push({ ...object, remainingLinks });
  }

  const contentObjects = state.referenceScanComplete ? potentiallyEligibleContentObjects : [];
  return {
    root: workspace,
    retentionDays,
    cutoff: new Date(cutoffMs).toISOString(),
    scan: {
      complete: state.referenceScanComplete,
      issueCount: state.issueCount,
      issues: state.issues,
    },
    runDirectories: runDirectories.map(({ inodes, ...item }) => item),
    newspaperFiles: newspaperResult.candidates,
    contentObjects: contentObjects.map(({ ...item }) => item),
    contentStore: {
      roots: state.contentStores.map((directory) => path.relative(workspace, directory)),
      oldObjects: oldContentObjects.length,
      referencedObjects: referencedContentObjectCount,
      linkedElsewhere: linkedContentObjectCount,
      potentiallyEligibleObjects: potentiallyEligibleContentObjects.length,
      potentiallyEligibleBytes: potentiallyEligibleContentObjects.reduce((sum, item) => sum + item.size, 0),
      eligibleObjects: contentObjects.length,
      eligibleBytes: contentObjects.reduce((sum, item) => sum + item.size, 0),
      deletionDisabled: !state.referenceScanComplete,
    },
    totals: {
      runDirectoryLogicalBytes: logicalBytesInRunDirectories,
      newspaperBytes: newspaperResult.candidates.reduce((sum, item) => sum + item.size, 0),
      contentAddressedBytes: contentObjects.reduce((sum, item) => sum + item.size, 0),
    },
  };
}

function safeToDeleteRun(root, candidate, cutoffMs) {
  const info = inspectTree(root, candidate.path);
  return !info.error && !info.hasLock && info.newestMtimeMs < cutoffMs
    && info.newestMtimeMs === candidate.newestMtimeMs
    && info.rootDev === candidate.rootDev && info.rootIno === candidate.rootIno;
}

export function applyArtifactRetention({ root, now = Date.now(), retentionDays = ARTIFACT_RETENTION_DAYS } = {}) {
  const options = { root, now, retentionDays };
  const plan = createArtifactRetentionPlan(options);
  const cutoffMs = new Date(plan.cutoff).getTime();
  const removed = [];
  const failures = [];
  const runPaths = new Set(plan.runDirectories.map((item) => item.path));
  const removedLinksByInode = new Map();

  for (const candidate of plan.newspaperFiles) {
    if (hasExcludedAncestor(candidate.path, runPaths)) continue;
    try {
      const stat = fs.lstatSync(candidate.path);
      const inode = `${candidate.dev}:${candidate.ino}`;
      const alreadyUnlinked = removedLinksByInode.get(inode) ?? 0;
      const expectedLinks = candidate.nlink - alreadyUnlinked;
      if (!stat.isFile() || stat.mtimeMs !== candidate.mtimeMs || stat.size !== candidate.size
        || stat.dev !== candidate.dev || stat.ino !== candidate.ino || stat.nlink !== expectedLinks
        || stat.mtimeMs >= cutoffMs) {
        failures.push(`newspaper changed since preview: ${candidate.relative}`);
        continue;
      }
      fs.unlinkSync(candidate.path);
      removedLinksByInode.set(inode, alreadyUnlinked + 1);
      removed.push(candidate.relative);
    } catch (error) {
      failures.push(`cannot remove ${candidate.relative}: ${error.code || error.message}`);
    }
  }
  for (const candidate of plan.runDirectories) {
    if (!safeToDeleteRun(plan.root, candidate, cutoffMs)) {
      failures.push(`run directory changed or became active: ${candidate.relative}`);
      continue;
    }
    try {
      fs.rmSync(candidate.path, { recursive: true, force: false });
      removed.push(candidate.relative);
    } catch (error) {
      failures.push(`cannot remove ${candidate.relative}: ${error.code || error.message}`);
    }
  }

  const removedContentObjects = [];
  let contentPlan = null;
  // A complete initial scan is required before the post-delete reference pass.
  if (plan.scan.complete) {
    contentPlan = createArtifactRetentionPlan({ ...options, includeExpiredReferences: true });
  }
  if (contentPlan?.scan.complete) {
    for (const candidate of contentPlan.contentObjects) {
      try {
        const stat = fs.lstatSync(candidate.path);
        if (!stat.isFile() || stat.mtimeMs !== candidate.mtimeMs || stat.nlink !== candidate.nlink
          || stat.size !== candidate.size || stat.dev !== candidate.dev || stat.ino !== candidate.ino) {
          failures.push(`content object changed since scan: ${candidate.relative}`);
          continue;
        }
        fs.unlinkSync(candidate.path);
        removedContentObjects.push(candidate.relative);
      } catch (error) {
        failures.push(`cannot remove content object ${candidate.relative}: ${error.code || error.message}`);
      }
    }
  }

  return {
    mode: "apply",
    plan,
    contentStorePlan: contentPlan?.contentStore ?? plan.contentStore,
    removed,
    removedContentObjects,
    failures,
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runConfiguredArtifactRetention({
  root = repoRoot,
  configRoot = root,
  now = Date.now(),
  apply = false
} = {}) {
  const { maximumAgeDays } = await readNewspaperLimits(configRoot);
  const options = { root, now, retentionDays: maximumAgeDays };
  return apply
    ? applyArtifactRetention(options)
    : { mode: "preview", plan: createArtifactRetentionPlan(options) };
}

function usage() {
  return [
    "Usage: node command/prune_artifacts.mjs [--apply] [--json]",
    "",
    `Default retention is ${ARTIFACT_RETENTION_DAYS} days. Preview is read-only; --apply deletes eligible data.`,
    "Only dated run directories, old newspaper .pya/text logs, and unreferenced SHA-256 objects are considered.",
  ].join("\n");
}

function parseArgs(argv) {
  const result = { apply: false, json: false };
  for (const arg of argv) {
    if (arg === "--apply") result.apply = true;
    else if (arg === "--json") result.json = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runConfiguredArtifactRetention({ apply: args.apply });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const { plan } = result;
  process.stdout.write(`[artifact-retention] mode=${result.mode} retention_days=${plan.retentionDays} cutoff=${plan.cutoff}\n`);
  process.stdout.write(`[artifact-retention] dated_runs=${plan.runDirectories.length} logical_bytes=${plan.totals.runDirectoryLogicalBytes} newspaper_logs=${plan.newspaperFiles.length} newspaper_bytes=${plan.totals.newspaperBytes}\n`);
  process.stdout.write(`[artifact-retention] content_store_objects=${plan.contentStore.oldObjects} referenced=${plan.contentStore.referencedObjects} linked_elsewhere=${plan.contentStore.linkedElsewhere} potentially_unreferenced=${plan.contentStore.potentiallyEligibleObjects} potentially_bytes=${plan.contentStore.potentiallyEligibleBytes} eligible=${plan.contentStore.eligibleObjects} eligible_bytes=${plan.contentStore.eligibleBytes}\n`);
  if (plan.contentStore.deletionDisabled) process.stdout.write(`[artifact-retention] content-store deletion disabled: reference scan incomplete (${plan.scan.issueCount} issue(s))\n`);
  for (const issue of plan.scan.issues) process.stdout.write(`[artifact-retention] scan warning: ${issue}\n`);
  if (!args.apply) {
    const largestRuns = [...plan.runDirectories].sort((left, right) => right.logicalBytes - left.logicalBytes).slice(0, 5);
    for (const item of largestRuns) process.stdout.write(`[artifact-retention] run candidate: ${item.relative} (${item.logicalBytes} logical bytes)\n`);
    for (const item of plan.newspaperFiles.slice(0, 5)) process.stdout.write(`[artifact-retention] newspaper candidate: ${item.relative} (${item.size} bytes)\n`);
  }
  if (args.apply) {
    process.stdout.write(`[artifact-retention] removed_run_or_log_paths=${result.removed.length} removed_content_objects=${result.removedContentObjects.length} failures=${result.failures.length}\n`);
    for (const failure of result.failures) process.stdout.write(`[artifact-retention] failure: ${failure}\n`);
    if (result.failures.length) process.exitCode = 1;
  } else {
    process.stdout.write("[artifact-retention] preview only; pass --apply to delete the listed eligible data\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`[artifact-retention] error ${String(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
