import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

import { throwErrorSentence } from "../error.mjs";

let exchangeRecorder = null;
let exchangeRunRoot = null;
let exchangeRunId = null;
let exchangeSentenceId = null;
const artifactByLocator = new Map();
const artifactHashes = new Map();
const artifactNameCounts = new Map();
const artifactLocatorByName = new Map();
const artifactLatestByProducer = new Map();
let exchangeStrict = false;

function isUri(locator = "") {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(locator);
}

function normalizeRunRoot(value) {
  return path.resolve(String(value ?? ""));
}

function normalizePath(locator) {
  const runRoot = exchangeRunRoot ?? normalizeRunRoot(process.cwd());
  const resolved = path.resolve(runRoot, locator);
  const relative = path.relative(runRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throwErrorSentence({
      name: "exchange defective",
      message: "exchange defective",
      from: { name: "exchange" },
      raw: { locator }
    });
  }
  return relative.replace(/[\\]+/g, "/");
}

export function setExchangeRecorder({ record, runRoot } = {}) {
  exchangeRecorder = typeof record === "function" ? record : null;
  exchangeRunRoot = runRoot ? normalizeRunRoot(runRoot) : null;
  exchangeRunId = null;
  exchangeSentenceId = null;
  artifactByLocator.clear();
  artifactHashes.clear();
  artifactNameCounts.clear();
  artifactLocatorByName.clear();
  artifactLatestByProducer.clear();
  exchangeStrict = false;
}

export function clearExchangeRecorder() {
  exchangeRecorder = null;
  exchangeRunRoot = null;
  exchangeRunId = null;
  exchangeSentenceId = null;
  artifactByLocator.clear();
  artifactHashes.clear();
  artifactNameCounts.clear();
  artifactLocatorByName.clear();
  artifactLatestByProducer.clear();
  exchangeStrict = false;
}

export function setExchangeRunRoot(runRoot) {
  exchangeRunRoot = runRoot ? normalizeRunRoot(runRoot) : null;
}

export function setExchangeRunId(runId) {
  exchangeRunId = runId ? String(runId) : null;
}

export function getExchangeRunId() {
  return exchangeRunId;
}

export function setExchangeSentenceId(sentenceId) {
  exchangeSentenceId = sentenceId ? String(sentenceId) : null;
}

export function getExchangeSentenceId() {
  return exchangeSentenceId;
}

export function getExchangeRunRoot() {
  return exchangeRunRoot;
}

export function setExchangeStrict(value) {
  exchangeStrict = Boolean(value);
}

export function getExchangeStrict() {
  return exchangeStrict;
}

export function normalizeLocator(locator) {
  const text = String(locator ?? "");
  if (!text) {
    throwErrorSentence({
      name: "exchange defective",
      message: "exchange defective",
      from: { name: "exchange" },
      raw: { locator }
    });
  }
  if (isUri(text)) return text;
  return normalizePath(text);
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function artifactExtension(locator) {
  if (!locator) return "";
  try {
    const url = new URL(locator);
    return path.extname(url.pathname || "");
  } catch {
    return path.extname(locator);
  }
}

function contentAddressPath(hash, locator) {
  const ext = artifactExtension(locator);
  const parts = ["artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`];
  return parts.join("/");
}

function writeContentAddressed({ hash, locator, bytes } = {}) {
  if (!hash || !bytes) return null;
  const rel = contentAddressPath(hash, locator);
  const runRoot = exchangeRunRoot ?? normalizeRunRoot(process.cwd());
  const abs = path.resolve(runRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  return { relative: rel, absolute: abs };
}

function sanitizeAliasPart(value) {
  return String(value ?? "")
    .replace(/[\\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function locatorBasename(locator) {
  const text = String(locator ?? "");
  if (!text) return "";
  if (isUri(text)) {
    try {
      const parsed = new URL(text);
      return path.basename(parsed.pathname || "");
    } catch {
      return "";
    }
  }
  return path.basename(text);
}

function runAliasName({ artifactName, locator } = {}) {
  const baseRaw = locatorBasename(locator);
  const base = sanitizeAliasPart(baseRaw || "");
  if (!base) return String(artifactName ?? "");
  return `${artifactName}-${base}`;
}

function linkRunAlias({ name, target, locator } = {}) {
  if (!exchangeRunId || !name || !target) return null;
  const locatorText = String(locator ?? "").replace(/[\\]+/g, "/");
  const runPrefix = `artifacts/${exchangeRunId}/`;
  if (locatorText.startsWith(runPrefix)) {
    // Already stored in this run folder; avoid duplicate alias files.
    return null;
  }
  const runRoot = exchangeRunRoot ?? normalizeRunRoot(process.cwd());
  const alias = runAliasName({ artifactName: name, locator });
  const rel = ["artifacts", exchangeRunId, alias].join("/");
  const abs = path.resolve(runRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) {
    try {
      fs.linkSync(target, abs);
    } catch {
      try {
        fs.symlinkSync(target, abs);
      } catch {
        return null;
      }
    }
  }
  return rel;
}

function nextArtifactName() {
  const base = sanitizeAliasPart("artifact");
  const count = artifactNameCounts.get(base) ?? 0;
  artifactNameCounts.set(base, count + 1);
  return `${base}-${String(count + 1).padStart(3, "0")}`;
}

function nextArtifactNameForProducer(producer = "") {
  const base = sanitizeAliasPart(producer || "artifact") || nextArtifactName();
  const count = artifactNameCounts.get(base) ?? 0;
  artifactNameCounts.set(base, count + 1);
  return `${base}-${String(count + 1).padStart(3, "0")}`;
}

export function recordArtifact({ locator, producer = "exchange", bytes, kind } = {}) {
  if (!exchangeRecorder) return null;
  const normalized = normalizeLocator(locator);
  if (exchangeStrict && !bytes) {
    throwErrorSentence({
      name: "exchange defective",
      message: "exchange defective",
      from: { name: "exchange" },
      raw: { locator: normalized }
    });
  }
  const hash = bytes ? hashBytes(bytes) : null;
  const size = bytes ? bytes.length : null;
  const existing = artifactByLocator.get(normalized);
  if (existing) {
    artifactLocatorByName.set(existing, normalized);
    if (producer && kind !== "metadata") artifactLatestByProducer.set(String(producer), normalized);
    if (hash) {
      const priorHash = artifactHashes.get(existing);
      if (priorHash && priorHash !== hash) {
        throwErrorSentence({
          name: "hash inconsistency",
          message: "hash inconsistency",
          from: { name: "exchange" },
          raw: { locator: normalized }
        });
      }
      if (!priorHash) artifactHashes.set(existing, hash);
    }
    if (hash && bytes) {
      const written = writeContentAddressed({ hash, locator: normalized, bytes });
      linkRunAlias({ name: existing, target: written?.absolute, locator: normalized });
    }
    return {
      mood: "ya",
      exists: true,
      be: "artifact",
      su: { name: existing },
      ob: exchangeSentenceId ? { name: exchangeSentenceId } : { text: normalized },
      to: { filename: normalized },
      from: { name: producer }
    };
  }
  const sentence = {
    mood: "ya",
    exists: true,
    be: "artifact",
    su: { name: nextArtifactNameForProducer(producer) },
    ob: exchangeSentenceId ? { name: exchangeSentenceId } : { text: normalized },
    to: { filename: normalized },
    from: { name: producer }
  };
  if (hash) {
    sentence.accordingto = { name: "sha256" };
    sentence.fromtext = { text: hash };
    artifactHashes.set(sentence.su.name, hash);
    const written = writeContentAddressed({ hash, locator: normalized, bytes });
    linkRunAlias({ name: sentence.su.name, target: written?.absolute, locator: normalized });
  }
  if (size != null) {
    sentence.by = { num: size };
  }
  if (kind) {
    sentence.as = { name: kind };
  }
  artifactByLocator.set(normalized, sentence.su.name);
  artifactLocatorByName.set(sentence.su.name, normalized);
  if (producer && kind !== "metadata") artifactLatestByProducer.set(String(producer), normalized);
  exchangeRecorder(sentence);
  return sentence;
}

export function lookupArtifactLocator(name) {
  const key = String(name ?? "").trim();
  if (!key) return null;
  return artifactLocatorByName.get(key) ?? artifactLatestByProducer.get(key) ?? null;
}

export function recordExchange({ artifactName, op, producer = "exchange", sentence } = {}) {
  if (!exchangeRecorder || !artifactName || !op) return null;
  const record = {
    mood: "ya",
    exists: true,
    be: "exchange",
    su: { name: artifactName },
    as: { name: op },
    from: { name: producer }
  };
  if (sentence) {
    record.ob = { la: sentence };
  }
  exchangeRecorder(record);
  return record;
}

export function emitExchangeSentence(sentence) {
  if (!exchangeRecorder || !sentence) return null;
  exchangeRecorder(sentence);
  return sentence;
}

export function hashLocator(locator) {
  if (!locator) return null;
  const normalized = normalizeLocator(locator);
  const absPath = path.resolve(exchangeRunRoot ?? normalizeRunRoot(process.cwd()), normalized);
  const bytes = fs.readFileSync(absPath);
  const hash = hashBytes(bytes);
  const size = bytes.length;
  return { hash, size, locator: normalized };
}

export function getArtifactName(locator) {
  if (!locator) return null;
  const normalized = normalizeLocator(locator);
  return artifactByLocator.get(normalized) ?? null;
}
