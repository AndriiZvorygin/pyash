import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile errors when ceremony reads sequence register but omits it in def", async () => {
  forget();

  const source = [
    "su name peek be ceremony def",
    "ob this fromindex be number ya",
    "su name peek be ceremony prah",
    "to name num target fromindex num 1 be peek do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${source}.pyash.quoted to state javascript to text output be compile do`);

  await assert.rejects(
    async () => {
      await interpret(sentence);
    },
    (err) => {
      assert.equal(err?.sentence?.su?.name, "sequence register missing");
      assert.match(err?.sentence?.ob?.text ?? "", /fromindex/);
      return true;
    }
  );
});
