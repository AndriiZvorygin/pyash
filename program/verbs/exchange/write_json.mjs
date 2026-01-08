import { buildProgram } from "../../program.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { compareUtf8, jsonObjectFromMapName } from "./json_map_export.mjs";

export function canonicalizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort(compareUtf8);
    for (const key of keys) {
      out[key] = canonicalizeJsonValue(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalizeJsonValue(value));
}

function jsonMapDefsFromPyash(text) {
  const program = buildProgram(String(text ?? ""));
  const defs = new Map();
  let currentName = null;

  for (const sentence of program.sentences) {
    if (sentence?.mood === "def" && sentence?.be === "json map" && sentence?.su?.name) {
      currentName = sentence.su.name;
      defs.set(currentName, { su: { name: currentName }, be: "json map", ob: { map: {} }, mood: "ya" });
      continue;
    }
    if (sentence?.mood === "prah") {
      currentName = null;
      continue;
    }
    if (currentName && sentence?.mood === "ya" && sentence?.su?.name) {
      const mapSentence = defs.get(currentName);
      if (mapSentence) {
        mapSentence.ob.map[sentence.su.name] = sentence.ob ?? {};
      }
    }
  }

  return defs;
}

export function jsonObjectFromPyash(text, { rootName } = {}) {
  const defs = jsonMapDefsFromPyash(text);
  if (defs.size === 0) {
    throwErrorSentence({
      name: "json map export failed",
      message: "json map export failed",
      from: { name: "write" },
      raw: { text }
    });
  }
  const root = rootName ?? defs.keys().next().value;
  const rememberFn = (name) => defs.get(name);
  return jsonObjectFromMapName(root, {
    remember: rememberFn,
    seen: new Set(),
    sourceName: "write",
    allowHollowVector: true
  });
}
