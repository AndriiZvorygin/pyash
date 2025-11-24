import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// detect noun class
function detectType(v) {
  if (v == null) return "null";
  if (typeof v.num === "number") return "num";
  if (typeof v.name === "string") return "name";
  if (typeof v === "number") return "num";
  if (typeof v === "string") return "str";
  return "unknown";
}

export async function add({ obj, to }) {
  const objType = detectType(obj);
  const toType = detectType(to);

  const moduleName = `add_obj_${objType}_to_${toType}.mjs`;
  const modulePath = path.join(__dirname, moduleName);

  if (!fs.existsSync(modulePath)) {
    throw new Error(`add: no handler for ${moduleName}`);
  }

  const mod = await import(modulePath);
  if (typeof mod.default !== "function")
    throw new Error(`add: ${moduleName} missing default export`);

  return mod.default({ obj, to });
}
