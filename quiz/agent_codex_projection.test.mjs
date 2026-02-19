import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { projectCodexRunToPyash } from "../command/pyash/agent_codex_projection.mjs";

test("codex projection writes user/agent turns into pyash session", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-codex-projection-"));
  const worldRoot = path.join(rootDir, "world");
  const agentName = "ccrc";
  const agentHouse = path.join(worldRoot, "house", agentName);
  const codexHome = path.join(agentHouse, ".codex");
  const sessionDir = path.join(codexHome, "sessions", "2026", "02", "17");
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const startedAtMs = Date.parse("2026-02-17T07:00:00.000Z");
  const codexSessionId = "019c5f6d-8565-7df3-891b-ae9b829691fa";
  const codexSessionFile = path.join(
    sessionDir,
    `rollout-2026-02-17T07-00-00-${codexSessionId}.jsonl`
  );
  const lines = [
    JSON.stringify({
      timestamp: "2026-02-17T07:00:01.000Z",
      type: "session_meta",
      payload: { id: codexSessionId, cwd: agentHouse }
    }),
    JSON.stringify({
      timestamp: "2026-02-17T07:00:01.500Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "# AGENTS.md instructions for /workplace/world/house/ccrc" }]
      }
    }),
    JSON.stringify({
      timestamp: "2026-02-17T07:00:01.600Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<environment_context>\n<cwd>/workplace</cwd>\n</environment_context>" }]
      }
    }),
    JSON.stringify({
      timestamp: "2026-02-17T07:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi from codex" }]
      }
    }),
    JSON.stringify({
      timestamp: "2026-02-17T07:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "hello from agent" }]
      }
    }),
    ""
  ];
  await fs.writeFile(codexSessionFile, lines.join("\n"), "utf8");

  const result = await projectCodexRunToPyash({
    rootDir,
    worldRoot,
    agentName,
    agentHouse,
    codexHome,
    startedAtMs
  });

  assert.equal(result.projected, 2);
  assert.equal(result.sessionId, codexSessionId);

  const projectedSessionDir = path.join(agentHouse, "session");
  const sessionFiles = await fs.readdir(projectedSessionDir);
  assert.equal(sessionFiles.length > 0, true);
  const projectedText = await fs.readFile(path.join(projectedSessionDir, sessionFiles[0]), "utf8");
  assert.match(projectedText, /su name user/);
  assert.match(projectedText, /ob text "hi from codex"/);
  assert.match(projectedText, /su name agent/);
  assert.match(projectedText, /ob text "hello from agent"/);
  assert.match(projectedText, /fromstate text "codex"/);

  const projectionStatePath = path.join(agentHouse, "conduct", "codex_projection.pya");
  const projectionState = await fs.readFile(projectionStatePath, "utf8");
  assert.match(projectionState, /su name codex projection be map def/);
  assert.match(projectionState, /last session id/);

  const newspaperDir = path.join(worldRoot, "newspaper");
  const newspaperFiles = await fs.readdir(newspaperDir);
  assert.equal(newspaperFiles.length > 0, true);
  const newspaperText = await fs.readFile(path.join(newspaperDir, newspaperFiles[0]), "utf8");
  assert.match(newspaperText, /be codex projection ya/);
});
