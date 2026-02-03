import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { buildErrorSentence, surfaceErrorSentence } from "../program/error.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { hashLocator, setExchangeRecorder, clearExchangeRecorder, setExchangeRunRoot } from "../program/bridge/exchange.mjs";

function readFlagValue(args, name) {
  const prefix = `${name}=`;
  const idx = args.findIndex(arg => arg === name || arg.startsWith(prefix));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return args[idx + 1] ?? null;
}

function normalizeLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);
}

function contentAddressPath(hash, locator) {
  if (!hash) return null;
  const ext = locator ? path.extname(locator) : "";
  return path.join("artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`);
}

async function main() {
  const args = process.argv.slice(2);
  const runId = readFlagValue(args, "--run-id") || "run";
  const runRootOverride = readFlagValue(args, "--run-root");
  const runRoot = runRootOverride ? path.resolve(runRootOverride) : process.cwd();
  const newspaperPath = path.resolve(runRoot, "newspaper", `${runId}.pya`);
  const text = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(text);
  const errors = [];
  setExchangeRecorder({ record: () => {}, runRoot });
  setExchangeRunRoot(runRoot);

  for (const line of lines) {
    if (!line.trim()) continue;
    const sentence = parse(line);
    if (sentence.be === "artifact") {
      const locator = sentence.to?.filename ?? sentence.ob?.text;
      const expectedHash = sentence.fromtext?.text;
      if (locator && expectedHash) {
        try {
          const caLocator = contentAddressPath(expectedHash, locator);
          let info = null;
          try {
            info = hashLocator(caLocator);
          } catch {
            info = hashLocator(locator);
          }
          if (!info || info.hash !== expectedHash) {
            errors.push(buildErrorSentence({
              name: "hash inconsistency",
              message: "hash inconsistency",
              from: { name: "replay" },
              raw: { locator }
            }));
          }
        } catch (err) {
          errors.push(buildErrorSentence({
            name: "replay defective",
            message: err?.message ?? "replay defective",
            from: { name: "replay" },
            raw: { locator }
          }));
        }
      }
    }
  }

  clearExchangeRecorder();

  if (errors.length > 0) {
    const errSentence = surfaceErrorSentence(errors[0]);
    console.error(sentenceToPyash(errSentence));
    process.exit(1);
  }
  console.log(`exists su name ${runId} be replay ya`);
}

main().catch(err => {
  const errSentence = surfaceErrorSentence(buildErrorSentence({
    name: "replay defective",
    message: err?.message ?? "replay defective",
    from: { name: "replay" }
  }));
  console.error(sentenceToPyash(errSentence));
  process.exit(1);
});
