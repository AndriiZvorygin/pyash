import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { state } from "../program/bridge/state.mjs";
import { forget, remember, dumpSandpits } from "../program/remember/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

async function runSource(source) {
  forget();
  let result;
  for (const raw of splitSentences(source)) {
    if (!raw.trim()) continue;
    result = await interpret(parse(raw));
  }
  return result;
}

async function runSourceWithLogs(source) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...values) => logs.push(values.join(" "));
  try {
    return { result: await runSource(source), logs };
  } finally {
    console.log = originalLog;
  }
}

function errorShape(sentence) {
  return JSON.parse(JSON.stringify({
    mood: sentence?.mood,
    be: sentence?.be,
    su: sentence?.su,
    ob: sentence?.ob,
    from: sentence?.from
  }));
}

function assertNoPrematureErrorFacts(traces) {
  assert.equal(
    traces.some((trace) => trace.some((sentence) => sentence?.be === "error" && sentence?.mood === "ya")),
    false,
    "intermediate sandpits must retain be error do carriers"
  );
  assert.equal(
    traces.some((trace) => trace.some((sentence) => sentence?.su?.name === "result")),
    false,
    "intermediate sandpits must not contain the surfaced result alias"
  );
}

test("a ceremony can return a truthful error sentence without target coercion", async () => {
  const result = await runSource([
    "exists su name output ob text \"seed\" be text ya",
    "su name failing to name text output be ceremony def",
    "su name bad result ob text \"inner failure\" from name failing be error ret",
    "su name failing be ceremony prah",
    "to name text output be failing do"
  ].join("\n"));

  const expected = {
    mood: "ya",
    be: "error",
    su: { name: "bad result" },
    ob: { text: "inner failure" },
    from: { name: "failing" }
  };
  assert.deepEqual(errorShape(result), expected);
  assert.deepEqual(errorShape(remember("bad result")), expected);
  assert.deepEqual(errorShape(remember("result")), { ...expected, su: { name: "result" } });
  assert.equal(remember("output")?.ob?.text, "seed", "errors must not overwrite a seeded target");
  assert.equal(state.currentEvoke, null, "outer evoke must be restored after the error result");
  assert.equal(state.currentEvokeRef, null, "outer evoke ref must be restored after the error result");
  assert.equal(state.executingBody, false);
});

test("a nested ceremony can return its inner error through the caller", async () => {
  const source = [
    "su name inner failure to name text nested result be ceremony def",
    "su name inner error ob text \"nested failure\" from name inner failure be error ret",
    "su name inner failure be ceremony prah",
    "su name outer failure to name text output be ceremony def",
    "to name text nested result be inner failure do",
    "ob text \"after nested call\" be write do",
    "su name outer failure be ceremony prah",
    "to name text output be outer failure do"
  ].join("\n");
  const result = await runSource(source);

  assert.deepEqual(errorShape(result), {
    mood: "ya",
    be: "error",
    su: { name: "inner error" },
    ob: { text: "nested failure" },
    from: { name: "inner failure" }
  });
  assert.equal(remember("nested result"), undefined, "nested error must not become a typed target");
  const traces = dumpSandpits();
  assert.equal(traces.length, 2, "both ceremony sandpits should be traced");
  assertNoPrematureErrorFacts(traces);

  forget();
  const compiledResult = await interpret(parse(
    `from text quoted.pyash.${source}.pyash.quoted to state javascript to text output be compile do`
  ));
  const compiled = String(compiledResult?.ob?.text ?? compiledResult?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");
  const logs = [];
  const context = { console: { log(...values) { logs.push(values.join(" ")); } } };
  vm.runInNewContext(compiled, context);
  const rawOuter = context["be_outer_failure_to_name_text"]({
    mood: "do",
    to: { name: "output", nameTypeWords: ["text"] },
    be: "outer failure"
  });
  assert.equal(rawOuter?.mood, "do", "nested compiled errors remain thrown carriers inside ceremonies");
  assert.deepEqual(errorShape(context["inner error"]), {
    mood: "ya",
    be: "error",
    su: { name: "inner error" },
    ob: { text: "nested failure" },
    from: { name: "inner failure" }
  });
  assert.deepEqual(errorShape(context.result), {
    mood: "ya",
    be: "error",
    su: { name: "result" },
    ob: { text: "nested failure" },
    from: { name: "inner failure" }
  });
  assert.equal(context.output, undefined);
  assert.deepEqual(logs, [], "the observable statement after a nested error must not run");
});

test("a successful nested ceremony still runs later statements when an error ceremony exists", async () => {
  const source = [
    "su name inner error to name text answer be ceremony def",
    "su name inner error ob text \"inner failure\" from name inner error be error ret",
    "su name inner error be ceremony prah",
    "su name inner success to name text answer be ceremony def",
    "ob text \"success\" ret",
    "su name inner success be ceremony prah",
    "su name plus two to name text answer be ceremony def",
    "to name text answer be inner success do",
    "ob text \"after success\" be write do",
    "su name plus two be ceremony prah",
    "to name text answer be plus two do"
  ].join("\n");

  const interpreted = await runSourceWithLogs(source);
  assert.deepEqual(interpreted.logs, ["after success"]);

  const compiledResult = await runSource(
    `from text quoted.pyash.${source}.pyash.quoted to state javascript to text answer be compile do`
  );
  const compiled = String(compiledResult?.ob?.text ?? compiledResult?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");
  const logs = [];
  const context = { console: { log(...values) { logs.push(values.join(" ")); } } };
  vm.runInNewContext(compiled, context);

  assert.deepEqual(logs, ["after success"]);
});

test("compiled error-capable ceremonies keep two successful no-target calls independent", async () => {
  const source = [
    "su name inner error to name text answer be ceremony def",
    "su name inner error ob text \"inner failure\" from name inner error be error ret",
    "su name inner error be ceremony prah",
    "su name inner success be ceremony def",
    "ob text \"success\" ret",
    "su name inner success be ceremony prah",
    "su name outer success to name text output be ceremony def",
    "be inner success do",
    "be inner success do",
    "ob text \"after nested calls\" be write do",
    "su name outer success be ceremony prah",
    "to name text output be outer success do"
  ].join("\n");

  const compiledResult = await runSource(
    `from text quoted.pyash.${source}.pyash.quoted to state javascript to text output be compile do`
  );
  const compiled = String(compiledResult?.ob?.text ?? compiledResult?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");
  const logs = [];
  vm.runInNewContext(compiled, { console: { log(...values) { logs.push(values.join(" ")); } } });

  assert.deepEqual(logs, ["after nested calls"]);
});

test("compiled error-capable ceremonies keep two successful nested loops independent", async () => {
  const source = [
    "su name inner error to name text answer be ceremony def",
    "su name inner error ob text \"inner failure\" from name inner error be error ret",
    "su name inner error be ceremony prah",
    "su name loop success fromindex num 1 be ceremony def",
    "ob text \"loop\" be write do",
    "su name loop success be ceremony prah",
    "su name outer loops to name text output be ceremony def",
    "fromindex num 1 toindex num 3 be loop success do",
    "fromindex num 1 toindex num 3 be loop success do",
    "ob text \"after nested loops\" be write do",
    "su name outer loops be ceremony prah",
    "to name text output be outer loops do"
  ].join("\n");

  const compiledResult = await runSource(
    `from text quoted.pyash.${source}.pyash.quoted to state javascript to text output be compile do`
  );
  const compiled = String(compiledResult?.ob?.text ?? compiledResult?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");
  const logs = [];
  vm.runInNewContext(compiled, { console: { log(...values) { logs.push(values.join(" ")); } } });

  assert.equal(logs.at(-1), "after nested loops");
  assert.equal(logs.filter((value) => value === "loop").length, 4);
});

test("loop sandpits surface returned errors without losing the canonical sentence", async () => {
  const result = await runSource([
    "su name looping failure fromindex num 1 to name text output be ceremony def",
    "su name loop error ob text \"loop failure\" from name looping failure be error ret",
    "su name looping failure be ceremony prah",
    "fromindex num 1 toindex num 3 to name text output be looping failure do"
  ].join("\n"));

  assert.deepEqual(errorShape(result), {
    mood: "ya",
    be: "error",
    su: { name: "loop error" },
    ob: { text: "loop failure" },
    from: { name: "looping failure" }
  });
  assert.deepEqual(errorShape(remember("loop error")), errorShape(result));
  assert.equal(remember("output"), undefined);
  assert.equal(dumpSandpits().length, 1);
});

test("compiled loop errors propagate through an enclosing ceremony before top-level surfacing", async () => {
  const source = [
    "su name looping failure fromindex num 1 to name text loop result be ceremony def",
    "su name loop error ob text \"loop failure\" from name looping failure be error ret",
    "su name looping failure be ceremony prah",
    "su name outer loop failure to name text output be ceremony def",
    "fromindex num 1 toindex num 3 to name text loop result be looping failure do",
    "ob text \"after loop\" be write do",
    "su name outer loop failure be ceremony prah",
    "to name text output be outer loop failure do"
  ].join("\n");
  const interpreted = await runSource(source);
  assert.deepEqual(errorShape(interpreted), {
    mood: "ya",
    be: "error",
    su: { name: "loop error" },
    ob: { text: "loop failure" },
    from: { name: "looping failure" }
  });
  assertNoPrematureErrorFacts(dumpSandpits());
  assert.deepEqual(errorShape(remember("loop error")), errorShape(interpreted));
  assert.deepEqual(errorShape(remember("result")), { ...errorShape(interpreted), su: { name: "result" } });

  const compiledResult = await runSource(
    `from text quoted.pyash.${source}.pyash.quoted to state javascript to text output be compile do`
  );
  const compiled = String(compiledResult?.ob?.text ?? compiledResult?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");
  const logs = [];
  const context = { console: { log(...values) { logs.push(values.join(" ")); } } };
  vm.runInNewContext(compiled, context);
  const rawOuter = context["be_outer_loop_failure_to_name_text"]({
    mood: "do",
    to: { name: "output", nameTypeWords: ["text"] },
    be: "outer loop failure"
  });
  assert.equal(rawOuter?.mood, "do", "compiled loop errors remain thrown carriers inside ceremonies");

  assert.deepEqual(errorShape(context["loop error"]), {
    mood: "ya",
    be: "error",
    su: { name: "loop error" },
    ob: { text: "loop failure" },
    from: { name: "looping failure" }
  });
  assert.deepEqual(errorShape(context.result), {
    mood: "ya",
    be: "error",
    su: { name: "result" },
    ob: { text: "loop failure" },
    from: { name: "looping failure" }
  });
  assert.deepEqual(logs, [], "the observable statement after a loop error must not run");
  assert.equal(context.output, undefined);
});

test("compiled ceremony errors preserve interpreter error identity", async () => {
  const source = [
    "exists su name output ob text \"seed\" be text ya",
    "su name failing to name text output be ceremony def",
    "su name bad result ob text \"compiled failure\" from name failing be error ret",
    "su name failing be ceremony prah",
    "to name text output be failing do"
  ].join("\n");
  const compiled = await runSource(`from text quoted.pyash.${source}.pyash.quoted to state javascript to text output be compile do`);
  const js = String(compiled?.ob?.text ?? compiled?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");
  const context = { console: { log() {} } };
  vm.runInNewContext(js, context);

  assert.deepEqual(errorShape(context["bad result"]), {
    mood: "ya",
    be: "error",
    su: { name: "bad result" },
    ob: { text: "compiled failure" },
    from: { name: "failing" }
  });
  assert.deepEqual(errorShape(context.result), {
    mood: "ya",
    be: "error",
    su: { name: "result" },
    ob: { text: "compiled failure" },
    from: { name: "failing" }
  });
  assert.equal(context.output?.ob?.text, "seed");
});
