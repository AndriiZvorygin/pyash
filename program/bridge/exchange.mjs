import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

import { throwErrorSentence } from "../error.mjs";

let exchangeRecorder = null;
let exchangeRunRoot = null;
let exchangeRunId = null;
let exchangeSentenceId = null;
let artifactCounter = 0;
const artifactByLocator = new Map();
const artifactHashes = new Map();
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
  artifactCounter = 0;
  artifactByLocator.clear();
  artifactHashes.clear();
  exchangeStrict = false;
}

export function clearExchangeRecorder() {
  exchangeRecorder = null;
  exchangeRunRoot = null;
  exchangeRunId = null;
  exchangeSentenceId = null;
  artifactCounter = 0;
  artifactByLocator.clear();
  artifactHashes.clear();
  exchangeStrict = false;
}

export function setExchangeRunRoot(runRoot) {
  exchangeRunRoot = runRoot ? normalizeRunRoot(runRoot) : null;
}

export function setExchangeRunId(runId) {
  exchangeRunId = runId ? String(runId) : null;
}

export function setExchangeSentenceId(sentenceId) {
  exchangeSentenceId = sentenceId ? String(sentenceId) : null;
}

export function getExchangeSentenceId() {
  return exchangeSentenceId;
}

export function setExchangeStrict(value) {
  exchangeStrict = Boolean(value);
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

function linkRunAlias({ name, target } = {}) {
  if (!exchangeRunId || !name || !target) return null;
  const runRoot = exchangeRunRoot ?? normalizeRunRoot(process.cwd());
  const rel = ["artifacts", exchangeRunId, name].join("/");
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
  const name = `artifact-${artifactCounter}`;
  artifactCounter += 1;
  return name;
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
      linkRunAlias({ name: existing, target: written?.absolute });
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
    su: { name: nextArtifactName() },
    ob: exchangeSentenceId ? { name: exchangeSentenceId } : { text: normalized },
    to: { filename: normalized },
    from: { name: producer }
  };
  if (hash) {
    sentence.accordingto = { name: "sha256" };
    sentence.fromtext = { text: hash };
    artifactHashes.set(sentence.su.name, hash);
    const written = writeContentAddressed({ hash, locator: normalized, bytes });
    linkRunAlias({ name: sentence.su.name, target: written?.absolute });
  }
  if (size != null) {
    sentence.by = { num: size };
  }
  if (kind) {
    sentence.as = { name: kind };
  }
  artifactByLocator.set(normalized, sentence.su.name);
  exchangeRecorder(sentence);
  return sentence;
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
