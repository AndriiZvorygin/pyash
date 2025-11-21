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

export default async function read({ from }) {
  const fromType = detectType(from);
  const moduleName = `read_from_${fromType}.mjs`;
  const modulePath = path.join(__dirname, moduleName);

  if (!fs.existsSync(modulePath)) {
    throw new Error(`read: no handler for ${moduleName}`);
  }

  const mod = await import(modulePath);
  if (typeof mod.default !== "function") {
    throw new Error(`read: ${moduleName} missing default export`);
  }

  return mod.default({ from });
}
