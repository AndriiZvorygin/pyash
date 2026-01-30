import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { throwErrorSentence } from "../../error.mjs";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";

async function runPdfToText({ filename }) {
  return new Promise((resolve, reject) => {
    const args = ["-layout", filename, "-"];
    const proc = spawn("pdftotext", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", data => { stdout += data.toString("utf8"); });
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", status => resolve({ status, stdout, stderr }));
  });
}

export async function read_fromstate_pdf(sentence) {
  const source = "read pdf";
  const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
  if (!sourceFilename) {
    throwErrorSentence({
      name: "pdf lost",
      message: "pdf lost",
      from: { name: source },
      raw: { filename: sourceFilename }
    });
  }

  let sourceBuffer;
  try {
    sourceBuffer = await fs.readFile(sourceFilename);
  } catch (err) {
    throwErrorSentence({
      name: "pdf lost",
      message: "pdf lost",
      from: { name: source },
      raw: { filename: sourceFilename, error: err?.message }
    });
  }

  const artifact = recordArtifact({ locator: sourceFilename, producer: "exchange", bytes: sourceBuffer });
  if (artifact?.su?.name) {
    recordExchange({ artifactName: artifact.su.name, op: "read", producer: "exchange" });
  }

  let result;
  try {
    result = await runPdfToText({ filename: sourceFilename });
  } catch (err) {
    if (err?.code === "ENOENT") {
      throwErrorSentence({
        name: "pdf defective",
        message: "pdf defective: pdftotext missing",
        from: { name: source },
        raw: { error: err?.message }
      });
    }
    throwErrorSentence({
      name: "pdf defective",
      message: "pdf defective",
      from: { name: source },
      raw: { error: err?.message }
    });
  }

  if (result?.status !== 0) {
    throwErrorSentence({
      name: "pdf defective",
      message: `pdf defective: pdftotext failed${result.stderr ? ` (${result.stderr.trim()})` : ""}`,
      from: { name: source },
      raw: { status: result.status }
    });
  }

  return { ob: { text: result.stdout ?? "" }, be: "text" };
}
