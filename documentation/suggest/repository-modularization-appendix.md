# Appendix — Repository Modularization Measurement Scripts

**Status:** evidence for
[`repository-modularization.md`](repository-modularization.md). It carries the
two measurements that need a script rather than a shell one-liner, plus the
output they produced at commit `4e31f9f8d`. It is not a second proposal. If
the proposal is accepted, these become `command/measure_module_graph.mjs` and
`command/measure_test_suite.mjs`.

Both scripts are read-only. Neither writes to the working tree.

---

## 1. The module graph

Reports the cross-directory import edges inside `program/`, the fan-in
per module, the import cycles, how the quiz suite couples to the program
tree, and the candidate layer violations.

### Script

Save as `command/measure_module_graph.mjs`:

```javascript
#!/usr/bin/env node
// Measures the import graph inside program/, and how the quiz suite couples
// to it. Read-only: it reports, it does not change anything.
//
// Usage: node command/measure_module_graph.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const files = execFileSync("git", ["ls-files", "program", "command", "quiz"], {
  cwd: root,
  encoding: "utf8"
})
  .split("\n")
  .filter((f) => f.endsWith(".mjs"));

const known = new Set(files);

function resolve(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.normalize(path.join(path.dirname(from), specifier));
  for (const candidate of [base, `${base}.mjs`, path.join(base, "index.mjs")]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

const edges = new Map();
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const targets = new Set();
  for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
    const target = resolve(file, match[1]);
    if (target && target !== file) targets.add(target);
  }
  edges.set(file, [...targets]);
}

const areaOf = (file) => file.split("/").slice(0, 2).join("/");

const cross = new Map();
for (const [file, targets] of edges) {
  if (!file.startsWith("program/")) continue;
  for (const target of targets) {
    if (!target.startsWith("program/")) continue;
    const from = areaOf(file);
    const to = areaOf(target);
    if (from === to) continue;
    const key = `${from} -> ${to}`;
    cross.set(key, (cross.get(key) || 0) + 1);
  }
}

console.log("program/ cross-directory edges");
for (const [key, count] of [...cross.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(String(count).padStart(5), key);
}

const fanIn = new Map();
for (const targets of edges.values()) {
  for (const target of targets) fanIn.set(target, (fanIn.get(target) || 0) + 1);
}
console.log("\ntop fan-in");
for (const [file, count] of [...fanIn.entries()]
  .filter(([file]) => file.startsWith("program/"))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)) {
  console.log(String(count).padStart(5), file);
}

// Import cycles, by strongly connected component.
const adjacency = new Map([...edges].filter(([file]) => file.startsWith("program/")));
const index = new Map();
const low = new Map();
const onStack = new Set();
const stack = [];
let counter = 0;
const cycles = [];

function connect(node) {
  index.set(node, counter);
  low.set(node, counter);
  counter += 1;
  stack.push(node);
  onStack.add(node);
  for (const next of adjacency.get(node) || []) {
    if (!index.has(next)) {
      connect(next);
      low.set(node, Math.min(low.get(node), low.get(next)));
    } else if (onStack.has(next)) {
      low.set(node, Math.min(low.get(node), index.get(next)));
    }
  }
  if (low.get(node) === index.get(node)) {
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1) cycles.push(component);
  }
}

for (const node of adjacency.keys()) {
  if (!index.has(node)) connect(node);
}

console.log("\nimport cycles in program/");
if (cycles.length === 0) console.log("  none");
for (const cycle of cycles) console.log(`  ${cycle.join(" -> ")}`);

// How the quizzes reach the program tree.
const quizzes = files.filter((file) => file.startsWith("quiz/") && file.endsWith(".test.mjs"));
let barrelOnly = 0;
let deep = 0;
const deepCounts = new Map();

for (const quiz of quizzes) {
  let reachesDeep = false;
  for (const target of edges.get(quiz) || []) {
    if (!target.startsWith("program/")) continue;
    const segments = target.replace("program/", "").split("/");
    if (segments.length === 1 || segments[segments.length - 1] === "index.mjs") continue;
    reachesDeep = true;
    deepCounts.set(target, (deepCounts.get(target) || 0) + 1);
  }
  if (reachesDeep) deep += 1;
  else barrelOnly += 1;
}

console.log("\nquiz coupling");
console.log(`  quizzes using only barrel/top-level program imports: ${barrelOnly}`);
console.log(`  quizzes importing a deep path: ${deep}`);
console.log("  most-imported deep paths");
for (const [file, count] of [...deepCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(String(count).padStart(5), file);
}

const reached = new Set();
const pending = [];
for (const quiz of quizzes) {
  for (const target of edges.get(quiz) || []) {
    if (target.startsWith("program/")) pending.push(target);
  }
}
while (pending.length) {
  const module = pending.pop();
  if (reached.has(module)) continue;
  reached.add(module);
  for (const target of edges.get(module) || []) {
    if (target.startsWith("program/") && !reached.has(target)) pending.push(target);
  }
}
const programModules = [...known].filter((file) => file.startsWith("program/"));
const reachedCount = programModules.filter((file) => reached.has(file)).length;
console.log(
  `\nprogram modules reached transitively by quizzes: ${reachedCount}/${programModules.length} ` +
    `(${((reachedCount / programModules.length) * 100).toFixed(1)}%)`
);

// Candidate layer violations: edges that run from a lower layer to a higher one.
const RULES = [
  ["program/library", "program/verbs"],
  ["program/library", "program/runtime"],
  ["program/agent", "program/verbs"],
  ["program/motor", "program/verbs"],
  ["program/runtime", "program/agent"],
  ["program/bridge", "program/verbs"],
  ["program/configure", "program/verbs"]
];

console.log("\ncandidate layer violations");
let violations = 0;
for (const [lower, higher] of RULES) {
  let count = 0;
  const seen = new Set();
  for (const [file, targets] of edges) {
    if (!file.startsWith(`${lower}/`)) continue;
    for (const target of targets) {
      if (!target.startsWith(`${higher}/`)) continue;
      const key = `${file}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      count += 1;
    }
  }
  if (count > 0) {
    violations += count;
    console.log(String(count).padStart(5), lower, "->", higher);
  }
}
console.log(`  total: ${violations}`);
```

### Output at `4e31f9f8d`

```
program/ cross-directory edges
   107 program/verbs -> program/remember
    91 program/verbs -> program/error.mjs
    81 program/verbs -> program/library
    63 program/verbs -> program/bridge
    32 program/agent -> program/library
    31 program/verbs -> program/agent
    27 program/verbs -> program/configure
    25 program/library -> program/program.mjs
    22 program/library -> program/error.mjs
    20 program/agent -> program/understand
    19 program/agent -> program/runtime
    17 program/library -> program/beautiful.mjs
    17 program/verbs -> program/motor
    15 program/agent -> program/beautiful.mjs
    15 program/library -> program/runtime
    14 program/verbs -> program/runtime
    12 program/library -> program/understand
    11 program/library -> program/bridge
    10 program/bridge -> program/error.mjs
    10 program/bridge -> program/library
     9 program/verbs -> program/beautiful.mjs
     8 program/agent -> program/bridge
     8 program/runtime -> program/library
     7 program/agent -> program/verbs
     7 program/library -> program/remember
     7 program/library -> program/verbs
     7 program/motor -> program/configure
     6 program/motor -> program/verbs
     6 program/runtime -> program/agent
     5 program/agent -> program/remember
     5 program/motor -> program/remember
     5 program/remember -> program/bridge
     5 program/runtime -> program/understand
     4 program/runtime -> program/beautiful.mjs
     4 program/verbs -> program/understand
     3 program/bridge -> program/beautiful.mjs
     3 program/main.mjs -> program/bridge
     3 program/motor -> program/error.mjs
     3 program/motor -> program/bridge
     3 program/understand -> program/library
     3 program/verbs -> program/program.mjs
     2 program/agent -> program/configure
     2 program/beautiful.mjs -> program/library
     2 program/bridge -> program/verbs
     2 program/bridge -> program/motor
     2 program/bridge -> program/remember
     2 program/configure -> program/remember
     2 program/configure -> program/verbs
     2 program/runtime -> program/bridge
     1 program/bridge -> program/configure
     1 program/bridge -> program/program.mjs
     1 program/error.mjs -> program/bridge
     1 program/library -> program/configure
     1 program/main.mjs -> program/understand
     1 program/main.mjs -> program/remember
     1 program/main.mjs -> program/library
     1 program/main.mjs -> program/beautiful.mjs
     1 program/program.mjs -> program/understand
     1 program/program.mjs -> program/library
     1 program/remember -> program/library
     1 program/report -> program/understand
     1 program/report -> program/library
     1 program/report -> program/beautiful.mjs
     1 program/runtime -> program/configure
     1 program/runtime -> program/remember
     1 program/runtime -> program/error.mjs
     1 program/verbs -> program/katago
     1 program/verbs -> program/report

top fan-in
   574 program/remember/index.mjs
   511 program/understand/index.mjs
   448 program/bridge/index.mjs
   132 program/error.mjs
    81 program/library/sentenceSplitter.mjs
    81 program/beautiful.mjs
    71 program/bridge/exchange.mjs
    54 program/program.mjs

import cycles in program/
  program/motor/mcp/snapshot.mjs -> program/motor/mcp/config.mjs -> program/motor/mcp.mjs -> program/bridge/modules.mjs -> program/bridge/refinery.mjs -> program/bridge/signature/derive.mjs -> program/bridge/signature.mjs -> program/remember/index.mjs
  program/library/vliw/database.mjs -> program/library/vliw/index.mjs

quiz coupling
  quizzes using only barrel/top-level program imports: 483
  quizzes importing a deep path: 298
  most-imported deep paths
    37 program/library/sentenceSplitter.mjs
    28 program/bridge/signature.mjs
    26 program/bridge/exchange.mjs
    17 program/runtime/work/status.mjs
    14 program/motor/mcp.mjs
    13 program/runtime/work/queue.mjs
    11 program/runtime/work/operator.mjs
    11 program/verbs/exchange/compile.mjs
    11 program/bridge/modules.mjs
     9 program/verbs/mind/mind.mjs

program modules reached transitively by quizzes: 590/617 (95.6%)

candidate layer violations
    15 program/library -> program/runtime
     7 program/library -> program/verbs
     7 program/agent -> program/verbs
     6 program/motor -> program/verbs
     6 program/runtime -> program/agent
     2 program/bridge -> program/verbs
     2 program/configure -> program/verbs
  total: 45
```

---

## 2. The test-time attribution

Attributes the time the suite spends to the quiz file and the area it
belongs to. The suite must be run first, with the spec reporter, because
that reporter prints a duration for every test.

### Script

Save as `command/measure_test_suite.mjs`:

```javascript
#!/usr/bin/env node
// Attributes the time the quiz suite spends to each quiz file and each
// domain. Read-only.
//
// Usage: node --test --test-reporter=spec $(git ls-files quiz | grep '\.test\.mjs$')
//        node command/measure_test_suite.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, "artifacts", "quiz-spec.txt");

if (!fs.existsSync(reportPath)) {
  console.error(
    "no spec report found. run the suite first:\n" +
      "  node --test --test-reporter=spec $(git ls-files quiz | grep '\\.test\\.mjs$') " +
      "> artifacts/quiz-spec.txt"
  );
  process.exit(1);
}

const rows = [];
for (const line of fs.readFileSync(reportPath, "utf8").split("\n")) {
  const match = line.match(/^\s*[✔✖] (.+) \(([0-9.]+)ms\)$/u);
  if (match) rows.push([match[1], parseFloat(match[2])]);
}

const quizzes = execFileSync("git", ["ls-files", "quiz"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((file) => file.endsWith(".test.mjs"));

// A test name is matched back to its file by looking for the name in the
// file's source, so the attribution holds as long as the name is unique
// within the tree.
const perFile = new Map();
for (const quiz of quizzes) {
  const source = fs.readFileSync(path.join(root, quiz), "utf8");
  let total = 0;
  for (const [name, duration] of rows) {
    if (source.includes(name)) total += duration;
  }
  perFile.set(quiz, total);
}

const total = [...perFile.values()].reduce((sum, value) => sum + value, 0);
console.log(`tests timed: ${rows.length}`);
console.log(`summed test time: ${(total / 1000).toFixed(1)}s`);

console.log("\nslowest quiz files");
for (const [file, duration] of [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(String(Math.round(duration)).padStart(8) + "ms  " + file);
}

const FAMILIES = [
  ["translation_*", /^quiz\/translation_/],
  ["vocab_suggest_*", /^quiz\/vocab_suggest/],
  ["compile_*", /^quiz\/compile_/],
  ["headquarters_*", /^quiz\/headquarters/],
  ["channel_*", /^quiz\/channel/],
  ["work_*", /^quiz\/runtime\/work_|^quiz\/work_/],
  ["agenda_*", /^quiz\/agenda/],
  ["qwen_say", /^quiz\/qwen_say/],
  ["vliw_*", /^quiz\/vliw_/],
  ["scripts", /^quiz\/scripts/]
];

console.log("\ntime by domain");
for (const [label, pattern] of FAMILIES) {
  let sum = 0;
  let count = 0;
  for (const [file, duration] of perFile) {
    if (!pattern.test(file)) continue;
    sum += duration;
    count += 1;
  }
  console.log(
    `${(sum / 1000).toFixed(1).padStart(9)}s ` +
      `${((sum / total) * 100).toFixed(1).padStart(5)}%  ` +
      `${String(count).padStart(3)} files  ${label}`
  );
}

const sorted = [...perFile.values()].sort((a, b) => b - a);
console.log(`\ntop 10 files: ${((sorted.slice(0, 10).reduce((a, b) => a + b, 0) / total) * 100).toFixed(1)}% of summed time`);
console.log(`top 25 files: ${((sorted.slice(0, 25).reduce((a, b) => a + b, 0) / total) * 100).toFixed(1)}% of summed time`);
console.log(`files under 100ms: ${sorted.filter((value) => value < 100).length} of ${sorted.length}`);
```

### Output at `4e31f9f8d`

```
tests timed: 3301
summed test time: 758.9s

slowest quiz files
   63367ms  quiz/translation_english_sentence.test.mjs
   62523ms  quiz/module_manuscript_scored_refinery.test.mjs
   60222ms  quiz/translation_pipeline.test.mjs
   37461ms  quiz/compiled_command_policy_identity.test.mjs
   24429ms  quiz/translation_english30k_coverage.test.mjs
   16214ms  quiz/translation_english_wordnet_bridges.test.mjs
   16164ms  quiz/translation_english_wordnet_refinery.test.mjs
   16140ms  quiz/pyash_configure_cli.test.mjs
   15798ms  quiz/document_digestion.test.mjs
   15553ms  quiz/qwen_say.test.mjs
   15512ms  quiz/refinery_checkpoint.test.mjs
   14593ms  quiz/coding_saddle.test.mjs
   14549ms  quiz/scripts.test.mjs
   11175ms  quiz/run_args.test.mjs
   11048ms  quiz/example_audit_report.test.mjs

time by domain
    219.7s  28.9%   55 files  translation_*
     36.1s   4.8%    6 files  vocab_suggest_*
     16.3s   2.1%   96 files  compile_*
     10.3s   1.4%    6 files  headquarters_*
      4.8s   0.6%    8 files  channel_*
      9.7s   1.3%   18 files  work_*
      5.8s   0.8%    8 files  agenda_*
     15.6s   2.0%    1 files  qwen_say
      0.2s   0.0%   12 files  vliw_*
     14.5s   1.9%    1 files  scripts

top 10 files: 43.2% of summed time
top 25 files: 64.2% of summed time
files under 100ms: 501 of 781
```

The domain grouping is by file-name prefix, which is what makes the flat
layout visible: `translation_` is a domain that happens to be spelled in
57 file names, and there is no directory that says so. The proposal's
translation and vocabulary share is 28.9% plus 4.8%, or 33.7%.

---

## 3. The suite runs

```
gh run view 41551328723 --log-failed 2>&1 \
  | grep -E '^test.*# (tests|pass|fail|skipped|duration_ms) '
```

```
test	Run tests	2026-11-03T00:18:43.7702093Z # tests 3280
test	Run tests	2026-11-03T00:18:43.7702247Z # pass 3249
test	Run tests	2026-11-03T00:18:43.7702314Z # fail 1
test	Run tests	2026-11-03T00:18:43.7702468Z # skipped 25
test	Run tests	2026-11-03T00:18:43.7702632Z # duration_ms 270331.939667
```

The single failure is
`existential phrase-list decisions survive English-to-Pyac and Pyash
projection` in `quiz/translation_pipeline.test.mjs`, which reproduces in
isolation and sits in another agent's in-flight translation work.
