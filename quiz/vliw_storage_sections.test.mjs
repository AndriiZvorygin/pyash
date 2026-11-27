import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compilePyashProgramSource,
  decodePyashProgramPack,
  decodePyashStorageSections
} from "../program/library/vliw/programlet.mjs";
import {
  decodePyacStorageSections
} from "../program/library/vliw/storage_sections.mjs";
import { decodePyashProgram } from "../program/library/vliw/sentence.mjs";
import { decodePyacPack } from "../program/library/vliw/database.mjs";

function withAssets(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pyac-storage-test-"));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function storageSentence(filename, bytes, shape, type = "paucal_number_") {
  const low = bytes & 0xffff;
  const high = Math.floor(bytes / 0x1_0000);
  return `exists su name weight from filename "${filename}" by ve num ${low} ${high} as name ${type} with ve num ${shape.join(" ")} be pfun myoc ya`;
}

test("file-backed Pyash storage compiles to a self-contained PyAC byte payload", () => {
  withAssets((root) => {
    const sourceBytes = Buffer.from([0, 1, 2, 0, 0xff, 0x80, 65]);
    fs.writeFileSync(path.join(root, "weights.bin"), sourceBytes);

    const compiled = compilePyashProgramSource(storageSentence("weights.bin", 7, [7]), {
      assetRoot: root
    });
    const [section] = decodePyacStorageSections(compiled.pack, {
      decodePack: decodePyacPack,
      decodeProgram: decodePyashProgram
    });

    assert.equal(compiled.storageByteLength, sourceBytes.byteLength);
    assert.equal(section.name, "weight");
    assert.equal(section.type, "paucal_number_");
    assert.deepEqual(section.dimensions, [7]);
    assert.deepEqual(Buffer.from(section.data), sourceBytes);
    assert.deepEqual(decodePyashProgramPack(compiled.pack), []);
    assert.equal(Buffer.from(compiled.pack).includes(Buffer.from("weights.bin")), false);
  });
});

test("storage sections support lengths beyond one uint16 count", () => {
  withAssets((root) => {
    const sourceBytes = Buffer.from(Array.from({ length: 70_000 }, (_, index) => index & 0xff));
    fs.writeFileSync(path.join(root, "large.bin"), sourceBytes);

    const compiled = compilePyashProgramSource(storageSentence("large.bin", 70_000, [35_000, 2]), {
      assetRoot: root
    });
    const [section] = decodePyacStorageSections(compiled.pack, {
      decodePack: decodePyacPack,
      decodeProgram: decodePyashProgram
    });

    assert.equal(section.byteLength, 70_000);
    assert.deepEqual(Buffer.from(section.data), sourceBytes);
  });
});

test("executable sentences precede embedded storage sections and remain independently decodable", () => {
  withAssets((root) => {
    const sourceBytes = Buffer.from([9, 8, 7, 6]);
    fs.writeFileSync(path.join(root, "table.bin"), sourceBytes);
    const executableSource = fs.readFileSync(path.resolve("examples/pyash/vliw-is-even.pya"), "utf8");
    const source = `${executableSource}\n${storageSentence("table.bin", sourceBytes.length, [4])}`;
    const compiled = compilePyashProgramSource(source, { assetRoot: root });

    assert.equal(decodePyashProgramPack(compiled.pack).length, 11);
    const [section] = decodePyashStorageSections(compiled.pack);
    assert.equal(section.name, "weight");
    assert.deepEqual(Buffer.from(section.data), sourceBytes);
  });
});

test("storage sections enforce numeric-family widths and reject non-zero padding", () => {
  withAssets((root) => {
    for (const [type, width] of [
      ["paucal_number_", 1],
      ["number_", 2],
      ["plural_number_", 4],
      ["multal_number_", 8]
    ]) {
      const bytes = Buffer.alloc(width * 4);
      const filename = `${type}.bin`;
      fs.writeFileSync(path.join(root, filename), bytes);
      const compiled = compilePyashProgramSource(storageSentence(filename, bytes.length, [4], type), {
        assetRoot: root
      });
      assert.equal(decodePyacStorageSections(compiled.pack, {
        decodePack: decodePyacPack,
        decodeProgram: decodePyashProgram
      })[0].elementBytes, width);
    }

    fs.writeFileSync(path.join(root, "invalid.bin"), Buffer.alloc(8));
    assert.throws(
      () => compilePyashProgramSource(storageSentence("invalid.bin", 8, [1], "plural_number_"), { assetRoot: root }),
      /do not agree/u
    );

    fs.writeFileSync(path.join(root, "odd.bin"), Buffer.from([1, 2, 3]));
    const compiled = compilePyashProgramSource(storageSentence("odd.bin", 3, [3]), { assetRoot: root });
    const corrupted = new Uint8Array(compiled.pack);
    corrupted[corrupted.length - 1] = 1;
    assert.throws(() => decodePyacStorageSections(corrupted, {
      decodePack: decodePyacPack,
      decodeProgram: decodePyashProgram
    }), /non-zero codelet padding/u);
  });
});
