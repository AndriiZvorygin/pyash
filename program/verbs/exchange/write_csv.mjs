import { throwErrorSentence } from "../../error.mjs";

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function csvTextFromMapName(name, { rememberFn } = {}) {
  const fact = rememberFn ? rememberFn(name) : null;
  if (!fact || fact.be !== "csv map") {
    throwErrorSentence({
      name: "csv columns defective",
      message: "csv columns defective",
      from: { name: "write csv" },
      raw: { name }
    });
  }
  const entries = fact?.ob?.map ?? {};
  const headerRaw = entries["header raw"]?.ve?.values;
  const header = entries.header?.ve?.values;
  let headers = Array.isArray(headerRaw) ? headerRaw : header;
  if (Array.isArray(headerRaw)) {
    const seen = new Set();
    let defective = false;
    for (const cell of headerRaw) {
      const key = String(cell ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!key || seen.has(key)) {
        defective = true;
        break;
      }
      seen.add(key);
    }
    if (defective) headers = header;
  }
  if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(header)) {
    throwErrorSentence({
      name: "csv columns defective",
      message: "csv columns defective",
      from: { name: "write csv" },
      raw: { name }
    });
  }

  const columns = header.map((key) => {
    const col = entries[key];
    if (!col?.ve?.values || col.ve.type !== "text") {
      throwErrorSentence({
        name: "csv columns defective",
        message: "csv columns defective",
        from: { name: "write csv" },
        raw: { name, key }
      });
    }
    return col.ve.values.map((v) => String(v ?? ""));
  });

  const length = columns[0]?.length ?? 0;
  for (const col of columns) {
    if (col.length !== length) {
      throwErrorSentence({
        name: "csv columns defective",
        message: "csv columns defective",
        from: { name: "write csv" },
        raw: { name }
      });
    }
  }

  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (let i = 0; i < length; i += 1) {
    const row = columns.map((col) => csvEscape(col[i] ?? ""));
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}
