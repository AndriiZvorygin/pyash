import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { throwErrorSentence } from "../../error.mjs";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";

async function runPandoc({ inputText, filename }) {
  return new Promise((resolve, reject) => {
    const args = ["-f", "html", "-t", "plain", "--wrap=none"];
    if (filename) args.push(filename);
    const proc = spawn("pandoc", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", data => { stdout += data.toString("utf8"); });
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", status => resolve({ status, stdout, stderr }));
    if (!filename) {
      proc.stdin.end(Buffer.from(String(inputText ?? ""), "utf8"));
    } else {
      proc.stdin.end();
    }
  });
}

export async function read_fromstate_html(sentence) {
  const source = "read html";
  const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
  let sourceText = sentence?.ob?.text ?? sentence?.from?.text;
  let sourceBuffer = null;

  if (sourceFilename) {
    try {
      sourceBuffer = await fs.readFile(sourceFilename);
      sourceText = sourceBuffer.toString("utf8");
    } catch (err) {
      throwErrorSentence({
        name: "html lost",
        message: "html lost",
        from: { name: source },
        raw: { filename: sourceFilename, error: err?.message }
      });
    }
  }

  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "html defective",
      message: "html defective",
      from: { name: source },
      raw: { filename: sourceFilename }
    });
  }

  if (sourceFilename && sourceBuffer) {
    const artifact = recordArtifact({ locator: sourceFilename, producer: "exchange", bytes: sourceBuffer });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "read", producer: "exchange" });
    }
  }

  let result;
  try {
    result = await runPandoc({ inputText: sourceText, filename: sourceFilename });
  } catch (err) {
    if (err?.code === "ENOENT") {
      throwErrorSentence({
        name: "html defective",
        message: "html defective: pandoc missing",
        from: { name: source },
        raw: { error: err?.message }
      });
    }
    throwErrorSentence({
      name: "html defective",
      message: "html defective",
      from: { name: source },
      raw: { error: err?.message }
    });
  }

  if (result?.status !== 0) {
    throwErrorSentence({
      name: "html defective",
      message: `html defective: pandoc failed${result.stderr ? ` (${result.stderr.trim()})` : ""}`,
      from: { name: source },
      raw: { status: result.status }
    });
  }

  return { ob: { text: result.stdout ?? "" }, be: "text" };
}
