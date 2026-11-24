import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { createPyacHousekeeperUpload } from "../program/library/vliw/housekeeper_upload.mjs";
import { encodePyacPack } from "../program/library/vliw/database.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVICE_PATH = path.join(ROOT, "container/gpu-housekeeper/service");

function verifyWithHousekeeper(upload, secret) {
  const script = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(SERVICE_PATH)})`,
    "import pyac_wire",
    "identity, pack = pyac_wire.verify_upload_stream(sys.stdin.buffer.read(), sys.argv[1])",
    "print(json.dumps({'username': identity['username'], 'hostId': identity['hostId'], 'handleId': identity['handleId'], 'packBytes': len(pack)}))"
  ].join("\n");
  return spawnSync("python3", ["-c", script, secret], {
    input: upload,
    encoding: "utf8"
  });
}

function postToHousekeeper(upload, secret, expectSecret = secret) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyac-upload-server-"));
  const secretPath = path.join(temporaryRoot, "secret.pya");
  fs.writeFileSync(secretPath, `exists su name gpu authentication key ob text ${JSON.stringify(expectSecret)} be text ya\n`);
  const script = [
    "import json, os, sys, threading",
    `sys.path.insert(0, ${JSON.stringify(SERVICE_PATH)})`,
    "import server as hk",
    "from urllib.error import HTTPError",
    "from urllib.request import Request, urlopen",
    "hk.Handler.host_id = 'mriczo'",
    "hk.Handler.runtime_registry = {'vliw': dict(hk.DEFAULT_RUNTIME_REGISTRY['vliw'])}",
    "hk.select_route = lambda *args: {'selected': {'hostId': 'mriczo', 'deviceId': 'gpu0', 'score': 1, 'reason': 'test'}, 'forwarded': False, 'selectionPolicy': 'test'}",
    "hk.start_registered_job = lambda *args: True",
    "httpd = hk.ThreadingHTTPServer(('127.0.0.1', 0), hk.Handler)",
    "thread = threading.Thread(target=httpd.serve_forever, daemon=True)",
    "thread.start()",
    "request = Request(f'http://127.0.0.1:{httpd.server_port}/submit-pyac', data=sys.stdin.buffer.read(), headers={'Content-Type': 'application/vnd.pyac-vliw-upload', 'X-Pyash-Device-Id': 'gpu0'}, method='POST')",
    "try:",
    "  with urlopen(request, timeout=5) as response: result = {'status': response.status, 'body': json.load(response)}",
    "except HTTPError as error:",
    "  result = {'status': error.code, 'body': json.loads(error.read().decode())}",
    "finally:",
    "  httpd.shutdown(); httpd.server_close()",
    "print(json.dumps(result))"
  ].join("\n");
  try {
    return spawnSync("python3", ["-c", script], {
      input: upload,
      encoding: "utf8",
      env: {
        ...process.env,
        GPU_HOUSEKEEPER_SECRET_PYA_PATH: secretPath,
        GPU_HOUSEKEEPER_PYA_DIR: temporaryRoot
      },
      timeout: 10000
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

test("Pyash VLIW-authenticated Housekeeper upload verifies without Base64", () => {
  const pack = encodePyacPack([new Uint16Array(16)]);
  const secret = "test-shared-secret";
  const upload = createPyacHousekeeperUpload({
    packBytes: pack,
    secret,
    username: "htaf",
    hostId: "mriczo",
    handleId: "0123456789ab",
    nonce: Buffer.from(Array.from({ length: 16 }, (_, index) => index))
  });
  const verified = verifyWithHousekeeper(upload.stream, secret);

  assert.equal(verified.status, 0, verified.stderr);
  assert.deepEqual(JSON.parse(verified.stdout), {
    username: "htaf",
    hostId: "mriczo",
    handleId: "0123456789ab",
    packBytes: pack.byteLength
  });
  assert.equal(upload.stream.subarray(upload.authPack.byteLength).equals(pack), true);
});

test("PyAC upload builder rejects oversized Pyash identity text", () => {
  assert.throws(() => createPyacHousekeeperUpload({
    packBytes: encodePyacPack([new Uint16Array(16)]),
    secret: "test-key",
    username: "a-user-name-that-is-too-long",
    hostId: "mriczo"
  }), /username must be 1-14/u);
});

test("PyAC upload authentication detects job pack modification", () => {
  const pack = encodePyacPack([new Uint16Array(16)]);
  const secret = "test-shared-secret";
  const upload = createPyacHousekeeperUpload({
    packBytes: pack,
    secret,
    username: "htaf",
    hostId: "mriczo",
    handleId: "0123456789ab",
    nonce: Buffer.alloc(16, 3)
  });
  const changed = Buffer.from(upload.stream);
  changed[changed.length - 1] ^= 1;
  const verified = verifyWithHousekeeper(changed, secret);
  assert.notEqual(verified.status, 0);
  assert.match(verified.stderr, /authentication failed/u);
});

test("authenticated raw PyAC upload enters the Housekeeper queue with signed source identity", () => {
  const pack = encodePyacPack([new Uint16Array(16)]);
  const upload = createPyacHousekeeperUpload({
    packBytes: pack,
    secret: "test-shared-secret",
    username: "htaf",
    hostId: "mriczo",
    handleId: "0123456789ab",
    nonce: Buffer.alloc(16, 9)
  });
  const response = postToHousekeeper(upload.stream, "test-shared-secret");
  assert.equal(response.status, 0, response.stderr);
  const result = JSON.parse(response.stdout);
  assert.equal(result.status, 200);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.source.username, "htaf");
  assert.equal(result.body.source.hostId, "mriczo");
});

test("Housekeeper rejects a raw PyAC upload signed with a different secret", () => {
  const upload = createPyacHousekeeperUpload({
    packBytes: encodePyacPack([new Uint16Array(16)]),
    secret: "caller-key",
    username: "htaf",
    hostId: "mriczo",
    handleId: "0123456789ab",
    nonce: Buffer.alloc(16, 4)
  });
  const response = postToHousekeeper(upload.stream, "caller-key", "receiver-key");
  assert.equal(response.status, 0, response.stderr);
  const result = JSON.parse(response.stdout);
  assert.equal(result.status, 401);
  assert.match(result.body.error, /authentication failed/u);
});
