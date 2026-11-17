import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { buildToolSchemas, buildToolSentence } from "../program/verbs/mind/tooling.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";
import { signatures as readSignatures } from "../program/verbs/exchange/read.mjs";

test("saddle tools map exposes coding signatures", async () => {
  forget();
  await interpret(parse('from filename "./module/saddle_tools.pya" ob name saddle tools to name saddle tools be import do'));

  const { toolMap } = buildToolSchemas("saddle tools");
  const capabilityLines = [
    "su name command be command ob text input to name text out can",
    "su name repair be repair ob text input to name map outcome can",
    "su name repair check be repair as wo check ob text input to name map outcome can",
    "su name session plan be write fromstate \"coding saddle plan\" ob text input can",
    "su name search be search ob text input fromstate wo zim can",
    "su name web search be search ob text input fromstate wo web by num 5 can",
    "su name web search source be search ob text input from filename input fromstate wo web by num 5 can",
    "su name search archive be search as wo cluster-compress in filename input ob text input can",
    "su name read archive focus be read as wo cluster-compress from filename input ob text input by text input can",
    "su name download be download from filename input as wo web to filename input can",
    "su name download markdown be download from filename input as wo markdown to filename input can",
    "su name read markdown be read from filename input fromstate wo html become wo markdown atmost byte 65536 can"
  ];

  for (const line of capabilityLines) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    assert.ok(toolMap.has(signature), `missing signature: ${signature}`);
  }

  const searchLine = capabilityLines.find((line) => line.startsWith("su name search "));
  const searchSignature = joinSignatureWords(deriveSignatureFromCall(parse(searchLine)));
  const searchTool = buildToolSchemas("saddle tools").tools
    .find((tool) => tool.function.signature === searchSignature);
  assert.equal(searchTool.function.name, "search_zim_library");
  assert.match(searchTool.function.description, /configured Kiwix ZIM service.*resolves the host-configured endpoint.*usable full page URL.*Pass that returned URL unchanged/u);
  assert.deepEqual(searchTool.function.parameters.properties, {
    query: { type: "string", description: "Terms to find in the ZIM collection served by the configured Kiwix endpoint." }
  });
  assert.deepEqual(searchTool.function.parameters.required, ["query"]);

  const searchCall = buildToolSentence({
    capability: parse(searchLine),
    args: { query: "Pyash archive" }
  });
  assert.equal(searchCall.be, "search");
  assert.equal(searchCall.ob.text, "Pyash archive");
  assert.deepEqual(searchCall.fromstate, { text: "zim", wo: "zim" });
  assert.equal(searchCall.in, undefined);

  const webSearchLine = capabilityLines.find((line) => line.startsWith("su name web search be"));
  const webSearchSignature = joinSignatureWords(deriveSignatureFromCall(parse(webSearchLine)));
  const webSearchTool = buildToolSchemas("saddle tools").tools
    .find((tool) => tool.function.signature === webSearchSignature);
  assert.equal(webSearchTool.function.name, "web_search");
  assert.match(webSearchTool.function.description, /live web search motor.*current information or news.*up to five results/u);
  assert.deepEqual(webSearchTool.function.parameters.properties, {
    query: { type: "string", description: "Terms to search on the live web." }
  });

  const webSourceLine = capabilityLines.find((line) => line.startsWith("su name web search source "));
  const webSourceSignature = joinSignatureWords(deriveSignatureFromCall(parse(webSourceLine)));
  const webSourceTool = buildToolSchemas("saddle tools").tools
    .find((tool) => tool.function.signature === webSourceSignature);
  assert.equal(webSourceTool.function.name, "web_search_source");
  assert.match(webSourceTool.function.description, /Yago.*POST \/search.*bearer key.*YaCy.*\/yacysearch\.json/u);
  assert.deepEqual(webSourceTool.function.parameters.properties, {
    query: { type: "string", description: "Terms to search." },
    search_url: { type: "string", description: "Search API endpoint URL. For Yago, use /search; for YaCy, use /yacysearch.json." }
  });
  const webSourceCall = buildToolSentence({
    capability: buildToolSchemas("saddle tools").toolMap.get(webSourceTool.function.name),
    args: { query: "technology news", search_url: "https://yago.zvorygin.ca/yacysearch.json" }
  });
  assert.deepEqual(webSourceCall.from, { filename: "https://yago.zvorygin.ca/yacysearch.json" });
  assert.deepEqual(webSourceCall.fromstate, { text: "web", wo: "web" });
  assert.equal(webSourceCall.by.num, 5);

  const searchArchiveLine = capabilityLines.find((line) => line.startsWith("su name search archive "));
  const searchArchiveSignature = joinSignatureWords(deriveSignatureFromCall(parse(searchArchiveLine)));
  const searchArchiveTool = buildToolSchemas("saddle tools").tools
    .find((tool) => tool.function.signature === searchArchiveSignature);
  assert.equal(searchArchiveTool.function.name, "search_archive");
  assert.match(searchArchiveTool.function.description, /archive file is mounted.*archive_path is a local archive path.*remote-only archives/u);
  assert.deepEqual(searchArchiveTool.function.parameters.properties, {
    archive_path: {
      type: "string",
      description: "A .zim file path or the configured archive directory for a local indexed search."
    },
    query: {
      type: "string",
      description: "Terms to find in the local ZIM index."
    }
  });
  assert.deepEqual(searchArchiveTool.function.parameters.required, ["archive_path", "query"]);
  const searchArchiveCall = buildToolSentence({
    capability: parse(searchArchiveLine),
    args: { archive_path: "world/library/archive/gpu-opencl-reference-2026-11.zim", query: "OpenCL clCreateBuffer" }
  });
  assert.deepEqual(searchArchiveCall.in, { filename: "world/library/archive/gpu-opencl-reference-2026-11.zim" });
  assert.deepEqual(searchArchiveCall.ob, { text: "OpenCL clCreateBuffer" });

  const focusLine = capabilityLines.find((line) => line.startsWith("su name read archive focus "));
  const focusSignature = joinSignatureWords(deriveSignatureFromCall(parse(focusLine)));
  const focusTool = buildToolSchemas("saddle tools").tools
    .find((tool) => tool.function.signature === focusSignature);
  assert.equal(focusTool.function.name, "read_archive_focus");
  const focusCapability = toolMap.get(focusTool.function.name);
  assert.equal(focusCapability?.be, "read");
  assert.deepEqual(focusTool.function.parameters.properties, {
    archive_path: {
      type: "string",
      description: "Path to the .zim archive in the shared archive library."
    },
    entry_path: {
      type: "string",
      description: "Exact entry path copied from a search result, for example OpenCL_API.html."
    },
    focus: {
      type: "string",
      description: "Symbol or phrase to locate within the entry, for example clCreateBuffer."
    }
  });
  assert.deepEqual(focusTool.function.parameters.required, ["archive_path", "entry_path", "focus"]);
  assert.match(focusTool.function.description, /archive file is mounted.*entry_path exactly from search results.*focus.*within that entry/u);
  const focusCall = buildToolSentence({
    capability: focusCapability,
    args: {
      archive_path: "world/library/archive/gpu-opencl-reference-2026-11.zim",
      entry_path: "OpenCL_API.html",
      focus: "clCreateBuffer"
    }
  });
  assert.deepEqual(focusCall.from, { filename: "world/library/archive/gpu-opencl-reference-2026-11.zim" });
  assert.deepEqual(focusCall.ob, { text: "OpenCL_API.html" });
  assert.deepEqual(focusCall.by, { text: "clCreateBuffer" });
  assert.deepEqual(focusCall.as, { text: "cluster-compress", wo: "cluster-compress" });
  assert.equal(focusCall.become, undefined);
  assert.match(buildToolSchemas("saddle tools").toolBlock, /read_archive_focus.*archive_path.*entry_path.*focus/u);
  focusCall.to = { name: "result", nameTypeWords: ["text"] };
  const focusRuntimeSignature = joinSignatureWords(deriveSignatureFromCall(focusCall));
  assert.ok(readSignatures.some((entry) => joinSignatureWords(entry.signatureWords) === focusRuntimeSignature));

  const downloadLine = capabilityLines.find((line) => line.startsWith("su name download "));
  const downloadSignature = joinSignatureWords(deriveSignatureFromCall(parse(downloadLine)));
  const downloadTool = buildToolSchemas("saddle tools").tools
    .find((tool) => tool.function.signature === downloadSignature);
  assert.deepEqual(downloadTool.function.parameters.required, ["from", "to"]);

  const downloadMarkdownLine = capabilityLines.find((line) => line.startsWith("su name download markdown "));
  const downloadMarkdownSignature = joinSignatureWords(deriveSignatureFromCall(parse(downloadMarkdownLine)));
  const downloadMarkdownTool = buildToolSchemas("saddle tools").tools
    .find((tool) => tool.function.signature === downloadMarkdownSignature);
  assert.deepEqual(downloadMarkdownTool.function.parameters.required, ["from", "to"]);

  const readMarkdownLine = capabilityLines.at(-1);
  const readMarkdownSignature = joinSignatureWords(deriveSignatureFromCall(parse(readMarkdownLine)));
  const readMarkdownTool = buildToolSchemas("saddle tools").tools
    .find((tool) => tool.function.signature === readMarkdownSignature);
  assert.deepEqual(readMarkdownTool.function.parameters.required, ["from"]);
  assert.deepEqual(readMarkdownTool.function.parameters.properties, { from: { type: "string" } });
});
