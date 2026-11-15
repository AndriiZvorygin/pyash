import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  forget,
  allRemember,
  dumpHistory,
  dumpSandpits,
  pushMemoryContext,
  popMemoryContext,
  remember,
  doRemember
} from "../program/remember/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import {
  compilePyashProgramSource,
  decodePyashProgramPack,
  executePyashProgramPack
} from "../program/library/vliw/index.mjs";

const examplePath = path.resolve("examples/pyash/vliw-programlet-local-slots.pya");
const localCounterExample = await fs.readFile(examplePath, "utf8");
const exampleLines = localCounterExample.split(/\r?\n/u).filter((line) => line.trim());
const localCounterSource = exampleLines.slice(0, -2).join("\n");
const localCounterInvocation = exampleLines.at(-2);

test("PyAC programlet keeps numeric variable markers and initializes each call frame", async () => {
  const compiled = compilePyashProgramSource(localCounterSource, {
    invocation: localCounterInvocation
  });
  const decoded = decodePyashProgramPack(compiled.pack);
  const declaration = decoded.find((sentence) => sentence.su?.name === "count" && sentence.mood === "ya");

  assert.deepEqual(declaration, {
    mood: "ya",
    su: { name: "count" },
    ob: { num: 0 },
    as: { name: "variable" },
    be: "number"
  });

  const result = await executePyashProgramPack(compiled.pack);
  assert.deepEqual(result.output, { num: 1 });

  forget();
  try {
    for (const line of exampleLines) await interpret(parse(line));
    assert.equal(remember("answer")?.ob?.num, 1);
    assert.equal(remember("count"), undefined, "invocation-local variable must not leak");
    const calls = dumpSandpits().filter((trace) => (
      trace.some((fact) => fact.su?.name === "count" && fact.as?.name === "variable" && !fact.exists)
    ));
    assert.equal(calls.length, 2);
    for (const trace of calls) {
      const slots = trace.filter((fact) => (
        fact.su?.name === "count" && fact.as?.name === "variable" && !fact.exists
      ));
      assert.equal(slots.length, 1, "writes update one frame slot rather than append facts");
      assert.equal(slots[0].ob.num, 1);
    }
  } finally {
    forget();
  }
});

const constantSource = [
  "su name count once to name num answer be ceremony def",
  "exists su name limit ob num 5 as name permanently number be number ya",
  "ob num 1 to name num limit be plus do",
  "su name limit ret",
  "su name count once be ceremony prah"
].join("\n");

test("PyAC programlet rejects writes to a declared constant quantity", () => {
  assert.throws(
    () => compilePyashProgramSource(constantSource, { invocation: "to name num answer be count once do" }),
    /constant quantity is read-only/u
  );
});

test("PyAC programlet requires a typed destination when writing a numeric local", () => {
  const untypedDestination = localCounterSource.replace(
    "to name num count",
    "to name count"
  );
  assert.throws(
    () => compilePyashProgramSource(untypedDestination, { invocation: localCounterInvocation }),
    /numeric variable slot requires a typed num destination: count/u
  );
});

test("interpreter rejects a write to a declared constant quantity", async () => {
  forget();
  try {
    for (const line of constantSource.split("\n")) await interpret(parse(line));
    await assert.rejects(
      async () => interpret(parse("to name num answer be count once do")),
      (error) => {
        assert.equal(error.sentence?.su?.name, "constant quantity write");
        assert.match(error.sentence?.ob?.text ?? "", /constant quantity is read-only: limit/u);
        return true;
      }
    );
  } finally {
    forget();
  }
});

test("interpreter rejects an untyped write to a numeric local", async () => {
  forget();
  try {
    await interpret(parse("exists su name count ob num 0 as name variable be number ya"));
    await assert.rejects(
      async () => interpret(parse("ob num 1 to name count be plus do")),
      (error) => {
        assert.equal(error.sentence?.su?.name, "variable defective");
        assert.match(error.sentence?.ob?.text ?? "", /typed num destination: count/u);
        return true;
      }
    );
  } finally {
    forget();
  }
});

test("local variable updates replace one frame slot and disappear on return", () => {
  forget();
  pushMemoryContext({ seedFromCurrent: true });
  try {
    doRemember({
      mood: "ya",
      exists: true,
      su: { name: "count" },
      ob: { num: 0 },
      as: { name: "variable" },
      be: "number"
    });
    doRemember({
      mood: "ya",
      su: { name: "count" },
      ob: { num: 1 },
      as: { name: "variable" },
      be: "number"
    });

    const slots = allRemember().filter((fact) => fact.su?.name === "count");
    assert.equal(slots.length, 1);
    assert.equal(slots[0].ob.num, 1);
    assert.equal(dumpHistory().filter((fact) => fact.su?.name === "count").length, 2);
  } finally {
    popMemoryContext();
  }
  assert.equal(remember("count"), undefined);
  forget();
});
