import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { throwErrorSentence } from "../../error.mjs";
import { compareUtf8, jsonValueFromObj } from "./json_map_export.mjs";
import { read_fromstate_csv } from "./read_csv.mjs";
import { read_fromstate_json } from "./read_json.mjs";
import { read_fromstate_yaml } from "./read_yaml.mjs";
import { read_fromstate_html } from "./read_html.mjs";
import { read_fromstate_pdf } from "./read_pdf.mjs";

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

export async function read_ob_filename(sentence) {
  return read_from_filename({ from: sentence?.ob });
}

function read_as_html(sentence) {
  return read_fromstate_html({ ...sentence, fromstate: { name: "html" } });
}

function read_as_pdf(sentence) {
  return read_fromstate_pdf({ ...sentence, fromstate: { name: "pdf" } });
}

function parseAllGenitive(genitive) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length < 2) return null;
  const tail = chainArr.at(-1);
  if (tail !== "all") return null;
  const mapName = chainArr[0];
  if (typeof mapName !== "string" || !mapName) return null;
  const role = chainArr.length > 2 ? chainArr[chainArr.length - 2] : null;
  return { mapName, role };
}

export async function read_from_json_map_all(sentence, { remember } = {}) {
  const info = parseAllGenitive(sentence?.ob?.genitive);
  if (!info) {
    throw new Error("read: no handler for all");
  }
  const { mapName, role } = info;
  const fact = remember ? remember(mapName) : null;
  if (!fact || fact.be !== "json map") {
    throwErrorSentence({
      name: "json map enumeration defective",
      message: "json map enumeration defective",
      from: { name: "read" },
      raw: { name: mapName }
    });
  }

  const entries = fact?.ob?.map ?? {};
  const keys = Object.keys(entries).sort(compareUtf8);
  const seen = new Set();
  const outKeys = [];
  const outValues = [];
  const outEntries = [];
  for (const key of keys) {
    const value = jsonValueFromObj(entries[key], { remember, seen, sourceName: "read", allowHollowVector: true });
    if (value === undefined) continue;
    outKeys.push(key);
    outValues.push(value);
    outEntries.push({ ve: { type: "raw", values: [key, value] } });
  }

  if (role === "su") {
    return { ob: { ve: { type: "text", values: outKeys } }, be: "vector" };
  }
  if (role === "ob") {
    const type = outValues.every((v) => typeof v === "number")
      ? "num"
      : outValues.every((v) => typeof v === "string")
        ? "text"
        : outValues.every((v) => typeof v === "boolean")
          ? "bool"
          : "raw";
    return { ob: { ve: { type, values: outValues } }, be: "vector" };
  }
  return { ob: { ve: { type: "raw", values: outEntries } }, be: "vector" };
}

export default async function read({ from }) {
  const fromType = detectType(from);
  if (fromType === "filename") {
    return read_from_filename({ from });
  }
  throw new Error(`read: no handler for ${fromType}`);
}

export const signatures = [
  { signatureWords: ["be", "read", "from", "filename"], handler: read_from_filename },
  { signatureWords: ["be", "read", "ob", "filename"], handler: read_ob_filename },
  { signatureWords: ["be", "read", "ob", "all"], handler: read_from_json_map_all },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "json", "to", "name"], handler: read_fromstate_json },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "json", "to", "name", "num"], handler: read_fromstate_json },
  { signatureWords: ["be", "read", "fromstate", "name", "json", "ob", "text", "to", "name"], handler: read_fromstate_json },
  { signatureWords: ["be", "read", "fromstate", "name", "json", "ob", "text", "to", "name", "num"], handler: read_fromstate_json },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "csv", "to", "name"], handler: read_fromstate_csv },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "csv", "to", "name", "num"], handler: read_fromstate_csv },
  { signatureWords: ["be", "read", "fromstate", "name", "csv", "ob", "text", "to", "name"], handler: read_fromstate_csv },
  { signatureWords: ["be", "read", "fromstate", "name", "csv", "ob", "text", "to", "name", "num"], handler: read_fromstate_csv },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "yaml", "to", "name"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "yaml", "to", "name", "num"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "fromstate", "name", "yaml", "ob", "text", "to", "name"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "fromstate", "name", "yaml", "ob", "text", "to", "name", "num"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "from", "text", "fromstate", "name", "yaml", "to", "name"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "from", "text", "fromstate", "name", "yaml", "to", "name", "num"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "fromtext", "text", "fromstate", "name", "yaml", "to", "name"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "fromtext", "text", "fromstate", "name", "yaml", "to", "name", "num"], handler: read_fromstate_yaml },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "html"], handler: read_fromstate_html },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "html", "to", "name"], handler: read_fromstate_html },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "html", "to", "name", "text"], handler: read_fromstate_html },
  { signatureWords: ["be", "read", "from", "filename", "as", "wo", "html"], handler: read_as_html },
  { signatureWords: ["be", "read", "from", "filename", "as", "wo", "html", "to", "name"], handler: read_as_html },
  { signatureWords: ["be", "read", "from", "filename", "as", "wo", "html", "to", "name", "text"], handler: read_as_html },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "pdf"], handler: read_fromstate_pdf },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "pdf", "to", "name"], handler: read_fromstate_pdf },
  { signatureWords: ["be", "read", "from", "filename", "fromstate", "name", "pdf", "to", "name", "text"], handler: read_fromstate_pdf },
  { signatureWords: ["be", "read", "from", "filename", "as", "wo", "pdf"], handler: read_as_pdf },
  { signatureWords: ["be", "read", "from", "filename", "as", "wo", "pdf", "to", "name"], handler: read_as_pdf },
  { signatureWords: ["be", "read", "from", "filename", "as", "wo", "pdf", "to", "name", "text"], handler: read_as_pdf }
];
