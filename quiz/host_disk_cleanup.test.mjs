import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHostDiskCleanup,
  collectHostDiskReport,
  parseDisabledSnaps,
} from "../command/host_disk_cleanup.mjs";

test("disabled snap parser only returns disabled revisions", () => {
  const rows = parseDisabledSnaps([
    "Name Version Rev Tracking Publisher Notes",
    "firefox 156.0 8969 latest/stable mozilla disabled",
    "firefox 157.0 8995 latest/stable mozilla -",
  ].join("\n"));
  assert.deepEqual(rows, [{ name: "firefox", revision: "8969", notes: "disabled" }]);
});
test("host cleanup report is read-only", () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    if (command === "df") return { status: 0, stdout: "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda5 100 90 10 90% /", stderr: "" };
    if (command === "snap") return { status: 0, stdout: "Name Version Rev Tracking Publisher Notes\n", stderr: "" };
    if (command === "du") return { status: 0, stdout: "0\t/var/cache/apt/archives", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  const report = collectHostDiskReport({ runner });
  assert.equal(report.root_disk.available, "10");
  assert.ok(calls.every(([command]) => !["rm", "unlink"].includes(command)));
});

test("apply cleanup only prunes dangling Docker/build cache and disabled system revisions", () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    return { status: 0, stdout: "", stderr: "" };
  };
  applyHostDiskCleanup({
    runner,
    report: { snaps: { disabled: [{ name: "firefox", revision: "8969" }] } },
  });
  assert.deepEqual(calls, [
    ["docker", ["image", "prune", "--force"]],
    ["docker", ["builder", "prune", "--force", "--filter", "until=168h"]],
    ["sudo", ["-n", "snap", "remove", "--purge", "firefox", "--revision", "8969"]],
    ["sudo", ["-n", "apt-get", "clean"]],
  ]);
});
