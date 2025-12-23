import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// following the dynamic dispatch style used in add.mjs
function detectType(value) {
  if (value?.filename) return "filename";
  if (typeof value === "string") return "text";
  return "unknown";
}

export async function read_from_filename({ from }) {
  const modulePath = path.join(__dirname, "read_from_filename.mjs");
  if (!fs.existsSync(modulePath)) {
    throw new Error("read: no handler for filename");
  }
  const mod = await import(modulePath);
  const result = await mod.default({ from });
  return { ob: result.ob, be: "text" };
}

export default async function read({ from }) {
  const fromType = detectType(from);
  if (fromType === "filename") {
    return read_from_filename({ from });
  }
  throw new Error(`read: no handler for ${fromType}`);
}

export const signatures = [
  { signatureWords: ["be", "read", "from", "filename"], handler: read_from_filename }
];
