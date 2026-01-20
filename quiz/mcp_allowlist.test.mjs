import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { closeMcpServers } from "../program/motor/mcp.mjs";

test("mcp allowlist denies unlisted tools", async () => {
  forget();
  const serverPath = path.resolve("quiz/fixtures/mcp_mock_server.json");
  doRemember({
    mood: "ya",
    su: { name: "mock" },
    be: "mcp",
    ob: { text: "inline" },
    by: { ve: { type: "text", values: [serverPath] } }
  });
  doRemember({
    mood: "ya",
    su: { name: "mcp allowlist" },
    ob: { ve: { type: "text", values: ["mcp mock echo"] } }
  });

  await interpret(parse("from name mcp mock to name mcp mock be import do"));
  await interpret(parse("ob text \"ok\" be mcp mock echo do"));

  doRemember({
    mood: "ya",
    su: { name: "mcp allowlist" },
    ob: { ve: { type: "text", values: ["mcp mock denied"] } }
  });

  await assert.rejects(
    () => interpret(parse("ob text \"no\" be mcp mock echo do")),
    (err) => err?.sentence?.su?.name === "mcp tool denied"
  );
  closeMcpServers();
});
