import { throwErrorSentence } from "../../../../error.mjs";

function normalizeJoin(segments) {
  let absolute = false;
  const parts = [];

  for (const raw of segments) {
    let segment = String(raw ?? "");
    if (!segment) continue;
    segment = segment.replace(/\\/gu, "/");
    segment = segment.replace(/^\.\/+/u, "");
    if (!segment || segment === ".") continue;
    if (!absolute && segment.startsWith("/")) absolute = true;
    const units = segment.split("/").filter(part => part !== "" && part !== ".");
    parts.push(...units);
  }

  if (!parts.length) return absolute ? "/" : "";
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

function resolveLiteralSegments(sentence) {
  const ob = sentence?.ob ?? {};
  if (ob.ve) {
    const values = Array.isArray(ob.ve.values) ? ob.ve.values : [];
    const type = String(ob.ve.type ?? "").trim().toLowerCase();
    if (type === "text" || type === "filename" || !type) {
      return values.map(value => String(value ?? ""));
    }
    if (type === "num") {
      return values.map((value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          throw new Error("num segment invalid");
        }
        return String(num);
      });
    }
    throw new Error("vector type unsupported");
  }
  if (typeof ob.text === "string") return [ob.text];
  if (typeof ob.filename === "string") return [ob.filename];
  if (Number.isFinite(Number(ob.num))) return [String(Number(ob.num))];
  throw new Error("dynamic segments unsupported");
}

export function handleNativePathJoin(context, helpers) {
  const { sentence, baseBe, lang, locals, declared, declaredTypes, cHelpers, rememberFlag } = context;
  const { sanitizeName, markDeclared } = helpers;
  if (baseBe !== "path join") return null;

  const targetName = sentence?.to?.name ?? null;
  if (!targetName) {
    throwErrorSentence({
      name: "compile error",
      message: "compile: path join target missing (use to name ...)",
      from: { name: "compile" },
      raw: { sentence }
    });
  }

  let segments = [];
  try {
    segments = resolveLiteralSegments(sentence);
  } catch (err) {
    throwErrorSentence({
      name: "compile error",
      message: `compile: path join ${String(err?.message ?? "unsupported")}`,
      from: { name: "compile" },
      raw: { sentence }
    });
  }

  const joined = normalizeJoin(segments);
  const asFilename =
    sentence?.to?.filename !== undefined ||
    Array.isArray(sentence?.to?.nameTypeWords) && sentence.to.nameTypeWords.includes("filename");
  const safeTarget = sanitizeName(targetName);

  if (lang === "c") {
    if (cHelpers) {
      cHelpers.usesTextHelper = true;
      cHelpers.usesString = true;
      cHelpers.usesPrintf = true;
    }
    const needsDecl = !locals?.has(safeTarget) && !declared?.has(safeTarget) && !declared?.has(targetName);
    const lines = [];
    if (needsDecl) {
      lines.push(`char ${safeTarget}[PYA_TEXT_CAP] = "";`);
      markDeclared(declared, targetName);
    }
    lines.push(`snprintf(${safeTarget}, PYA_TEXT_CAP, "%s", ${JSON.stringify(joined)});`);
    if (declaredTypes) declaredTypes.set(targetName, asFilename ? "filename" : "text");
    return lines.join("\n");
  }

  if (rememberFlag) rememberFlag.used = true;
  const needsDecl = !declared?.has(targetName) && !declared?.has(safeTarget);
  const lines = [];
  if (needsDecl) {
    lines.push(`let ${safeTarget};`);
  }
  if (asFilename) {
    lines.push(`${safeTarget} = { su: { name: ${JSON.stringify(targetName)} }, ob: { filename: ${JSON.stringify(joined)} }, be: "filename", mood: "ya" };`);
  } else {
    lines.push(`${safeTarget} = { su: { name: ${JSON.stringify(targetName)} }, ob: { text: ${JSON.stringify(joined)} }, be: "text", mood: "ya" };`);
  }
  lines.push(`globalThis[${JSON.stringify(targetName)}] = ${safeTarget};`);
  lines.push(`globalThis.result = { ...${safeTarget}, su: { name: "result" } };`);
  markDeclared(declared, targetName);
  if (declaredTypes) declaredTypes.set(targetName, asFilename ? "filename" : "text");
  return lines.join("\n");
}
