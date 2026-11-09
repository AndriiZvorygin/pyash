import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { buildToolSchemas, buildToolSentence } from "../program/verbs/mind/tooling.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";

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
  assert.deepEqual(searchTool.function.parameters.properties, { ob: { type: "string" } });
  assert.deepEqual(searchTool.function.parameters.required, ["ob"]);

  const searchCall = buildToolSentence({
    capability: parse(searchLine),
    args: { ob: "Pyash archive" }
  });
  assert.equal(searchCall.be, "search");
  assert.equal(searchCall.ob.text, "Pyash archive");
  assert.deepEqual(searchCall.fromstate, { text: "zim", wo: "zim" });
  assert.equal(searchCall.in, undefined);

  const focusLine = capabilityLines.find((line) => line.startsWith("su name read archive focus "));
  const focusSignature = joinSignatureWords(deriveSignatureFromCall(parse(focusLine)));
  const focusTool = buildToolSchemas("saddle tools").tools
    .find((tool) => tool.function.signature === focusSignature);
  assert.deepEqual(focusTool.function.parameters.properties, {
    by: { type: "string" },
    from: { type: "string" },
    ob: { type: "string" }
  });
  assert.deepEqual(focusTool.function.parameters.required, ["by", "from", "ob"]);
  const focusCall = buildToolSentence({
    capability: parse(focusLine),
    args: {
      from: "world/library/archive/gpu-opencl-reference-2026-11.zim",
      ob: "OpenCL_API.html",
      by: "clCreateBuffer"
    }
  });
  assert.deepEqual(focusCall.from, { filename: "world/library/archive/gpu-opencl-reference-2026-11.zim" });
  assert.deepEqual(focusCall.ob, { text: "OpenCL_API.html" });
  assert.deepEqual(focusCall.by, { text: "clCreateBuffer" });
  assert.deepEqual(focusCall.as, { text: "cluster-compress", wo: "cluster-compress" });

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
