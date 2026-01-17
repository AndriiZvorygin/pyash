import fs from "node:fs/promises";
import fsSync from "node:fs";
import { spawn } from "node:child_process";
import { remember } from "../../remember/index.mjs";
import { state } from "../../bridge/state.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { getEffectiveVyahAspect } from "../../library/grammar/vyah.mjs";
import { resolveConfigText } from "../../configure/env.mjs";
import { mapSentenceToPyash } from "./json_map.mjs";
import { jsonObjectFromMapSentence } from "./json_map_export.mjs";
import { csvTextFromMapName } from "./write_csv.mjs";
import { canonicalJsonStringify, canonicalizeJsonValue, jsonObjectFromPyash } from "./write_json.mjs";
import YAML from "yaml";

function vectorLiteral(values = [], type = "num") {
  const parts = ["ve", type];
  for (const value of values) {
    if (typeof value === "number") {
      parts.push(String(value));
    } else if (typeof value === "boolean") {
      parts.push(value ? "truth" : "lie");
    } else if (typeof value === "string") {
      if (/^[A-Za-z0-9_.-]+$/.test(value)) {
        parts.push(value);
      } else {
        parts.push(JSON.stringify(value));
      }
    } else {
      parts.push(String(value));
    }
  }
  return parts.join(" ");
}

function resolveGenitive(genitive, { rememberFn } = {}) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return undefined;

  const [root, ...rest] = chainArr;
  let curr =
    root === "this"
      ? (state.currentEvokeRef || state.currentEvoke)
      : (typeof root === "string" && rememberFn ? rememberFn(root) : undefined);

  for (const part of rest) {
    if (curr && typeof curr === "object" && curr.name && rememberFn) {
      const fact = rememberFn(curr.name);
      if (fact) curr = fact.ob ?? fact;
    }
    if (curr && typeof curr === "object") {
      if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
        curr = curr.ob.map[part];
      } else if (curr.ob && curr.ob[part] !== undefined) {
        curr = curr.ob[part];
      } else {
        curr = curr?.[part];
      }
    } else {
      curr = curr?.[part];
    }
  }

  if (typeof curr === "number") return curr;
  if (typeof curr === "string") return curr;
  if (curr && typeof curr === "object") {
    if (typeof curr.num === "number") return curr.num;
    if (typeof curr.text === "string") return curr.text;
    if (typeof curr.boolean === "boolean") return curr.boolean ? "truth" : "lie";
    if (Array.isArray(curr.values)) return vectorLiteral(curr.values, curr.type || "num");
    if (curr.ve?.values) return vectorLiteral(curr.ve.values, curr.ve.type || "num");
  }
  return curr;
}

function mapDefChainFromName(name, { rememberFn } = {}) {
  const visited = new Set();
  const defs = [];

  const visit = (mapName) => {
    if (!mapName || visited.has(mapName)) return;
    visited.add(mapName);
    const fact = rememberFn ? rememberFn(mapName) : null;
    if (!fact || (fact.be !== "json map" && fact.be !== "map" && fact.be !== "csv map")) return;
    const entries = fact?.ob?.map ?? {};
    for (const value of Object.values(entries)) {
      if (value?.name) visit(value.name);
      if (value?.ve?.type === "name") {
        for (const child of value.ve.values || []) {
          if (typeof child === "string") visit(child);
        }
      }
    }
    defs.push(fact);
  };

  visit(name);
  if (defs.length === 0) return "";
  return defs.map(mapSentenceToPyash).join("\n\n");
}

export function renderWriteValue(ob = {}, { rememberFn, format = "pyash" } = {}) {
  if (format === "yaml") {
    const textValue = typeof ob.text === "string"
      ? ob.text
      : (ob.name && rememberFn ? (rememberFn(ob.name)?.ob?.text ?? null) : null);
    if (typeof textValue === "string") {
      const json = jsonObjectFromPyash(textValue, {});
      return YAML.stringify(canonicalizeJsonValue(json));
    }
  }
  if (format === "json" || format === "beautiful json") {
    const textValue = typeof ob.text === "string"
      ? ob.text
      : (ob.name && rememberFn ? (rememberFn(ob.name)?.ob?.text ?? null) : null);
    if (typeof textValue === "string") {
      const json = jsonObjectFromPyash(textValue, {});
      return format === "json"
        ? canonicalJsonStringify(json)
        : JSON.stringify(json, null, 2);
    }
  }
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.num === "number") return ob.num;
  if (typeof ob.boolean === "boolean") return ob.boolean ? "truth" : "lie";
  if (ob.hollow) return "null";
  if (ob.la) return `la ${sentenceToPyash(ob.la)} ko`;
  if (format === "csv" && ob.name && rememberFn) {
    return csvTextFromMapName(ob.name, { rememberFn });
  }
  if (ob.genitive) {
    const v = resolveGenitive(ob.genitive, { rememberFn });
    if (v !== undefined) return v;
  }
  if (ob.name && rememberFn) {
    const fact = rememberFn(ob.name);
    if (fact?.be === "json map" || fact?.be === "map" || fact?.be === "csv map") {
      if (fact.be === "json map" && format === "yaml") {
        const json = jsonObjectFromMapSentence(fact, { remember: rememberFn, seen: new Set(), sourceName: "write", allowHollowVector: true });
        return YAML.stringify(canonicalizeJsonValue(json));
      }
      if (fact.be === "json map" && format === "json") {
        const json = jsonObjectFromMapSentence(fact, { remember: rememberFn, seen: new Set(), sourceName: "write", allowHollowVector: true });
        return canonicalJsonStringify(json);
      }
      if (fact.be === "json map" && format === "beautiful json") {
        const json = jsonObjectFromMapSentence(fact, { remember: rememberFn, seen: new Set(), sourceName: "write", allowHollowVector: true });
        return JSON.stringify(json, null, 2);
      }
      const chain = mapDefChainFromName(ob.name, { rememberFn });
      return chain || sentenceToPyash(fact);
    }
    if (fact?.ob?.la) return sentenceToPyash(fact);
    if (fact?.ob?.ve?.values) return sentenceToPyash(fact);
    if (fact?.ob?.text !== undefined) return fact.ob.text;
    if (fact?.ob?.num !== undefined) return fact.ob.num;
    if (fact?.ob?.boolean !== undefined) return fact.ob.boolean ? "truth" : "lie";
    if (fact?.ob?.hollow) return "null";
  }
  if (ob.name) return ob.name;
  return "";
}

function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function startFileTail({ filename, onLine }) {
  let offset = 0;
  let pending = "";
  const interval = setInterval(() => {
    let stats;
    try {
      stats = fsSync.statSync(filename);
    } catch {
      return;
    }
    if (stats.size <= offset) return;
    const fd = fsSync.openSync(filename, "r");
    const buffer = Buffer.alloc(stats.size - offset);
    fsSync.readSync(fd, buffer, 0, buffer.length, offset);
    fsSync.closeSync(fd);
    offset = stats.size;
    const text = pending + buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length) onLine(line);
    }
  }, 200);
  return () => clearInterval(interval);
}

function resolveKeyboardCommand({ rememberFn } = {}) {
  const bin = resolveConfigText("keyboard bin", { rememberFn }) || "xdotool";
  return { bin, args: ["type", "--clearmodifiers", "--delay", "0"] };
}

function normalizeStreamLine(line) {
  return String(line ?? "").trim().toLowerCase();
}

function normalizeStreamPrefix(line) {
  const normalized = normalizeStreamLine(line);
  return normalized.replace(/[.]+$/u, "");
}

function makeStreamIncrementalWriter(onAppend) {
  let lastLine = "";
  let lineOpen = false;
  const needsSpaceAfterPunct = (prev, next) => /[.!?]$/.test(prev) && next && !/^\s/.test(next);
  return {
    write(line) {
      const trimmed = String(line ?? "").trim();
      if (!trimmed) return;
      if (!lastLine) {
        onAppend(trimmed);
        lastLine = trimmed;
        lineOpen = true;
        return;
      }
      const normLast = normalizeStreamLine(lastLine);
      const normNext = normalizeStreamLine(trimmed);
      const normLastPrefix = normalizeStreamPrefix(lastLine);
      if (normNext === normLast) return;
      if (normNext.startsWith(normLast) || (normLastPrefix && normNext.startsWith(normLastPrefix))) {
        const baseLen = normNext.startsWith(normLast) ? lastLine.length : lastLine.replace(/[.]+$/u, "").length;
        let suffix = trimmed.slice(baseLen);
        if (needsSpaceAfterPunct(lastLine, suffix)) {
          suffix = ` ${suffix}`;
        }
        if (suffix) {
          onAppend(suffix);
          lastLine = trimmed;
          lineOpen = true;
        }
        return;
      }
      if (lineOpen) onAppend("\n");
      onAppend(trimmed);
      lastLine = trimmed;
      lineOpen = true;
    },
    finish() {
      if (lineOpen) onAppend("\n");
      lineOpen = false;
    }
  };
}

async function sendKeyboardText(text, { bin, args }) {
  if (!text) return;
  await new Promise((resolve, reject) => {
    const proc = spawn(bin, [...args, text], { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", status => {
      if (status && status !== 0) {
        reject(new Error(`keyboard command exited with ${status}`));
      } else {
        resolve();
      }
    });
  });
}

export default async function write(sentence, { remember: rememberFn = remember } = {}) {
  const modifiers = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const aspect = getEffectiveVyahAspect(modifiers, { verb: "write", caseKey: "vyah" });
  const aspectKey = aspect === "stream" ? "stream" : "eval";
  if (aspectKey !== "eval" && aspectKey !== "stream") {
    throwErrorSentence({
      name: "write aspect invalid",
      message: `write does not support vyah ${aspect}`,
      from: { name: "write" },
      raw: { aspect }
    });
  }

  const target = sentence?.to?.filename;
  const targetName = sentence?.to?.name ?? sentence?.to?.wo ?? sentence?.to?.text;
  const isKeyboard = targetName === "keyboard";
  if (targetName && !isKeyboard && aspectKey !== "stream") {
    throwErrorSentence({
      name: "write target invalid",
      message: `write target invalid: to name ${targetName}`,
      from: { name: "write" },
      raw: { targetName }
    });
  }
  const formatParts = [];
  if (sentence?.become?.name) formatParts.push(sentence.become.name);
  if (sentence?.become?.text) formatParts.push(sentence.become.text);
  const formatRaw = formatParts.join(" ").trim().toLowerCase();
  let format = "pyash";
  if (formatRaw.includes("json") && formatRaw.includes("beautiful")) {
    format = "beautiful json";
  } else if (formatRaw.includes("json")) {
    format = "json";
  } else if (formatRaw.includes("yaml")) {
    format = "yaml";
  } else if (formatRaw.includes("csv")) {
    format = "csv";
  }
  if (aspectKey === "stream") {
    if (!isKeyboard) {
      throwErrorSentence({
        name: "write stream invalid",
        message: "write vyah stream requires to wo keyboard",
        from: { name: "write" },
        raw: { sentence }
      });
    }
    const streamName = sentence?.from?.name ?? sentence?.from?.text;
    if (!streamName) {
      throwErrorSentence({
        name: "write stream invalid",
        message: "write vyah stream requires from name <stream>",
        from: { name: "write" },
        raw: { sentence }
      });
    }
    const stream = rememberFn(streamName);
    const streamLike = stream && (stream.be === "stream" || stream.ob?.filename || Array.isArray(stream.ob?.ve?.values));
    if (!streamLike) {
      throwErrorSentence({
        name: "write stream missing",
        message: `stream not found: ${streamName} (set PYA_STREAM_STDOUT=0 or define stream stdout default to lie for hear stream handles)`,
        from: { name: "write" },
        raw: { streamName }
      });
    }
    const keyboardCmd = resolveKeyboardCommand({ rememberFn });
    let collected = "";
    let chain = Promise.resolve();
    const append = (chunk) => {
      if (!chunk) return;
      collected += chunk;
      chain = chain.then(() => sendKeyboardText(chunk, keyboardCmd)).catch(() => {});
    };
    if (Array.isArray(stream?.ob?.ve?.values)) {
      for (const value of stream.ob.ve.values) {
        append(String(value ?? ""));
        append("\n");
      }
      await chain;
    } else if (stream?.ob?.filename) {
      const filename = stream.ob.filename;
      let done = null;
      const waitForBlank = new Promise(resolve => { done = resolve; });
      const writer = makeStreamIncrementalWriter((chunk) => {
        append(chunk);
      });
      const stopTail = startFileTail({
        filename,
        onLine: (line) => {
          const trimmed = String(line ?? "").trim();
          if (!trimmed) return;
          if (trimmed.includes("[BLANK_AUDIO]") || trimmed.includes("[PYA_STREAM_END]")) {
            if (done) done();
            return;
          }
          writer.write(trimmed);
        }
      });
      await waitForBlank;
      stopTail();
      writer.finish();
      await chain;
    } else {
      throwErrorSentence({
        name: "write stream invalid",
        message: "write vyah stream requires a hear stream",
        from: { name: "write" },
        raw: { streamName }
      });
    }
    return { ob: { text: normalizeNewlines(collected).trimEnd() }, be: "write" };
  }

  const text = renderWriteValue(sentence.ob ?? {}, { rememberFn, format });
  const normalized = normalizeNewlines(text);
  if (isKeyboard) {
    const keyboardCmd = resolveKeyboardCommand({ rememberFn });
    try {
      await sendKeyboardText(normalized, keyboardCmd);
    } catch (err) {
      throwErrorSentence({
        name: "write keyboard defective",
        message: `write keyboard defective: ${err?.message ?? "unknown error"}`,
        from: { name: "write" },
        raw: { error: err?.message ?? String(err ?? "") }
      });
    }
  } else if (target) {
    await fs.writeFile(target, normalized, "utf8");
    const buffer = Buffer.from(normalized, "utf8");
    const artifact = recordArtifact({ locator: target, producer: "exchange", bytes: buffer });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "write", producer: "exchange" });
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(text);
  }
  return { ob: { text: normalized }, be: "write" };
}

export const signatures = [
  { signatureWords: ["be", "write", "ob", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "hollow"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "hollow"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "map"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "json", "map"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "text", "to", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "text", "to", "wo", "keyboard"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "wo", "keyboard"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "to", "text", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "text", "to", "text", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "stream", "to", "text", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "to", "wo", "keyboard", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "text", "to", "wo", "keyboard", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "stream", "to", "wo", "keyboard", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "from", "name", "filename", "to", "wo", "keyboard", "vyah", "stream"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "csv", "ob", "name", "csv", "map"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "json", "ob", "name", "json", "map"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "name", "json", "map"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "json", "ob", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "json", "ob", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "csv", "map"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "bool"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "hollow"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "bool"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "hollow"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "json", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "json", "ob", "name", "json", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "csv", "ob", "name", "csv", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "name", "json", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "name", "yaml", "ob", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "csv", "map", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "bool", "to", "filename"], handler: write }
];
