import crypto from "node:crypto";
import path from "node:path";

import { throwErrorSentence } from "../error.mjs";

let exchangeRecorder = null;
let exchangeRunRoot = null;
let artifactCounter = 0;

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
  artifactCounter = 0;
}

export function clearExchangeRecorder() {
  exchangeRecorder = null;
  exchangeRunRoot = null;
  artifactCounter = 0;
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

function nextArtifactName() {
  const name = `artifact-${artifactCounter}`;
  artifactCounter += 1;
  return name;
}

export function recordArtifact({ locator, producer = "exchange", bytes, kind } = {}) {
  if (!exchangeRecorder) return null;
  const normalized = normalizeLocator(locator);
  const hash = bytes ? hashBytes(bytes) : null;
  const size = bytes ? bytes.length : null;
  const sentence = {
    mood: "ya",
    be: "artifact",
    su: { name: nextArtifactName() },
    ob: { text: normalized },
    from: { name: producer }
  };
  if (hash) {
    sentence.accordingto = { name: "sha256" };
    sentence.fromtext = { text: hash };
  }
  if (size != null) {
    sentence.by = { num: size };
  }
  if (kind) {
    sentence.as = { name: kind };
  }
  exchangeRecorder(sentence);
  return sentence;
}

export function recordExchange({ artifactName, op, producer = "exchange", sentence } = {}) {
  if (!exchangeRecorder || !artifactName || !op) return null;
  const record = {
    mood: "ya",
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
