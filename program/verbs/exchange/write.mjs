import fs from "node:fs/promises";
import { remember } from "../../remember/index.mjs";
import { state } from "../../bridge/state.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
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

export default async function write(sentence, { remember: rememberFn = remember } = {}) {
  const target = sentence?.to?.filename;
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
  const text = renderWriteValue(sentence.ob ?? {}, { rememberFn, format });
  const normalized = normalizeNewlines(text);
  if (target) {
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
