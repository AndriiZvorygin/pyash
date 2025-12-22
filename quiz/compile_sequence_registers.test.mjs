import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile errors when ceremony reads sequence register but omits it in def", async () => {
  forget();

  const source = [
    "subj name peek be ceremony def",
    "obj this fromindex be number ya",
    "subj name peek be ceremony prah",
    "to name num target fromindex num 1 be peek do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${source}.pyash.quoted to state javascript to text output be compile do`);

  await assert.rejects(
    async () => {
      await interpret(sentence);
    },
    (err) => {
      assert.equal(err?.sentence?.subj?.name, "sequence register missing");
      assert.match(err?.sentence?.obj?.text ?? "", /fromindex/);
      return true;
    }
  );
});
