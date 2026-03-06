import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAdbDevicesOutput,
  upsertAndroidDeviceIdSentence
} from "../program/library/android_default_device.mjs";

test("parseAdbDevicesOutput extracts serial, state, and details", () => {
  const parsed = parseAdbDevicesOutput(`List of devices attached\nabc123\tdevice usb:1-1 model:Pixel\nxyz999\toffline transport_id:3\n`);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], {
    serial: "abc123",
    state: "device",
    details: "usb:1-1 model:Pixel",
    raw: "abc123\tdevice usb:1-1 model:Pixel"
  });
  assert.equal(parsed[1].state, "offline");
});

test("upsertAndroidDeviceIdSentence appends sentence when missing", () => {
  const next = upsertAndroidDeviceIdSentence('su name sample ob text "ok" ya\n', "abc123");
  assert.match(next, /exists su name android device id ob text "abc123" be default ya/);
  assert.match(next, /su name sample ob text "ok" ya/);
});

test("upsertAndroidDeviceIdSentence replaces existing default line", () => {
  const text = [
    'exists su name android device id ob text "old" be default ya',
    'su name sample ob text "ok" ya'
  ].join("\n") + "\n";
  const next = upsertAndroidDeviceIdSentence(text, "new-id");
  assert.match(next, /^exists su name android device id ob text "new-id" be default ya/m);
  assert.ok(!next.includes('"old"'));
});

test("upsertAndroidDeviceIdSentence migrates legacy non-default sentence", () => {
  const text = 'su name android device id ob text "old" ya\n';
  const next = upsertAndroidDeviceIdSentence(text, "new-id");
  assert.match(next, /^exists su name android device id ob text "new-id" be default ya/m);
  assert.ok(!next.includes('"old"'));
});
