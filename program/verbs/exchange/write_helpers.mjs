import { remember } from "../../remember/index.mjs";
import { state } from "../../bridge/state.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { mapSentenceToPyash } from "./json_map.mjs";
import { jsonObjectFromMapSentence } from "./json_map_export.mjs";
import { csvTextFromMapName } from "./write_csv.mjs";
import { canonicalJsonStringify, canonicalizeJsonValue, jsonObjectFromPyash } from "./write_json.mjs";
import YAML from "yaml";
import { emitSystemdIniFromMap, emitSystemdIniFromSections } from "../../agent/service_definition.mjs";

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
      if (value?.ob?.name) visit(value.ob.name);
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

function readScalarAsText(value = {}) {
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.num === "number") return String(value.num);
  if (typeof value?.boolean === "boolean") return value.boolean ? "truth" : "lie";
  if (value?.hollow) return "";
  return "";
}

function sectionValuesFromJsonMap(name, { rememberFn } = {}) {
  const fact = rememberFn ? rememberFn(name) : null;
  if (!fact || fact.be !== "json map") return {};
  const out = {};
  const entries = fact?.ob?.map ?? {};
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value?.ve?.values)) {
      out[key] = value.ve.values.map(v => String(v ?? ""));
      continue;
    }
    out[key] = [readScalarAsText(value)];
  }
  return out;
}

function systemdTextFromMapName(name, { rememberFn } = {}) {
  const fact = rememberFn ? rememberFn(name) : null;
  if (!fact) return "";
  if (fact.be === "json map") {
    const json = jsonObjectFromMapSentence(fact, { remember: rememberFn, seen: new Set(), sourceName: "write", allowHollowVector: true });
    return emitSystemdIniFromMap(json);
  }
  if (fact.be !== "map") return "";
  const map = fact?.ob?.map ?? {};
  const unitName = map?.unit?.ob?.name ?? map?.unit?.name ?? "";
  const serviceName = map?.service?.ob?.name ?? map?.service?.name ?? "";
  const installName = map?.install?.ob?.name ?? map?.install?.name ?? "";
  const sections = {
    Unit: sectionValuesFromJsonMap(unitName, { rememberFn }),
    Service: sectionValuesFromJsonMap(serviceName, { rememberFn }),
    Install: sectionValuesFromJsonMap(installName, { rememberFn })
  };
  return emitSystemdIniFromSections(sections);
}

function seriesSentenceToPyash(fact = {}) {
  const name = String(fact?.su?.name ?? "").trim();
  const entries = Array.isArray(fact?.ob?.series) ? fact.ob.series : [];
  if (!name || entries.length === 0) return sentenceToPyash(fact);
  const lines = [`su name ${name} be series def`];
  for (const entry of entries) lines.push(sentenceToPyash(entry));
  lines.push("prah");
  return lines.join("\n");
}

function renderWriteValue(ob = {}, { rememberFn, format = "pyash" } = {}) {
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
  if (typeof ob.date === "string") return ob.date;
  if (typeof ob.boolean === "boolean") return ob.boolean ? "truth" : "lie";
  if (ob.hollow) return "null";
  if (ob.la) return `la ${sentenceToPyash(ob.la)} ko`;
  if (format === "csv" && ob.name && rememberFn) {
    return csvTextFromMapName(ob.name, { rememberFn });
  }
  if (format === "systemd" && ob.name && rememberFn) {
    return systemdTextFromMapName(ob.name, { rememberFn });
  }
  if (ob.genitive) {
    const v = resolveGenitive(ob.genitive, { rememberFn });
    if (v !== undefined) return v;
  }
  if (ob.name && rememberFn) {
    const fact = rememberFn(ob.name);
    if (fact?.be === "series" && Array.isArray(fact?.ob?.series)) {
      return seriesSentenceToPyash(fact);
    }
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
    if (fact?.ob?.name && rememberFn) {
      const refFact = rememberFn(fact.ob.name);
      if (refFact?.be === "json map" || refFact?.be === "map" || refFact?.be === "csv map") {
        const chain = mapDefChainFromName(fact.ob.name, { rememberFn });
        return chain || sentenceToPyash(refFact);
      }
      if (refFact?.ob?.la) return sentenceToPyash(refFact);
      if (refFact?.ob?.ve?.values) return sentenceToPyash(refFact);
      if (refFact?.ob?.text !== undefined) return refFact.ob.text;
      if (refFact?.ob?.num !== undefined) return refFact.ob.num;
      if (refFact?.ob?.date !== undefined) return refFact.ob.date;
      if (refFact?.ob?.boolean !== undefined) return refFact.ob.boolean ? "truth" : "lie";
      if (refFact?.ob?.hollow) return "null";
    }
    if (fact?.ob?.la) return sentenceToPyash(fact);
    if (fact?.ob?.ve?.values) return sentenceToPyash(fact);
    if (fact?.ob?.text !== undefined) return fact.ob.text;
    if (fact?.ob?.num !== undefined) return fact.ob.num;
    if (fact?.ob?.date !== undefined) return fact.ob.date;
    if (fact?.ob?.boolean !== undefined) return fact.ob.boolean ? "truth" : "lie";
    if (fact?.ob?.hollow) return "null";
  }
  if (ob.name) return ob.name;
  return "";
}

function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export { renderWriteValue, normalizeNewlines };
