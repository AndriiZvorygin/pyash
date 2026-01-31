import fsSync from "node:fs";
import path from "node:path";

import { allRemember } from "../../remember/index.mjs";
import { recordArtifact, emitExchangeSentence, getExchangeRunRoot } from "../../bridge/exchange.mjs";
import { jsonToMapSentences, jsonToPyashText } from "../../verbs/exchange/json_map.mjs";
import { collectExistingNames } from "./tools.mjs";
import { sanitizeServerName } from "./config.mjs";

function buildCapabilityRecord({ tool }) {
  if (!tool?.capabilities || typeof tool.capabilities !== "object") return null;
  const record = { ...tool.capabilities };
  if (!record.tool) record.tool = tool.name;
  return record;
}

function emitJsonMapDefSentences(mapSentence) {
  if (!mapSentence?.su?.name || mapSentence?.be !== "json map") return;
  const mapName = mapSentence.su.name;
  emitExchangeSentence({ mood: "def", su: { name: mapName }, be: "json map" });
  const entries = mapSentence?.ob?.map ?? {};
  for (const [key, value] of Object.entries(entries)) {
    emitExchangeSentence({ mood: "ya", su: { name: key }, ob: value ?? {} });
  }
  emitExchangeSentence({ mood: "prah" });
}

function recordSnapshot({ serverName, tools }) {
  const toolMap = Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      {
        description: tool.description ?? "",
        inputSchema: tool.inputSchema ?? null,
        outputSchema: tool.outputSchema ?? null,
        toolId: tool.toolId ?? ""
      }
    ])
  );
  const capabilitiesById = {};
  for (const tool of tools) {
    const record = buildCapabilityRecord({ tool });
    if (!record || !tool.toolId) continue;
    capabilitiesById[tool.toolId] = record;
  }
  const snapshot = {
    server: serverName,
    tools: toolMap,
    capabilities: Object.keys(capabilitiesById).length ? capabilitiesById : undefined
  };
  const { text: snapshotText } = jsonToPyashText(snapshot, `mcp ${serverName} tools snapshot`, { existingNames: [] });
  const snapshotSentence = {
    mood: "ya",
    su: { name: `mcp ${serverName}` },
    be: "tool snapshot",
    ob: { text: snapshotText }
  };
  const locator = `artifacts/mcp/${sanitizeServerName(serverName)}-tools.json`;
  const runRoot = getExchangeRunRoot() ?? process.cwd();
  const absPath = path.resolve(runRoot, locator);
  try {
    fsSync.mkdirSync(path.dirname(absPath), { recursive: true });
    fsSync.writeFileSync(absPath, snapshotText, "utf8");
  } catch {}
  recordArtifact({
    locator,
    producer: "mcp",
    bytes: Buffer.from(snapshotText, "utf8"),
    kind: "mcp snapshot"
  });
  emitExchangeSentence(snapshotSentence);

  const existingNames = collectExistingNames({ allRememberFn: allRemember });
  for (const tool of tools) {
    if (!tool.toolId) continue;
    const record = buildCapabilityRecord({ tool });
    if (!record) continue;
    const capabilityName = `mcp capability ${tool.toolId}`;
    const { sentences } = jsonToMapSentences(record, capabilityName, { existingNames });
    existingNames.add(capabilityName);
    for (const sentence of sentences) emitJsonMapDefSentences(sentence);
  }
}

export { recordSnapshot };
