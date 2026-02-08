import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseSystemdIniToSections } from "../program/agent/service_definition.mjs";

const execFileAsync = promisify(execFile);

test("systemd ini -> pyash section maps -> ini roundtrip preserves Unit/Service/Install semantics", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-systemd-roundtrip-"));
  const mapsPath = path.join(tmp, "roundtrip-maps.pya");
  const outIniPath = path.join(tmp, "roundtrip.service");
  const fixturePath = path.resolve("quiz/fixtures/systemd.ini");

  await execFileAsync(process.execPath, [
    "command/systemd_bridge.mjs",
    "--action", "ini-to-pyash-sections",
    "--input", fixturePath,
    "--output", mapsPath,
    "--service-name", "roundtrip demo"
  ], { cwd: path.resolve(".") });

  const mapsText = await fs.readFile(mapsPath, "utf8");
  assert.match(mapsText, /su name roundtrip demo unit be json map def/);
  assert.match(mapsText, /su name roundtrip demo service be json map def/);
  assert.match(mapsText, /su name roundtrip demo install be json map def/);

  await execFileAsync(process.execPath, [
    "command/systemd_bridge.mjs",
    "--action", "pyash-sections-to-ini",
    "--input", mapsPath,
    "--output", outIniPath
  ], { cwd: path.resolve(".") });

  const srcIni = await fs.readFile(fixturePath, "utf8");
  const outIni = await fs.readFile(outIniPath, "utf8");
  const srcSections = parseSystemdIniToSections(srcIni);
  const outSections = parseSystemdIniToSections(outIni);
  assert.deepEqual(outSections.Unit, srcSections.Unit);
  assert.deepEqual(outSections.Service, srcSections.Service);
  assert.deepEqual(outSections.Install, srcSections.Install);
});

