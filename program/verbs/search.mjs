import fs from "node:fs/promises";
import path from "node:path";

import { remember, doRemember } from "../remember/index.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { throwErrorSentence } from "../error.mjs";

function resolveFilename(value, { rememberFn } = {}) {
  if (!value) return "";
  if (typeof value.filename === "string") return value.filename;
  if (typeof value.text === "string") return value.text;
  if (value.name && rememberFn) {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return "";
}

function resolveText(value, { rememberFn } = {}) {
  if (!value) return "";
  if (typeof value.text === "string") return value.text;
  if (value.name && rememberFn) {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return "";
}

function resolveMotor(value, { rememberFn } = {}) {
  if (!value) return "";
  if (typeof value.filename === "string") return value.filename;
  if (typeof value.text === "string") return value.text;
  if (value.name && rememberFn) {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return "";
}

function normalizeSearxUrl(base, question, limit) {
  const trimmed = String(base ?? "").replace(/\/+$/, "");
  const hasSearch = trimmed.endsWith("/search");
  const url = new URL(hasSearch ? trimmed : `${trimmed}/search`);
  url.searchParams.set("q", question);
  url.searchParams.set("format", "json");
  if (limit) url.searchParams.set("count", String(limit));
  return url.toString();
}

function rankKey(rank) {
  return String(rank);
}

async function loadFixture() {
  const envPath = process.env.PYA_WEB_SEARCH_FIXTURE;
  if (envPath) {
    return fs.readFile(envPath, "utf8");
  }
  const cfg = resolveConfigText("web search fixture", { rememberFn: remember });
  if (cfg) {
    return fs.readFile(String(cfg), "utf8");
  }
  const fact = remember("web search fixture");
  const filename = fact?.ob?.filename ?? fact?.ob?.text;
  if (filename) {
    return fs.readFile(String(filename), "utf8");
  }
  return null;
}

function buildFoundMap({ question, motorUrl, limit, results }) {
  const map = {};
  map.metadata = {
    mood: "ya",
    su: { name: "metadata" },
    ob: { text: question },
    fromstate: { text: "web", wo: "web" },
    from: { filename: motorUrl },
    by: { num: limit }
  };
  const motorId = (() => {
    try {
      return new URL(motorUrl).hostname;
    } catch {
      return "motor";
    }
  })();
  map.metadata.via = { name: motorId };

  results.forEach((entry, idx) => {
    const rank = idx + 1;
    const key = rankKey(rank);
    const sentence = {
      mood: "ya",
      su: { name: key },
      atindex: { num: rank },
      from: { filename: entry.url }
    };
    if (entry.title) sentence.ob = { text: entry.title };
    if (entry.abstract) sentence.as = { text: entry.abstract };
    if (entry.branch) sentence.fromstate = { text: entry.branch, wo: entry.branch };
    if (entry.motor) sentence.via = { name: entry.motor };
    map[key] = sentence;
  });
  return map;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`status ${res.status}`);
  }
  return res.json();
}

async function searchWeb(sentence, { remember: rememberFn = remember } = {}) {
  const question = resolveText(sentence?.ob, { rememberFn });
  if (!question) {
    throwErrorSentence({
      name: "web search question lost",
      message: "web search question lost",
      from: { name: "search" },
      raw: { sentence }
    });
  }
  const explicitMotor = resolveMotor(sentence?.from, { rememberFn });
  let motorUrl = explicitMotor;
  if (!motorUrl) {
    const motorFact = rememberFn("web search motor");
    motorUrl = motorFact?.ob?.filename ?? motorFact?.ob?.text ?? "";
  }
  if (!motorUrl) {
    throwErrorSentence({
      name: "web search motor lost",
      message: "web search motor lost",
      from: { name: "search" },
      raw: { sentence }
    });
  }
  const limit = Math.max(1, Math.trunc(Number(sentence?.by?.num ?? 10)));

  let payload;
  const fixture = await loadFixture();
  if (fixture) {
    payload = JSON.parse(fixture);
  } else {
    const url = normalizeSearxUrl(motorUrl, question, limit);
    try {
      payload = await fetchJson(url);
    } catch (err) {
      const hint = "hint: set web search motor in configure/container.pya or configure/secret.pya and run container/pyash/command/begin.sh --restart to start searxng, or set web search motor explicitly";
      throwErrorSentence({
        name: "web search defective",
        message: `web search defective: ${err?.message ?? "request failed"}; ${hint}`,
        from: { name: "search" },
        raw: { error: err?.message ?? String(err), motor: motorUrl }
      });
    }
  }
  const rawResults = Array.isArray(payload?.results) ? payload.results : [];
  const normalized = rawResults.slice(0, limit).map((result) => {
    const url = result?.url ?? result?.link ?? "";
    const title = result?.title ?? "";
    const abstract = result?.content ?? result?.summary ?? "";
    const branch = result?.category ?? "";
    const motor = result?.engine ?? (Array.isArray(result?.engines) ? result.engines[0] : "");
    return {
      url: String(url || ""),
      title: title ? String(title) : "",
      abstract: abstract ? String(abstract) : "",
      branch: branch ? String(branch) : "",
      motor: motor ? String(motor) : ""
    };
  }).filter(entry => entry.url);

  const map = buildFoundMap({ question, motorUrl, limit, results: normalized });
  const targetName = sentence?.su?.name ?? sentence?.to?.name ?? null;
  if (targetName) {
    return {
      mood: "ya",
      su: { name: targetName },
      ob: { map, text: question },
      from: { filename: motorUrl },
      be: "map"
    };
  }
  return { ob: { map, text: question }, be: "map" };
}

async function listFiles(root) {
  const stats = await fs.stat(root);
  if (stats.isFile()) return [root];
  if (!stats.isDirectory()) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFiles(next);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(next);
    }
  }
  return files;
}

export async function search(sentence, { remember: rememberFn = remember } = {}) {
  const webFlag = sentence?.fromstate?.wo === "web" || sentence?.fromstate?.text === "web";
  if (webFlag) {
    return searchWeb(sentence, { remember: rememberFn });
  }
  const pattern = resolveText(sentence?.ob, { rememberFn });
  const target = resolveFilename(sentence?.in ?? sentence?.inside, { rememberFn });
  if (!pattern) {
    throwErrorSentence({
      name: "search pattern missing",
      message: "search pattern missing",
      from: { name: "search" },
      raw: { sentence }
    });
  }
  if (!target) {
    throwErrorSentence({
      name: "search target missing",
      message: "search target missing",
      from: { name: "search" },
      raw: { sentence }
    });
  }
  const resolved = path.resolve(String(target));
  let files;
  try {
    files = await listFiles(resolved);
  } catch (err) {
    throwErrorSentence({
      name: "search defective",
      message: `search defective: ${resolved}`,
      from: { name: "search" },
      raw: { error: err?.message }
    });
  }
  const regex = new RegExp(pattern, "i");
  const matches = [];
  for (const file of files) {
    let contents;
    try {
      contents = await fs.readFile(file, "utf8");
    } catch (err) {
      throwErrorSentence({
        name: "search defective",
        message: `search defective: ${file}`,
        from: { name: "search" },
        raw: { error: err?.message }
      });
    }
    const lines = contents.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (regex.test(lines[i])) {
        matches.push(`${file}:${i + 1}:${lines[i]}`);
      }
    }
  }
  matches.sort((a, b) => a.localeCompare(b));
  return { ob: { text: matches.join("\n") }, be: "search" };
}

export default search;

export const signatures = [
  { signatureWords: ["be", "search", "ob", "text", "fromstate", "wo", "web"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "fromstate", "wo", "web"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "fromstate", "wo", "web", "by", "num"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "fromstate", "wo", "web", "by", "num"], handler: search },
  { signatureWords: ["be", "search", "by", "num", "fromstate", "wo", "web", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "by", "num", "fromstate", "wo", "web", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "fromstate", "wo", "web", "from", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "fromstate", "wo", "web", "from", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "fromstate", "wo", "web", "from", "filename", "by", "num"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "fromstate", "wo", "web", "from", "filename", "by", "num"], handler: search },
  { signatureWords: ["be", "search", "by", "num", "fromstate", "wo", "web", "from", "filename", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "by", "num", "fromstate", "wo", "web", "from", "filename", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "by", "num", "from", "filename", "fromstate", "wo", "web", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "by", "num", "from", "filename", "fromstate", "wo", "web", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "from", "filename", "fromstate", "wo", "web", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "from", "filename", "fromstate", "wo", "web", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "in", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "in", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "in", "name", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "in", "name", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "inside", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "inside", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "inside", "name", "filename"], handler: search },
  { signatureWords: ["be", "search", "ob", "name", "text", "inside", "name", "filename"], handler: search },
  { signatureWords: ["be", "search", "in", "filename", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "in", "filename", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "in", "name", "filename", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "in", "name", "filename", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "inside", "filename", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "inside", "filename", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "inside", "name", "filename", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "inside", "name", "filename", "ob", "name", "text"], handler: search }
];
