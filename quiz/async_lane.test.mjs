import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  ASYNC_LANE_DURABLE,
  ASYNC_LANE_FAST,
  resolveAsyncLane
} from "../program/library/async_lane.mjs";

test("resolveAsyncLane maps soon to fast and future to durable", () => {
  const soonSentence = parse('vyah start soon be android verify do');
  const futureSentence = parse('vyah start future be android verify do');
  assert.equal(resolveAsyncLane(soonSentence).lane, ASYNC_LANE_FAST);
  assert.equal(resolveAsyncLane(futureSentence).lane, ASYNC_LANE_DURABLE);
});

test("resolveAsyncLane defaults to durable when tense is omitted", () => {
  const sentence = parse('vyah start be android verify do');
  assert.equal(resolveAsyncLane(sentence).lane, ASYNC_LANE_DURABLE);
});

test("resolveAsyncLane rejects soon and future together", () => {
  const sentence = parse('vyah start soon future be android verify do');
  assert.throws(
    () => resolveAsyncLane(sentence, { verb: "android" }),
    (err) => err?.sentence?.su?.name === "vyah tense invalid"
  );
});
