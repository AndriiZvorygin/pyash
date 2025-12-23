import fs from "node:fs/promises";
import { remember } from "../remember/index.mjs";
import { state } from "../bridge/state.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { throwErrorSentence } from "../error.mjs";
import { mapSentenceToPyash } from "./exchange/json_map.mjs";

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

const JSON_SCALAR_VECTORS = new Set(["num", "number", "text", "bool", "boolean", "hollow"]);

function jsonValueFromObj(ob, { rememberFn, seen }) {
  if (!ob || (typeof ob === "object" && Object.keys(ob).length === 0)) return undefined;
  if (ob.hollow) return null;
  if (ob.text !== undefined) return ob.text;
  if (ob.num !== undefined) return ob.num;
  if (ob.boolean !== undefined) return ob.boolean;
    if (ob.ve) {
      const type = ob.ve.type || "num";
      if (type === "hollow") return [];
      if (type === "name") {
        return ob.ve.values.map((name) => jsonObjectFromMapName(name, { rememberFn, seen }));
      }
      if (!JSON_SCALAR_VECTORS.has(type)) {
        throwErrorSentence({
          name: "json map contents defective",
          message: `json map contents defective: unsupported vector type ${type}`,
          from: { name: "say" },
          raw: { type }
        });
      }
      return ob.ve.values.map((value) => {
        if (type === "bool" || type === "boolean") return value === "truth" || value === true || value === 1;
        return value;
      });
    }
  if (ob.name) return jsonObjectFromMapName(ob.name, { rememberFn, seen });
  throwErrorSentence({
    name: "json map contents defective",
    message: "json map contents defective: unsupported contents",
    from: { name: "say" },
    raw: ob
  });
  return undefined;
}

function jsonObjectFromMapName(name, { rememberFn, seen }) {
  const fact = rememberFn ? rememberFn(name) : null;
  if (!fact || fact.be !== "json map") {
    throwErrorSentence({
      name: "json map referential defective",
      message: `json map referential defective: ${name}`,
      from: { name: "say" },
      raw: { name }
    });
  }
  return jsonObjectFromMapSentence(fact, { rememberFn, seen });
}

function jsonObjectFromMapSentence(mapSentence, { rememberFn, seen }) {
  const mapName = mapSentence?.su?.name ?? "<map>";
  if (seen.has(mapName)) {
    throwErrorSentence({
      name: "json map export self referential",
      message: "json map export self referential",
      from: { name: "say" },
      raw: { name: mapName }
    });
  }
  seen.add(mapName);
  const entries = mapSentence?.ob?.map ?? {};
  const out = {};
  for (const [key, value] of Object.entries(entries)) {
    const jsonValue = jsonValueFromObj(value, { rememberFn, seen });
    if (jsonValue === undefined) continue;
    out[key] = jsonValue;
  }
  seen.delete(mapName);
  return out;
}

function mapDefChainFromName(name, { rememberFn } = {}) {
  const visited = new Set();
  const defs = [];

  const visit = (mapName) => {
    if (!mapName || visited.has(mapName)) return;
    visited.add(mapName);
    const fact = rememberFn ? rememberFn(mapName) : null;
    if (!fact || (fact.be !== "json map" && fact.be !== "map")) return;
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

export function renderSayValue(ob = {}, { rememberFn, format = "pyash" } = {}) {
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.num === "number") return ob.num;
  if (typeof ob.boolean === "boolean") return ob.boolean ? "truth" : "lie";
  if (ob.hollow) return "null";
  if (ob.genitive) {
    const v = resolveGenitive(ob.genitive, { rememberFn });
    if (v !== undefined) return v;
  }
  if (ob.name && rememberFn) {
    const fact = rememberFn(ob.name);
    if (fact?.be === "json map" || fact?.be === "map") {
      if (fact.be === "json map" && format === "json") {
        const json = jsonObjectFromMapSentence(fact, { rememberFn, seen: new Set() });
        return JSON.stringify(json, null, 2);
      }
      const chain = mapDefChainFromName(ob.name, { rememberFn });
      return chain || sentenceToPyash(fact);
    }
    if (fact?.ob?.ve?.values) return sentenceToPyash(fact);
    if (fact?.ob?.text !== undefined) return fact.ob.text;
    if (fact?.ob?.num !== undefined) return fact.ob.num;
    if (fact?.ob?.boolean !== undefined) return fact.ob.boolean ? "truth" : "lie";
    if (fact?.ob?.hollow) return "null";
  }
  if (ob.name) return ob.name;
  return "";
}

export async function say(sentence, { remember: rememberFn = remember } = {}) {
  const format = (sentence?.become?.name || sentence?.become?.text || "").toLowerCase();
  const text = renderSayValue(sentence.ob ?? {}, { rememberFn, format: format === "json" ? "json" : "pyash" });
  if (sentence?.to?.filename) {
    await fs.writeFile(sentence.to.filename, String(text ?? ""), "utf8");
  }
  // Log for REPL friendliness
  // eslint-disable-next-line no-console
  console.log(text);
  return { ob: { text }, be: "say" };
}

export default say;

export const signatures = [
  { signatureWords: ["be", "say", "ob", "text"], handler: say },
  { signatureWords: ["be", "say", "ob", "num"], handler: say },
  { signatureWords: ["be", "say", "ob", "bool"], handler: say },
  { signatureWords: ["be", "say", "ob", "hollow"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "text"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "num"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "bool"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "hollow"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "vec"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "vec", "num"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "vec", "text"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "vec", "bool"], handler: say },
  { signatureWords: ["be", "say", "ob", "vec"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "text"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "num"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "bool"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "hollow"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "text"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "num"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "bool"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "hollow"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "vec"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "vec", "num"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "vec", "text"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "vec", "bool"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "vec"], handler: say },
  { signatureWords: ["be", "say", "ob", "text", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "num", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "bool", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "hollow", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "text", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "num", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "bool", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "hollow", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "vec", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "vec", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "text", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "num", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "bool", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "hollow", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "text", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "num", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "bool", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "hollow", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "vec", "to", "filename"], handler: say }
];
