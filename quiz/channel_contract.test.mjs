import test from "node:test";
import assert from "node:assert/strict";

import {
  ROUTER_OPERATION_HEALTH,
  ROUTER_OPERATION_INPUT,
  ROUTER_OPERATION_PRODUCE,
  ackFromSentence,
  ackToSentence,
  agentEndpoint,
  assertInputResultSentence,
  assertProduceResultSentence,
  buildRouterInputRequestSentence,
  buildRouterProduceRequestSentence,
  channelEndpoint,
  eventFromSentence,
  eventToSentence,
  healthFromSentence,
  healthToSentence,
  resolveRouterOperation
} from "../program/agent/channel_core/contract.mjs";

test("channel contract builds and parses input event sentence", () => {
  const sentence = eventToSentence({
    payloadId: "news-20260211-0001",
    fromEndpoint: "channel matrix room !abc:server",
    toEndpoint: "agent pyash-agent",
    payloadText: "hello",
    targetAgentName: "pyash-agent",
    sessionId: "channel matrix room !abc:server -> agent pyash-agent"
  });
  assert.equal(sentence.be, ROUTER_OPERATION_INPUT);
  assert.equal(sentence.su.name, "news-20260211-0001");
  assert.equal(sentence.ob.text, "hello");
  assert.equal(sentence.for.text, "pyash-agent");
  assert.equal(sentence.fromtext.text, "channel matrix room !abc:server -> agent pyash-agent");
  assert.deepEqual(eventFromSentence(sentence), {
    payloadId: "news-20260211-0001",
    fromEndpoint: "channel matrix room !abc:server",
    toEndpoint: "agent pyash-agent",
    payloadText: "hello",
    targetAgentName: "pyash-agent",
    sessionId: "channel matrix room !abc:server -> agent pyash-agent"
  });
});

test("channel contract builds and parses produce ack sentence", () => {
  const sentence = ackToSentence({
    messageId: "matrix-event-20260211-0001",
    fromEndpoint: "agent pyash-agent",
    toEndpoint: "channel matrix room !abc:server",
    payloadId: "news-20260211-0001",
    success: true
  });
  assert.equal(sentence.be, ROUTER_OPERATION_PRODUCE);
  assert.deepEqual(sentence.vyah.ve.values, ["success"]);
  assert.deepEqual(ackFromSentence(sentence), {
    messageId: "matrix-event-20260211-0001",
    fromEndpoint: "agent pyash-agent",
    toEndpoint: "channel matrix room !abc:server",
    payloadId: "news-20260211-0001",
    success: true
  });
});

test("channel contract builds and parses router health sentence", () => {
  const sentence = healthToSentence({
    statusText: "ready",
    healthy: true,
    sinceIso: "2026-02-11T13:00:00.000Z"
  });
  assert.equal(sentence.be, ROUTER_OPERATION_HEALTH);
  assert.equal(sentence.su.name, "router");
  assert.equal(sentence.ob.text, "ready");
  assert.equal(sentence.as.boolean, true);
  assert.equal(sentence.since.date, "2026-02-11T13:00:00.000Z");
  assert.deepEqual(healthFromSentence(sentence), {
    name: "router",
    statusText: "ready",
    healthy: true,
    sinceIso: "2026-02-11T13:00:00.000Z",
    activeMode: "",
    fallbackActive: false,
    fallbackReason: "",
    queueDepth: 0,
    lastInputAt: ""
  });
});

test("channel contract request builders produce router sentences", () => {
  const input = buildRouterInputRequestSentence({
    channelType: "matrix",
    event: { channelId: "!abc:server", text: "hello" },
    targetAgentName: "pyash-agent",
    sessionName: "session one"
  });
  assert.equal(resolveRouterOperation(input), ROUTER_OPERATION_INPUT);
  assert.equal(input.from.name, "channel matrix room !abc:server");
  assert.equal(input.to.name, "agent pyash-agent");
  assert.equal(input.fromtext.text, "session one");

  const produce = buildRouterProduceRequestSentence({
    channelType: "matrix",
    event: { channelId: "!abc:server" },
    sourceAgentName: "pyash-agent",
    payloadId: "news-20260211-0001",
    responseText: "ok"
  });
  assert.equal(resolveRouterOperation(produce), ROUTER_OPERATION_PRODUCE);
  assert.equal(produce.from.name, "agent pyash-agent");
  assert.equal(produce.to.name, "channel matrix room !abc:server");
  assert.equal(produce.accordingto.text, "news-20260211-0001");
});

test("channel contract endpoint helpers are stable", () => {
  assert.equal(channelEndpoint({ channelType: "matrix", channelId: "!abc:server" }), "channel matrix room !abc:server");
  assert.equal(agentEndpoint("pyash-agent"), "agent pyash-agent");
});

test("channel contract validators reject malformed results", () => {
  assert.throws(
    () => assertInputResultSentence({ be: "input", su: { name: "" } }),
    /router input defective: invalid router input/
  );
  assert.throws(
    () => assertProduceResultSentence({ be: "produce", su: { name: "" } }),
    /router produce defective: invalid router produce/
  );
});
