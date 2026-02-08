import test from "node:test";
import assert from "node:assert/strict";

import {
  parseSystemdIniToMap,
  emitSystemdIniFromMap,
  serviceSentenceToSystemdMap,
  systemdMapToServiceSentence
} from "../program/agent/service_definition.mjs";

test("systemd ini parses to canonical map", () => {
  const ini = [
    "[Unit]",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    "ExecStart=/usr/local/bin/my-service",
    "Restart=on-failure",
    "",
    "[Install]",
    "WantedBy=multi-user.target"
  ].join("\n");
  const map = parseSystemdIniToMap(ini);
  assert.deepEqual(map, {
    unit_after: "network-online.target",
    unit_wants: "network-online.target",
    service_type: "simple",
    service_exec_start: "/usr/local/bin/my-service",
    service_restart: "on-failure",
    install_wanted_by: "multi-user.target"
  });
});

test("canonical map emits systemd ini", () => {
  const map = {
    unit_after: "network-online.target",
    unit_wants: "network-online.target",
    service_type: "simple",
    service_exec_start: "/usr/local/bin/my-service",
    service_restart: "on-failure",
    install_wanted_by: "multi-user.target"
  };
  const ini = emitSystemdIniFromMap(map);
  assert.match(ini, /\[Unit\]/);
  assert.match(ini, /After=network-online.target/);
  assert.match(ini, /ExecStart=\/usr\/local\/bin\/my-service/);
  assert.match(ini, /\[Install\]/);
});

test("service sentence converts to map and back", () => {
  const sentence = {
    mood: "ya",
    su: { name: "my service" },
    since: { name: "network-online.target" },
    fromperson: { name: "network-online.target" },
    as: { text: "simple" },
    ob: { filename: "/usr/local/bin/my-service" },
    for: { name: "multi-user.target" },
    onto: { text: "on-failure" },
    be: "service"
  };
  const map = serviceSentenceToSystemdMap(sentence);
  assert.equal(map.service_exec_start, "/usr/local/bin/my-service");
  const rebuilt = systemdMapToServiceSentence(map, { serviceName: "my service" });
  assert.equal(rebuilt.be, "service");
  assert.equal(rebuilt.ob?.filename, "/usr/local/bin/my-service");
  assert.equal(rebuilt.since?.name, "network-online.target");
});

