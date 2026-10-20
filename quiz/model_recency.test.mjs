import assert from "node:assert/strict";
import test from "node:test";

import { orderModelsByRecency, rememberRecentModel } from "../web/model_recency.js";

test("model options sort by recent successful use and keep catalog order for the rest", () => {
  const models = [
    { value: "qwen-a" },
    { value: "strata::flash" },
    { value: "qwen-b" },
    { value: "qwen-c" }
  ];

  assert.deepEqual(
    orderModelsByRecency(models, ["qwen-b", "qwen-a"]),
    [models[2], models[0], models[1], models[3]]
  );
});

test("recent model use moves the model to the front without duplicates", () => {
  assert.deepEqual(
    rememberRecentModel(["qwen-a", "strata::flash", "qwen-b"], "qwen-a"),
    ["qwen-a", "strata::flash", "qwen-b"]
  );
  assert.deepEqual(
    rememberRecentModel(["qwen-a", "strata::flash", "qwen-b"], "qwen-b"),
    ["qwen-b", "qwen-a", "strata::flash"]
  );
});

test("empty model values do not enter the recent-use list", () => {
  assert.deepEqual(rememberRecentModel(["qwen-a"], "  "), ["qwen-a"]);
});
