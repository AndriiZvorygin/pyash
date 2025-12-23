import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile json map example to javascript and run", async () => {
  forget();

  const pyash = await fs.readFile("examples/pyash/json-map-write.pya", "utf8");
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.obj?.text ?? result?.value?.text ?? "";
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, {
    console: {
      log: (...args) => logs.push(args.join(" "))
    }
  });

  const expected = [
    "{",
    "  \"name\": \"Ada\",",
    "  \"age\": 36,",
    "  \"alive\": true,",
    "  \"note\": null,",
    "  \"address\": {",
    "    \"street\": \"123 Main St\",",
    "    \"city\": \"Springfield\"",
    "  },",
    "  \"projects\": [",
    "    {",
    "      \"title\": \"Pyash compiler\",",
    "      \"done\": false",
    "    },",
    "    {",
    "      \"title\": \"Vector polish\",",
    "      \"done\": true",
    "    }",
    "  ]",
    "}"
  ].join("\n");

  assert.deepEqual(logs, [expected]);
});
