import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { codexCommand, parseCodexWrapperArgs } from "../command/pyash/codex_cli.mjs";

test("parse codex wrapper args keeps passthrough after --", () => {
  const parsed = parseCodexWrapperArgs([
    "--root", "/tmp/world",
    "--tools-map", "agent tools",
    "--",
    "resume",
    "--last"
  ]);
  assert.equal(parsed.root, "/tmp/world");
  assert.equal(parsed.toolsMap, "agent tools");
  assert.equal(parsed.noMcp, false);
  assert.deepEqual(parsed.passthrough, ["resume", "--last"]);
});

test("parse codex wrapper args supports equals form and no-mcp", () => {
  const parsed = parseCodexWrapperArgs([
    "--root=/tmp/world",
    "--tools-map=ops",
    "--no-mcp",
    "exec",
    "hi"
  ]);
  assert.equal(parsed.root, "/tmp/world");
  assert.equal(parsed.toolsMap, "ops");
  assert.equal(parsed.noMcp, true);
  assert.deepEqual(parsed.passthrough, ["exec", "hi"]);
});

test("parse codex wrapper args defaults tools map", () => {
  const parsed = parseCodexWrapperArgs(["resume", "--last"]);
  assert.equal(parsed.root, "");
  assert.equal(parsed.toolsMap, "agent tools");
  assert.equal(parsed.noMcp, false);
  assert.deepEqual(parsed.passthrough, ["resume", "--last"]);
});

test("codex wrapper keeps project workspace separate from Pyash MCP config root", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-codex-wrapper-"));
  const binDir = path.join(tempDir, "bin");
  const projectRoot = path.join(tempDir, "project");
  const probePath = path.join(tempDir, "args.json");
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(projectRoot, { recursive: true });
  const fakeCodex = path.join(binDir, "codex");
  await fs.writeFile(fakeCodex, `#!/usr/bin/env node
import fs from "node:fs";
fs.writeFileSync(process.env.PYA_CODEX_ARGS, JSON.stringify(process.argv.slice(2)));
`, "utf8");
  await fs.chmod(fakeCodex, 0o700);
  try {
    const status = await codexCommand(["--root", projectRoot, "resume", "--last"], {
      installRoot: "/pyash/install",
      cwd: projectRoot,
      envOverrides: {
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
        PYA_CODEX_ARGS: probePath
      }
    });
    assert.equal(status, 0);
    const args = JSON.parse(await fs.readFile(probePath, "utf8"));
    const serverArgsSetting = args.find((arg) => arg.startsWith("mcp_servers.pyash.args="));
    const serverArgs = JSON.parse(serverArgsSetting.slice("mcp_servers.pyash.args=".length));
    assert.equal(serverArgs[serverArgs.indexOf("--root") + 1], projectRoot);
    assert.equal(serverArgs[serverArgs.indexOf("--config-root") + 1], "/pyash/install");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
