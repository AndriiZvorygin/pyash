import fs from "node:fs/promises";
import path from "node:path";
import {
  verifyPyashText,
  buildVerifyOutcomeSeries,
  renderVerifyOutcomeSeriesLines
} from "../../program/library/pyash_verify.mjs";

function firstPositional(args) {
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] ?? "");
    if (!token || token.startsWith("--")) continue;
    if (i > 0) {
      const prev = String(args[i - 1] ?? "");
      if (prev === "--root" || prev === "--text") continue;
    }
    return token;
  }
  return "";
}

export function createVerifyCommand(deps) {
  const {
    resolveRootDirFromArgs,
    hasFlag,
    parseArgValue,
    jsonOut,
    textOut
  } = deps;

  return async function verifyCommand(args) {
    const json = hasFlag(args, "--json");
    const rootDir = await resolveRootDirFromArgs(args);
    const inlineText = parseArgValue(args, "--text");
    const positional = firstPositional(args);
    if (!inlineText && !positional) throw new Error("verify requires a file path or --text");
    if (inlineText && positional) throw new Error("verify accepts either file path or --text, not both");

    let sourceText = String(inlineText ?? "");
    let source = "";
    if (!inlineText) {
      source = path.resolve(rootDir, positional);
      sourceText = await fs.readFile(source, "utf8");
    }

    const report = verifyPyashText(sourceText, { source });
    const series = buildVerifyOutcomeSeries(report);
    const payload = {
      ok: report.ok,
      route: "verify",
      source: report.source,
      sentenceCount: report.sentenceCount,
      issueCount: report.issueCount,
      issues: report.issues,
      series
    };

    if (json) {
      jsonOut(payload);
    } else {
      for (const line of renderVerifyOutcomeSeriesLines(series)) textOut(line);
    }
    if (!report.ok) process.exitCode = 1;
  };
}
