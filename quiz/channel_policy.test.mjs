import test from "node:test";
import assert from "node:assert/strict";

import { parseChannelPolicyText, mergeChannelPolicies } from "../program/agent/channels/policy.mjs";

test("channel policy parser loads matrix settings and room lanes", () => {
  const text = [
    "su name matrix channel ob bool truth ya",
    'su name matrix mode ob text "appservice" ya',
    'su name matrix long poll ms ob text "45000" ya',
    'su name matrix bridge service file ob text "synapse-data/appservices/agent.yaml" ya',
    "su name matrix mention gate ob bool truth ya",
    "su name matrix debug ob bool truth ya",
    'su name matrix homeserver ob text "https://matrix.example.org" ya',
    'su name matrix user ob text "@agent:example.org" ya',
    'su name matrix room ob text "!a:example.org" ya',
    'su name matrix dm room ob text "!dm:example.org" ya',
    'su name matrix room ob text "!b:example.org" ya',
    "su name matrix listeners ob ve name confederation-priest agent-helper be map ya",
    "su name matrix !a:example.org listeners ob ve name confederation-priest be map ya",
    'su name matrix !a:example.org lane ob text "main_room" ya'
  ].join("\n");
  const policy = parseChannelPolicyText(text);
  const matrix = policy.matrix;
  assert.ok(matrix);
  assert.equal(matrix.enabled, true);
  assert.equal(matrix.mode, "appservice");
  assert.equal(matrix.longPollMs, 45000);
  assert.equal(matrix.appserviceRegistration, "synapse-data/appservices/agent.yaml");
  assert.equal(matrix.homeserver, "https://matrix.example.org");
  assert.equal(matrix.user, "@agent:example.org");
  assert.equal(matrix.mentionGate, true);
  assert.equal(matrix.debug, true);
  assert.ok(matrix.dmRooms.includes("!dm:example.org"));
  assert.deepEqual(matrix.listeners, ["confederation-priest", "agent-helper"]);
  assert.deepEqual(matrix.roomListeners["!a:example.org"], ["confederation-priest"]);
  assert.equal(matrix.rooms.length, 3);
  const a = matrix.rooms.find(room => room.id === "!a:example.org");
  const b = matrix.rooms.find(room => room.id === "!b:example.org");
  assert.equal(a?.lane, "main_room");
  assert.match(String(b?.lane), /^matrix_/);
});

test("channel policy merge applies global defaults with agent overrides", () => {
  const global = parseChannelPolicyText([
    "su name matrix channel ob bool truth ya",
    'su name matrix mode ob text "sync" ya',
    'su name matrix long poll ms ob text "30000" ya',
    "su name matrix mention gate ob bool truth ya",
    "su name matrix debug ob bool lie ya",
    'su name matrix homeserver ob text "https://matrix.example.org" ya',
    'su name matrix dm room ob text "!dm:example.org" ya',
    'su name matrix room ob text "!global:example.org" ya',
    'su name matrix room lane ob text "global_lane" ya',
    "su name matrix listeners ob ve name confederation-priest be map ya"
  ].join("\n"));
  const agent = parseChannelPolicyText([
    'su name matrix user ob text "@helper:example.org" ya',
    'su name matrix mode ob text "poll" ya',
    'su name matrix long poll ms ob text "1000" ya',
    "su name matrix debug ob bool truth ya",
    'su name matrix room ob text "!agent:example.org" ya',
    'su name matrix !agent:example.org lane ob text "agent_lane" ya',
    "su name matrix listeners ob ve name agent-helper be map ya"
  ].join("\n"));
  const merged = mergeChannelPolicies(global, agent);
  const matrix = merged.matrix;
  assert.ok(matrix?.enabled);
  assert.equal(matrix?.homeserver, "https://matrix.example.org");
  assert.equal(matrix?.user, "@helper:example.org");
  assert.equal(matrix?.mode, "poll");
  assert.equal(matrix?.longPollMs, 1000);
  assert.equal(matrix?.mentionGate, true);
  assert.equal(matrix?.debug, true);
  assert.ok(matrix?.dmRooms?.includes("!dm:example.org"));
  assert.deepEqual(matrix?.listeners, ["confederation-priest", "agent-helper"]);
  assert.equal(matrix?.rooms.length, 3);
  const globalRoom = matrix.rooms.find(room => room.id === "!global:example.org");
  const agentRoom = matrix.rooms.find(room => room.id === "!agent:example.org");
  assert.equal(globalRoom?.lane, "global_lane");
  assert.equal(agentRoom?.lane, "agent_lane");
});
