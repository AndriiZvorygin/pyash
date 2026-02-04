import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { throwErrorSentence } from "../../error.mjs";
import { handleFileUnavailable } from "../../library/file_errors.mjs";
import { compareUtf8, jsonValueFromObj } from "./json_map_export.mjs";
import { remember } from "../../remember/index.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { splitSentences } from "../../library/sentenceSplitter.mjs";
import { read_fromstate_csv } from "./read_csv.mjs";
import { read_fromstate_json } from "./read_json.mjs";
import { read_fromstate_yaml } from "./read_yaml.mjs";
import { read_fromstate_lobster } from "./read_lobster.mjs";
import { isWorldToolsActive, resolveWorldPath, resolveWorldPlace, resolveWorldPlaceDir } from "../../library/world.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// following the dynamic dispatch style used in add.mjs
function detectType(value) {
  if (value?.filename) return "filename";
  if (typeof value === "string") return "text";
  return "unknown";
}

export async function read_from_filename({ from }) {
  if (isWorldToolsActive({ rememberFn: remember })) {
    const { resolved, outside, root } = resolveWorldPath(from?.filename ?? "", { rememberFn: remember });
    if (outside) {
      throwErrorSentence({
        name: "read defective",
        message: `read defective: outside world root (${root})`,
        from: { name: "read" },
        raw: { from }
      });
    }
    from = { ...from, filename: resolved };
  }
  const modulePath = path.join(__dirname, "read_from_filename.mjs");
  if (!fs.existsSync(modulePath)) {
    throw new Error("read: no handler for filename");
  }
  const mod = await import(modulePath);
  const result = await mod.default({ from });
  const response = { ob: result.ob, be: "read" };
  if (result?.value) response.value = result.value;
  return response;
}

export async function read_ob_filename(sentence) {
  return read_from_filename({ from: sentence?.ob });
}

export async function read_tail_from_filename(sentence) {
  const fromValue = sentence?.from ?? {};
  const filename = fromValue?.filename ?? fromValue?.text ?? null;
  const tailFlag = sentence?.ob?.wo ?? sentence?.ob?.text ?? null;
  if (tailFlag && String(tailFlag) !== "tail") {
    throwErrorSentence({
      name: "read defective",
      message: `read defective: unknown tail mode ${tailFlag}`,
      from: { name: "read" },
      raw: { sentence }
    });
  }
  const limit = sentence?.atmost?.num ?? sentence?.atmost?.quantity?.num ?? 10;
  if (!filename) {
    throwErrorSentence({
      name: "read defective",
      message: "read defective: missing filename",
      from: { name: "read" },
      raw: { sentence }
    });
  }
  let targetPath = path.resolve(String(filename));
  if (isWorldToolsActive({ rememberFn: remember })) {
    if (filename === ".activity.pya") {
      const place = resolveWorldPlace({ rememberFn: remember }) ?? "commons";
      const placeDir = resolveWorldPlaceDir(place, { rememberFn: remember });
      if (placeDir) targetPath = path.join(placeDir, filename);
    } else {
      const { resolved, outside, root } = resolveWorldPath(filename, { rememberFn: remember });
      if (outside) {
        throwErrorSentence({
          name: "read defective",
          message: `read defective: outside world root (${root})`,
          from: { name: "read" },
          raw: { filename }
        });
      }
      targetPath = resolved;
    }
  }
  let text = "";
  try {
    text = fs.readFileSync(targetPath, "utf8");
  } catch (err) {
    handleFileUnavailable(err, { path: targetPath, from: "read" });
    return { ob: { ve: { type: "hollow", values: [] } }, be: "read" };
  }
  const lines = splitSentences(text).slice(-(limit > 0 ? limit : undefined));
  return { ob: { ve: { type: "text", values: lines } }, be: "read" };
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
  { signatureWords: ["be", "read", "ob", "wo", "tail", "from", "filename"], handler: read_tail_from_filename },
  { signatureWords: ["be", "read", "ob", "wo", "tail", "from", "filename", "atmost", "num"], handler: read_tail_from_filename },
  { signatureWords: ["be", "read", "ob", "wo", "tail", "atmost", "num", "from", "filename"], handler: read_tail_from_filename },
  { signatureWords: ["be", "read", "atmost", "num", "from", "filename", "ob", "wo"], handler: read_tail_from_filename },
  { signatureWords: ["be", "read", "ob", "wo", "tail", "from", "filename", "to", "name", "text"], handler: read_tail_from_filename },
  { signatureWords: ["be", "read", "ob", "wo", "tail", "from", "filename", "atmost", "num", "to", "name", "text"], handler: read_tail_from_filename },
  { signatureWords: ["be", "read", "ob", "wo", "tail", "atmost", "num", "from", "filename", "to", "name", "text"], handler: read_tail_from_filename },
  { signatureWords: ["be", "read", "atmost", "num", "from", "filename", "ob", "wo", "to", "name", "text"], handler: read_tail_from_filename },
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
  { signatureWords: ["be", "read", "become", "wo", "pyash", "from", "filename", "fromstate", "name", "lobster", "to", "name", "text"], handler: read_fromstate_lobster },
  { signatureWords: ["be", "read", "become", "wo", "pyash", "from", "filename", "fromstate", "name", "lobster", "to", "name", "num"], handler: read_fromstate_lobster },
  { signatureWords: ["be", "read", "become", "wo", "pyash", "from", "text", "fromstate", "name", "lobster", "to", "name", "text"], handler: read_fromstate_lobster },
  { signatureWords: ["be", "read", "become", "wo", "pyash", "from", "text", "fromstate", "name", "lobster", "to", "name", "num"], handler: read_fromstate_lobster },
  { signatureWords: ["be", "read", "become", "wo", "pyash", "fromtext", "text", "fromstate", "name", "lobster", "to", "name", "text"], handler: read_fromstate_lobster },
  { signatureWords: ["be", "read", "become", "wo", "pyash", "fromtext", "text", "fromstate", "name", "lobster", "to", "name", "num"], handler: read_fromstate_lobster },
  { signatureWords: ["be", "read", "become", "wo", "pyash", "fromstate", "name", "lobster", "ob", "text", "to", "name", "text"], handler: read_fromstate_lobster },
  { signatureWords: ["be", "read", "become", "wo", "pyash", "fromstate", "name", "lobster", "ob", "text", "to", "name", "num"], handler: read_fromstate_lobster }
];
