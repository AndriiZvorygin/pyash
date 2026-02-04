import fs from "node:fs/promises";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
import { handleFileUnavailable } from "../../library/file_errors.mjs";

export default async function readFromFilename({ from }) {
  const filename = from?.filename;
  if (!filename) throw new Error("read_from_filename: filename is required");

  let buffer;
  try {
    buffer = await fs.readFile(filename);
  } catch (err) {
    handleFileUnavailable(err, { path: filename, from: "read" });
  }
  const artifact = recordArtifact({ locator: filename, producer: "exchange", bytes: buffer });
  if (artifact?.su?.name) {
    recordExchange({ artifactName: artifact.su.name, op: "read", producer: "exchange" });
  }
  const text = buffer.toString("utf8");
  return { ob: { filename, text }, value: { text } };
}
