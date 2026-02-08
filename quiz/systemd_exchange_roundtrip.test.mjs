import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { parseSystemdIniToSections } from "../program/agent/service_definition.mjs";

test("systemd exchange read/write roundtrip preserves Unit/Service/Install semantics", async () => {
  const fixturePath = path.resolve("quiz/fixtures/systemd.ini");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-systemd-exchange-"));
  const outPath = path.join(tmpDir, "roundtrip.service");
  const target = "roundtrip_demo";

  forget();
  await interpret(parse(`from filename "${fixturePath}" fromstate wo systemd to name ${target} be read do`));

  assert.equal(remember(target)?.be, "map");
  assert.equal(remember(`${target} unit`)?.be, "json map");
  assert.equal(remember(`${target} service`)?.be, "json map");
  assert.equal(remember(`${target} install`)?.be, "json map");

  await interpret(parse(`ob name ${target} become name systemd to filename "${outPath}" be write do`));

  const srcSections = parseSystemdIniToSections(await fs.readFile(fixturePath, "utf8"));
  const outSections = parseSystemdIniToSections(await fs.readFile(outPath, "utf8"));
  assert.deepEqual(outSections.Unit, srcSections.Unit);
  assert.deepEqual(outSections.Service, srcSections.Service);
  assert.deepEqual(outSections.Install, srcSections.Install);
});
