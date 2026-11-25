#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { BACKENDS, runCase } from "../program/library/parity/backends.mjs";
import { CASES } from "../program/library/parity/cases.mjs";

function sameLines(left, right) {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function compareCase(testCase, outputs) {
  const report = {
    family: testCase.family,
    name: testCase.name,
    known: testCase.known ?? null,
    ok: true,
    backends: {}
  };
  if (testCase.expected === "same") {
    const reference = outputs[testCase.backends[0]];
    for (const backend of testCase.backends) {
      const output = outputs[backend];
      const pass = output.code === 0
        && !output.timedOut
        && sameLines(output.lines, reference.lines);
      report.backends[backend] = {
        status: pass ? "pass" : "fail",
        actual: { code: output.code, lines: output.lines },
        expected: { code: 0, lines: reference.lines }
      };
      if (!pass) report.ok = false;
    }
    return report;
  }
  for (const backend of testCase.backends) {
    const output = outputs[backend];
    const baseline = testCase.expected[backend];
    const pass = output.code === baseline.code
      && !output.timedOut
      && sameLines(output.lines, baseline.lines);
    report.backends[backend] = {
      status: pass ? "pinned" : "fail",
      actual: { code: output.code, lines: output.lines },
      expected: baseline
    };
    if (!pass) report.ok = false;
  }
  return report;
}

export async function runParityGate({ cases = CASES, timeoutMs } = {}) {
  const results = [];
  for (const testCase of cases) {
    const outputs = await runCase(testCase.backends, testCase.lines, { timeoutMs });
    results.push(compareCase(testCase, outputs));
  }
  return { ok: results.every((result) => result.ok), results };
}

function printReport(report) {
  const rows = report.results.map((result) => ({
    label: `${result.family}/${result.name}`,
    statuses: BACKENDS.map((backend) => result.backends[backend]?.status ?? "missing")
  }));
  const width = Math.max(24, ...rows.map((row) => row.label.length));
  console.log(`${"case".padEnd(width)}  ${BACKENDS.map((backend) => backend.padEnd(11)).join("  ")}`);
  for (const row of rows) {
    console.log(`${row.label.padEnd(width)}  ${row.statuses.map((status) => status.padEnd(11)).join("  ")}`);
  }
  for (const result of report.results) {
    if (result.ok) continue;
    console.log(`\nFAIL ${result.family}/${result.name}`);
    for (const backend of BACKENDS) {
      const entry = result.backends[backend];
      if (entry?.status === "fail") {
        console.log(`  ${backend}: expected ${JSON.stringify(entry.expected)} got ${JSON.stringify(entry.actual)}`);
      }
    }
  }
  console.log(report.ok ? "\nparity gate: pass" : "\nparity gate: fail");
}

async function main() {
  const report = await runParityGate();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
