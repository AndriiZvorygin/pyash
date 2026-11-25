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
  decodePyashProgramSections,
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
    exists: true,
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

test("PyAC programlet signatures preserve floating-vector argument and return types", () => {
  const source = [
    "su name vector echo from name vec float input to name vec float answer be ceremony def",
    "su name input ret",
    "su name vector echo be ceremony prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(source, {
    invocation: "from ve float32 1 2 to name vec float answer be vector echo do"
  });

  assert.ok(compiled.byteLength > 0);
  assert.deepEqual(compiled.sentences[0].from, {
    name: "input",
    nameTypeWords: ["vec", "float"]
  });
  assert.deepEqual(compiled.sentences[0].to, {
    name: "answer",
    nameTypeWords: ["vec", "float"]
  });
});

test("PyAC source compiles a vector-weight ceremony from existing vector primitives", async () => {
  const source = await fs.readFile(
    path.resolve("quiz/fixtures/vliw-programlet-vector-weight.pya"),
    "utf8"
  );
  const compiled = compilePyashProgramSource(source, {
    invocation: "from ve float32 1 2 3 to name vec float answer be vector weight do"
  });

  assert.equal(compiled.sentences.length, 9);
  assert.deepEqual(compiled.sentences[0].from.nameTypeWords, ["vec", "float"]);
  assert.deepEqual(compiled.sentences[0].to.nameTypeWords, ["vec", "float"]);
  assert.deepEqual(
    compiled.sentences.slice(1, 6).map(({ be }) => be),
    ["gjat bwit", "subtract", "exponential", "tfo2t", "dvis"]
  );
  assert.equal(compiled.sentences.at(-1).mood, "do");
  assert.ok(compiled.byteLength > 0);
});

test("PyAC sections resolve ceremony aliases after decoding", () => {
  const source = [
    "su name one be myocpfun def",
    "su name vector weight to name num answer be ceremony def",
    "ob num 1 to name num answer be plus do",
    "su name answer ret",
    "su name vector weight be ceremony prah",
    "su name count once to name num answer be ceremony def",
    "to name num first be vector weight do",
    "su name first ret",
    "su name count once be ceremony prah",
    "to name num answer be count once do",
    "su name one be myocpfun prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(source);

  assert.equal(decodePyashProgramSections(compiled.pack).length, 1);
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

test("PyAC programlet rejects writes to a declared boolean constant", () => {
  const source = [
    "su name inspect once ob bool lie to name bool answer be ceremony def",
    "exists su name enabled ob bool truth as name permanently boolean be boolean ya",
    "ob bool lie to name bool enabled be boolean do",
    "su name enabled ret",
    "su name inspect once be ceremony prah"
  ].join("\n");
  assert.throws(
    () => compilePyashProgramSource(source, {
      invocation: "ob bool truth to name bool answer be inspect once do"
    }),
    /constant quantity is read-only: enabled/u
  );
});

test("PyAC packet sections compile and execute as independent named sections", async () => {
  const source = [
    "su name one be myocpfun def",
    "su name one to name num answer be ceremony def",
    "ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name one be ceremony prah",
    "to name num answer be one do",
    "su name one be myocpfun prah",
    "su name two be myocpfun def",
    "su name two to name num answer be ceremony def",
    "ob num 5 to name num answer be plus do",
    "su name answer ret",
    "su name two be ceremony prah",
    "to name num answer be two do",
    "su name two be myocpfun prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(source);

  assert.deepEqual(compiled.sections.map(({ name }) => name), ["one", "two"]);
  assert.equal(compiled.sections.length, 2);
  const result = await executePyashProgramPack(compiled.pack);
  assert.deepEqual(result.sections.map(({ name, output }) => [name, output]), [
    ["one", { num: 2 }],
    ["two", { num: 5 }]
  ]);
  assert.deepEqual(result.completionOrder, result.sections.map(({ index }) => index));
});

test("PyAC packet sections reject duplicate names and unclosed boundaries", () => {
  const section = [
    "su name one be myocpfun def",
    "su name one to name num answer be ceremony def",
    "ob num 1 to name num answer be plus do",
    "su name answer ret",
    "su name one be ceremony prah",
    "to name num answer be one do",
    "su name one be myocpfun prah"
  ];
  assert.throws(
    () => compilePyashProgramSource([...section, ...section].join("\n")),
    /section names must be unique/u
  );
  assert.throws(
    () => compilePyashProgramSource(section.slice(0, -1).join("\n")),
    /missing its matching paragraph terminator/u
  );
  const longSectionName = section
    .map((sentence) => sentence.replaceAll("name one", "name one two three four five six seven eight nine"))
    .join("\n");
  assert.throws(
    () => compilePyashProgramSource(longSectionName),
    /section name exceeds 8 HNUC words/u
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
  await assert.rejects(
    executePyashProgramPack(compiled.pack, { stepBudget: 6 }),
    /execution step budget exhausted \(6\)/u
  );
  assert.deepEqual(
    (await executePyashProgramPack(compiled.pack, { stepBudget: 7 })).output,
    { num: 3 }
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

test("PyAC programlets reject nested conditionals before lowering can lose a branch", () => {
  const nestedBranch = [
    "su name count once to name num answer be ceremony def",
    "ob num 1 be equally from num 1 then ob num 2 be equally from num 2 then ob num 4 to name num answer be plus do else ob num 5 to name num answer be plus do else ob num 6 to name num answer be plus do",
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");

  assert.throws(
    () => compilePyashProgramSource(nestedBranch, { invocation: "to name num answer be count once do" }),
    /nested conditional branches are not admitted/u
  );
});

test("PyAC programlets execute compound predicates without dropping a comparison", async () => {
  const compoundPredicate = [
    "su name count once to name bool answer be ceremony def",
    "be and ob la ob num 1 be tiny from num 3 do ko with la ob num 4 be tiny from num 2 do ko then ob bool truth to name bool answer be boolean do else ob bool lie to name bool answer be boolean do",
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");

  const compiled = compilePyashProgramSource(compoundPredicate, {
    invocation: "to name bool answer be count once do"
  });
  assert.deepEqual((await executePyashProgramPack(compiled.pack)).output, { boolean: false });
});

test("PyAC programlet signatures reject value families the Rust frame ABI cannot carry", () => {
  const unsupportedArguments = [
    ["ob ve num 1 2", "ob ve num 1 2"],
    ["ob date 2025-05-01", "ob date 2025-05-01"],
    ['ob text "x"', 'ob text "x"'],
    ["ob num -1", "ob num -1"],
    ["ob num 65536", "ob num 65536"]
  ];

  for (const [formal, actual] of unsupportedArguments) {
    const source = [
      `su name count once ${formal} to name num answer be ceremony def`,
      "su name answer ret",
      "su name count once be ceremony prah"
    ].join("\n");
    assert.throws(
      () => compilePyashProgramSource(source, {
        invocation: `${actual} to name num answer be count once do`
      }),
      /only admits U16 numeric or boolean scalar input fields/u,
      formal
    );
  }
});

test("PyAC programlet locals explicitly reject vector, date, and text values", () => {
  const unsupportedLocals = [
    ["ob ve num 1 2", "be vector"],
    ["ob date 2025-05-01", "be date"],
    ['ob text "x"', "be text"]
  ];

  for (const [value, type] of unsupportedLocals) {
    const source = [
      "su name count once to name num answer be ceremony def",
      `exists su name payload ${value} as name variable ${type} ya`,
      "su name payload ret",
      "su name count once be ceremony prah"
    ].join("\n");
    assert.throws(
      () => compilePyashProgramSource(source, { invocation: "to name num answer be count once do" }),
      /only admits initialized numeric or boolean local declarations/u,
      value
    );
  }
});

test("PyAC programlet accepts source bodies longer than 64 codelets", () => {
  const sourceWithActions = (actionCount) => [
    "su name count once to name num answer be ceremony def",
    ...Array.from({ length: actionCount }, () => "ob num 1 to name num answer be plus do"),
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");

  const compiled = compilePyashProgramSource(sourceWithActions(80), {
    invocation: "to name num answer be count once do"
  });
  assert.equal(compiled.vectorCount, 84);
});

test("PyAC programlet enforces frame-local and call-depth limits", async () => {
  const tooManyLocals = [
    "su name count once to name num answer be ceremony def",
    ...Array.from({ length: 64 }, (_, index) => (
      `exists su name local${index} ob num 0 as name variable be number ya`
    )),
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");
  assert.throws(
    () => compilePyashProgramSource(tooManyLocals, {
      invocation: "to name num answer be count once do"
    }),
    /exceeds 63 declared locals/u
  );

  const numberWords = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const callChain = (depth) => {
    const source = [];
    for (const [index, word] of numberWords.slice(0, depth).entries()) {
      const next = index + 1 < depth ? numberWords[index + 1] : null;
      source.push(
        `su name count ${word} to name num answer be ceremony def`,
        next
          ? `to name num answer be count ${next} do`
          : "ob num 1 to name num answer be plus do",
        "su name answer ret",
        `su name count ${word} be ceremony prah`
      );
    }
    return source.join("\n");
  };
  const maximumDepth = compilePyashProgramSource(callChain(8), {
    invocation: "to name num answer be count one do"
  });
  assert.deepEqual((await executePyashProgramPack(maximumDepth.pack)).output, { num: 1 });
  assert.throws(
    () => compilePyashProgramSource(callChain(9), {
      invocation: "to name num answer be count one do"
    }),
    /call depth exceeds 8/u
  );
});

test("PyAC branches can delegate multiple actions to a called ceremony", async () => {
  const source = [
    "su name count once to name num answer be ceremony def",
    "ob num 1 to name num answer be plus do",
    "ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name count once be ceremony prah",
    "su name count twice to name num answer be ceremony def",
    "ob num 1 be equally from num 1 then to name num answer be count once do else ob num 0 to name num answer be plus do",
    "su name answer ret",
    "su name count twice be ceremony prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(source, { invocation: "to name num answer be count twice do" });

  assert.deepEqual((await executePyashProgramPack(compiled.pack)).output, { num: 3 });
});

test("PyAC nested bounded loops compose through a called ceremony", async () => {
  const source = [
    "su name count once fromindex num 0 to name num answer be ceremony def",
    "ob num 1 to name num answer be plus do",
    "su name answer ret",
    "su name count once be ceremony prah",
    "su name count twice fromindex num 0 to name num answer be ceremony def",
    "fromindex num 1 toindex num 4 to name num count once be count once do",
    "ob name count once to name num answer be plus do",
    "su name answer ret",
    "su name count twice be ceremony prah"
  ].join("\n");
  const compiled = compilePyashProgramSource(source, {
    invocation: "fromindex num 1 toindex num 4 to name num answer be count twice do"
  });

  assert.deepEqual((await executePyashProgramPack(compiled.pack)).output, { num: 9 });
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

test("PyAC programlets accept mutable boolean locals and typed boolean writes", async () => {
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
  assert.deepEqual((await executePyashProgramPack(compiled.pack)).output, { boolean: false });
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

test("PyAC boolean branches compose local comparison leaves", async () => {
  const source = [
    "su name choose once ob num 0 to name num answer be ceremony def",
    "exists su name count ob num of ob of this as name variable be number ya",
    "be and ob la ob name count be equally from num 5 do ko with la ob name count be giant from num 3 do ko then ob num 1 to name num answer be plus do else ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name choose once be ceremony prah"
  ].join("\n");
  const trueBranch = compilePyashProgramSource(source, {
    invocation: "ob num 5 to name num answer be choose once do"
  });
  const falseBranch = compilePyashProgramSource(source, {
    invocation: "ob num 2 to name num answer be choose once do"
  });

  assert.deepEqual((await executePyashProgramPack(trueBranch.pack)).output, { num: 1 });
  assert.deepEqual((await executePyashProgramPack(falseBranch.pack)).output, { num: 2 });

  const unsupportedAction = source.replace(
    " then ob num 1 to name num answer be plus do else ob num 2 to name num answer be plus do",
    " do"
  );
  assert.throws(
    () => compilePyashProgramSource(unsupportedAction, {
      invocation: "ob num 5 to name num answer be choose once do"
    }),
    /rejects effectful or unknown verb: and/u
  );
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

test("PyAC programlets reject pure actions without a typed local destination", () => {
  const source = [
    "su name count once to name num answer be ceremony def",
    "exists su name count ob num 8 as name variable be number ya",
    "ob name count with num 2 be divide do",
    "su name count ret",
    "su name count once be ceremony prah"
  ].join("\n");
  assert.throws(
    () => compilePyashProgramSource(source, { invocation: "to name num answer be count once do" }),
    /divide action requires a typed to name destination/u
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

test("conditional fromindex return updates the loop cursor and preserves the final result", async () => {
  const source = [
    "su name count once to name num answer fromindex num 0 toindex num 0 be ceremony def",
    "exists su name answer ob num of fromindex of this as name variable be number ya",
    "ob name answer be equally from num 2 then this fromindex num of toindex of this ret",
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const invocation = "to name num answer fromindex num 1 toindex num 5 be count once do";
  const compiled = compilePyashProgramSource(source, { invocation });
  const decoded = decodePyashProgramPack(compiled.pack);
  const branch = decoded.find((sentence) => sentence.consequence?.mood === "ret");

  assert.equal(branch?.mood, "do");
  assert.deepEqual(branch?.consequence?.fromindex?.genitive?.chain, ["this", "toindex", "num"]);
  const { output } = await executePyashProgramPack(compiled.pack);
  assert.deepEqual(output, { num: 2 });
});
