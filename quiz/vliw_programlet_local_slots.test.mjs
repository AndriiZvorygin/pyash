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
  DEFAULT_PYASH_PROGRAMLET_STEP_BUDGET,
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

test("PyAC programlets admit long bodies and complexity above the old profile cap", async () => {
  const longBody = [
    "su name count twice to name num answer be ceremony def",
    ...Array.from({ length: 36 }, () => "ob num 1 to name num answer be plus do"),
    "su name answer ret",
    "su name count twice be ceremony prah"
  ].join("\n");
  const longCompiled = compilePyashProgramSource(longBody, {
    invocation: "to name num answer be count twice do"
  });
  assert.ok(longCompiled.sentences.length > 31);
  assert.deepEqual((await executePyashProgramPack(longCompiled.pack)).output, { num: 36 });

  const branchBody = [
    "su name count once to name num answer be ceremony def",
    ...Array.from({ length: 11 }, () => (
      "ob num 1 be equally from num 1 then ob num 1 to name num answer be plus do"
    )),
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const branchCompiled = compilePyashProgramSource(branchBody, {
    invocation: "to name num answer be count once do"
  });
  assert.equal(branchCompiled.complexity, 12);
  assert.deepEqual((await executePyashProgramPack(branchCompiled.pack)).output, { num: 11 });
});

test("PyAC programlets execute fromindex/toindex loops under a per-run step budget", async () => {
  const loopSource = [
    "su name count once fromindex num 0 to name num answer be ceremony def",
    "ob num 1 to name num answer be plus do",
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(loopSource, {
    invocation: "fromindex num 1 toindex num 4 to name num answer be count once do"
  });
  assert.equal(DEFAULT_PYASH_PROGRAMLET_STEP_BUDGET, 65_536);
  assert.deepEqual((await executePyashProgramPack(compiled.pack)).output, { num: 3 });
  await assert.rejects(
    executePyashProgramPack(compiled.pack, { stepBudget: 5 }),
    /execution step budget exhausted \(5\)/u
  );
});

test("PyAC programlets preserve inline else arms after sentence splitting", () => {
  const branchSource = [
    "su name count once to name num answer be ceremony def",
    "exists su name count ob num 5 as name variable be number ya",
    "ob name count be tiny from num 5 then ob num 1 to name num answer be plus do else ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(branchSource, {
    invocation: "to name num answer be count once do"
  });
  const branch = decodePyashProgramPack(compiled.pack).find((sentence) => sentence.consequence);

  assert.equal(branch?.consequence?.be, "plus");
  assert.equal(branch?.alternative?.be, "plus");
});

test("PyAC programlets forward case arguments through nested calls and ret", () => {
  const source = [
    "su name plus two ob num 0 to name num answer be ceremony def",
    "exists su name count ob num of ob of this as name variable be number ya",
    "ob num 2 to name num count be plus do",
    "this ob name count ret",
    "su name plus two be ceremony prah",
    "su name count twice ob num 0 to name num answer be ceremony def",
    "exists su name count ob num of ob of this as name variable be number ya",
    "ob name count to name num count be plus two do",
    "this ob name count ret",
    "su name count twice be ceremony prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(source, {
    invocation: "ob num 5 to name num answer be count twice do"
  });
  const decoded = decodePyashProgramPack(compiled.pack);

  assert.deepEqual(decoded[1].ob, { genitive: { chain: ["this", "ob", "num"] } });
  assert.deepEqual(decoded[3].ob, { name: "count" });
  assert.equal(decoded[3].mood, "ret");
  assert.equal(decoded[7].be, "plus two");
  assert.deepEqual(decoded[7].ob, { name: "count" });
});

test("PyAC programlets accept mutable boolean locals and typed boolean writes", () => {
  const source = [
    "su name count once ob bool lie to name bool answer be ceremony def",
    "exists su name count ob bool truth as name variable be boolean ya",
    "ob bool lie to name bool count be boolean do",
    "this ob name count ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(source, {
    invocation: "ob bool truth to name bool answer be count once do"
  });
  const decoded = decodePyashProgramPack(compiled.pack);
  assert.equal(decoded[1].be, "boolean");
  assert.equal(decoded[2].to.nameTypeWords[0], "bool");
  assert.equal(decoded[3].ob.name, "count");
});

test("PyAC programlets bind the active fromindex register into a local", () => {
  const source = [
    "su name count once fromindex num 0 to name num answer be ceremony def",
    "exists su name count ob num of fromindex of this as name variable be number ya",
    "su name count ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(source, {
    invocation: "fromindex num 1 toindex num 4 to name num answer be count once do"
  });
  const decoded = decodePyashProgramPack(compiled.pack);
  assert.deepEqual(decoded[1].ob, { genitive: { chain: ["this", "fromindex", "num"] } });
});

test("PyAC programlet skips a nested callee body for an empty loop range", async () => {
  const source = [
    "su name count once fromindex num 0 to name num answer be ceremony def",
    "exists su name count ob num 0 as name variable be number ya",
    "ob num 1 to name num count be plus do",
    "su name count ret",
    "su name count once be ceremony prah",
    "su name count twice to name num answer be ceremony def",
    "to name num answer be count once fromindex num 2 toindex num 2 do",
    "su name answer ret",
    "su name count twice be ceremony prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(source, {
    invocation: "to name num answer be count twice do"
  });

  assert.deepEqual((await executePyashProgramPack(compiled.pack)).output, { num: 0 });
});

test("PyAC programlets admit existing multiply and scalar comparison primitives", async () => {
  const arithmeticSource = [
    "su name multiply once to name num answer be ceremony def",
    "exists su name count ob num 6 as name permanently number be number ya",
    "from name count by num 7 to name num answer be multiply do",
    "su name answer ret",
    "su name multiply once be ceremony prah"
  ].join("\n");
  const arithmetic = compilePyashProgramSource(arithmeticSource, {
    invocation: "to name num answer be multiply once do"
  });
  assert.deepEqual((await executePyashProgramPack(arithmetic.pack)).output, { num: 42 });

  const conditionalSource = [
    "su name count once to name num answer be ceremony def",
    "ob num 3 be tiny from num 5 then ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const conditional = compilePyashProgramSource(conditionalSource, {
    invocation: "to name num answer be count once do"
  });
  assert.deepEqual((await executePyashProgramPack(conditional.pack)).output, { num: 2 });
});

test("PyAC programlets lower the complete advertised numeric operator set", () => {
  const operators = [
    "plus",
    "subtract",
    "multiply",
    "divide",
    "exponential",
    "remains",
    "xor",
    "invert"
  ];
  for (const operator of operators) {
    const source = [
      "su name count once to name num answer be ceremony def",
      "exists su name count ob num 3 as name variable be number ya",
      `ob name count to name num answer be ${operator} do`,
      "su name answer ret",
      "su name count once be ceremony prah"
    ].join("\n");
    assert.doesNotThrow(
      () => compilePyashProgramSource(source, { invocation: "to name num answer be count once do" }),
      `${operator} must have a canonical VLIW word mapping`
    );
  }
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
