import fs from "node:fs/promises";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";

export default async function readFromFilename({ from }) {
  const filename = from?.filename;
  if (!filename) throw new Error("read_from_filename: filename is required");

  const buffer = await fs.readFile(filename);
  const artifact = recordArtifact({ locator: filename, producer: "exchange", bytes: buffer });
  if (artifact?.su?.name) {
    recordExchange({ artifactName: artifact.su.name, op: "read", producer: "exchange" });
  }
  return { ob: { filename } };
}
