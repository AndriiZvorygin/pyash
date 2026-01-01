import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

test("command errors surface original sentence in from la", async () => {
  const sentence = parse("ob text \"\" be command do");
  await assert.rejects(
    () => interpret(sentence),
    (err) => {
      const surfaced = err?.sentence;
      assert.equal(surfaced?.be, "error");
      assert.equal(surfaced?.mood, "do");
      assert.equal(surfaced?.su?.name, "command defective");
      assert.ok(surfaced?.from?.la, "from should include la sentence");
      assert.equal(surfaced?.from?.la?.be, "command");
      return true;
    }
  );
});
