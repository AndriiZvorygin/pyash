import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cosine, listSpeakerNpy, parseNpyVector } from "../command/voice_similarity_report.mjs";

function writeNpyFloat32(filename, values) {
  const magic = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]); // \x93NUMPY
  const ver = Buffer.from([0x01, 0x00]);
  const headerCore = `{'descr': '<f4', 'fortran_order': False, 'shape': (${values.length},), }`;
  let header = Buffer.from(`${headerCore}\n`, "latin1");
  const preambleLen = magic.length + ver.length + 2;
  const pad = (16 - ((preambleLen + header.length) % 16)) % 16;
  if (pad > 0) {
    header = Buffer.from(`${headerCore}${" ".repeat(Math.max(0, pad - 1))}\n`, "latin1");
  }
  const headerLen = Buffer.alloc(2);
  headerLen.writeUInt16LE(header.length, 0);
  const data = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i += 1) data.writeFloatLE(values[i], i * 4);
  const out = Buffer.concat([magic, ver, headerLen, header, data]);
  fs.writeFileSync(filename, out);
}

test("voice similarity npy parser reads 1d float32 vectors", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "voice-sim-"));
  const file = path.join(dir, "speaker_001.npy");
  writeNpyFloat32(file, [1, 2, 3, 4]);
  const vec = parseNpyVector(file);
  assert.equal(vec.length, 4);
  assert.ok(Math.abs(vec[0] - 1) < 1e-6);
  assert.ok(Math.abs(vec[3] - 4) < 1e-6);
});

test("voice similarity cosine reports expected extremes", () => {
  const same = cosine(new Float64Array([1, 0]), new Float64Array([2, 0]));
  const orth = cosine(new Float64Array([1, 0]), new Float64Array([0, 3]));
  assert.ok(Math.abs(same - 1) < 1e-9);
  assert.ok(Math.abs(orth - 0) < 1e-9);
});

test("voice similarity listSpeakerNpy only includes speaker npy files", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "voice-sim-list-"));
  writeNpyFloat32(path.join(dir, "speaker_001.npy"), [1, 0]);
  writeNpyFloat32(path.join(dir, "speaker_010.npy"), [0, 1]);
  await fsp.writeFile(path.join(dir, "speaker_001.pya"), "x", "utf8");
  await fsp.writeFile(path.join(dir, "noise.npy"), "x", "utf8");
  const items = listSpeakerNpy(dir);
  assert.deepEqual(items.map((x) => x.key), ["speaker_001", "speaker_010"]);
});

