#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, doRemember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { buildToolSchemas, buildToolSentence } from "../program/verbs/mind/tooling.mjs";

const DEFAULT_TOOLS_MAP = "agent tools";

function readArgValue(args, name, fallback = "") {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return String(args[idx + 1] ?? "").trim() || fallback;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const root = readArgValue(args, "--root", process.cwd());
  const toolsMap = readArgValue(args, "--tools-map", DEFAULT_TOOLS_MAP);
  return {
    root: path.resolve(root),
    toolsMap
  };
}

function toolListFromSchemas(toolSchemas = []) {
  const list = [];
  for (const entry of toolSchemas) {
    const fn = entry?.function;
    if (!fn?.name) continue;
    list.push({
      name: fn.name,
      description: String(fn.description ?? "").trim(),
      inputSchema: fn.parameters ?? { type: "object", properties: {}, required: [] }
    });
  }
  return list;
}

function firstTextValue(ob = {}) {
  if (!ob || typeof ob !== "object") return "";
  if (typeof ob.text === "string" && ob.text.trim()) return ob.text.trim();
  if (typeof ob.name === "string" && ob.name.trim()) return ob.name.trim();
  if (typeof ob.filename === "string" && ob.filename.trim()) return ob.filename.trim();
  if (typeof ob.num === "number" && Number.isFinite(ob.num)) return String(ob.num);
  if (typeof ob.boolean === "boolean") return ob.boolean ? "truth" : "lie";
  return "";
}

function serializeResult(result) {
  if (!result || typeof result !== "object") return { text: String(result ?? ""), sentence: result };
  const pyash = sentenceToPyash(result);
  const text = firstTextValue(result.ob)
    || (typeof pyash === "string" ? pyash.trim() : "")
    || JSON.stringify(result);
  return {
    text,
    sentence: result
  };
}

async function materializeToolsMapFromDefinition({ mapPath, toolsMap }) {
  let raw = "";
  try {
    raw = await fs.readFile(mapPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let collecting = false;
  const entries = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const sentence = parse(line);
    if (!sentence) continue;
    if (!collecting) {
      if (sentence.mood === "def" && sentence.be === "map" && sentence.su?.name === toolsMap) {
        collecting = true;
      }
      continue;
    }
    if (sentence.mood === "prah") break;
    entries.push(sentence);
  }
  if (!entries.length) return;
  const map = {};
  for (const entry of entries) {
    const key = entry?.su?.name ?? entry?.su?.text;
    if (!key) continue;
    map[key] = entry;
  }
  if (!Object.keys(map).length) return;
  doRemember({
    mood: "ya",
    su: { name: toolsMap },
    be: "map",
    ob: { map }
  });
}

async function ensureDefaultToolsMap({ cwd, toolsMap }) {
  if (remember(toolsMap)?.be === "map") return;
  if (toolsMap !== DEFAULT_TOOLS_MAP) return;
  const mapPath = path.resolve(cwd, "module", "agent_tools.pya");
  await materializeToolsMapFromDefinition({ mapPath, toolsMap });
}

async function buildRuntime({ root, toolsMap }) {
  process.chdir(root);
  forget();
  clearSignatureHandlers();
  for (const sig of builtInSignatures) registerSignatureHandler(sig);
  await loadDefaultConfig({ cwd: root, interpretFn: interpret, entryPath: root });
  await ensureDefaultToolsMap({ cwd: root, toolsMap });
  const built = buildToolSchemas(toolsMap);
  if (!built?.tools?.length) {
    throw new Error(`tools map not available: ${toolsMap}`);
  }
  const tools = toolListFromSchemas(built.tools);
  return {
    root,
    toolsMap,
    tools,
    toolMap: built.toolMap
  };
}

function writeJson(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id, result) {
  writeJson({ jsonrpc: "2.0", id, result });
}

function writeError(id, code, message, data = undefined) {
  const payload = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message }
  };
  if (data !== undefined) payload.error.data = data;
  writeJson(payload);
}

async function handleToolsCall(runtime, params = {}) {
  const toolName = String(params?.name ?? "").trim();
  if (!toolName) {
    return {
      content: [{ type: "text", text: "missing tool name" }],
      isError: true
    };
  }
  const capability = runtime.toolMap.get(toolName);
  if (!capability) {
    return {
      content: [{ type: "text", text: `unknown tool: ${toolName}` }],
      isError: true
    };
  }
  const toolSentence = buildToolSentence({
    capability,
    args: params?.arguments ?? {}
  });
  if (capability?.be === "read" && !toolSentence.to) {
    toolSentence.to = { name: "result", nameTypeWords: ["text"] };
  }

  try {
    const result = await interpret(toolSentence);
    const serialized = serializeResult(result);
    return {
      content: [{ type: "text", text: serialized.text }],
      structuredContent: serialized.sentence
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: String(err?.message ?? err) }],
      isError: true
    };
  }
}

async function main() {
  const config = parseArgs(process.argv);
  const runtime = await buildRuntime(config);

  process.stdin.setEncoding("utf8");
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) break;
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        writeError(null, -32700, "parse error");
        continue;
      }
      const method = String(request?.method ?? "").trim();
      const id = request?.id;
      if (!method) {
        writeError(id ?? null, -32600, "invalid request");
        continue;
      }
      if (method === "initialize") {
        writeResult(id, {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "pyash-mcp-server", version: "0.1.0" },
          capabilities: { tools: {} }
        });
        continue;
      }
      if (method === "notifications/initialized") {
        continue;
      }
      if (method === "tools/list") {
        writeResult(id, { tools: runtime.tools });
        continue;
      }
      if (method === "tools/call") {
        handleToolsCall(runtime, request?.params ?? {})
          .then((result) => writeResult(id, result))
          .catch((err) => writeError(id, -32000, String(err?.message ?? err)));
        continue;
      }
      if (id !== undefined) {
        writeError(id, -32601, `method not found: ${method}`);
      }
    }
  });
}

main().catch((err) => {
  process.stderr.write(`${String(err?.message ?? err)}\n`);
  process.exit(1);
});
