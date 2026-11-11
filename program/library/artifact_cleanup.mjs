import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { MOODS } from "./grammar/keywords.mjs";
import { acquireArtifactStoreLock, activeRunMarkerDirectory } from "./artifact_store_lock.mjs";
import { splitSentences } from "./sentenceSplitter.mjs";

const HASH_RE = /^[a-f0-9]{64}$/u;
const RUN_ID_RE = /^(?:\d{8}-\d{3,4}-[A-Za-z0-9._-]+|\d{8}T\d{6,}(?:Z)?-\d+-[A-Za-z0-9._-]+)$/u;
const KNOWN_ARTIFACT_ROOTS = new Set(["sha256", ".active-runs", ".maintenance-lock"]);
const PYA_SENTENCE_PREFIX = /^(?:exists|su|ob|from|to|as|via|through|with|be|at|during|when|while|la|ko|prah|ret|can|pi7|que|def|do|ya|vyah)\b/u;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function isRunId(value) {
  return RUN_ID_RE.test(String(value ?? ""));
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function artifactExtension(locator) {
  const value = String(locator ?? "");
  if (!value) return "";
  try {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)) {
      return path.extname(new URL(value).pathname);
    }
  } catch {
    return "";
  }
  return path.extname(value);
}

function addRunIdFromLocator(runIds, locator) {
  const normalized = String(locator ?? "").replace(/[\\]+/gu, "/");
  const match = normalized.match(/(?:^|\/)artifacts\/([^/]+)(?:\/|$)/u);
  if (match && match[1] !== "sha256" && match[1] !== ".active-runs" && match[1] !== ".maintenance-lock") {
    runIds.add(match[1]);
  }
}

function isValidParsedSentence(sentence) {
  return sentence && typeof sentence === "object"
    && (MOODS.includes(sentence.mood) || (sentence.mood === "propose" && sentence.be === "command"));
}

function looksLikeRetentionRecord(line) {
  return /(?:^|\s)be\s+artifact(?:\s|$)|(?:^|\s)accordingto\s+name\s+sha256(?:\s|$)|(?:^|\s)be\s+run(?:\s|$)|(?:^|\s)be\s+run\s+root(?:\s|$)|(?:^|\s)be\s+end(?:\s|$)/u.test(line);
}

async function canonicalNewspaperDirectories(root) {
  const directories = new Map([
    [path.join(root, "newspaper"), root],
    [path.join(root, "world", "newspaper"), path.join(root, "world")]
  ]);
  for (const parentName of ["house", "coding-saddle-projects"]) {
    const parent = path.join(root, "world", parentName);
    let entries = [];
    try {
      entries = await fs.readdir(parent, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const entryRoot = path.join(parent, entry.name);
      const artifactRoot = parentName === "house" ? path.join(root, "world") : entryRoot;
      directories.set(path.join(entryRoot, "newspaper"), artifactRoot);
    }
  }
  return [...directories.entries()].map(([directory, artifactRoot]) => ({ directory, artifactRoot }))
    .sort((a, b) => a.directory.localeCompare(b.directory));
}

async function newspaperFiles(root) {
  const files = [];
  for (const { directory, artifactRoot } of await canonicalNewspaperDirectories(root)) {
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".pya")) continue;
      files.push({ filename: path.join(directory, entry.name), artifactRoot });
    }
  }
  return files.sort((a, b) => a.filename.localeCompare(b.filename));
}

async function readNewspaperReferences(root) {
  const result = {
    files: [],
    stores: new Map(),
    externalArtifactRoots: new Set(),
    blockers: []
  };
  const storeFor = (storeRoot) => {
    const resolved = path.resolve(storeRoot);
    let store = result.stores.get(resolved);
    if (!store) {
      store = { root: resolved, runIds: new Set(), references: new Map(), files: [], blockers: [] };
      result.stores.set(resolved, store);
    }
    return store;
  };

  for (const file of await newspaperFiles(root)) {
    const { filename } = file;
    const baseRunId = path.basename(filename, ".pya").replace(/-\d{4}$/u, "");
    const content = await fs.readFile(filename, "utf8");
    let parsedCount = 0;
    let artifactRoot = path.resolve(file.artifactRoot);
    let declaredArtifactRoot = null;
    const parsedSentences = [];
    const fileBlockers = [];
    // Split the complete newspaper as Pyash, then parse only candidate sentences.
    // Newspapers may interleave plain transcript/tool output with structured facts.
    for (const rawSentence of splitSentences(content, { includeThen: true })) {
      const sentenceText = rawSentence.trim();
      if (!sentenceText) continue;
      if (!PYA_SENTENCE_PREFIX.test(sentenceText)) {
        continue;
      }
      let sentence;
      try {
        sentence = parse(sentenceText);
      } catch {
        sentence = null;
      }
      if (!isValidParsedSentence(sentence)) {
        if (looksLikeRetentionRecord(sentenceText)) fileBlockers.push(`malformed newspaper retention record: ${filename}`);
        continue;
      }
      parsedCount += 1;
      parsedSentences.push(sentence);
      if (sentence.be === "run root" && sentence?.ob?.filename) {
        const resolved = path.resolve(root, String(sentence.ob.filename));
        if (declaredArtifactRoot && declaredArtifactRoot !== resolved) {
          result.blockers.push(`conflicting run roots in newspaper: ${filename}`);
        }
        declaredArtifactRoot = resolved;
      }
      if (sentence.be === "run" && !sentence?.su?.name) {
        fileBlockers.push(`run record has no run id: ${filename}`);
      }
      if (sentence.be === "run root" && !sentence?.ob?.filename) {
        fileBlockers.push(`run-root record has no filename: ${filename}`);
      }
    }
    if (declaredArtifactRoot) artifactRoot = declaredArtifactRoot;
    if (!isWithin(root, artifactRoot)) {
      result.externalArtifactRoots.add(artifactRoot);
      result.files.push(filename);
      continue;
    }
    const store = storeFor(artifactRoot);
    store.blockers.push(...fileBlockers);
    store.files.push(filename);
    if (isRunId(baseRunId)) store.runIds.add(baseRunId);
    for (const sentence of parsedSentences) {
      if (sentence.be === "run" && sentence?.su?.name) store.runIds.add(String(sentence.su.name));
      if (sentence.be !== "artifact") continue;

      const locator = sentence?.to?.filename;
      addRunIdFromLocator(store.runIds, locator ?? sentence?.ob?.filename);
      if (sentence?.accordingto?.name && sentence.accordingto.name !== "sha256") {
        addRunIdFromLocator(store.runIds, sentence?.ob?.filename ?? locator);
        continue;
      }
      const hash = String(sentence?.fromtext?.text ?? "").toLowerCase();
      if (sentence?.accordingto?.name !== "sha256" || !HASH_RE.test(hash)) {
        store.blockers.push(`artifact record has an invalid SHA-256 reference: ${filename}`);
        continue;
      }
      if (typeof locator !== "string" || !locator.trim()) {
        store.blockers.push(`artifact record has no filename locator: ${filename}`);
        continue;
      }
      const extension = artifactExtension(locator);
      const key = `${hash}${extension}`;
      const size = Number(sentence?.by?.num);
      if (!Number.isSafeInteger(size) || size < 0) {
        store.blockers.push(`artifact record has an invalid byte size: ${filename}:${key}`);
        continue;
      }
      const reference = store.references.get(key) ?? { hash, extension, expectedSizes: new Set(), newspapers: new Set() };
      reference.expectedSizes.add(size);
      reference.newspapers.add(filename);
      store.references.set(key, reference);
    }
    if (content.trim() && parsedCount === 0) {
      store.blockers.push(`malformed newspaper contains no parseable sentences: ${filename}`);
    }
    result.files.push(filename);
  }
  return result;
}

async function listRunDirectories(root, retainedRunIds) {
  const artifactsRoot = path.join(root, "artifacts");
  let entries = [];
  try {
    entries = await fs.readdir(artifactsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { candidates: [], unknown: [] };
    throw error;
  }
  const candidates = [];
  const unknown = [];
  for (const entry of entries) {
    if (KNOWN_ARTIFACT_ROOTS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      unknown.push(entry.name);
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (!isRunId(entry.name)) {
      unknown.push(entry.name);
      continue;
    }
    if (retainedRunIds.has(entry.name)) continue;
    const fullPath = path.join(artifactsRoot, entry.name);
    const stat = await fs.lstat(fullPath);
    candidates.push({ storeRoot: root, runId: entry.name, path: fullPath, bytes: await treeBytes(fullPath), modifiedAt: stat.mtime.toISOString() });
  }
  candidates.sort((a, b) => a.runId.localeCompare(b.runId));
  unknown.sort();
  return { candidates, unknown };
}

async function treeBytes(directory) {
  let total = 0;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) total += await treeBytes(target);
    else if (entry.isFile()) total += (await fs.lstat(target)).size;
  }
  return total;
}

async function walkCasObjects(root) {
  const casRoot = path.join(root, "artifacts", "sha256");
  const objects = [];
  const malformed = [];
  const invalidRoots = [];
  try {
    const casStat = await fs.lstat(casRoot);
    if (!casStat.isDirectory() || casStat.isSymbolicLink()) {
      invalidRoots.push(casRoot);
      return { objects, malformed, invalidRoots };
    }
  } catch (error) {
    if (error?.code === "ENOENT") return { objects, malformed, invalidRoots };
    throw error;
  }
  let first = [];
  try {
    first = await fs.readdir(casRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { objects, malformed, invalidRoots };
    throw error;
  }
  for (const firstEntry of first) {
    if (!firstEntry.isDirectory() || firstEntry.isSymbolicLink() || !/^[a-f0-9]{2}$/u.test(firstEntry.name)) {
      malformed.push(path.join(casRoot, firstEntry.name));
      continue;
    }
    const firstPath = path.join(casRoot, firstEntry.name);
    for (const secondEntry of await fs.readdir(firstPath, { withFileTypes: true })) {
      if (!secondEntry.isDirectory() || secondEntry.isSymbolicLink() || !/^[a-f0-9]{2}$/u.test(secondEntry.name)) {
        malformed.push(path.join(firstPath, secondEntry.name));
        continue;
      }
      const secondPath = path.join(firstPath, secondEntry.name);
      for (const objectEntry of await fs.readdir(secondPath, { withFileTypes: true })) {
        const filename = objectEntry.name;
        const match = filename.match(/^([a-f0-9]{64})(\.[^/]*)?$/u);
        if (!match || !objectEntry.isFile() || objectEntry.isSymbolicLink()
          || !match[1].startsWith(`${firstEntry.name}${secondEntry.name}`)) {
          malformed.push(path.join(secondPath, filename));
          continue;
        }
        const objectPath = path.join(secondPath, filename);
        const stat = await fs.lstat(objectPath);
        objects.push({
          storeRoot: root,
          hash: match[1],
          extension: match[2] ?? "",
          filename,
          path: objectPath,
          bytes: stat.size,
          linkCount: stat.nlink
        });
      }
    }
  }
  objects.sort((a, b) => a.filename.localeCompare(b.filename));
  return { objects, malformed, invalidRoots };
}

async function hashFile(filename) {
  const hash = crypto.createHash("sha256");
  const stream = fsSync.createReadStream(filename);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

function activeMarkers(root) {
  return (async () => {
    const directory = activeRunMarkerDirectory(root);
    let stat;
    try {
      stat = await fs.lstat(directory);
    } catch (error) {
      if (error?.code === "ENOENT") return { active: [], stale: [], invalid: false };
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { active: [], stale: [], invalid: true };
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const active = [];
    const stale = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".pya")) continue;
      const filename = path.join(directory, entry.name);
      const content = await fs.readFile(filename, "utf8");
      const pid = Number(content.match(/^su name process id ob num (\d+) be number ya$/mu)?.[1]);
      if (processIsAlive(pid)) active.push({ filename, pid });
      else stale.push(filename);
    }
    return { active, stale, invalid: false };
  })();
}

async function artifactStoreRoots(root, newspaperStores) {
  const roots = new Set([root]);
  const worldRoot = path.join(root, "world");
  roots.add(worldRoot);
  const projectsRoot = path.join(worldRoot, "coding-saddle-projects");
  let projects = [];
  try {
    projects = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const entry of projects) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) roots.add(path.join(projectsRoot, entry.name));
  }
  for (const storeRoot of newspaperStores.keys()) {
    if (isWithin(root, storeRoot)) roots.add(path.resolve(storeRoot));
  }

  const existing = [];
  const invalid = [];
  for (const storeRoot of [...roots].sort()) {
    const artifactsRoot = path.join(storeRoot, "artifacts");
    try {
      const stat = await fs.lstat(artifactsRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) invalid.push(artifactsRoot);
      else existing.push(storeRoot);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return { roots: existing, invalid };
}

async function buildReport(root) {
  const newspapers = await readNewspaperReferences(root);
  const stores = await artifactStoreRoots(root, newspapers.stores);
  const runDirectories = [];
  const removableCas = [];
  const referencedCas = [];
  const missingReferences = [];
  const malformedContentAddressedPaths = [];
  const invalidContentAddressedRoots = [];
  const unknownArtifactRoots = [];
  const activeRuns = [];
  const staleRunMarkers = [];
  const blockers = [...newspapers.blockers];
  const blockedStoreRoots = new Set();
  const blockersByStore = {};

  for (const invalidPath of stores.invalid) blockers.push(`artifact root is not a real directory: ${invalidPath}`);
  for (const storeRoot of stores.roots) {
    const store = newspapers.stores.get(storeRoot) ?? { runIds: new Set(), references: new Map() };
    const storeBlockers = [...(store.blockers ?? [])];
    const runResult = await listRunDirectories(storeRoot, store.runIds);
    runDirectories.push(...runResult.candidates);
    unknownArtifactRoots.push(...runResult.unknown.map(name => path.join(storeRoot, "artifacts", name)));

    const cas = await walkCasObjects(storeRoot);
    malformedContentAddressedPaths.push(...cas.malformed);
    invalidContentAddressedRoots.push(...cas.invalidRoots);
    for (const invalidRoot of cas.invalidRoots) storeBlockers.push(`CAS root is not a real directory: ${invalidRoot}`);
    const objectByKey = new Map(cas.objects.map(object => [`${object.hash}${object.extension}`, object]));
    for (const [key, reference] of store.references) {
      const object = objectByKey.get(key);
      if (!object) {
        missingReferences.push(`${storeRoot}:${key}`);
        storeBlockers.push(`newspaper references missing content-addressed artifact: ${storeRoot}:${key}`);
        continue;
      }
      if (reference.expectedSizes.size > 1) {
        storeBlockers.push(`conflicting newspaper artifact sizes: ${storeRoot}:${key}`);
      } else if (reference.expectedSizes.size === 1 && !reference.expectedSizes.has(object.bytes)) {
        storeBlockers.push(`referenced artifact size mismatch: ${storeRoot}:${key}`);
      }
      referencedCas.push(object);
    }
    for (const object of cas.objects) {
      if (!store.references.has(`${object.hash}${object.extension}`)) removableCas.push(object);
    }

    const activity = await activeMarkers(storeRoot);
    activeRuns.push(...activity.active);
    staleRunMarkers.push(...activity.stale);
    if (activity.invalid) storeBlockers.push(`active run marker root is not a real directory: ${activeRunMarkerDirectory(storeRoot)}`);
    if (activity.active.length > 0) {
      storeBlockers.push(`active run lease(s) in ${storeRoot}: ${activity.active.map(item => item.pid).join(", ")}`);
    }
    if (storeBlockers.length > 0) {
      blockedStoreRoots.add(storeRoot);
      blockersByStore[storeRoot] = [...new Set(storeBlockers)];
      blockers.push(...storeBlockers);
    }
  }

  return {
    root,
    storeRoots: stores.roots,
    newspaperFiles: newspapers.files,
    externalArtifactRoots: [...newspapers.externalArtifactRoots].sort(),
    retainedRunIds: [...newspapers.stores.values()].flatMap(store => [...store.runIds]).sort(),
    runDirectories,
    contentAddressedObjects: removableCas,
    referencedContentAddressedObjects: referencedCas.length,
    referencedContentAddressedObjectsList: referencedCas,
    missingReferences,
    malformedContentAddressedPaths,
    invalidContentAddressedRoots,
    unknownArtifactRoots,
    activeRuns,
    staleRunMarkers,
    globalBlockers: [...new Set(newspapers.blockers.concat(stores.invalid.map(invalidPath => `artifact root is not a real directory: ${invalidPath}`)))],
    blockedStoreRoots: [...blockedStoreRoots].sort(),
    blockersByStore,
    blockers: [...new Set(blockers)],
    blocked: blockers.length > 0
  };
}

function emptyReport(root, { blocked = false, blockers = [] } = {}) {
  return {
    root,
    storeRoots: [],
    applied: false,
    blocked,
    globalBlockers: [],
    blockedStoreRoots: [],
    blockersByStore: {},
    blockers,
    runDirectories: [],
    contentAddressedObjects: [],
    referencedContentAddressedObjects: 0,
    newspaperFiles: [],
    externalArtifactRoots: [],
    retainedRunIds: [],
    unknownArtifactRoots: [],
    missingReferences: [],
    malformedContentAddressedPaths: [],
    invalidContentAddressedRoots: [],
    staleRunMarkers: [],
    activeRuns: []
  };
}

async function releaseLocks(releases) {
  for (const release of [...releases].reverse()) await release();
}

export async function cleanArtifactStore({ root = process.cwd(), apply = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const report = await buildReport(resolvedRoot);
  report.applied = false;
  if (!apply || report.globalBlockers.length > 0) return report;

  const markStoreBlocked = (storeRoot, message) => {
    report.blockedStoreRoots = [...new Set([...report.blockedStoreRoots, storeRoot])].sort();
    report.blockersByStore[storeRoot] = [...new Set([...(report.blockersByStore[storeRoot] ?? []), message])];
    report.blockers = [...new Set([...report.blockers, message])];
    report.blocked = true;
  };
  let blockedStores = new Set(report.blockedStoreRoots);
  let eligibleRoots = report.storeRoots.filter(storeRoot => !blockedStores.has(storeRoot));
  if (eligibleRoots.length === 0) return report;

  const verifiedCas = new Map();
  report.skippedContentAddressedObjects = [];
  for (const object of report.referencedContentAddressedObjectsList) {
    if (!eligibleRoots.includes(object.storeRoot) || blockedStores.has(object.storeRoot)) continue;
    if (await hashFile(object.path) !== object.hash) {
      markStoreBlocked(object.storeRoot, `referenced artifact hash mismatch: ${object.storeRoot}:${object.filename}`);
      blockedStores.add(object.storeRoot);
    }
  }
  eligibleRoots = eligibleRoots.filter(storeRoot => !blockedStores.has(storeRoot));
  if (eligibleRoots.length === 0) return report;
  for (const object of report.contentAddressedObjects) {
    if (!eligibleRoots.includes(object.storeRoot)) continue;
    const stat = await fs.lstat(object.path);
    if (await hashFile(object.path) !== object.hash) {
      report.skippedContentAddressedObjects.push({ filename: object.path, reason: "content-address hash mismatch" });
      continue;
    }
    verifiedCas.set(object.path, { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs });
  }

  const verifiedRunDirectories = new Set(report.runDirectories
    .filter(item => eligibleRoots.includes(item.storeRoot))
    .map(item => item.path));
  const releases = [];
  try {
    for (const storeRoot of eligibleRoots) releases.push(await acquireArtifactStoreLock(storeRoot));
    const current = await buildReport(resolvedRoot);
    current.applied = false;
    if (current.globalBlockers.length > 0) return current;
    const currentBlockedStores = new Set(current.blockedStoreRoots);
    const currentEligibleRoots = eligibleRoots.filter(storeRoot => !currentBlockedStores.has(storeRoot));
    if (currentEligibleRoots.length === 0) return current;

    for (const storeRoot of currentEligibleRoots) {
      const markerRoot = activeRunMarkerDirectory(storeRoot);
      for (const marker of current.staleRunMarkers) {
        if (path.dirname(marker) === markerRoot) await fs.rm(marker, { force: true });
      }
    }
    current.removedRunDirectories = [];
    for (const directory of current.runDirectories) {
      if (!currentEligibleRoots.includes(directory.storeRoot) || !verifiedRunDirectories.has(directory.path)) continue;
      const stat = await fs.lstat(directory.path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        current.blockers.push(`run artifact root changed during cleanup: ${directory.path}`);
        current.blocked = true;
        return current;
      }
      await fs.rm(directory.path, { recursive: true, force: false });
      current.removedRunDirectories.push({ path: directory.path, bytes: directory.bytes });
    }

    current.skippedContentAddressedObjects = report.skippedContentAddressedObjects;
    current.removedContentAddressedObjects = [];
    current.removedExternalHardlinkCounts = [];
    for (const object of current.contentAddressedObjects) {
      if (!currentEligibleRoots.includes(object.storeRoot)) continue;
      const verified = verifiedCas.get(object.path);
      if (!verified) continue;
      let stat;
      try {
        stat = await fs.lstat(object.path);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        current.skippedContentAddressedObjects.push({ filename: object.path, reason: "not a regular file" });
        continue;
      }
      if (stat.dev !== verified.dev || stat.ino !== verified.ino || stat.size !== verified.size || stat.mtimeMs !== verified.mtimeMs) {
        current.skippedContentAddressedObjects.push({ filename: object.path, reason: "object changed during cleanup" });
        continue;
      }
      if (stat.nlink > 1) {
        current.removedExternalHardlinkCounts.push({ filename: object.path, remainingLinks: stat.nlink - 1 });
      }
      await fs.unlink(object.path);
      current.removedContentAddressedObjects.push({ path: object.path, bytes: object.bytes });
    }
    current.applied = true;
    return current;
  } finally {
    await releaseLocks(releases);
  }
}
