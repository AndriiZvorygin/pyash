import fs from "node:fs/promises";
import path from "node:path";

import { remember, doRemember } from "../remember/index.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { throwErrorSentence } from "../error.mjs";
import { normalizeSearxUrl, resolveSearchMotor } from "../library/web_search_endpoint.mjs";
import { isClusterCompressFormat, searchZimArchive } from "../library/zim_archive.mjs";

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

function isYaCyJsonEndpoint(value) {
  try {
    return new URL(String(value ?? "")).pathname.replace(/\/+$/u, "").endsWith("/yacysearch.json");
  } catch {
    return false;
  }
}

function isYagoSearchEndpoint(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.pathname.replace(/\/+$/u, "") === "/search";
  } catch {
    return false;
  }
}

function normalizeYaCyUrl(endpoint, question, limit) {
  const url = new URL(endpoint);
  url.searchParams.set("query", question);
  url.searchParams.set("maximumRecords", String(limit));
  url.searchParams.set("contentdom", "text");
  return url.toString();
}

function normalizeYaCyPayload(payload, limit) {
  const channels = Array.isArray(payload?.channels) ? payload.channels : [];
  const channel = channels[0] ?? {};
  const items = Array.isArray(channel.items) ? channel.items : [];
  return {
    complete: payload?.complete === true,
    totalResults: channel.totalResults ?? null,
    failures: Array.isArray(channel.partialFailures)
      ? channel.partialFailures.map((failure) => {
        const reason = String(failure?.reason ?? "").toLowerCase();
        const source = String(failure?.source ?? "").toLowerCase();
        if (source === "local-search" && /deadline|timeout|timed out/u.test(reason)) return "local search timed out";
        if (source === "fuzzy-stage" && /deadline|timeout|timed out/u.test(reason)) return "fuzzy search timed out";
        if (/deadline|timeout|timed out/u.test(reason)) return "search peer timed out";
        if (/status \d{3}|invalid response/u.test(reason)) return "search peer returned an error";
        return "search peer unavailable";
      })
      : [],
    results: items.slice(0, limit).map((item) => ({
      url: String(item?.link ?? item?.url ?? ""),
      title: String(item?.title ?? ""),
      abstract: String(item?.description ?? item?.abstract ?? ""),
      branch: String(item?.category ?? ""),
      motor: "yacy"
    })).filter((item) => item.url)
  };
}

function normalizeYagoPayload(payload, limit) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return {
    status: String(payload?.status ?? "response received").toLowerCase(),
    totalResults: payload?.total_results ?? payload?.totalResults ?? null,
    results: results.slice(0, limit).map((item) => ({
      url: String(item?.url ?? item?.link ?? ""),
      title: String(item?.title ?? ""),
      abstract: String(item?.content ?? item?.description ?? item?.snippet ?? ""),
      branch: "",
      motor: "yago"
    })).filter((item) => item.url)
  };
}

function resolveYagoApiKey(rememberFn) {
  return String(process.env.YAGO_API_KEY ?? resolveConfigText("yago api key", { rememberFn }) ?? "").trim();
}

function retryAfterMilliseconds(value) {
  const retryAfter = String(value ?? "").trim();
  if (/^\d+(?:\.\d+)?$/u.test(retryAfter)) return Math.min(5000, Number(retryAfter) * 1000);
  const date = Date.parse(retryAfter);
  if (Number.isFinite(date)) return Math.min(5000, Math.max(0, date - Date.now()));
  return 1000;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`status ${res.status}`);
  }
  return res.json();
}

async function fetchYagoSearch(url, apiKey, body) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(body)
    });
    if (response.status === 409) {
      if (attempt === 0) {
        await wait(retryAfterMilliseconds(response.headers.get("retry-after")));
        continue;
      }
      return { incompleteReason: "search sources did not complete" };
    }
    if (!response.ok) throw new Error(`status ${response.status}`);
    return { payload: await response.json() };
  }
  return { incompleteReason: "search sources did not complete" };
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
  motorUrl = resolveSearchMotor(motorUrl);
  const limit = Math.max(1, Math.trunc(Number(sentence?.by?.num ?? 10)));

  let payload;
  const fixture = await loadFixture();
  let yacyResult = null;
  let yagoResult = null;
  if (fixture) {
    payload = JSON.parse(fixture);
  } else {
    const yacyEndpoint = isYaCyJsonEndpoint(motorUrl);
    const yagoEndpoint = !yacyEndpoint && isYagoSearchEndpoint(motorUrl);
    let url;
    let options;
    let yagoApiKey = "";
    if (yacyEndpoint) {
      url = normalizeYaCyUrl(motorUrl, question, limit);
    } else if (yagoEndpoint) {
      yagoApiKey = resolveYagoApiKey(rememberFn);
      if (!yagoApiKey) {
        throwErrorSentence({
          name: "web search api key lost",
          message: "web search api key lost: add yago api key to configure/secret.pya or set YAGO_API_KEY",
          from: { name: "search" },
          raw: { motor: motorUrl }
        });
      }
      url = motorUrl;
    } else {
      url = normalizeSearxUrl(motorUrl, question, limit);
    }
    try {
      if (yagoEndpoint) {
        const yagoResponse = await fetchYagoSearch(url, yagoApiKey, { query: question, max_results: limit });
        payload = yagoResponse.payload ?? {};
        yagoResult = yagoResponse.incompleteReason
          ? { status: "incomplete", totalResults: null, results: [], failures: [yagoResponse.incompleteReason] }
          : normalizeYagoPayload(payload, limit);
      } else {
        payload = await fetchJson(url, options);
      }
      if (yacyEndpoint) yacyResult = normalizeYaCyPayload(payload, limit);
    } catch (err) {
      if (yagoEndpoint && /status 401|status 403/u.test(String(err?.message ?? ""))) {
        throwErrorSentence({
          name: "web search authentication failed",
          message: "web search authentication failed: Yago rejected the Search API key; check yago api key in configure/secret.pya",
          from: { name: "search" },
          raw: { motor: motorUrl, status: String(err.message).match(/status \d+/u)?.[0] }
        });
      }
      const hint = yagoEndpoint
        ? "hint: verify the Yago /search endpoint and yago api key in configure/secret.pya"
        : "hint: set web search motor in configure/container.pya or configure/secret.pya and run container/pyash/command/begin.sh --restart to start searxng, or set web search motor explicitly";
      throwErrorSentence({
        name: "web search defective",
        message: `web search defective: ${err?.message ?? "request failed"}; ${hint}`,
        from: { name: "search" },
        raw: { error: err?.message ?? String(err), motor: motorUrl }
      });
    }
  }
  const rawResults = yacyResult ? yacyResult.results : yagoResult ? yagoResult.results : Array.isArray(payload?.results) ? payload.results : [];
  const normalized = yacyResult || yagoResult ? rawResults : rawResults.slice(0, limit).map((result) => {
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
  if (yacyResult) {
    const status = yacyResult.complete ? "complete" : normalized.length ? "partial" : "incomplete";
    const summaryParts = [`Search status: ${status}`, `${normalized.length} result${normalized.length === 1 ? "" : "s"} returned`];
    if (yacyResult.totalResults != null) summaryParts.push(`reported total: ${yacyResult.totalResults}`);
    const failureCounts = new Map();
    for (const failure of yacyResult.failures) {
      failureCounts.set(failure, (failureCounts.get(failure) ?? 0) + 1);
    }
    if (yacyResult.failures.length) {
      summaryParts.push(`issues: ${[...failureCounts]
        .map(([reason, count]) => `${reason}${count > 1 ? ` (${count})` : ""}`)
        .join("; ")}`);
    }
    map.metadata.searchStatus = { text: status };
    if (yacyResult.totalResults != null) map.metadata.searchTotalResults = { text: String(yacyResult.totalResults) };
    if (failureCounts.size) map.metadata.searchIssues = { text: [...failureCounts]
      .map(([reason, count]) => `${reason}${count > 1 ? ` (${count})` : ""}`)
      .join("; ") };
    map.metadata.as = { text: summaryParts.join("; ") };
  }
  if (yagoResult) {
    const status = ["partial", "incomplete"].includes(yagoResult.status) ? yagoResult.status : "response received";
    const summaryParts = [`Search status: ${status}`, `${normalized.length} result${normalized.length === 1 ? "" : "s"} returned`];
    if (yagoResult.totalResults != null) summaryParts.push(`reported total: ${yagoResult.totalResults}`);
    if (yagoResult.failures?.length) {
      const counts = new Map();
      for (const failure of yagoResult.failures) counts.set(failure, (counts.get(failure) ?? 0) + 1);
      const issues = [...counts].map(([reason, count]) => `${reason}${count > 1 ? ` (${count})` : ""}`).join("; ");
      map.metadata.searchIssues = { text: issues };
      summaryParts.push(`issues: ${issues}`);
    }
    map.metadata.searchStatus = { text: status };
    map.metadata.via = { name: "yago" };
    if (yagoResult.totalResults != null) map.metadata.searchTotalResults = { text: String(yagoResult.totalResults) };
    map.metadata.as = { text: summaryParts.join("; ") };
  }
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

export async function search(sentence, { remember: rememberFn = remember, runtimeContext = null } = {}) {
  const webFlag = sentence?.fromstate?.wo === "web" || sentence?.fromstate?.text === "web";
  if (webFlag) {
    return searchWeb(sentence, { remember: rememberFn });
  }
  if (isClusterCompressFormat(sentence)) {
    return searchZimArchive(sentence, { remember: rememberFn, runtimeContext });
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
  { signatureWords: ["be", "search", "inside", "name", "filename", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "as", "wo", "cluster-compress", "in", "filename", "ob", "text"], handler: search },
  { signatureWords: ["be", "search", "as", "wo", "cluster-compress", "in", "filename", "ob", "name", "text"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "inside", "filename", "as", "wo", "cluster-compress"], handler: search },
  { signatureWords: ["be", "search", "ob", "text", "in", "filename", "fromstate", "wo", "zim"], handler: search },
  { signatureWords: ["be", "search", "fromstate", "wo", "zim", "ob", "text"], handler: search }
];
