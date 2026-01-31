import { remember } from "../../remember/index.mjs";
import { mapSentenceToPyash } from "../exchange/json_map.mjs";

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

export { mapDefChainFromName };
