import { sanitizeName } from "./util.mjs";

function inlineSentenceLiteral(value, declared = new Set(), { inlineNames = true } = {}) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(v => inlineSentenceLiteral(v, declared)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entriesArr = Object.entries(value);
    if (entriesArr.length === 1 && entriesArr[0][0] === "name") {
      const nameVal = entriesArr[0][1];
      if (typeof nameVal === "string" && declared.has(nameVal)) {
        if (inlineNames) {
          return sanitizeName(nameVal);
        }
        return `{ name: ${nameVal} }`;
      }
    }
    const entries = Object.entries(value).map(([key, val]) => {
      if (key === "name" && typeof val === "string" && declared.has(val) && inlineNames) {
        return `${key}: ${val}`;
      }
      return `${key}: ${inlineSentenceLiteral(val, declared, { inlineNames })}`;
    });
    return `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}

function findDefinitionBlock(sentences, name) {
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (s?.mood === "def" && s?.be === "ceremony" && s?.su?.name === name) {
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      return { def: s, body, prah: sentences[j], end: j };
    }
  }
  return null;
}

function collectExportFacts(record, sentences) {
  const exported = new Map();
  for (const name of record.exportNames) {
    if (record.localCeremonies.has(name)) continue;
    const mapped = record.nameMap.get(name);
    if (!mapped) continue;
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (s?.mood === "def" && (s.be === "map" || s.be === "json map") && s?.su?.name === mapped) {
        const entries = [];
        let j = i + 1;
        for (; j < sentences.length; j++) {
          if (sentences[j].mood === "prah") break;
          entries.push(sentences[j]);
        }
        const map = {};
        const internalPrefix = `${record.alias} internal `;
        for (const entry of entries) {
          let key = entry?.su?.name;
          if (!key) continue;
          if (key.startsWith(internalPrefix)) {
            key = key.slice(internalPrefix.length);
          }
          map[key] = entry.ob ?? {};
        }
        exported.set(name, { be: s.be, ob: { map } });
        i = j;
        break;
      }
      if (s?.mood === "ya" && s?.su?.name === mapped) {
        exported.set(name, { be: s.be, ob: s.ob ?? {} });
        break;
      }
    }
  }
  return exported;
}

function mapNamespaceSentences({ alias, exportFacts, nameMap }) {
  const def = { mood: "def", be: "map", su: { name: alias } };
  const entries = [];
  for (const [key, value] of exportFacts.entries()) {
    const mapped = nameMap?.get(key);
    entries.push({ mood: "ya", su: { name: key }, ob: mapped ? { name: mapped } : (value?.ob ?? value ?? {}) });
  }
  const prah = { mood: "prah", be: "map", su: { name: alias } };
  return [def, ...entries, prah];
}

export { inlineSentenceLiteral, findDefinitionBlock, collectExportFacts, mapNamespaceSentences };
